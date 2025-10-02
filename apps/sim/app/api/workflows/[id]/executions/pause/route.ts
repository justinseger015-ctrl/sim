import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('PauseExecutionAPI')

/**
 * POST /api/workflows/[id]/executions/pause
 * Pauses a running workflow execution and stores its state
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params
    const body = await request.json()
    
    const {
      executionId,
      executionContext,
      workflowState,
      environmentVariables,
      workflowInput,
      metadata,
    } = body as {
      executionId: string
      executionContext: ExecutionContext
      workflowState: SerializedWorkflow
      environmentVariables: Record<string, string>
      workflowInput?: any
      metadata?: Record<string, any>
    }

    if (!executionId || !executionContext || !workflowState) {
      return NextResponse.json(
        { error: 'Missing required fields: executionId, executionContext, workflowState' },
        { status: 400 }
      )
    }

    logger.info(`Pausing execution ${executionId} for workflow ${workflowId}`)

    const pausedExecution = await pauseResumeService.pauseExecution({
      workflowId,
      executionId,
      userId: session.user.id,
      executionContext,
      workflowState,
      environmentVariables: environmentVariables || {},
      workflowInput,
      metadata,
    })

    return NextResponse.json({
      success: true,
      pausedExecution: {
        id: pausedExecution.id,
        executionId: pausedExecution.executionId,
        workflowId: pausedExecution.workflowId,
        pausedAt: pausedExecution.pausedAt.toISOString(),
        metadata: pausedExecution.metadata,
      },
    })
  } catch (error: any) {
    logger.error('Error pausing execution:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to pause execution' },
      { status: 500 }
    )
  }
}

