import { NextRequest, NextResponse } from 'next/server'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'
import { Executor } from '@/executor'

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
  
  try {
    const { workflowId, executionId } = await params

    logger.info(`Webhook resume request for execution ${executionId} of workflow ${workflowId}`)

    // Parse optional JSON body for input data
    let resumeInput: any = {}
    try {
      const body = await request.text()
      if (body && body.trim()) {
        resumeInput = JSON.parse(body)
      }
    } catch (parseError) {
      logger.warn('Failed to parse resume input as JSON, using empty object', {
        error: parseError,
      })
    }

    // Check if workflow exists
    const [workflowData] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowData) {
      logger.warn(`Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Retrieve paused execution
    const resumeData = await pauseResumeService.resumeExecution(executionId)

    if (!resumeData) {
      logger.warn(`No paused execution found for ${executionId}`)
      return NextResponse.json(
        { error: 'No paused execution found for this ID' },
        { status: 404 }
      )
    }

    // CRITICAL: Verify this is a deployed workflow execution
    // Webhook resume is only allowed for deployed contexts for security
    const isDeployedContext = resumeData.metadata?.isDeployedContext === true
    
    if (!isDeployedContext) {
      logger.warn(`Webhook resume attempted for non-deployed execution ${executionId}`)
      return NextResponse.json(
        { 
          error: 'Webhook resume is only available for deployed workflows. Use the API resume endpoint for manual executions.',
          details: 'This execution was not started from a deployed context (API, webhook, or schedule trigger)'
        },
        { status: 403 }
      )
    }

    logger.info(`Resuming deployed execution ${executionId}`, {
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

    // Check if execution completed or was paused/cancelled again
    const metadata = result.metadata as any
    const { context: resumedContext, ...metadataWithoutContext } = metadata || {}
    const isPaused = metadata?.isPaused
    const waitBlockInfo = metadata?.waitBlockInfo
    const isCancelled = !result.success && result.error?.includes('cancelled')

    // If paused again, persist the new paused state
    if (isPaused) {
      if (!resumedContext) {
        logger.warn('Resume result indicated paused but no context provided', {
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

          logger.info('Workflow paused again after webhook resume', {
            executionId,
            waitBlockInfo,
          })
        } catch (persistError: any) {
          logger.error('Failed to persist paused execution after webhook resume', {
            executionId,
            error: persistError,
          })
        }
      }
    }

    const duration = Date.now() - startTime

    logger.info(`Webhook resume completed for ${executionId}`, {
      success: result.success,
      isPaused,
      isCancelled,
      duration,
    })

    return NextResponse.json({
      success: result.success,
      output: result.output,
      error: result.error,
      isPaused,
      isCancelled,
      metadata: {
        duration,
        executedBlockCount: context.executedBlocks.size,
        waitBlockInfo: isPaused ? waitBlockInfo : undefined,
      },
    })
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error('Error in webhook resume:', error)
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

