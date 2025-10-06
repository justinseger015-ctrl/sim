import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { getBaseUrl } from '@/lib/urls/utils'
import { executeTool } from '@/tools'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'

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
    
    // Check if we're resuming from a webhook trigger
    const isResuming = (context as any).isResuming
    const resumeInput = (context as any).resumeInput
    
    if (isResuming && resumeTriggerType === 'webhook') {
      logger.info(`Wait block resumed via webhook`, {
        blockId: block.id,
        hasResumeInput: !!resumeInput,
      })
      
      return {
        pausedAt: (context as any).waitBlockInfo?.pausedAt || pausedAt,
        resumedAt: new Date().toISOString(),
        triggerType: 'webhook',
        resumeInput: resumeInput || {},
        status: 'resumed',
        message: `Workflow resumed via webhook`,
      }
    }

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
      // Check if we're resuming from a webhook trigger
      const isResuming = (context as any).isResuming
      const resumeInput = (context as any).resumeInput
      
      if (isResuming) {
        logger.info(`Wait block resumed via webhook`, {
          blockId: block.id,
          hasResumeInput: !!resumeInput,
        })
        
        return {
          pausedAt: (context as any).waitBlockInfo?.pausedAt || pausedAt,
          resumedAt: new Date().toISOString(),
          triggerType: 'webhook',
          resumeInput: resumeInput || {},
          status: 'resumed',
          message: `Workflow resumed via webhook`,
        }
      }
      
      // Build trigger configuration
      const triggerConfig: Record<string, any> = {
        type: 'webhook',
        webhookSecret: inputs.webhookSecret || '',
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

      // Store the output in context so it can be resolved
      const waitOutput = {
        pausedAt,
        resumeUrl,
        triggerType: 'webhook',
        status: 'waiting',
      }
      
      // Update the block state with the output
      if (!context.blockStates.has(block.id)) {
        context.blockStates.set(block.id, { 
          output: {},
          executed: true,
          executionTime: 0
        })
      }
      const blockState = context.blockStates.get(block.id)!
      blockState.output = waitOutput as any

      // Send webhook notification if configured
      let webhookSent = false
      let webhookResponse: any = null
      let webhookError: string | undefined

      // Resolve variables in webhook URL if needed
      let webhookUrl = inputs.webhookSendUrl
      if (webhookUrl && typeof webhookUrl === 'string') {
        const blockName = block.metadata?.name || 'wait'
        const normalizedBlockName = blockName.toLowerCase().replace(/\s+/g, '')
        
        // Replace variable references in URL
        webhookUrl = webhookUrl.replace(
          new RegExp(`<${normalizedBlockName}\\.(\\w+)>`, 'g'),
          (match: string, property: string) => {
            if (property === 'resumeUrl' || property === 'resumeurl') {
              return resumeUrl || ''
            }
            return (waitOutput as any)[property] || match
          }
        )
        
        webhookUrl = webhookUrl.replace(
          new RegExp(`<${blockName.replace(/\s+/g, '')}\\.(\\w+)>`, 'gi'),
          (match: string, property: string) => {
            if (property.toLowerCase() === 'resumeurl') {
              return resumeUrl || ''
            }
            return (waitOutput as any)[property] || match
          }
        )
      }
      
      if (webhookUrl && resumeUrl) {
        logger.info('Wait block preparing to send notification webhook', {
          url: webhookUrl,
          originalUrl: inputs.webhookSendUrl,
          hasBody: !!inputs.webhookSendBody,
          hasHeaders: !!inputs.webhookSendHeaders,
          hasParams: !!inputs.webhookSendParams,
        })
        
        try {
          // Parse the webhook body first
          let webhookBody = inputs.webhookSendBody
          
          if (typeof webhookBody === 'string') {
            // Simple variable resolution for the current block
            const blockName = block.metadata?.name || 'wait'
            const normalizedBlockName = blockName.toLowerCase().replace(/\s+/g, '')
            
            // Replace variable references - use JSON.stringify for proper quoting
            let bodyStr = webhookBody.replace(
              new RegExp(`<${normalizedBlockName}\\.(\\w+)>`, 'g'),
              (match: string, property: string) => {
                if (property === 'resumeUrl' || property === 'resumeurl') {
                  return JSON.stringify(resumeUrl || '')
                }
                const value = (waitOutput as any)[property]
                if (value !== undefined) {
                  return JSON.stringify(value)
                }
                return match
              }
            )
            
            // Also handle with original block name
            bodyStr = bodyStr.replace(
              new RegExp(`<${blockName.replace(/\s+/g, '')}\\.(\\w+)>`, 'gi'),
              (match: string, property: string) => {
                if (property.toLowerCase() === 'resumeurl') {
                  return JSON.stringify(resumeUrl || '')
                }
                const value = (waitOutput as any)[property]
                if (value !== undefined) {
                  return JSON.stringify(value)
                }
                return match
              }
            )
            
            // Now try to parse the result as JSON
            try {
              webhookBody = JSON.parse(bodyStr)
            } catch {
              // If not JSON, use as-is
              webhookBody = bodyStr
            }
          }

          // Also support template variables for backward compatibility
          const bodyStrFinal = JSON.stringify(webhookBody || {})
          const replacedBody = bodyStrFinal
            .replace(/{{resumeUrl}}/g, resumeUrl || '')
            .replace(/{{workflowId}}/g, workflowId || '')
            .replace(/{{executionId}}/g, executionId || '')
          
          const finalBody = JSON.parse(replacedBody)

          // Ensure headers and params are in the correct format for http_request tool
          // The tool expects TableRow[] format, not plain objects
          const headers = inputs.webhookSendHeaders || []
          const params = inputs.webhookSendParams || []
          
          // Resolve variables in headers and params
          const resolveTableValue = (table: any[]) => {
            return table.map(row => {
              if (row.cells && row.cells.Value && typeof row.cells.Value === 'string') {
                let value = row.cells.Value
                
                // Replace variable references for this block
                const blockName = block.metadata?.name || 'wait'
                const normalizedBlockName = blockName.toLowerCase().replace(/\s+/g, '')
                
                value = value.replace(
                  new RegExp(`<${normalizedBlockName}\\.(\\w+)>`, 'g'),
                  (match: string, property: string) => {
                    if (property === 'resumeUrl' || property === 'resumeurl') {
                      return resumeUrl || ''
                    }
                    return (waitOutput as any)[property] || match
                  }
                )
                
                // Also handle with original block name
                value = value.replace(
                  new RegExp(`<${blockName.replace(/\s+/g, '')}\\.(\\w+)>`, 'gi'),
                  (match: string, property: string) => {
                    if (property.toLowerCase() === 'resumeurl') {
                      return resumeUrl || ''
                    }
                    return (waitOutput as any)[property] || match
                  }
                )
                
                return { ...row, cells: { ...row.cells, Value: value } }
              }
              return row
            })
          }
          
          const resolvedHeaders = resolveTableValue(headers)
          const resolvedParams = resolveTableValue(params)

          // Log the final request details
          logger.info('Wait block sending webhook with resolved values', {
            url: webhookUrl,
            originalUrl: inputs.webhookSendUrl,
            method: inputs.webhookSendMethod || 'POST',
            bodyRaw: inputs.webhookSendBody,
            bodyFinal: finalBody,
            paramsCount: resolvedParams.length,
            headersCount: resolvedHeaders.length,
          })

          // Send webhook with retries
          const sendWebhook = async () => {
            // Ensure URL is provided
            if (!webhookUrl) {
              throw new Error('Webhook URL is required but was not provided')
            }
            
            const result = await executeTool(
              'http_request',
              {
                url: webhookUrl, // Use the resolved webhook URL
                method: inputs.webhookSendMethod || 'POST',
                params: resolvedParams, // Use resolved params with variables replaced
                headers: resolvedHeaders, // Use resolved headers with variables replaced
                body: finalBody,
              },
              false, // skipProxy
              false, // skipPostProcess
              context
            )

            if (!result.success) {
              const error = new Error(result.error || 'Webhook send failed')
              ;(error as any).status = result.output?.status
              throw error
            }

            return result.output
          }

          // Always use retry logic for webhook sending
          webhookResponse = await retryWithExponentialBackoff(sendWebhook, {
            maxRetries: 5,
            initialDelayMs: 5000,
            maxDelayMs: 10 * 60 * 1000, // 10 minutes max
            retryCondition: (error: any) => {
              // Don't retry for missing URL or configuration errors
              const errorMessage = error.message || error.error || ''
              if (errorMessage.includes('Missing') || errorMessage.includes('required')) {
                return false
              }
              
              // Retry on 5xx and 429 errors
              const status = error.status || error.output?.status
              return !status || status >= 500 || status === 429
            },
          })

          webhookSent = true
          logger.info('Wait block webhook sent successfully', { 
            url: webhookUrl,
            resumeUrl,
          })
        } catch (error) {
          webhookError = error instanceof Error ? error.message : String(error)
          logger.error('Wait block webhook send failed', { 
            url: webhookUrl,
            error: webhookError,
          })
        }
      }

      // Return output that indicates this is a wait block
      return {
        pausedAt,
        triggerType: 'webhook',
        triggerConfig,
        resumeUrl,
        status: 'waiting',
        message: `Workflow paused at ${block.metadata?.name || 'Wait block'}. Resume via webhook call.`,
        webhookSent,
        webhookResponse,
        ...(webhookError && { webhookError }),
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