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

// Timeout for waiting on Redis (3 minutes to match HTTP sync timeout)
const WAIT_TIMEOUT_SECONDS = 180

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
  private getWaitInfoKey(executionId: string, blockId?: string): string {
    return blockId 
      ? `execution:wait:${executionId}:${blockId}`
      : `execution:wait:${executionId}`
  }

  /**
   * Get the Redis list key for resume signaling (using BLPOP for true blocking)
   */
  private getResumeDataKey(executionId: string, blockId?: string): string {
    return blockId
      ? `execution:resume:${executionId}:${blockId}`
      : `execution:resume:${executionId}`
  }

  /**
   * Get the Redis channel name for pub/sub notifications
   */
  private getChannelName(executionId: string, blockId?: string): string {
    return blockId
      ? `execution:channel:${executionId}:${blockId}`
      : `execution:channel:${executionId}`
  }

  /**
   * Register a waiting execution and sleep until resumed.
   * This blocks the current thread until the execution is resumed via webhook/API.
   * Uses Redis BLPOP for true blocking - thread sleeps until signaled or timeout (3 min).
   * 
   * @param waitInfo Information about the waiting execution
   * @returns Resume data when execution is woken up, or null if timeout
   */
  async waitForResume(waitInfo: WaitInfo): Promise<any> {
    const { executionId, workflowId, blockId } = waitInfo

    logger.info('Registering execution for wait', {
      executionId,
      workflowId,
      blockId: waitInfo.blockId,
      triggerType: waitInfo.triggerType,
    })

    const redis = await initRedis()
    logger.debug('Redis initialization result', { hasRedis: !!redis, executionId, blockId })

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

      const waitKey = this.getWaitInfoKey(executionId, blockId)
      logger.debug('Setting wait info in Redis', { 
        key: waitKey, 
        executionId, 
        blockId,
        dataLength: waitInfoJson.length 
      })
      
      await redis.setex(
        waitKey,
        WAIT_TIMEOUT_SECONDS,
        waitInfoJson
      )

      logger.info('Waiting execution registered in Redis, now blocking', {
        executionId,
        blockId,
        timeout: WAIT_TIMEOUT_SECONDS,
        key: waitKey,
      })

      // Use Redis BLPOP for true blocking - thread sleeps until signaled or timeout
      const resumeKey = this.getResumeDataKey(executionId, blockId)

      try {
        // BLPOP blocks until an item is available or timeout
        // Returns [key, value] or null on timeout
        const result = await redis.blpop(resumeKey, WAIT_TIMEOUT_SECONDS)

        if (!result) {
          // Timeout reached
          logger.warn('Wait timeout reached', { executionId })
          await redis.del(this.getWaitInfoKey(executionId, blockId))
          return null
        }

        const [, resumeDataJson] = result
        logger.info('Resume signal received via BLPOP', { executionId })

        // Parse resume data
        let resumeData = {}
        try {
          resumeData = JSON.parse(resumeDataJson)
        } catch (error) {
          logger.warn('Failed to parse resume data, using empty data', { error })
        }

        // Clean up wait info
        await redis.del(this.getWaitInfoKey(executionId, blockId))

        logger.info('Execution resumed', { executionId, hasResult: !!resumeData })
        return resumeData

      } catch (error) {
        logger.error('Error during BLPOP wait', { error, executionId })
        await redis.del(this.getWaitInfoKey(executionId, blockId))
        return null
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
    const { executionId, blockId } = waitInfo
    const key = blockId ? `${executionId}:${blockId}` : executionId

    return new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        this.inMemoryWaits.delete(key)
        logger.warn('Wait timeout reached (in-memory)', { executionId, blockId })
        resolve(null)
      }, WAIT_TIMEOUT_SECONDS * 1000)

      const entry = this.inMemoryWaits.get(key) || {
        waitInfo,
        resolvers: [],
      }

      entry.resolvers.push((resumeData: any) => {
        clearTimeout(timeout)
        this.inMemoryWaits.delete(key)
        resolve(resumeData)
      })

      this.inMemoryWaits.set(key, entry)

      logger.info('Execution waiting in memory', { executionId, blockId, key })
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
  async resumeExecution(executionId: string, resumeData: any = {}, blockId?: string): Promise<boolean> {
    logger.info('Attempting to resume execution', { executionId, blockId })

    const redis = await initRedis()

    if (!redis) {
      logger.warn('Redis not available, using in-memory fallback for resume', { executionId })
      return this.resumeExecutionInMemory(executionId, resumeData, blockId)
    }

    try {
      // Check if wait info exists
      const waitInfoJson = await redis.get(this.getWaitInfoKey(executionId, blockId))

      if (!waitInfoJson) {
        logger.warn('No waiting execution found for resume', { executionId, blockId })
        return false
      }

      // Push resume data to Redis list (wakes up BLPOP immediately)
      const resumeKey = this.getResumeDataKey(executionId, blockId)
      await redis.rpush(resumeKey, JSON.stringify(resumeData))

      // Set expiry on the list in case the waiting thread died
      await redis.expire(resumeKey, 60)

      logger.info('Pushed resume signal to list', {
        executionId,
        blockId,
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
  private async resumeExecutionInMemory(executionId: string, resumeData: any, blockId?: string): Promise<boolean> {
    const key = blockId ? `${executionId}:${blockId}` : executionId
    const entry = this.inMemoryWaits.get(key)

    if (!entry) {
      logger.warn('No waiting execution found in memory for resume', { executionId, blockId })
      return false
    }

    // Call all resolvers
    for (const resolver of entry.resolvers) {
      resolver(resumeData)
    }

    logger.info('Resumed execution in memory', { executionId, blockId, resolverCount: entry.resolvers.length })
    return true
  }

  /**
   * Get wait info for an execution (if it exists and is waiting)
   */
  async getWaitInfo(executionId: string, blockId?: string): Promise<any | null> {
    const redis = await initRedis()

    if (!redis) {
      const key = blockId ? `${executionId}:${blockId}` : executionId
      const entry = this.inMemoryWaits.get(key)
      return entry ? entry.waitInfo : null
    }

    try {
      const waitInfoJson = await redis.get(this.getWaitInfoKey(executionId, blockId))
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

