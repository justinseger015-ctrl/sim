import { db } from '@sim/db'
import { pausedWorkflowExecutions, workflow as workflowTable } from '@sim/db/schema'
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
    const metadata = execution.metadata as any
    return NextResponse.json({
      workflowId: execution.workflowId,
      executionId: execution.executionId,
      pausedAt: execution.pausedAt,
      metadata: execution.metadata,
      workflowName: (execution.workflowState as any)?.name || 'Workflow',
      humanOperation: metadata?.humanOperation || 'approval',
      humanInputFormat: metadata?.humanInputFormat,
      fullApprovalView: metadata?.fullApprovalView !== undefined ? metadata.fullApprovalView : true,
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
    const { action, formData } = body // 'approve' or 'reject', and optional custom form data

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
        .from(workflowTable)
        .where(eq(workflowTable.id, execution.workflowId))
        .limit(1)

      if (!workflowRecord) {
        throw new Error('Workflow not found')
      }

      // Deserialize the execution context
      const context = deserializeExecutionContext(execution.executionContext)
      const workflowStateRaw = execution.workflowState as any
      
      // Convert edges back to connections for Executor compatibility
      const workflowState = {
        ...workflowStateRaw,
        connections: workflowStateRaw.edges || workflowStateRaw.connections || [],
      }
      
      const blockId = (execution.metadata as any)?.blockId

      logger.info('Resuming workflow from paused state', {
        executionId: execution.executionId,
        workflowId: execution.workflowId,
        blockId,
      })

      // Reconstruct executedBlocks from blockLogs
      // The executor uses executedBlocks to track what has already run
      const metadataLogs = Array.isArray((execution.metadata as any)?.logs)
        ? ((execution.metadata as any).logs as any[])
        : []
      const prePauseLogs = metadataLogs.length > 0 ? metadataLogs : Array.isArray(context.blockLogs) ? context.blockLogs : []
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
        
        // Build output based on operation mode
        const metadata = execution.metadata as any
        const humanOperation = metadata?.humanOperation || 'approval'
        
        const approvalOutput: any = {
          approveUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/approve/${token}`,
          waitDuration: executionTime,
        }
        
        if (humanOperation === 'approval') {
          // Approval mode: include approved status and edited content
          approvalOutput.approved = approved
          if (formData && formData.content) {
            approvalOutput.content = formData.content
          }
        } else if (humanOperation === 'custom') {
          // Custom mode: include all form data fields (no 'approved' field)
          if (formData) {
            Object.assign(approvalOutput, formData)
          }
        } else if (humanOperation === 'chat') {
          // Chat mode: include chat conversation and edited content
          if (formData && formData.chat) {
            approvalOutput.chat = formData.chat
          }
          if (formData && formData.content) {
            approvalOutput.content = formData.content
          }
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

      // Build the resume input with approval decision and form data
      const approvalResumeInput = {
        approved: true,
        approvedAt: new Date().toISOString(),
        approvalToken: token,
        ...(formData && { ...formData }), // Include custom form data if provided
      }

      // Call the resume API endpoint instead of handling resume directly
      // This ensures all resume logic is in one place and works consistently
      const { getBaseUrl } = await import('@/lib/urls/utils')
      const baseUrl = getBaseUrl()
      const resumeUrl = `${baseUrl}/api/workflows/${execution.workflowId}/executions/resume/${execution.executionId}`
      
      logger.info('Calling resume API from approval endpoint', {
        resumeUrl,
        executionId: execution.executionId,
        workflowId: execution.workflowId,
        approvalData: Object.keys(approvalResumeInput),
      })

      const resumeResponse = await fetch(resumeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass the request headers to maintain session context
          ...(request.headers.get('cookie') && { 'Cookie': request.headers.get('cookie')! }),
        },
        body: JSON.stringify(approvalResumeInput),
      })

      if (!resumeResponse.ok) {
        const errorText = await resumeResponse.text()
        logger.error('Resume API call failed from approval endpoint', {
          status: resumeResponse.status,
          error: errorText,
        })
        throw new Error(errorText || 'Failed to resume execution')
      }

      const resumeResult = await resumeResponse.json()
      
      // Extract execution result from resume response
      const executionResult = resumeResult
      const isSuccess = resumeResult.success !== false
      
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
          
          // Check if this was a child workflow that needs to resume its parent
          if (isSuccess && (execution.metadata as any)?.parentExecutionInfo) {
            const parentInfo = (execution.metadata as any).parentExecutionInfo
            logger.info('Child workflow completed via approval, checking if parent needs to resume', {
              parentWorkflowId: parentInfo.workflowId,
              parentExecutionId: parentInfo.executionId,
              parentBlockId: parentInfo.blockId,
            })
            
            // Check if parent execution is paused
            if (parentInfo.executionId) {
              try {
                const { pauseResumeService } = await import('@/lib/execution/pause-resume-service')
                const parentResumeData = await pauseResumeService.getPausedExecutionData(parentInfo.executionId)
                
                if (parentResumeData) {
                  logger.info('Found paused parent execution, triggering resume', {
                    parentExecutionId: parentInfo.executionId,
                  })
                  
                  // Update parent's block state with child workflow result
                  const childResult = executionResult.output || {}
                  const duration = totalDuration || 0
                  
                  // Get workflow data for child workflow name
                  const [workflowData] = await db
                    .select()
                    .from(workflowTable)
                    .where(eq(workflowTable.id, execution.workflowId))
                    .limit(1)
                  
                  // Parent execution context is already deserialized by getPausedExecutionData
                  const parentContext = parentResumeData.executionContext
                  
                  logger.info('Parent context retrieved', {
                    executionId: parentInfo.executionId,
                    blockStatesCount: parentContext.blockStates.size,
                    blockStateIds: Array.from(parentContext.blockStates.keys()),
                    executedBlocksCount: parentContext.executedBlocks.size,
                    executedBlockIds: Array.from(parentContext.executedBlocks),
                  })
                  
                  if (!(parentContext as any).shouldPauseAfterBlock) {
                    parentContext.blockStates.set(parentInfo.blockId, {
                      output: {
                        success: executionResult.success,
                        childWorkflowName: childResult.childWorkflowName || workflowData?.name || 'Child Workflow',
                        childWorkflowId: execution.workflowId,
                        result: childResult,
                        error: executionResult.error,
                        // Include child workflow trace spans
                        childTraceSpans: traceSpans || [],
                      },
                      executed: true,
                      executionTime: duration,
                    })
                  }
                  
                  // Mark the workflow block as executed in the parent context
                  parentContext.executedBlocks.add(parentInfo.blockId)
                  
                  // Activate downstream blocks from the workflow block (same as HITL block resume)
                  const parentConnections = parentResumeData.workflowState.connections || []
                  for (const conn of parentConnections) {
                    if (conn.source === parentInfo.blockId) {
                      parentContext.activeExecutionPath.add(conn.target)
                      logger.info('Activated downstream block from workflow block', {
                        source: parentInfo.blockId,
                        target: conn.target,
                      })
                    }
                  }
                  
                  // Add child workflow block log to parent's block logs
                  const childWorkflowLog = {
                    blockId: parentInfo.blockId,
                    blockName: `${childResult.childWorkflowName || workflowData?.name || 'Child Workflow'} workflow`,
                    blockType: 'workflow',
                    startedAt: new Date(Date.now() - duration).toISOString(),
                    endedAt: new Date().toISOString(),
                    durationMs: duration,
                    success: executionResult.success,
                    input: {
                      workflowId: execution.workflowId,
                    },
                    output: {
                      success: executionResult.success,
                      childWorkflowName: childResult.childWorkflowName || workflowData?.name || 'Child Workflow',
                      result: childResult,
                      childTraceSpans: traceSpans || [],
                    },
                    error: executionResult.error,
                  }
                  parentContext.blockLogs.push(childWorkflowLog)
                  
                  // Also add to metadata logs so it survives the resume filtering
                  const existingMetadataLogs = Array.isArray(parentResumeData.metadata?.logs) 
                    ? parentResumeData.metadata.logs 
                    : []
                  const updatedMetadata = {
                    ...parentResumeData.metadata,
                    logs: [...existingMetadataLogs, childWorkflowLog],
                  }
                  
                  // Serialize the updated context back
                  const { serializeExecutionContext } = await import('@/lib/execution/pause-resume-utils')
                  const updatedSerializedContext = serializeExecutionContext(parentContext)
                  
                  // Update the parent's paused execution with the new context and metadata
                  await db
                    .update(pausedWorkflowExecutions)
                    .set({
                      executionContext: updatedSerializedContext,
                      metadata: updatedMetadata,
                      updatedAt: new Date(),
                    })
                    .where(eq(pausedWorkflowExecutions.executionId, parentInfo.executionId))
                  
                  logger.info('Updated parent execution context with child result')
                  
                  // Trigger parent workflow resume via internal API call
                  // Always use the regular resume endpoint which handles both manual and deployed executions
                  const parentResumeUrl = `${baseUrl}/api/workflows/${parentInfo.workflowId}/executions/resume/${parentInfo.executionId}`
                  
                  logger.info('Triggering parent workflow resume', {
                    parentExecutionId: parentInfo.executionId,
                    endpoint: parentResumeUrl,
                  })
                  
                  try {
                    // Forward session cookies from the original request for authentication
                    const cookieHeader = request.headers.get('cookie') || ''
                    
                    const parentResumeResponse = await fetch(parentResumeUrl, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookieHeader,
                      },
                      body: JSON.stringify({
                        // Pass child completion info
                        childWorkflowCompleted: true,
                        childWorkflowId: execution.workflowId,
                        childWorkflowResult: childResult,
                      }),
                    })
                    
                    if (!parentResumeResponse.ok) {
                      const errorText = await parentResumeResponse.text()
                      logger.error('Failed to resume parent workflow', {
                        status: parentResumeResponse.status,
                        error: errorText,
                      })
                    } else {
                      logger.info('Successfully triggered parent workflow resume', {
                        parentWorkflowId: parentInfo.workflowId,
                        parentExecutionId: parentInfo.executionId,
                      })
                    }
                  } catch (resumeError) {
                    logger.error('Error triggering parent workflow resume', resumeError)
                  }
                }
              } catch (error) {
                logger.error('Error checking parent execution status', error)
              }
            }
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

