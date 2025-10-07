import { db } from '@sim/db'
import { pausedWorkflowExecutions, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { Executor } from '@/executor'
import { deserializeExecutionContext } from '@/lib/execution/pause-resume-utils'

const logger = createLogger('ApprovalAPI')

/**
 * GET /api/approval/[token]
 * Retrieve approval details for a paused execution
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params

    if (!token) {
      return NextResponse.json({ error: 'Approval token is required' }, { status: 400 })
    }

    // Look up the paused execution
    const pausedExecution = await db
      .select()
      .from(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.approvalToken, token))
      .limit(1)

    if (!pausedExecution || pausedExecution.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired approval link' }, { status: 404 })
    }

    const execution = pausedExecution[0]

    // Check if already used
    if (execution.approvalUsed) {
      return NextResponse.json(
        {
          error: 'This approval link has already been used',
          alreadyUsed: true,
        },
        { status: 410 }
      )
    }

    // Return execution details for the UI
    return NextResponse.json({
      workflowId: execution.workflowId,
      executionId: execution.executionId,
      pausedAt: execution.pausedAt,
      metadata: execution.metadata,
      workflowName: (execution.workflowState as any)?.name || 'Workflow',
    })
  } catch (error) {
    logger.error('Error retrieving approval details', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/approval/[token]
 * Handle approve or reject action
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const mergeLogs = (...logSets: any[][]): any[] => {
    const merged: any[] = []
    const seen = new Map<string, boolean>()

    logSets.forEach((logs) => {
      if (!Array.isArray(logs)) {
        return
      }

      logs.forEach((log, index) => {
        if (!log || typeof log !== 'object') {
          return
        }

        const startedAt = log.startedAt || log.endedAt || ''
        const blockId = log.blockId || `log-${index}`
        const key = log.logId
          ? `id:${log.logId}`
          : `${blockId}-${startedAt}-${log.success === false ? 'error' : 'ok'}`

        if (!seen.has(key)) {
          seen.set(key, true)
          merged.push(log)
        }
      })
    })

    merged.sort((a, b) => {
      const aTime = new Date(a.startedAt || a.endedAt || 0).getTime()
      const bTime = new Date(b.startedAt || b.endedAt || 0).getTime()
      return aTime - bTime
    })

    return merged
  }

  try {
    const { token } = await params
    const body = await request.json()
    const { action } = body // 'approve' or 'reject'

    if (!token) {
      return NextResponse.json({ error: 'Approval token is required' }, { status: 400 })
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      )
    }

    // Look up the paused execution
    const pausedExecution = await db
      .select()
      .from(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.approvalToken, token))
      .limit(1)

    if (!pausedExecution || pausedExecution.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired approval link' }, { status: 404 })
    }

    const execution = pausedExecution[0]

    // Check if already used
    if (execution.approvalUsed) {
      return NextResponse.json(
        {
          error: 'This approval link has already been used',
          alreadyUsed: true,
        },
        { status: 410 }
      )
    }

    // Mark as used
    await db
      .update(pausedWorkflowExecutions)
      .set({ approvalUsed: true })
      .where(eq(pausedWorkflowExecutions.approvalToken, token))

    const approved = action === 'approve'

    logger.info('Approval action received, resuming workflow', {
      executionId: execution.executionId,
      workflowId: execution.workflowId,
      approved,
    })

    try {
      // Get workflow info
      const [workflowRecord] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.id, execution.workflowId))
        .limit(1)

      if (!workflowRecord) {
        throw new Error('Workflow not found')
      }

      // Deserialize the execution context
      const context = deserializeExecutionContext(execution.executionContext)
      const workflowState = execution.workflowState as any
      const blockId = (execution.metadata as any)?.blockId

      logger.info('Resuming workflow from paused state', {
        executionId: execution.executionId,
        workflowId: execution.workflowId,
        blockId,
      })

      // Reconstruct executedBlocks from blockLogs
      // The executor uses executedBlocks to track what has already run
      const prePauseLogs = Array.isArray(context.blockLogs) ? context.blockLogs : []
      for (const log of prePauseLogs) {
        if (log.blockId) {
          context.executedBlocks.add(log.blockId)
        }
      }
      
      // Rebuild activeExecutionPath by finding all downstream blocks from executed blocks
      // The executor only processes blocks in activeExecutionPath
      const connections = workflowState.connections || []
      const executedBlockIds = Array.from(context.executedBlocks)
      
      // Add all blocks to activeExecutionPath that are reachable from executed blocks
      for (const conn of connections) {
        // If the source block was executed, add the target to the active path
        if (executedBlockIds.includes(conn.source) || conn.source === blockId) {
          context.activeExecutionPath.add(conn.target)
        }
      }
      
      // Also add all executed blocks to the active path (they're part of the flow)
      for (const execBlockId of executedBlockIds) {
        context.activeExecutionPath.add(execBlockId)
      }
      if (blockId) {
        context.activeExecutionPath.add(blockId)
      }
      
      logger.info('Reconstructed executedBlocks and activeExecutionPath', {
        executedBlocksSize: context.executedBlocks.size,
        blockIds: Array.from(context.executedBlocks),
        activeExecutionPathSize: context.activeExecutionPath.size,
        activeExecutionPath: Array.from(context.activeExecutionPath),
        workflowBlockCount: workflowState.blocks?.length || 0,
        workflowBlocks: workflowState.blocks?.map((b: any) => ({ id: b.id, name: b.metadata?.name })) || [],
        connections: workflowState.connections?.map((c: any) => ({ source: c.source, target: c.target })) || [],
      })
      
      // Mark the Human in the Loop block as executed and set its output
      // This is critical - the executor uses executedBlocks to know what has already run
      if (blockId) {
        const pausedAt = new Date(execution.pausedAt)
        const approvedAt = new Date()
        const executionTime = approvedAt.getTime() - pausedAt.getTime()
        
        const approvalOutput = {
          approveUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/approve/${token}`,
          approved,
        }
        
        context.blockStates.set(blockId, {
          output: approvalOutput,
          executed: true,
          executionTime,
        })
        
        // Mark the block as executed so the executor knows to skip it and continue to next blocks
        context.executedBlocks.add(blockId)
        
        // Add the HITL block execution to the logs
        // Find the HITL block metadata from the workflow state
        const hitlBlock = workflowState.blocks?.find((b: any) => b.id === blockId)
        
        context.blockLogs.push({
          blockId,
          blockName: hitlBlock?.metadata?.name || 'Human in the Loop',
          blockType: hitlBlock?.metadata?.id || 'user_approval',
          startedAt: pausedAt.toISOString(),
          endedAt: approvedAt.toISOString(),
          durationMs: executionTime,
          success: true,
          input: {
            resumeTriggerType: 'human',
          },
          output: approvalOutput,
        })
        
        logger.info('Marked HITL block as executed in context and added to logs', {
          blockId,
          approved,
          executedBlocksSize: context.executedBlocks.size,
          allExecutedBlocks: Array.from(context.executedBlocks),
          blockLogsCount: context.blockLogs.length,
        })
      }

      // The blockState has already been set above with the clean output

      // If rejected, don't resume execution - just mark and return
      if (!approved) {
        // Complete the log with error status
        try {
          const { getBaseUrl } = await import('@/lib/urls/utils')
          const baseUrl = getBaseUrl()
          const triggerType = (execution.metadata as any)?.triggerType || 'manual'
          const rejectionLogs = mergeLogs(prePauseLogs)
          
          const logResponse = await fetch(`${baseUrl}/api/workflows/${execution.workflowId}/log`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': request.headers.get('cookie') || '',
            },
            body: JSON.stringify({
              executionId: execution.executionId,
              result: {
                success: false,
                error: 'Workflow rejected by user',
                logs: rejectionLogs,
                metadata: {
                  duration: (execution.metadata as any)?.duration || 0,
                  isPaused: false,
                  source: triggerType === 'chat' ? 'chat' : undefined,
                },
              },
            }),
          })
          
          if (!logResponse.ok) {
            logger.error('Failed to log rejection', {
              executionId: execution.executionId,
              status: logResponse.status,
            })
          }
        } catch (logError) {
          logger.error('Error logging rejection', {
            executionId: execution.executionId,
            error: logError,
          })
        }
        
        // Delete the paused execution record
        await db
          .delete(pausedWorkflowExecutions)
          .where(eq(pausedWorkflowExecutions.approvalToken, token))

        logger.info('Workflow rejected - execution stopped', {
          executionId: execution.executionId,
          workflowId: execution.workflowId,
        })

        return NextResponse.json({
          success: true,
          approved: false,
          workflowResumed: false,
          workflowCompleted: false,
          message: 'Workflow rejected. Execution stopped.',
        })
      }

      // Resume execution from the paused state (only if approved)
      const { executor, context: resumedContext } = Executor.createFromPausedState(
        workflowState,
        context,
        execution.environmentVariables as Record<string, string>,
        execution.workflowInput || {},
        {},
        {
          executionId: execution.executionId,
          workflowId: execution.workflowId,
          workspaceId: workflowRecord.workspaceId || undefined,
          isDeployedContext: (execution.metadata as any)?.isDeployedContext || false,
          // Pass the approval decision as resumeInput
          resumeInput: {
            approved: true,
            approvedAt: new Date().toISOString(),
            approvalToken: token,
          },
        }
      )

      // Log context state before resuming
      logger.info('Context state before resume', {
        executionId: execution.executionId,
        executedBlocksSize: resumedContext.executedBlocks.size,
        executedBlockIds: Array.from(resumedContext.executedBlocks),
        blockLogsCount: resumedContext.blockLogs?.length || 0,
        hasResumeInput: !!(resumedContext as any).resumeInput,
        isResuming: !!(resumedContext as any).isResuming,
      })

      // Resume from the saved context (continues from where it paused)
      const result = await executor.resumeFromContext(execution.workflowId, resumedContext)

      // Check if it's a streaming result or regular result
      const executionResult = 'stream' in result && 'execution' in result ? result.execution : result
      const isSuccess = 'success' in executionResult ? executionResult.success : true
      
      logger.info('Execution result after resume', {
        executionId: execution.executionId,
        success: isSuccess,
        logsCount: Array.isArray(executionResult.logs) ? executionResult.logs.length : 0,
        hasOutput: !!executionResult.output,
      })

      const resumedLogs = Array.isArray(executionResult.logs) ? executionResult.logs : []
      const combinedLogs = mergeLogs(prePauseLogs, resumedLogs)
      const mergedExecutionResult = {
        ...executionResult,
        logs: combinedLogs,
      }

      // Ensure resumed context retains block logs for downstream handlers
      resumedContext.blockLogs = combinedLogs

      // Delete the paused execution record now that it's resumed
      await db
        .delete(pausedWorkflowExecutions)
        .where(eq(pausedWorkflowExecutions.approvalToken, token))

      logger.info('Workflow resumed and completed successfully', {
        executionId: execution.executionId,
        workflowId: execution.workflowId,
        success: isSuccess,
        blockCount: executionResult.logs?.length || 0,
      })

      // Persist the resumed execution logs
      if (mergedExecutionResult) {
        try {
          // Build trace spans from execution result
          const { buildTraceSpans } = await import('@/lib/logs/execution/trace-spans/trace-spans')
          const { traceSpans, totalDuration } = buildTraceSpans(mergedExecutionResult)
          
          // Get the original trigger type from metadata
          const triggerType = (execution.metadata as any)?.triggerType || 'manual'
          
          // Get base URL for API calls
          const { getBaseUrl } = await import('@/lib/urls/utils')
          const baseUrl = getBaseUrl()
          
          // Call the log API to persist the completed execution
          const logResponse = await fetch(`${baseUrl}/api/workflows/${execution.workflowId}/log`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Pass along any auth headers from the original request
              'Cookie': request.headers.get('cookie') || '',
            },
            body: JSON.stringify({
              executionId: execution.executionId,
              result: {
                ...mergedExecutionResult,
                metadata: {
                  ...mergedExecutionResult.metadata,
                  isPaused: false, // Execution is no longer paused
                  source: triggerType === 'chat' ? 'chat' : undefined,
                },
                traceSpans,
                totalDuration,
              },
            }),
          })
          
          if (!logResponse.ok) {
            logger.error('Failed to persist resumed execution logs', {
              executionId: execution.executionId,
              status: logResponse.status,
            })
          }
        } catch (logError) {
          logger.error('Error persisting resumed execution logs', {
            executionId: execution.executionId,
            error: logError,
          })
          // Don't fail the request if log persistence fails
        }
      }

      return NextResponse.json({
        success: true,
        approved: true,
        workflowResumed: true,
        workflowCompleted: isSuccess,
        message: 'Workflow approved and execution resumed successfully.',
        executionResult: {
          ...mergedExecutionResult,
          executionId: execution.executionId,
        },
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      
      logger.error('Error resuming workflow', {
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
        executionId: execution.executionId,
        workflowId: execution.workflowId,
      })

      // Return error response
      return NextResponse.json({
        success: false,
        approved,
        workflowResumed: false,
        error: 'Workflow resumption failed',
        details: errorMessage,
      }, { status: 500 })
    }
  } catch (error) {
    logger.error('Error processing approval', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

