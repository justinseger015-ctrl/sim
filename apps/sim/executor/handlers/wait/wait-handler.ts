import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { getBaseUrl } from '@/lib/urls/utils'
import { executeTool } from '@/tools'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'

const logger = createLogger('WaitBlockHandler')

// Server-side only import for execution registry
let executionRegistry: any = null
const getExecutionRegistry = async () => {
  if (typeof window !== 'undefined') return null
  if (!executionRegistry) {
    try {
      const module = await import('@/lib/execution/execution-registry')
      executionRegistry = module.executionRegistry
    } catch (error) {
      logger.error('Failed to import execution registry', { error })
      return null
    }
  }
  return executionRegistry
}

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
        webhook: resumeInput || {},
        status: 'resumed',
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
          waitDuration: waitMs,
          status: 'cancelled',
        }
      }
      
      return {
        waitDuration: waitMs,
        status: 'completed',
      }
    }
    
    // Handle webhook-based wait (using pause mechanism)
    if (resumeTriggerType === 'webhook') {
      // Check if we're resuming from a webhook trigger (old DB-based resume)
      const isResuming = (context as any).isResuming
      const resumeInput = (context as any).resumeInput
      
      if (isResuming) {
        logger.info(`Wait block resumed via webhook (DB-based)`, {
          blockId: block.id,
          hasResumeInput: !!resumeInput,
        })
        
        return {
          webhook: resumeInput || {},
          status: 'resumed',
        }
      }
      
      // Generate resume URL for webhook trigger
      const executionId = context.executionId
      const workflowId = context.workflowId
      const baseUrl = getBaseUrl()
      const resumeUrl = executionId && workflowId 
        ? `${baseUrl}/api/webhooks/resume/${workflowId}/${executionId}/${block.id}`
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

      // Build trigger configuration first
      const triggerConfig: Record<string, any> = {
        type: 'webhook',
        webhookSecret: inputs.webhookSecret || '',
      }

      // Check for mock response early (client-side testing mode)
      // If mock response is provided and we're in client mode, skip webhook entirely
      const registry = await getExecutionRegistry()
      const mockResponse = inputs.mockResponse
      
      if (!registry && mockResponse) {
        logger.info('Wait block using mock response (client-side execution) - skipping webhook', {
          executionId,
          workflowId,
          blockId: block.id,
          hasMockData: !!mockResponse,
        })
        
        // Parse mock response if it's a string
        let mockData = mockResponse
        if (typeof mockResponse === 'string') {
          try {
            mockData = JSON.parse(mockResponse)
          } catch (error) {
            logger.warn('Failed to parse mock response as JSON, using as-is', { error })
          }
        }
        
        return {
          webhook: mockData || {},
          status: 'resumed',
        }
      }

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

      // Always use Redis-based sleep/wake for webhook wait blocks
      if (executionId && workflowId) {
        logger.info('Wait block entering sleep mode via Redis', {
          executionId,
          workflowId,
          blockId: block.id,
        })

        // Registry was already checked earlier - if we're here, it must be available
        if (!registry) {
          throw new Error('Redis execution registry not available - cannot process wait block. Add a mock response for client-side testing.')
        }

        // DO NOT set pause flags here - we're handling the wait ourselves via Redis BLPOP
        // If we set shouldPauseAfterBlock, the executor will return early and break parent/child waiting
        
        let resumeData: any
        try {
          // Register and wait for resume
          resumeData = await registry.waitForResume({
            workflowId,
            executionId,
            blockId: block.id,
            pausedAt,
            resumeUrl,
            triggerType: 'webhook',
            context,
          })
        } catch (error) {
          logger.error('Error in waitForResume', { 
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            executionId,
            blockId: block.id 
          })
          throw error
        }

        if (!resumeData) {
          // Timeout or cancellation
          logger.warn('Wait block timeout or cancelled', { executionId, blockId: block.id })
          return {
            status: 'timeout',
          }
        }

        // Check if cancelled
        if (resumeData.cancelled) {
          logger.info('Wait block cancelled via registry', { executionId, blockId: block.id })
          return {
            status: 'cancelled',
          }
        }

        // Successfully resumed via Redis - execution continues normally
        logger.info('Wait block successfully resumed via Redis', {
          executionId,
          blockId: block.id,
          hasResumeData: !!resumeData,
        })

        return {
          webhook: resumeData || {},
          status: 'resumed',
        }
      } else {
        throw new Error('Cannot process wait block without execution ID and workflow ID')
      }
    }

    // For user_approval blocks, also use Redis-based sleep/wake
    if (block.metadata?.id === 'user_approval') {
      const triggerConfig: Record<string, any> = {
        type: 'manual',
        description: inputs.waitDescription || 'Workflow paused for user approval',
      }

      const executionId = context.executionId
      const workflowId = context.workflowId

      if (executionId && workflowId) {
        // Check for mock response early (client-side testing mode)
        const registry = await getExecutionRegistry()
        const mockResponse = inputs.mockResponse
        
        if (!registry && mockResponse) {
          logger.info('User approval block using mock response (client-side execution)', {
            executionId,
            workflowId,
            blockId: block.id,
          })
          
          // Parse mock response if it's a string
          let mockData = mockResponse
          if (typeof mockResponse === 'string') {
            try {
              mockData = JSON.parse(mockResponse)
            } catch (error) {
              logger.warn('Failed to parse mock response as JSON, using as-is', { error })
            }
          }
          
          return {
            webhook: mockData || {},
            status: 'approved',
          }
        }

        logger.info('User approval block entering sleep mode via Redis', {
          executionId,
          workflowId,
          blockId: block.id,
        })
        
        if (!registry) {
          throw new Error('Redis execution registry not available - cannot process user approval block. Add a mock response for client-side testing.')
        }

        // Register and wait for resume
        const resumeData = await registry.waitForResume({
          workflowId,
          executionId,
          blockId: block.id,
          pausedAt,
          resumeUrl: '', // User approval doesn't use webhook URLs
          triggerType: 'manual',
          context,
        })

        if (!resumeData) {
          logger.warn('User approval block timeout', { executionId, blockId: block.id })
          return {
            status: 'timeout',
          }
        }

        if (resumeData.cancelled) {
          logger.info('User approval cancelled via registry', { executionId, blockId: block.id })
          return {
            status: 'cancelled',
          }
        }

        logger.info('User approval block successfully resumed via Redis', {
          executionId,
          blockId: block.id,
          hasResumeData: !!resumeData,
        })

        return {
          webhook: resumeData || {},
          status: 'approved',
        }
      } else {
        throw new Error('Cannot process user approval block without execution ID and workflow ID')
      }
    }

    // Default fallback
    return {
      status: 'completed',
    }
  }
}
