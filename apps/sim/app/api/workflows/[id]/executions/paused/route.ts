import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { pauseResumeService } from '@/lib/execution/pause-resume-service'

const logger = createLogger('PausedExecutionsAPI')

/**
 * GET /api/workflows/[id]/executions/paused
 * Lists all paused executions for a workflow
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params

    logger.info(`Listing paused executions for workflow ${workflowId}`)

    const pausedExecutions = await pauseResumeService.listPausedExecutions(
      workflowId,
      session.user.id
    )

    return NextResponse.json({
      success: true,
      pausedExecutions: pausedExecutions.map((exec) => ({
        id: exec.id,
        executionId: exec.executionId,
        workflowId: exec.workflowId,
        userId: exec.userId,
        pausedAt: exec.pausedAt.toISOString(),
        metadata: exec.metadata,
        createdAt: exec.createdAt.toISOString(),
        updatedAt: exec.updatedAt.toISOString(),
      })),
    })
  } catch (error: any) {
    logger.error('Error listing paused executions:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to list paused executions' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/workflows/[id]/executions/paused?executionId=xxx
 * Deletes a paused execution without resuming it
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const executionId = searchParams.get('executionId')

    if (!executionId) {
      return NextResponse.json(
        { error: 'executionId query parameter is required' },
        { status: 400 }
      )
    }

    logger.info(`Deleting paused execution ${executionId}`)

    const deleted = await pauseResumeService.deletePausedExecution(
      executionId,
      session.user.id
    )

    if (!deleted) {
      return NextResponse.json(
        { error: 'Paused execution not found or access denied' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Paused execution deleted successfully',
    })
  } catch (error: any) {
    logger.error('Error deleting paused execution:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete paused execution' },
      { status: 500 }
    )
  }
}

