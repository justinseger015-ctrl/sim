import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('WaitBlockHandler')

// Helper function to sleep for a specified number of milliseconds with cancellation support
const sleep = async (ms: number, checkCancelled?: () => boolean): Promise<boolean> => {
  const chunkMs = 100 // Check every 100ms
  let elapsed = 0
  
  while (elapsed < ms) {
    // Check if execution was cancelled
    if (checkCancelled && checkCancelled()) {
      return false // Sleep was interrupted
    }
    
    // Sleep for a chunk or remaining time, whichever is smaller
    const sleepTime = Math.min(chunkMs, ms - elapsed)
    await new Promise(resolve => setTimeout(resolve, sleepTime))
    elapsed += sleepTime
  }
  
  return true // Sleep completed normally
}

/**
 * Handler for Wait blocks that pause workflow execution.
 * - For time-based triggers: Actually sleeps for the specified duration
 * - For webhook triggers: Pauses workflow and waits for external webhook call
 */
export class WaitBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'wait' || block.metadata?.id === 'user_approval'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing Wait block: ${block.id}`, { inputs })

    const resumeTriggerType = inputs.resumeTriggerType || 'time'
    const pausedAt = new Date().toISOString()

    // Handle time-based wait
    if (resumeTriggerType === 'time') {
      const timeValue = parseInt(inputs.timeValue || '10', 10)
      const timeUnit = inputs.timeUnit || 'seconds'
      
      // Calculate wait time in milliseconds
      let waitMs = timeValue * 1000 // Default to seconds
      if (timeUnit === 'minutes') {
        waitMs = timeValue * 60 * 1000
      }
      
      // Enforce 5-minute maximum (300,000 ms)
      const maxWaitMs = 5 * 60 * 1000
      if (waitMs > maxWaitMs) {
        logger.warn(`Wait time ${waitMs}ms exceeds maximum of 5 minutes, capping to 5 minutes`)
        waitMs = maxWaitMs
      }
      
      logger.info(`Waiting for ${waitMs}ms (${timeValue} ${timeUnit})`)
      
      // Actually sleep for the specified duration
      // The executor updates context.isCancelled when cancel() is called
      const checkCancelled = () => {
        // Check if execution was marked as cancelled in the context
        // This gets updated by the executor when user cancels
        return (context as any).isCancelled === true
      }
      
      const completed = await sleep(waitMs, checkCancelled)
      
      if (!completed) {
        logger.info('Wait was interrupted by cancellation')
        return {
          pausedAt,
          triggerType: 'time',
          waitDuration: waitMs,
          status: 'cancelled',
          message: `Wait was cancelled after starting`,
        }
      }
      
      const resumedAt = new Date().toISOString()
      
      return {
        pausedAt,
        resumedAt,
        triggerType: 'time',
        waitDuration: waitMs,
        status: 'resumed',
        message: `Waited for ${timeValue} ${timeUnit}`,
      }
    }
    
    // Handle webhook-based wait (using pause mechanism)
    if (resumeTriggerType === 'webhook') {
      // Build trigger configuration
      const triggerConfig: Record<string, any> = {
        type: 'webhook',
        webhookPath: inputs.webhookPath || '',
        webhookSecret: inputs.webhookSecret || '',
        inputFormat: inputs.webhookInputFormat || [],
      }

      logger.info(`Wait block configured with webhook trigger`, {
        blockId: block.id,
        triggerConfig,
      })

      // Store wait block information in context metadata
      if (!context.metadata) {
        logger.warn('Context metadata missing, initializing new metadata object')
        context.metadata = { duration: 0 }
      }

      // Add wait block information to metadata
      const waitBlockInfo = {
        blockId: block.id,
        blockName: block.metadata?.name || 'Wait',
        pausedAt,
        description: '',
        triggerConfig,
      }

      // Store in context for the pause handler to access
      logger.info('Wait block setting waitBlockInfo on context')
      if (!(context as any).waitBlockInfo) {
        (context as any).waitBlockInfo = waitBlockInfo
      }

      // Mark that execution should pause
      logger.info('Wait block marking context to pause')
      ;(context as any).shouldPauseAfterBlock = true
      ;(context as any).pauseReason = 'wait_block'

      logger.info(`Wait block will pause execution after this block completes`, {
        blockId: block.id,
        blockName: block.metadata?.name,
      })

      // Generate resume URL for webhook trigger
      const executionId = context.executionId
      const workflowId = context.workflowId
      const baseUrl = getBaseUrl()
      const resumeUrl = executionId && workflowId 
        ? `${baseUrl}/api/webhooks/resume/${workflowId}/${executionId}`
        : undefined

      logger.info('Wait block resumeUrl generated', {
        resumeUrl,
        executionId,
        workflowId,
        isDeployed: context.isDeployedContext,
      })

      // Return output that indicates this is a wait block
      return {
        pausedAt,
        triggerType: 'webhook',
        triggerConfig,
        resumeUrl,
        status: 'waiting',
        message: `Workflow paused at ${block.metadata?.name || 'Wait block'}. Resume via webhook call.`,
      }
    }

    // For user_approval blocks, always use the manual pause mechanism
    if (block.metadata?.id === 'user_approval') {
      const triggerConfig: Record<string, any> = {
        type: 'manual',
        description: '',
      }

      // Store wait block information
      if (!context.metadata) {
        context.metadata = { duration: 0 }
      }

      const waitBlockInfo = {
        blockId: block.id,
        blockName: block.metadata?.name || 'User Approval',
        pausedAt,
        description: '',
        triggerConfig,
      }

      ;(context as any).waitBlockInfo = waitBlockInfo
      ;(context as any).shouldPauseAfterBlock = true
      ;(context as any).pauseReason = 'wait_block'

      return {
        pausedAt,
        triggerType: 'manual',
        triggerConfig,
        status: 'waiting',
        message: `Workflow paused at ${block.metadata?.name || 'User Approval block'}. Resume via manual trigger.`,
      }
    }

    // Default fallback
    return {
      pausedAt,
      triggerType: resumeTriggerType,
      status: 'completed',
      message: `Wait block completed with trigger type: ${resumeTriggerType}`,
    }
  }
}