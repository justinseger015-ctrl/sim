import { NextRequest, NextResponse } from 'next/server'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'
import { Executor } from '@/executor'
import type { ExecutionResult } from '@/executor/types'
import { parseWebhookBody } from '@/lib/webhooks/processor'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('WebhookResumeAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

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
  
  try {
    const { workflowId, executionId } = await params

    logger.info(`[${requestId}] Webhook resume request for execution ${executionId} of workflow ${workflowId}`)

    // Parse webhook body using the same logic as regular webhooks
    const parseResult = await parseWebhookBody(request, requestId)
    
    if (parseResult instanceof NextResponse) {
      return parseResult
    }
    
    const { body: resumeInput, rawBody } = parseResult

    // Check if workflow exists
    const [workflowData] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Get the full resume data
    const resumeData = await pauseResumeService.resumeExecution(executionId)

    if (!resumeData) {
      logger.warn(`[${requestId}] Failed to load paused execution data for ${executionId}`)
      return NextResponse.json(
        { error: 'Failed to load paused execution data' },
        { status: 500 }
      )
    }

    // CRITICAL: Verify this is a deployed workflow execution
    // Webhook resume is only allowed for deployed contexts for security
    const isDeployedContext = resumeData.metadata?.isDeployedContext === true
    
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

    // Verify webhook authentication if configured
    if (triggerConfig?.type === 'webhook' && triggerConfig?.webhookSecret) {
      const expectedSecret = triggerConfig.webhookSecret
      
      // Check X-Sim-Secret header (same as generic webhooks)
      const providedSecret = request.headers.get('x-sim-secret')
      
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
    const { executor, context } = Executor.createFromPausedState(
      resumeData.workflowState,
      resumeData.executionContext,
      resumeData.environmentVariables,
      resumeData.workflowInput,
      {},
      {
        executionId: executionId,
        workspaceId: workflowData.workspaceId,
        isDeployedContext: true,
        resumeInput, // Include resume input in context for blocks to access
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
    logger.error(`[${requestId}] Error in webhook resume:`, error)
    return NextResponse.json(
      {
        error: 'Internal server error during webhook resume',
        message: error.message,
        duration,
      },
      { status: 500 }
    )
  }
}