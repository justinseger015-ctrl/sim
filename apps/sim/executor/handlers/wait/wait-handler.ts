import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { getBaseUrl } from '@/lib/urls/utils'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { executeTool } from '@/tools'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'

const logger = createLogger('WaitBlockHandler')

// Server-side only imports
let executionRegistry: any = null
let pausedExecutionService: any = null

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

const getPausedExecutionService = async () => {
  if (typeof window !== 'undefined') return null
  if (!pausedExecutionService) {
    try {
      const module = await import('@/lib/execution/paused-execution-service')
      pausedExecutionService = module.pausedExecutionService
    } catch (error) {
      logger.error('Failed to import paused execution service', { error })
      return null
    }
  }
  return pausedExecutionService
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
  private responseHandler = new ResponseBlockHandler()

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'wait' || block.metadata?.id === 'user_approval'
  }

  /**
   * Parse API response data using the same logic as Response block
   * Handles self-references to resumeUrl by manually replacing them
   */
  private parseApiResponseData(inputs: Record<string, any>, resumeUrl: string): any {
    const responseMode = inputs.apiResponseMode || 'json'
    
    // Helper to replace self-references to resumeUrl
    const resolveSelfReferences = (value: any): any => {
      if (typeof value === 'string') {
        // Replace any <blockName.resumeUrl> pattern with the actual resumeUrl
        return value.replace(/<[^>]+\.resumeUrl>/g, resumeUrl)
      }
      if (Array.isArray(value)) {
        return value.map(resolveSelfReferences)
      }
      if (value && typeof value === 'object') {
        const resolved: any = {}
        for (const [key, val] of Object.entries(value)) {
          resolved[key] = resolveSelfReferences(val)
        }
        return resolved
      }
      return value
    }
    
    if (responseMode === 'json' && inputs.apiEditorResponse) {
      // Handle JSON mode
      let data = inputs.apiEditorResponse
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch (error) {
          // Not valid JSON, keep as string
        }
      }
      return resolveSelfReferences(data)
    }
    
    if (responseMode === 'structured' && inputs.apiBuilderResponse) {
      // Handle structured mode - convert array format to object
      if (Array.isArray(inputs.apiBuilderResponse)) {
        const result: any = {}
        for (const field of inputs.apiBuilderResponse) {
          if (field.name) {
            result[field.name] = resolveSelfReferences(field.value)
          }
        }
        return result
      }
      return resolveSelfReferences(inputs.apiBuilderResponse)
    }
    
    return {}
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

    // Check if we're resuming from a human approval
    if (isResuming && resumeTriggerType === 'human') {
      logger.info(`Wait block resumed via human approval`, {
        blockId: block.id,
        blockName: block.metadata?.name,
        hasResumeInput: !!resumeInput,
        approved: resumeInput?.approved,
        resumeInputKeys: resumeInput ? Object.keys(resumeInput) : [],
      })
      
      // For user_approval blocks, return the approval status
      if (block.metadata?.id === 'user_approval') {
        const output = {
          approveUrl: resumeInput?.approveUrl || resumeInput?.approvalToken ? `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/approve/${resumeInput.approvalToken}` : '',
          approved: resumeInput?.approved || false,
        }
        
        logger.info('Returning human approval output', {
          blockId: block.id,
          blockName: block.metadata?.name,
          output,
        })
        
        return output
      }
      
      // For regular wait blocks with human mode (shouldn't happen but handle gracefully)
      return {
        status: 'resumed',
      }
    }

    // Check if we're resuming from an API approval
    if (isResuming && resumeTriggerType === 'api') {
      logger.info(`Wait block resumed via API approval`, {
        blockId: block.id,
        blockName: block.metadata?.name,
        hasResumeInput: !!resumeInput,
        resumeInputKeys: resumeInput ? Object.keys(resumeInput) : [],
      })
      
      // For user_approval blocks, return the API input data as block outputs
      // The API response format is handled separately in the resume endpoint
      if (block.metadata?.id === 'user_approval') {
        const baseUrl = getBaseUrl()
        
        // Return the API input payload as the block's output
        // This makes all the API input fields available to downstream blocks
        const output = {
          resumeUrl: `${baseUrl}/api/workflows/${context.workflowId}/executions/resume/${context.executionId}`,
          ...resumeInput, // All API input fields become available downstream
        }
        
        logger.info('Returning API input as block output', {
          blockId: block.id,
          blockName: block.metadata?.name,
          outputKeys: Object.keys(output),
        })
        
        return output
      }
      
      // For regular wait blocks with API mode (shouldn't happen but handle gracefully)
      return {
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
      const executionId = context.executionId
      const workflowId = context.workflowId

      if (!executionId || !workflowId) {
        throw new Error('Cannot process user approval block without execution ID and workflow ID')
      }

      // Handle "Human" resume type - one-time approval link
      if (inputs.resumeTriggerType === 'human') {
        // Check for mock response (testing mode)
        const mockResponse = inputs.mockResponse
        
        if (mockResponse) {
          logger.info('Human approval block using mock response (testing mode)', {
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
            approved: true,
            status: 'approved',
            approveUrl: 'mock://approval-url',
          }
        }

        // Save execution state to database and generate approval URL
        // This does NOT pause - it just saves and returns the URL
        const baseUrl = getBaseUrl()
        
        if (!executionId || !workflowId) {
          throw new Error('Execution ID and Workflow ID are required for Human in the Loop block')
        }

        let approveUrl: string
        
        // Try server-side service first (for server execution)
        const pausedService = await getPausedExecutionService()
        
        if (pausedService) {
          // Server-side execution - use service directly
          try {
            const result = await pausedService.savePausedExecution(
              {
                workflowId,
                executionId,
                blockId: block.id,
                context,
                pausedAt: new Date(pausedAt),
              },
              baseUrl
            )
            approveUrl = result.approveUrl

            logger.info('Paused execution saved (server-side), approval URL generated', {
              executionId,
              workflowId,
              approveUrl,
              hasToken: !!result.approvalToken,
            })
          } catch (error) {
            logger.error('Failed to save paused execution', {
              error,
              executionId,
              workflowId,
            })
            throw new Error(`Failed to save paused execution state: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        } else {
          // Client-side execution - call API endpoint
          logger.info('Client-side execution - calling API to save paused state', {
            executionId,
            workflowId,
            blockId: block.id,
            contextExecutedBlocks: context.executedBlocks ? Array.from(context.executedBlocks) : [],
            contextActiveExecutionPath: context.activeExecutionPath ? Array.from(context.activeExecutionPath) : [],
          })

          try {
            const response = await fetch('/api/execution/pause', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                workflowId,
                executionId,
                blockId: block.id,
                context,
                pausedAt: new Date(pausedAt).toISOString(),
              }),
            })

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.details || errorData.error || 'Failed to save paused execution')
            }

            const result = await response.json()
            approveUrl = result.approveUrl

            logger.info('Paused execution saved (client-side API), approval URL generated', {
              executionId,
              workflowId,
              approveUrl,
            })
          } catch (error) {
            logger.error('Failed to save paused execution via API', {
              error,
              executionId,
              workflowId,
            })
            throw new Error(`Failed to save paused execution state: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        // Signal to the executor to pause execution after this block
        // This prevents the workflow from continuing to downstream blocks
        ;(context as any).shouldPauseAfterBlock = true
        ;(context as any).waitBlockInfo = {
          blockId: block.id,
          blockName: block.metadata?.name || 'Human in the Loop',
          pausedAt: new Date(pausedAt).toISOString(),
          description: 'Workflow paused for human approval',
          triggerConfig: {
            type: 'human',
            approveUrl,
          },
        }

        logger.info('Workflow will pause after Human in the Loop block', {
          executionId,
          workflowId,
          blockId: block.id,
          approveUrl,
        })

        // Return only the actual block outputs (approveUrl and approved)
        // Other internal fields should not be exposed to API consumers
        return {
          approveUrl,
          approved: false, // Not yet approved
        }
      }

      // Handle "API" resume type - programmatic approval via API
      if (inputs.resumeTriggerType === 'api') {
        // Check for mock response (testing mode)
        const mockResponse = inputs.mockResponse
        
        if (mockResponse) {
          logger.info('API approval block using mock response (testing mode)', {
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
            resumeUrl: 'mock://resume-url',
            approved: mockData?.approved || false,
            ...mockData, // Include other fields from mock data
          }
        }

        const baseUrl = getBaseUrl()
        let resumeUrl = `${baseUrl}/api/workflows/${workflowId}/executions/resume/${executionId}`
        
        // Check if this is a deployed execution
        // If not deployed, return the configured response without saving to DB
        if (!context.isDeployedContext) {
          logger.info('API resume type in non-deployed context, pausing without DB save', {
            executionId,
            workflowId,
            blockId: block.id,
          })
          
          // Signal to pause execution
          ;(context as any).shouldPauseAfterBlock = true
          ;(context as any).waitBlockInfo = {
            blockId: block.id,
            blockName: block.metadata?.name || 'Human in the Loop',
            pausedAt: new Date(pausedAt).toISOString(),
            description: 'Workflow paused for API approval (editor mode)',
            triggerConfig: {
              type: 'api',
              resumeUrl,
            },
          }
          
          // For non-deployed context, return simple block outputs (not apiResponse format)
          // This allows the block to show properly in the editor UI
          const responseData = this.parseApiResponseData(inputs, resumeUrl)
          
          return {
            resumeUrl,
            ...responseData,
          }
        }

        // Save execution state to database and generate API resume URL
        
        if (!executionId || !workflowId) {
          throw new Error('Execution ID and Workflow ID are required for API resume block')
        }
        
        // Try server-side service first (for server execution)
        const pausedService = await getPausedExecutionService()
        
        if (pausedService) {
          // Server-side execution - use service directly
          try {
            const result = await pausedService.savePausedExecution(
              {
                workflowId,
                executionId,
                blockId: block.id,
                context,
                pausedAt: new Date(pausedAt),
                resumeType: 'api',
                apiInputFormat: inputs.apiInputFormat,
                apiResponseMode: inputs.apiResponseMode,
                apiBuilderResponse: inputs.apiBuilderResponse,
                apiEditorResponse: inputs.apiEditorResponse,
              },
              baseUrl
            )
            // For API mode, use the API resume endpoint
            resumeUrl = `${baseUrl}/api/workflows/${workflowId}/executions/resume/${executionId}`

            logger.info('Paused execution saved (server-side), API resume URL generated', {
              executionId,
              workflowId,
              resumeUrl,
            })
          } catch (error) {
            logger.error('Failed to save paused execution', {
              error,
              executionId,
              workflowId,
            })
            throw new Error(`Failed to save paused execution state: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        } else {
          // Client-side execution - call API endpoint
          logger.info('Client-side execution - calling API to save paused state', {
            executionId,
            workflowId,
            blockId: block.id,
          })

          try {
            const response = await fetch('/api/execution/pause', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                workflowId,
                executionId,
                blockId: block.id,
                context,
                pausedAt: new Date(pausedAt).toISOString(),
                resumeType: 'api',
                apiInputFormat: inputs.apiInputFormat,
                apiResponseMode: inputs.apiResponseMode,
                apiBuilderResponse: inputs.apiBuilderResponse,
                apiEditorResponse: inputs.apiEditorResponse,
              }),
            })

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              throw new Error(errorData.details || errorData.error || 'Failed to save paused execution')
            }

            const result = await response.json()
            // For API mode, use the API resume endpoint
            resumeUrl = `${baseUrl}/api/workflows/${workflowId}/executions/resume/${executionId}`

            logger.info('Paused execution saved (client-side API), API resume URL generated', {
              executionId,
              workflowId,
              resumeUrl,
            })
          } catch (error) {
            logger.error('Failed to save paused execution via API', {
              error,
              executionId,
              workflowId,
            })
            throw new Error(`Failed to save paused execution state: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        // Signal to the executor to pause execution after this block
        ;(context as any).shouldPauseAfterBlock = true
        ;(context as any).waitBlockInfo = {
          blockId: block.id,
          blockName: block.metadata?.name || 'Human in the Loop',
          pausedAt: new Date(pausedAt).toISOString(),
          description: 'Workflow paused for API approval',
          triggerConfig: {
            type: 'api',
            resumeUrl,
          },
        }

        logger.info('Workflow will pause after API approval block', {
          executionId,
          workflowId,
          blockId: block.id,
          resumeUrl,
        })

        // Return the configured response structure using Response block logic
        const responseData = this.parseApiResponseData(inputs, resumeUrl)
        
        // Return as 'apiResponse' so the execute route knows to handle it like Response block
        return {
          apiResponse: {
            data: {
              resumeUrl,
              ...responseData,
            },
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        }
      }

      const triggerConfig: Record<string, any> = {
        type: 'manual',
        description: inputs.waitDescription || 'Workflow paused for user approval',
      }

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
