import type { NextRequest } from 'next/server'
import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const { logs, executionId, result } = body

    if (result) {
      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      const isChatExecution = result.metadata?.source === 'chat'

      const triggerType = isChatExecution ? 'chat' : 'manual'
      const loggingSession = new LoggingSession(id, executionId, triggerType, requestId)

      const userId = validation.workflow.userId
      const workspaceId = validation.workflow.workspaceId || ''

      // Check if a log entry already exists for this execution
      const existingLog = await db
        .select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, executionId))
        .limit(1)

<<<<<<< HEAD
      const { traceSpans } = buildTraceSpans(result)

      if (result.success === false) {
        const message = result.error || 'Workflow execution failed'
        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: result.metadata?.duration || 0,
          error: { message },
          traceSpans,
        })
      } else {
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: result.metadata?.duration || 0,
          finalOutput: result.output || {},
          traceSpans,
        })
=======
      // Check if execution is paused (HITL block)
      const isPaused = result.metadata?.isPaused === true

      // Only create a new log entry if one doesn't exist
      if (existingLog.length === 0) {
        await loggingSession.safeStart({
          userId,
          workspaceId,
          variables: {},
        })
        logger.info(`[${requestId}] Created new log entry for execution ${executionId}`)
      } else {
        logger.info(`[${requestId}] Log entry already exists for execution ${executionId}`, {
          hasEndedAt: !!existingLog[0].endedAt,
        })
      }

      // Handle paused executions - don't complete the log
      if (isPaused) {
        logger.info(`[${requestId}] Execution paused at HITL block, keeping log open for later completion`, {
          executionId,
          waitBlockInfo: result.metadata?.waitBlockInfo,
        })
        
        return createSuccessResponse({
          message: 'Execution paused - log created but kept open for resume',
        })
      }
      
      // Handle non-paused executions - complete the log
      if (existingLog.length > 0 && existingLog[0].endedAt) {
        // Log already exists and is marked as completed
        // Check if this is a resumed execution with new trace spans to update
        const hasTraceSpans = result.traceSpans && Array.isArray(result.traceSpans) && result.traceSpans.length > 0
        
        if (hasTraceSpans) {
          // This is a resumed execution with trace spans - update the existing log
          logger.info(`[${requestId}] Updating completed log with trace spans from resumed execution`, {
            executionId,
            traceSpansCount: result.traceSpans.length,
          })
          
          await loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: result.metadata?.duration || result.totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: result.traceSpans,
          })
        } else {
          // Log already completed and no new trace spans - skip
          logger.info(`[${requestId}] Log already completed, skipping`, {
            executionId,
          })
        }
      } else {
        // Complete the log for the first time
        if (result.success === false) {
          const message = result.error || 'Workflow execution failed'
          await loggingSession.safeCompleteWithError({
            endedAt: new Date().toISOString(),
            totalDurationMs: result.metadata?.duration || 0,
            error: { message },
          })
        } else {
          const { traceSpans } = buildTraceSpans(result)
          
          logger.info(`[${requestId}] Completing log with trace spans`, {
            executionId,
            traceSpansCount: traceSpans?.length || 0,
          })
          
          await loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: result.metadata?.duration || 0,
            finalOutput: result.output || {},
            traceSpans,
          })
        }
>>>>>>> fe37dfd8f (HITL v1)
      }

      return createSuccessResponse({
        message: 'Execution logs persisted successfully',
      })
    }

    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      logger.warn(`[${requestId}] No logs provided for workflow: ${id}`)
      return createErrorResponse('No logs provided', 400)
    }

    logger.info(`[${requestId}] Persisting ${logs.length} logs for workflow: ${id}`, {
      executionId,
    })

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
