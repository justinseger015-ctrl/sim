import { NextRequest, NextResponse } from 'next/server'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'
import { Executor } from '@/executor'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import { getUserEntityPermissions } from '@/lib/permissions/utils'

const logger = createLogger('ResumeExecutionAPI')

/**
 * Helper function to replace <api.fieldName> references with actual values
 */
function replaceApiReferences(obj: any, apiInput: Record<string, any>): any {
  if (typeof obj === 'string') {
    // Replace <api.fieldName> patterns
    return obj.replace(/<api\.(\w+)>/g, (match, fieldName) => {
      return apiInput[fieldName] !== undefined ? apiInput[fieldName] : match
    })
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => replaceApiReferences(item, apiInput))
  }
  
  if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceApiReferences(value, apiInput)
    }
    return result
  }
  
  return obj
}

/**
 * POST /api/workflows/[id]/executions/resume/[executionId]
 * Resumes a paused workflow execution
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  try {
    const { id: workflowId, executionId } = await params
    
    // Check for API key authentication (for API resume type)
    const apiKeyHeader = request.headers.get('x-api-key')
    let authenticatedUserId: string | null = null
    let isApiAuth = false

    if (apiKeyHeader) {
      // API key authentication
      const { validateWorkflowAccess } = await import('@/app/api/workflows/middleware')
      const validation = await validateWorkflowAccess(request, workflowId, true)
      
      if (validation.error) {
        return NextResponse.json(
          { error: validation.error.message },
          { status: validation.error.status }
        )
      }
      
      authenticatedUserId = validation.workflow!.userId
      isApiAuth = true
      
      logger.info(`API key authenticated for workflow ${workflowId}`, {
        userId: authenticatedUserId,
      })
    } else {
      // Session authentication (for manual resume from UI)
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      authenticatedUserId = session.user.id
    }

    logger.info(`Resuming execution ${executionId} for workflow ${workflowId}`, {
      isApiAuth,
    })

    // Check if user has permission for this workflow
    const [workflowData] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check permissions
    let hasPermission = workflowData.userId === authenticatedUserId
    
    if (!hasPermission && workflowData.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        authenticatedUserId!,
        'workspace',
        workflowData.workspaceId
      )
      hasPermission = userPermission === 'write' || userPermission === 'admin'
    }

    if (!hasPermission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Retrieve paused execution
    const resumeData = await pauseResumeService.resumeExecution(executionId)

    if (!resumeData) {
      return NextResponse.json(
        { error: 'No paused execution found for this ID' },
        { status: 404 }
      )
    }

    // For API resume type, validate the input payload
    let resumeInput: any = {}
    const resumeType = (resumeData.metadata as any)?.resumeTriggerType
    
    if (resumeType === 'api') {
      // Parse and validate the API payload against the defined input schema
      try {
        const payload = await request.json()
        
        // Validate against the defined input schema
        const apiInputFormat = (resumeData.metadata as any)?.apiInputFormat
        if (apiInputFormat && Array.isArray(apiInputFormat)) {
          // Validate required fields
          for (const field of apiInputFormat) {
            if (field.required && !(field.name in payload)) {
              return NextResponse.json(
                { error: `Missing required field: ${field.name}` },
                { status: 400 }
              )
            }
          }
        }
        
        resumeInput = payload
        
        logger.info('API resume payload validated', {
          executionId,
          payloadKeys: Object.keys(payload),
        })
      } catch (parseError) {
        return NextResponse.json(
          { error: 'Invalid JSON payload' },
          { status: 400 }
        )
      }
    }

    // Create executor from paused state
    const { executor, context } = Executor.createFromPausedState(
      resumeData.workflowState,
      resumeData.executionContext,
      resumeData.environmentVariables,
      resumeData.workflowInput,
      {},
      {
        executionId: executionId,
        workspaceId: workflowData.workspaceId,
        isDeployedContext: resumeData.metadata?.isDeployedContext || false,
        ...(resumeType === 'api' && { resumeInput }), // Pass the API payload as resumeInput
      }
    )

    // Track which blocks were already executed before resume
    const preResumeExecutedBlocks = new Set(context.executedBlocks)

    // Resume execution
    const result = await executor.resumeFromContext(workflowId, context)

    // Check if we got a StreamingExecution result (with stream + execution properties)
    // For resume, we only care about the ExecutionResult part, not the stream
    const executionResult: ExecutionResult = 'stream' in result && 'execution' in result ? result.execution : result

    // Filter logs to only include blocks executed AFTER resume (not before pause)
    const newLogs = (executionResult.logs || []).filter(log => 
      !preResumeExecutedBlocks.has(log.blockId)
    )

    // Check if execution completed or was paused/cancelled again
    const metadata = executionResult.metadata as any
    const { context: resumedContext, ...metadataWithoutContext } = metadata || {}
    const isPaused = metadata?.isPaused
    const waitBlockInfo = metadata?.waitBlockInfo
    const isCancelled = !executionResult.success && executionResult.error?.includes('cancelled')

    if (isPaused) {
      if (!resumedContext) {
        logger.warn('Resume result indicated paused but no context provided', {
          executionId,
          workflowId,
        })
      } else {
        try {
          const executionContext = resumedContext as ExecutionContext
          const workflowState: SerializedWorkflow =
            (executionContext.workflow as SerializedWorkflow) || resumeData.workflowState
          const environmentVariables =
            executionContext.environmentVariables || resumeData.environmentVariables || {}
          const pauseMetadata = {
            ...(resumeData.metadata || {}),
            ...metadataWithoutContext,
            waitBlockInfo,
          }

          await pauseResumeService.pauseExecution({
            workflowId,
            executionId,
            userId: authenticatedUserId!,
            executionContext,
            workflowState,
            environmentVariables,
            workflowInput: resumeData.workflowInput,
            metadata: pauseMetadata,
          })
        } catch (persistError: any) {
          logger.error('Failed to persist paused execution after resume', {
            executionId,
            error: persistError,
          })
        }
      }
    }

    // For API resume type, return the custom configured response to the API caller
    if (resumeType === 'api' && isApiAuth) {
      const metadata = resumeData.metadata as any
      const apiResponseMode = metadata?.apiResponseMode || 'json'
      
      let responseData: any = {
        success: true,
        message: 'Workflow resumed successfully',
      }
      
      // Build custom response based on configuration
      // The response can reference the API inputs using <api.fieldName>
      if (apiResponseMode === 'json' && metadata?.apiEditorResponse) {
        // Editor mode: Use the JSON response template
        try {
          let editorResponse = metadata.apiEditorResponse
          
          // If it's a string, parse it
          if (typeof editorResponse === 'string') {
            editorResponse = JSON.parse(editorResponse)
          }
          
          // Replace <api.fieldName> references with actual values from resumeInput
          const resolvedResponse = replaceApiReferences(editorResponse, resumeInput)
          responseData = resolvedResponse
        } catch (parseError) {
          logger.warn('Failed to parse/resolve API editor response, using default', { parseError })
          responseData = { ...responseData, ...resumeInput }
        }
      } else if (apiResponseMode === 'structured' && metadata?.apiBuilderResponse) {
        // Builder mode: Use the structured response
        // Resolve any API references in the builder data
        const resolvedResponse = replaceApiReferences(metadata.apiBuilderResponse, resumeInput)
        responseData = resolvedResponse
      } else {
        // Default: return the API input as confirmation
        responseData = {
          ...responseData,
          data: resumeInput,
        }
      }
      
      logger.info('Returning custom API response to caller', {
        executionId,
        responseMode: apiResponseMode,
        responseKeys: Object.keys(responseData),
      })
      
      return NextResponse.json(responseData)
    }
    
    // For non-API resume (webhook, manual), return standard response
    return NextResponse.json({
      success: executionResult.success,
      output: executionResult.output,
      error: executionResult.error,
      isPaused,
      isCancelled,
      logs: newLogs, // Only return logs for blocks executed after resume
      metadata: {
        duration: executionResult.metadata?.duration,
        executedBlockCount: context.executedBlocks.size,
        waitBlockInfo,
        startTime: executionResult.metadata?.startTime,
        endTime: executionResult.metadata?.endTime,
      },
    })
  } catch (error: any) {
    logger.error('Error resuming execution:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to resume execution' },
      { status: 500 }
    )
  }
}

