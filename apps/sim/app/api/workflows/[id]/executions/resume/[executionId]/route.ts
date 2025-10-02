import { NextRequest, NextResponse } from 'next/server'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'
import { Executor } from '@/executor'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import { getUserEntityPermissions } from '@/lib/permissions'

const logger = createLogger('ResumeExecutionAPI')

/**
 * POST /api/workflows/[id]/executions/resume/[executionId]
 * Resumes a paused workflow execution
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId, executionId } = await params

    logger.info(`Resuming execution ${executionId} for workflow ${workflowId}`)

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
    let hasPermission = workflowData.userId === session.user.id
    
    if (!hasPermission && workflowData.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
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
      }
    )

    // Resume execution
    const result = await executor.resumeFromContext(workflowId, context)

    // Check if execution completed or was paused/cancelled again
    const metadata = result.metadata as any
    const { context: resumedContext, ...metadataWithoutContext } = metadata || {}
    const isPaused = metadata?.isPaused
    const waitBlockInfo = metadata?.waitBlockInfo
    const isCancelled = !result.success && result.error?.includes('cancelled')

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
            userId: session.user.id,
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

    return NextResponse.json({
      success: result.success,
      output: result.output,
      error: result.error,
      isPaused,
      isCancelled,
      logs: result.logs || [],
      metadata: {
        duration: result.metadata?.duration,
        executedBlockCount: context.executedBlocks.size,
        waitBlockInfo,
        startTime: result.metadata?.startTime,
        endTime: result.metadata?.endTime,
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

