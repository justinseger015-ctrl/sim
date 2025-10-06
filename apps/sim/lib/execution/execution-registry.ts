import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext } from '@/executor/types'

const logger = createLogger('ExecutionRegistry')

// Server-side only imports
let Redis: any = null
let getRedisClient: any = null

// Dynamically import Redis only on server-side
const initRedis = async () => {
  if (typeof window !== 'undefined') {
    return null
  }
  
  if (!Redis || !getRedisClient) {
    try {
      const redisModule = await import('@/lib/redis')
      getRedisClient = redisModule.getRedisClient
      Redis = (await import('ioredis')).default
    } catch (error) {
      logger.error('Failed to import Redis', { error })
      return null
    }
  }
  
  return getRedisClient?.()
}

// Timeout for waiting on Redis (5 minutes max for webhook-based waits)
const WAIT_TIMEOUT_SECONDS = 300

interface WaitInfo {
  workflowId: string
  executionId: string
  blockId: string
  pausedAt: string
  resumeUrl?: string
  triggerType: 'webhook' | 'manual'
  context: ExecutionContext
}

/**
 * Execution Registry manages active workflow executions using Redis for coordination.
 * This enables sleep/wake patterns across multiple ECS tasks without DB persistence.
 */
export class ExecutionRegistry {
  private static instance: ExecutionRegistry

  // In-memory fallback for when Redis is not available (local dev, etc.)
  private inMemoryWaits = new Map<string, {
    waitInfo: WaitInfo
    resolvers: Array<(resumeData: any) => void>
  }>()

  private constructor() {}

  static getInstance(): ExecutionRegistry {
    if (!ExecutionRegistry.instance) {
      ExecutionRegistry.instance = new ExecutionRegistry()
    }
    return ExecutionRegistry.instance
  }

  /**
   * Get the Redis key for storing wait info
   */
  private getWaitInfoKey(executionId: string): string {
    return `execution:wait:${executionId}`
  }

  /**
   * Get the Redis key for storing resume data/signal
   */
  private getResumeDataKey(executionId: string): string {
    return `execution:resume:${executionId}`
  }

  /**
   * Register a waiting execution and sleep until resumed.
   * This blocks the current thread until the execution is resumed via webhook/API.
   * Uses polling approach for better compatibility with serverless environments.
   * 
   * @param waitInfo Information about the waiting execution
   * @returns Resume data when execution is woken up, or null if timeout
   */
  async waitForResume(waitInfo: WaitInfo): Promise<any> {
    const { executionId, workflowId } = waitInfo

    logger.info('Registering execution for wait', {
      executionId,
      workflowId,
      blockId: waitInfo.blockId,
      triggerType: waitInfo.triggerType,
    })

    const redis = await initRedis()

    if (!redis) {
      logger.warn('Redis not available, using in-memory fallback for wait', { executionId })
      return this.waitForResumeInMemory(waitInfo)
    }

    try {
      // Store wait info in Redis with expiry
      const waitInfoJson = JSON.stringify({
        workflowId: waitInfo.workflowId,
        executionId: waitInfo.executionId,
        blockId: waitInfo.blockId,
        pausedAt: waitInfo.pausedAt,
        resumeUrl: waitInfo.resumeUrl,
        triggerType: waitInfo.triggerType,
        // Don't store full context in Redis, just minimal info
      })

      await redis.setex(
        this.getWaitInfoKey(executionId),
        WAIT_TIMEOUT_SECONDS,
        waitInfoJson
      )

      logger.info('Waiting execution registered in Redis, now sleeping', {
        executionId,
        timeout: WAIT_TIMEOUT_SECONDS,
      })

      // Poll for resume signal using short intervals
      // This is more compatible with serverless than blocking operations
      const startTime = Date.now()
      const pollIntervalMs = 500 // Poll every 500ms
      const resumeKey = this.getResumeDataKey(executionId)

      while (true) {
        // Check if we've exceeded timeout
        const elapsed = Date.now() - startTime
        if (elapsed >= WAIT_TIMEOUT_SECONDS * 1000) {
          logger.warn('Wait timeout reached', { executionId, elapsed })
          await redis.del(this.getWaitInfoKey(executionId))
          return null
        }

        // Check for resume signal
        const resumeDataJson = await redis.get(resumeKey)
        if (resumeDataJson) {
          logger.info('Resume signal received', { executionId })
          
          // Parse resume data
          let resumeData = {}
          try {
            resumeData = JSON.parse(resumeDataJson)
          } catch (error) {
            logger.warn('Failed to parse resume data, using empty data', { error })
          }

          // Clean up
          await Promise.all([
            redis.del(this.getWaitInfoKey(executionId)),
            redis.del(resumeKey),
          ])

          logger.info('Execution resumed', { executionId, hasResult: !!resumeData })
          return resumeData
        }

        // Sleep before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
      }

    } catch (error) {
      logger.error('Error in waitForResume with Redis', { error, executionId })
      // Fall back to in-memory on error
      return this.waitForResumeInMemory(waitInfo)
    }
  }

  /**
   * In-memory fallback for when Redis is not available.
   * Only works within a single process - not suitable for multi-task deployments.
   */
  private async waitForResumeInMemory(waitInfo: WaitInfo): Promise<any> {
    const { executionId } = waitInfo

    return new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        this.inMemoryWaits.delete(executionId)
        logger.warn('Wait timeout reached (in-memory)', { executionId })
        resolve(null)
      }, WAIT_TIMEOUT_SECONDS * 1000)

      const entry = this.inMemoryWaits.get(executionId) || {
        waitInfo,
        resolvers: [],
      }

      entry.resolvers.push((resumeData: any) => {
        clearTimeout(timeout)
        this.inMemoryWaits.delete(executionId)
        resolve(resumeData)
      })

      this.inMemoryWaits.set(executionId, entry)

      logger.info('Execution waiting in memory', { executionId })
    })
  }

  /**
   * Resume a waiting execution by setting a resume signal.
   * This wakes up the sleeping thread.
   * 
   * @param executionId The execution ID to resume
   * @param resumeData Data to pass to the resumed execution
   * @returns true if the execution was found and resumed, false otherwise
   */
  async resumeExecution(executionId: string, resumeData: any = {}): Promise<boolean> {
    logger.info('Attempting to resume execution', { executionId })

    const redis = await initRedis()

    if (!redis) {
      logger.warn('Redis not available, using in-memory fallback for resume', { executionId })
      return this.resumeExecutionInMemory(executionId, resumeData)
    }

    try {
      // Check if wait info exists
      const waitInfoJson = await redis.get(this.getWaitInfoKey(executionId))

      if (!waitInfoJson) {
        logger.warn('No waiting execution found for resume', { executionId })
        return false
      }

      // Set resume data with expiry (should be picked up quickly by polling thread)
      const resumeKey = this.getResumeDataKey(executionId)
      await redis.setex(
        resumeKey,
        60, // 60 second expiry is plenty for polling to pick it up
        JSON.stringify(resumeData)
      )

      logger.info('Set resume signal', {
        executionId,
        resumeKey,
      })

      return true

    } catch (error) {
      logger.error('Error resuming execution with Redis', { error, executionId })
      // Fall back to in-memory
      return this.resumeExecutionInMemory(executionId, resumeData)
    }
  }

  /**
   * In-memory fallback for resuming executions
   */
  private async resumeExecutionInMemory(executionId: string, resumeData: any): Promise<boolean> {
    const entry = this.inMemoryWaits.get(executionId)

    if (!entry) {
      logger.warn('No waiting execution found in memory for resume', { executionId })
      return false
    }

    // Call all resolvers
    for (const resolver of entry.resolvers) {
      resolver(resumeData)
    }

    logger.info('Resumed execution in memory', { executionId, resolverCount: entry.resolvers.length })
    return true
  }

  /**
   * Get wait info for an execution (if it exists and is waiting)
   */
  async getWaitInfo(executionId: string): Promise<any | null> {
    const redis = await initRedis()

    if (!redis) {
      const entry = this.inMemoryWaits.get(executionId)
      return entry ? entry.waitInfo : null
    }

    try {
      const waitInfoJson = await redis.get(this.getWaitInfoKey(executionId))
      return waitInfoJson ? JSON.parse(waitInfoJson) : null
    } catch (error) {
      logger.error('Error getting wait info', { error, executionId })
      return null
    }
  }

  /**
   * Cancel a waiting execution
   */
  async cancelWait(executionId: string): Promise<boolean> {
    logger.info('Cancelling wait for execution', { executionId })

    // Resume with a cancellation flag
    return this.resumeExecution(executionId, { cancelled: true })
  }
}

export const executionRegistry = ExecutionRegistry.getInstance()

