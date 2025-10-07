import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { executionRegistry } from '@/lib/execution/execution-registry'
import { parseWebhookBody } from '@/lib/webhooks/processor'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('WebhookResumeWithBlockAPI')

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string; executionId: string; blockId: string }> }
) {
  const requestId = generateRequestId()
  const { workflowId, executionId, blockId } = await params

  try {
    logger.info(`[${requestId}] Webhook resume request received with blockId`, {
      workflowId,
      executionId,
      blockId,
      method: req.method,
      url: req.url,
    })

    // Parse the webhook body
    const parseResult = await parseWebhookBody(req, requestId)
    
    // Check if parseWebhookBody returned an error response
    if (parseResult instanceof NextResponse) {
      return parseResult
    }
    
    const { body } = parseResult
    logger.info(`[${requestId}] Webhook body parsed`, {
      contentType: req.headers.get('content-type'),
      hasBody: !!body,
      bodyKeys: body ? Object.keys(body) : [],
    })

    // Prepare resume input
    const resumeInput = body || {}

    // Try to wake up the specific wait block via execution registry
    logger.info(`[${requestId}] Checking if wait block is waiting in registry`, { 
      executionId,
      blockId 
    })
    
    const waitInfo = await executionRegistry.getWaitInfo(executionId, blockId)
    logger.debug(`[${requestId}] getWaitInfo result`, {
      executionId,
      blockId,
      found: !!waitInfo,
      waitInfo: waitInfo ? { workflowId: waitInfo.workflowId, triggerType: waitInfo.triggerType } : null,
    })
    
    if (waitInfo) {
      logger.info(`[${requestId}] Found waiting block in registry, waking it up`, {
        executionId,
        blockId,
        workflowId: waitInfo.workflowId,
      })
      
      // Wake up the sleeping thread
      const resumed = await executionRegistry.resumeExecution(executionId, resumeInput, blockId)
      
      if (resumed) {
        logger.info(`[${requestId}] Successfully woke up sleeping wait block`, { 
          executionId,
          blockId 
        })
        
        // Return success - the sleeping thread will handle the rest
        return NextResponse.json({
          success: true,
          message: 'Execution resume signal sent',
          executionId,
          blockId,
        })
      } else {
        logger.warn(`[${requestId}] Failed to wake up wait block, it may have timed out`, { 
          executionId,
          blockId 
        })
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to resume execution - wait block may have timed out',
            executionId,
            blockId,
          },
          { status: 404 }
        )
      }
    } else {
      logger.warn(`[${requestId}] Wait block not found in registry`, { 
        executionId,
        blockId 
      })
      
      // For backward compatibility, redirect to the old route without blockId
      // This handles cases where the wait was registered without blockId
      const baseUrl = req.nextUrl.origin
      const fallbackUrl = `${baseUrl}/api/webhooks/resume/${workflowId}/${executionId}`
      
      logger.info(`[${requestId}] Redirecting to fallback URL without blockId`, { 
        fallbackUrl 
      })
      
      return NextResponse.redirect(fallbackUrl, 307)
    }
  } catch (error) {
    logger.error(`[${requestId}] Error processing webhook resume`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      workflowId,
      executionId,
      blockId,
    })

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
