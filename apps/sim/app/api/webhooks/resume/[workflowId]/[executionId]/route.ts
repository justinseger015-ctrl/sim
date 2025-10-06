import { NextRequest, NextResponse } from 'next/server'

import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'
import { Executor } from '@/executor'
import type { ExecutionResult, ExecutionContext } from '@/executor/types'
import { parseWebhookBody } from '@/lib/webhooks/processor'
import { generateRequestId } from '@/lib/utils'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { updateWorkflowRunCounts } from '@/lib/workflows/utils'

const logger = createLogger('WebhookResumeAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * OPTIONS /api/webhooks/resume/[workflowId]/[executionId]
 * Handle CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sim-Secret',
    },
  })
}

/**
 * GET /api/webhooks/resume/[workflowId]/[executionId]
 * Test endpoint to verify route is accessible
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; executionId: string }> }
) {
  try {
    const { workflowId, executionId } = await params
    return NextResponse.json({
      message: 'Webhook resume endpoint is accessible',
      workflowId,
      executionId,
      method: 'GET',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Error in GET handler', message: error.message },
      { status: 500 }
    )
  }
}

/**
 * POST /api/webhooks/resume/[workflowId]/[executionId]
 * Public webhook endpoint to resume a paused workflow execution
 * This endpoint is designed for external systems to trigger workflow resumption
 * and only works for deployed workflows (isDeployedContext: true)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; executionId: string }> }
) {
  const startTime = Date.now()
  const requestId = generateRequestId()
  let workflowId: string = 'unknown'
  let executionId: string = 'unknown'
  
  try {
    const paramsData = await params
    workflowId = paramsData.workflowId
    executionId = paramsData.executionId
    
    logger.info(`[${requestId}] Webhook resume request for execution ${executionId} of workflow ${workflowId}`)

    // Parse webhook body - allow empty bodies for resume webhooks
    logger.info(`[${requestId}] Parsing webhook body...`)
    
    let resumeInput: any = {}
    let rawBody: string = ''
    
    try {
      const requestClone = request.clone()
      rawBody = await requestClone.text()
      
      // Allow empty bodies for resume webhooks
      if (rawBody && rawBody.length > 0) {
        try {
          resumeInput = JSON.parse(rawBody)
          logger.info(`[${requestId}] Parsed JSON webhook payload`, {
            resumeInputKeys: Object.keys(resumeInput),
          })
        } catch (parseError) {
          logger.warn(`[${requestId}] Failed to parse webhook body as JSON, using empty object`, {
            error: parseError instanceof Error ? parseError.message : String(parseError),
          })
          resumeInput = {}
        }
      } else {
        logger.info(`[${requestId}] Empty webhook body, using empty object`)
      }
    } catch (bodyError) {
      logger.error(`[${requestId}] Failed to read request body`, {
        error: bodyError instanceof Error ? bodyError.message : String(bodyError),
      })
      resumeInput = {}
    }
    
    logger.info(`[${requestId}] Webhook body processing complete`, {
      hasResumeInput: !!resumeInput,
      resumeInputKeys: Object.keys(resumeInput || {}),
      rawBodyLength: rawBody?.length,
    })

    // Check if workflow exists
    logger.info(`[${requestId}] Checking if workflow exists: ${workflowId}`)
    const [workflowData] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }
    
    logger.info(`[${requestId}] Workflow found`, {
      workflowId: workflowData.id,
      workspaceId: workflowData.workspaceId,
      name: workflowData.name,
    })

    // Get the full resume data
    logger.info(`[${requestId}] Loading paused execution data for ${executionId}`)
    
    let resumeData: any
    try {
      resumeData = await pauseResumeService.resumeExecution(executionId)
    } catch (dbError: any) {
      logger.error(`[${requestId}] Database error loading paused execution`, {
        error: dbError.message,
        executionId,
      })
      return NextResponse.json(
        { 
          error: 'Database error loading paused execution data',
          message: dbError.message,
          executionId,
        },
        { status: 500 }
      )
    }

    if (!resumeData) {
      logger.warn(`[${requestId}] Failed to load paused execution data for ${executionId}`)
      return NextResponse.json(
        { error: 'Failed to load paused execution data' },
        { status: 500 }
      )
    }
    
    logger.info(`[${requestId}] Paused execution data loaded`, {
      hasWorkflowState: !!resumeData.workflowState,
      hasExecutionContext: !!resumeData.executionContext,
      hasMetadata: !!resumeData.metadata,
      metadataKeys: Object.keys(resumeData.metadata || {}),
    })

    // CRITICAL: Verify this is a deployed workflow execution
    // Webhook resume is only allowed for deployed contexts for security
    const isDeployedContext = resumeData.metadata?.isDeployedContext === true
    
    logger.info(`[${requestId}] Checking deployment context`, {
      isDeployedContext,
      metadataIsDeployedContext: resumeData.metadata?.isDeployedContext,
    })
    
    if (!isDeployedContext) {
      logger.warn(`[${requestId}] Webhook resume attempted for non-deployed execution ${executionId}`)
      return NextResponse.json(
        { 
          error: 'Webhook resume is only available for deployed workflows. Use the API resume endpoint for manual executions.',
          details: 'This execution was not started from a deployed context (API, webhook, or schedule trigger)'
        },
        { status: 403 }
      )
    }

    // Extract wait block info to check webhook authentication
    const waitBlockInfoAuth = resumeData.metadata?.waitBlockInfo as any
    const triggerConfig = waitBlockInfoAuth?.triggerConfig
    
    logger.info(`[${requestId}] Checking webhook authentication`, {
      hasWaitBlockInfo: !!waitBlockInfoAuth,
      triggerType: triggerConfig?.type,
      hasWebhookSecret: !!triggerConfig?.webhookSecret,
    })

    // Verify webhook authentication if configured
    if (triggerConfig?.type === 'webhook' && triggerConfig?.webhookSecret) {
      const expectedSecret = triggerConfig.webhookSecret
      
      // Check X-Sim-Secret header (same as generic webhooks)
      const providedSecret = request.headers.get('x-sim-secret')
      
      logger.info(`[${requestId}] Webhook authentication required`, {
        hasProvidedSecret: !!providedSecret,
        headerPresent: request.headers.has('x-sim-secret'),
      })
      
      if (!providedSecret) {
        logger.warn(`[${requestId}] Webhook resume request missing authentication header`)
        return new NextResponse('Unauthorized - Missing authentication', { status: 401 })
      }
      
      if (providedSecret !== expectedSecret) {
        logger.warn(`[${requestId}] Webhook resume authentication failed`)
        return new NextResponse('Unauthorized - Invalid secret', { status: 401 })
      }
      
      logger.info(`[${requestId}] Webhook resume authentication verified`)
    }

    logger.info(`[${requestId}] Resuming deployed execution ${executionId}`, {
      workflowId,
      isDeployedContext,
      hasResumeInput: Object.keys(resumeInput).length > 0,
    })

    // Create executor from paused state
    logger.info(`[${requestId}] Creating executor from paused state`)
    
    let executionResult: ExecutionResult
    let context: ExecutionContext
    let preResumeExecutedBlocks: Set<string>
    
    // Create logging session for resumed execution
    const loggingSession = new LoggingSession(workflowId, executionId, 'webhook', requestId)
    
    try {
      // Start logging session
      await loggingSession.safeStart({
        userId: workflowData.userId,
        workspaceId: workflowData.workspaceId || undefined,
        variables: resumeData.environmentVariables || {},
      })
      
      // If deployment version ID is stored in metadata, use that specific version
      let workflowStateToUse = resumeData.workflowState
      const deploymentVersionId = resumeData.metadata?.deploymentVersionId
      
      if (deploymentVersionId) {
        logger.info(`[${requestId}] Loading specific deployment version from metadata: ${deploymentVersionId}`)
        const { loadDeploymentVersionById } = await import('@/lib/workflows/db-helpers')
        const deploymentData = await loadDeploymentVersionById(deploymentVersionId)
        
        if (deploymentData) {
          // Use deployment version state but preserve the original context
          const { Serializer } = await import('@/serializer')
          workflowStateToUse = new Serializer().serializeWorkflow(
            deploymentData.blocks,
            deploymentData.edges,
            deploymentData.loops || {},
            deploymentData.parallels || {},
            false
          )
          logger.info(`[${requestId}] Using deployment version state`)
        } else {
          logger.warn(`[${requestId}] Deployment version ${deploymentVersionId} not found, using original state`)
        }
      }
      
      const executorData = Executor.createFromPausedState(
        workflowStateToUse,
        resumeData.executionContext,
        resumeData.environmentVariables,
        resumeData.workflowInput,
        {},
        {
          executionId: executionId,
          workspaceId: workflowData.workspaceId,
          isDeployedContext: true,
          resumeInput, // Include resume input in context for blocks to access
          isResuming: true, // Mark that we're resuming
          deploymentVersionId: resumeData.metadata?.deploymentVersionId, // Pass through deployment version ID from metadata
        }
      )
      
      const { executor } = executorData
      context = executorData.context
      
      logger.info(`[${requestId}] Executor created successfully`, {
        hasExecutor: !!executor,
        hasContext: !!context,
        executedBlocksCount: context.executedBlocks?.size || 0,
        blockStatesCount: context.blockStates?.size || 0,
      })

      // Set up logging on the executor
      loggingSession.setupExecutor(executor)

      // Track which blocks were already executed before resume
      preResumeExecutedBlocks = new Set(context.executedBlocks)

      // Resume execution
      logger.info(`[${requestId}] Starting resume execution from context`)
      const result = await executor.resumeFromContext(workflowId, context)
      logger.info(`[${requestId}] Resume execution completed`, {
        hasResult: !!result,
        resultType: typeof result,
        hasStream: 'stream' in result,
        hasExecution: 'execution' in result,
      })

      // Check if we got a StreamingExecution result (with stream + execution properties)
      // For resume, we only care about the ExecutionResult part, not the stream
      executionResult = 'stream' in result && 'execution' in result ? result.execution : result
    } catch (executorError: any) {
      logger.error(`[${requestId}] Failed to create or execute from paused state`, {
        error: executorError.message,
        stack: executorError.stack,
        name: executorError.name,
        phase: 'executor_creation',
      })
      
      // Complete logging session with error
      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startTime,
        error: {
          message: executorError.message || 'Failed to resume workflow execution',
          stackTrace: executorError.stack || '',
        },
      })
      
      throw executorError
    }

    // Filter logs to only include blocks executed AFTER resume (not before pause)
    const newLogs = (executionResult.logs || []).filter((log: any) => 
      !preResumeExecutedBlocks.has(log.blockId)
    )

    // Check if execution completed or was paused/cancelled again
    const metadata = executionResult.metadata as any
    const { context: resumedContext, ...metadataWithoutContext } = metadata || {}
    const isPaused = metadata?.isPaused
    const waitBlockInfo = metadata?.waitBlockInfo
    const isCancelled = !executionResult.success && executionResult.error?.includes('cancelled')

    // If paused again, persist the new paused state
    if (isPaused) {
      if (!resumedContext) {
        logger.warn(`[${requestId}] Resume result indicated paused but no context provided`, {
          executionId,
          workflowId,
        })
      } else {
        try {
          const executionContext = resumedContext
          const workflowState = executionContext.workflow || resumeData.workflowState
          const environmentVariables =
            executionContext.environmentVariables || resumeData.environmentVariables || {}
          const pauseMetadata = {
            ...(resumeData.metadata || {}),
            ...metadataWithoutContext,
            waitBlockInfo,
            isDeployedContext: true,
            deploymentVersionId: resumeData.metadata?.deploymentVersionId,
          }

          await pauseResumeService.pauseExecution({
            workflowId,
            executionId,
            userId: workflowData.userId,
            executionContext,
            workflowState,
            environmentVariables,
            workflowInput: resumeData.workflowInput,
            metadata: pauseMetadata,
          })

          logger.info(`[${requestId}] Workflow paused again after webhook resume`, {
            executionId,
            waitBlockInfo,
          })
        } catch (persistError: any) {
          logger.error(`[${requestId}] Failed to persist paused execution after webhook resume`, {
            executionId,
            error: persistError,
          })
        }
      }
    }

    const duration = Date.now() - startTime

    // Build trace spans from execution result (works for both success and failure)
    const { traceSpans, totalDuration } = buildTraceSpans(executionResult)

    // Update workflow run counts if execution was successful
    if (executionResult.success) {
      await updateWorkflowRunCounts(workflowId)
    }

    // Complete logging session
    if (executionResult.success || isPaused) {
      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: totalDuration || duration,
        finalOutput: executionResult.output || {},
        traceSpans: (traceSpans || []) as any,
      })
    } else {
      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: totalDuration || duration,
        error: {
          message: executionResult.error || 'Workflow execution failed',
          stackTrace: '',
        },
      })
    }

    logger.info(`[${requestId}] Webhook resume completed for ${executionId}`, {
      success: executionResult.success,
      isPaused,
      isCancelled,
      duration,
    })

    return NextResponse.json({
      success: executionResult.success,
      output: executionResult.output,
      error: executionResult.error,
      isPaused,
      isCancelled,
      logs: newLogs, // Only return logs for blocks executed after resume
      metadata: {
        duration,
        executedBlockCount: context.executedBlocks.size,
        waitBlockInfo: isPaused ? waitBlockInfo : undefined,
      },
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error(`[${requestId}] Error in webhook resume:`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      executionId: executionId || 'unknown',
      workflowId: workflowId || 'unknown',
    })
    return NextResponse.json(
      {
        error: 'Internal server error during webhook resume',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        duration,
      },
      { status: 500 }
    )
  }
}