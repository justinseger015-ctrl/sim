import { db } from '@sim/db'
import { pausedWorkflowExecutions } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

const logger = createLogger('ApprovalChatAPI')

/**
 * POST /api/approval/[token]/chat
 * Handle chat message for approval
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const { token } = await params
    const body = await request.json()
    const { message, chatHistory, content } = body

    if (!token) {
      return NextResponse.json({ error: 'Approval token is required' }, { status: 400 })
    }

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
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

    // Build messages for LLM
    const systemMessage = `You are an AI assistant helping a user review and discuss content that requires approval. The content to review is:

${content || 'No content provided'}

Your role is to:
- Help the user understand the content
- Answer questions about it
- Provide analysis or recommendations
- Help them make an informed decision

IMPORTANT: Follow the user's exact request. Provide direct answers with no preamble, introduction, or summary unless specifically asked. Be concise, helpful, and professional.`

    const messages: any[] = [
      { role: 'system', content: systemMessage },
    ]

    // Add chat history
    if (Array.isArray(chatHistory)) {
      for (const msg of chatHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        })
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message,
    })

    logger.info('Generating LLM response for approval chat', {
      executionId: execution.executionId,
      messageCount: messages.length,
    })

    // Call LLM
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const { text } = await generateText({
      model: anthropic('claude-3-5-sonnet-20241022'),
      messages: messages.slice(1), // Skip system message for generateText
      system: systemMessage,
      maxTokens: 1000,
    })

    logger.info('LLM response generated', {
      executionId: execution.executionId,
      responseLength: text.length,
    })

    return NextResponse.json({
      success: true,
      response: text,
    })
  } catch (error) {
    logger.error('Error processing chat message', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

