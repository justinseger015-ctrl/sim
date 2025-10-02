import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WaitBlockHandler')

/**
 * Handler for Wait blocks that pause workflow execution.
 * When a Wait block is executed, it triggers a workflow pause and saves
 * the execution state along with resume trigger configuration.
 */
export class WaitBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'wait'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing Wait block: ${block.id}`, { inputs })

    const resumeTriggerType = inputs.resumeTriggerType || 'manual'
    const description = inputs.description || ''
    const pausedAt = new Date().toISOString()

    // Build trigger configuration based on resume type
    const triggerConfig: Record<string, any> = {
      type: resumeTriggerType,
      description,
    }

    // Add trigger-specific configuration
    if (resumeTriggerType === 'input') {
      triggerConfig.inputFormat = inputs.inputInputFormat || []
    } else if (resumeTriggerType === 'api') {
      triggerConfig.inputFormat = inputs.apiInputFormat || []
    } else if (resumeTriggerType === 'webhook') {
      triggerConfig.webhookPath = inputs.webhookPath || ''
      triggerConfig.webhookSecret = inputs.webhookSecret || ''
      triggerConfig.inputFormat = inputs.webhookInputFormat || []
    } else if (resumeTriggerType === 'schedule') {
      triggerConfig.scheduleType = inputs.scheduleType || 'daily'
      triggerConfig.minutesInterval = inputs.minutesInterval
      triggerConfig.hourlyMinute = inputs.hourlyMinute
      triggerConfig.dailyTime = inputs.dailyTime
      triggerConfig.weeklyDay = inputs.weeklyDay
      triggerConfig.weeklyTime = inputs.weeklyTime
      triggerConfig.monthlyDay = inputs.monthlyDay
      triggerConfig.monthlyTime = inputs.monthlyTime
      triggerConfig.cronExpression = inputs.cronExpression
      triggerConfig.timezone = inputs.scheduleTimezone || 'UTC'
    }

    logger.info(`Wait block configured with ${resumeTriggerType} trigger`, {
      blockId: block.id,
      triggerConfig,
    })

    // Store wait block information in context metadata
    // This will be saved when the workflow is paused
    logger.info('Wait block preparing context metadata', {
      hasMetadata: Boolean(context.metadata),
      metadataKeys: context.metadata ? Object.keys(context.metadata) : undefined,
    })

    if (!context.metadata) {
      logger.warn('Context metadata missing, initializing new metadata object')
      context.metadata = { duration: 0 }
    }

    logger.info('Wait block metadata after ensure', {
      metadataKeys: Object.keys(context.metadata || {}),
    })

    // Add wait block information to metadata
    const waitBlockInfo = {
      blockId: block.id,
      blockName: block.metadata?.name || 'Wait',
      pausedAt,
      description,
      triggerConfig,
    }

    // Store in context for the pause handler to access
    logger.info('Wait block setting waitBlockInfo on context')
    if (!(context as any).waitBlockInfo) {
      (context as any).waitBlockInfo = waitBlockInfo
    }
    logger.info('Wait block waitBlockInfo set', {
      waitBlockInfo: (context as any).waitBlockInfo,
    })

    // Mark that execution should pause
    // We use a special marker in the context that the executor will check
    logger.info('Wait block marking context to pause')
    ;(context as any).shouldPauseAfterBlock = true
    ;(context as any).pauseReason = 'wait_block'
    logger.info('Wait block marked context pause flags', {
      shouldPause: (context as any).shouldPauseAfterBlock,
      pauseReason: (context as any).pauseReason,
    })

    logger.info(`Wait block will pause execution after this block completes`, {
      blockId: block.id,
      blockName: block.metadata?.name,
    })

    // Return output that indicates this is a wait block
    return {
      pausedAt,
      triggerType: resumeTriggerType,
      triggerConfig,
      status: 'waiting',
      message: description || `Workflow paused at ${block.metadata?.name || 'Wait block'}. Resume via ${resumeTriggerType} trigger.`,
    }
  }
}

