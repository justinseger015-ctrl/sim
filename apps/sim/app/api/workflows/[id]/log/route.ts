import type { NextRequest } from 'next/server'
import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
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

      // Check if execution is paused (HITL block)
      const isPaused = result.metadata?.isPaused === true

      // Only create a new log entry if one doesn't exist
      if (existingLog.length === 0) {
        const startResult = await loggingSession.safeStart({
          userId,
          workspaceId,
          variables: {},
        })
        logger.info(`[${requestId}] Log creation result`, {
          executionId,
          success: startResult,
          userId,
          workspaceId,
        })
      } else {
        logger.info(`[${requestId}] Log entry already exists for execution ${executionId}`, {
          hasEndedAt: !!existingLog[0].endedAt,
          level: existingLog[0].level,
        })
      }

      // Handle paused executions - mark as pending
      if (isPaused) {
        logger.info(`[${requestId}] Execution paused at HITL block, marking as pending`, {
          executionId,
          waitBlockInfo: result.metadata?.waitBlockInfo,
        })
        
        // Build trace spans for paused execution (includes blocks executed before pause)
        const { traceSpans, totalDuration } = buildTraceSpans(result)
        
        // Calculate costs from executed blocks
        const { calculateCostSummary } = await import('@/lib/logs/execution/logging-factory')
        const costSummary = calculateCostSummary(traceSpans)
        
        // Update log to pending status with current trace spans and costs
        // Note: approval token is stored in pausedWorkflowExecutions and joined in logs API
        await db
          .update(workflowExecutionLogs)
          .set({
            level: 'pending',
            totalDurationMs: totalDuration,
            cost: {
              total: costSummary.totalCost,
              input: costSummary.totalInputCost,
              output: costSummary.totalOutputCost,
              tokens: {
                prompt: costSummary.totalPromptTokens,
                completion: costSummary.totalCompletionTokens,
                total: costSummary.totalTokens,
              },
              models: costSummary.models,
            },
            executionData: sql`jsonb_set(
              COALESCE(execution_data, '{}'::jsonb),
              '{traceSpans}',
              ${JSON.stringify(traceSpans)}::jsonb
            )`,
          })
          .where(eq(workflowExecutionLogs.executionId, executionId))
        
        logger.info(`[${requestId}] Updated log to pending status`, {
          traceSpansCount: traceSpans.length,
          totalCost: costSummary.totalCost,
          modelCost: costSummary.modelCost,
        })
        
        return createSuccessResponse({
          message: 'Execution paused - log marked as pending',
        })
      }
      
      // Handle non-paused executions - complete the log
      if (existingLog.length > 0 && (existingLog[0].endedAt || existingLog[0].level === 'pending')) {
        // Log already exists and is either completed or pending (resume case)
        // Check if this is a resumed execution with new trace spans to update
        const hasTraceSpans = result.traceSpans && Array.isArray(result.traceSpans) && result.traceSpans.length > 0
        const wasPending = existingLog[0].level === 'pending'
        
        if (hasTraceSpans || wasPending) {
          // This is a resumed execution or already completed - update with final status
          logger.info(`[${requestId}] Updating ${wasPending ? 'pending' : 'completed'} log with final result`, {
            executionId,
            traceSpansCount: result.traceSpans?.length || 0,
            wasPending,
          })
          
          await loggingSession.safeComplete({
            endedAt: new Date().toISOString(),
            totalDurationMs: result.metadata?.duration || result.totalDuration || 0,
            finalOutput: result.output || {},
            traceSpans: result.traceSpans || [],
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
