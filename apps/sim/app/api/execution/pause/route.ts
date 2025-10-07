import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { pausedExecutionService } from '@/lib/execution/paused-execution-service'
import { getBaseUrl } from '@/lib/urls/utils'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('PauseExecutionAPI')

/**
 * POST /api/execution/pause
 * Save a paused execution state to the database (called from client-side execution)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId()
  
  try {
    const body = await request.json()
    const { 
      workflowId, 
      executionId, 
      blockId, 
      context, 
      pausedAt, 
      resumeType,
      humanOperation,
      humanInputFormat,
      apiInputFormat,
      apiResponseMode,
      apiBuilderResponse,
      apiEditorResponse,
    } = body

    if (!workflowId || !executionId || !blockId) {
      return NextResponse.json(
        { error: 'Missing required fields: workflowId, executionId, blockId' },
        { status: 400 }
      )
    }

    // For client-side execution, use the session user ID (more efficient)
    // Only fall back to workflow lookup for server-side execution
    const userId = await getUserId(requestId)
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info('Saving paused execution via API', {
      workflowId,
      executionId,
      blockId,
      userId,
      resumeType: resumeType || 'human',
    })

    const baseUrl = getBaseUrl()
    const result = await pausedExecutionService.savePausedExecution(
      {
        workflowId,
        executionId,
        userId,
        blockId,
        context,
        pausedAt: pausedAt ? new Date(pausedAt) : new Date(),
        resumeType,
        humanOperation,
        humanInputFormat,
        apiInputFormat,
        apiResponseMode,
        apiBuilderResponse,
        apiEditorResponse,
      },
      baseUrl
    )

    logger.info('Paused execution saved successfully', {
      workflowId,
      executionId,
      approveUrl: result.approveUrl,
    })

    return NextResponse.json({
      success: true,
      approvalToken: result.approvalToken,
      approveUrl: result.approveUrl,
    })
  } catch (error) {
    logger.error('Error saving paused execution', { error })
    return NextResponse.json(
      { 
        error: 'Failed to save paused execution',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

