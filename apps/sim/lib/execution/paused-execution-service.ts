import { db } from '@sim/db'
import { pausedWorkflowExecutions, workflow, workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext } from '@/executor/types'
import { serializeExecutionContext } from './pause-resume-utils'

const logger = createLogger('PausedExecutionService')

export interface SavePausedExecutionParams {
  workflowId: string
  executionId: string
  userId?: string  // Optional - will be fetched from workflow if not provided
  blockId: string
  context: ExecutionContext
  pausedAt: Date
  resumeType?: 'human' | 'api'  // Type of resume mechanism
  humanOperation?: 'approval' | 'custom'  // Human operation mode
  humanInputFormat?: any  // Input schema for custom form in Human mode
  apiInputFormat?: any  // Input schema for API resume type
  apiResponseMode?: string  // Response mode for API resume (builder/json)
  apiBuilderResponse?: any  // Builder response structure
  apiEditorResponse?: any  // JSON editor response template
}

export interface PausedExecutionResult {
  approvalToken: string
  approveUrl: string
}

/**
 * Service for managing paused workflow executions with human approval
 * Server-side only - handles database operations for paused state
 */
export class PausedExecutionService {
  private static instance: PausedExecutionService

  private constructor() {}

  static getInstance(): PausedExecutionService {
    if (!PausedExecutionService.instance) {
      PausedExecutionService.instance = new PausedExecutionService()
    }
    return PausedExecutionService.instance
  }

  /**
   * Save a paused execution to the database and generate approval token
   */
  async savePausedExecution(params: SavePausedExecutionParams, baseUrl: string): Promise<PausedExecutionResult> {
    const { 
      workflowId, 
      executionId, 
      blockId, 
      context, 
      pausedAt, 
      resumeType = 'human',
      humanOperation,
      humanInputFormat,
      apiInputFormat,
      apiResponseMode,
      apiBuilderResponse,
      apiEditorResponse,
    } = params
    let { userId } = params

    // If userId not provided, fetch from workflow
    if (!userId) {
      const workflows = await db
        .select({ userId: workflow.userId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflows.length) {
        throw new Error(`Workflow ${workflowId} not found`)
      }

      userId = workflows[0].userId
    }

    // Generate unique approval token
    const approvalToken = randomUUID()
    const approveUrl = `${baseUrl}/approve/${approvalToken}`

    logger.info('Saving paused execution state for human approval', {
      executionId,
      workflowId,
      blockId,
      userId,
      contextExecutedBlocks: context.executedBlocks instanceof Set ? Array.from(context.executedBlocks) : context.executedBlocks,
      contextActiveExecutionPath: context.activeExecutionPath instanceof Set ? Array.from(context.activeExecutionPath) : context.activeExecutionPath,
    })

    // Look up the original trigger type from the execution log
    const [executionLog] = await db
      .select({ trigger: workflowExecutionLogs.trigger })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    const triggerType = executionLog?.trigger || 'manual'

    // Serialize the execution context properly
    // When coming from client-side API, Maps/Sets become plain objects during JSON.stringify
    // We need to convert those objects back into the proper array format for storage
    let serializedContext: any
    
    logger.info('Serializing execution context for pause', {
      executionId,
      blockStatesType: typeof context.blockStates,
      blockStatesIsMap: context.blockStates instanceof Map,
      blockStatesKeys: context.blockStates instanceof Map 
        ? Array.from(context.blockStates.keys())
        : Object.keys(context.blockStates || {}),
    })
    
    if (context.blockStates instanceof Map) {
      // Server-side context with Maps/Sets - needs serialization
      serializedContext = serializeExecutionContext(context)
    } else {
      // Client-side: Maps are already plain objects - convert to proper format
      const blockStatesObj = context.blockStates as any
      const blockStatesArray = Object.keys(blockStatesObj || {}).map(blockId => ({
        blockId,
        output: blockStatesObj[blockId]?.output || {},
        executed: blockStatesObj[blockId]?.executed || false,
        executionTime: blockStatesObj[blockId]?.executionTime || 0,
      }))
      
      logger.info('Converted client-side blockStates to array', {
        executionId,
        inputObjectKeys: Object.keys(blockStatesObj || {}).length,
        outputArrayLength: blockStatesArray.length,
      })

      const decisionsObj = context.decisions as any
      const routerArray = decisionsObj?.router ? Object.entries(decisionsObj.router) : []
      const conditionArray = decisionsObj?.condition ? Object.entries(decisionsObj.condition) : []

      serializedContext = {
        ...context,
        blockStates: blockStatesArray,
        decisions: {
          router: routerArray,
          condition: conditionArray,
        },
        loopIterations: context.loopIterations ? Object.entries(context.loopIterations as any) : [],
        loopItems: context.loopItems ? Object.entries(context.loopItems as any) : [],
        completedLoops: Array.isArray(context.completedLoops) ? context.completedLoops : [],
        executedBlocks: Array.isArray(context.executedBlocks) ? context.executedBlocks : [],
        activeExecutionPath: Array.isArray(context.activeExecutionPath) ? context.activeExecutionPath : [],
      }
    }

    try {
      // Use INSERT ... ON CONFLICT to handle duplicate execution_id atomically
      // If the execution_id already exists, just return without error
      const result = await db
        .insert(pausedWorkflowExecutions)
        .values({
          id: randomUUID(),
          workflowId,
          executionId,
          userId,
          pausedAt,
          executionContext: serializedContext,
          workflowState: context.workflow || {},
          environmentVariables: context.environmentVariables || {},
          workflowInput: null,
          metadata: {
            blockId,
            resumeTriggerType: resumeType,
            triggerType, // Save the original trigger type
            pausedAt: pausedAt.toISOString(),
            // Include parent execution info if this is a child workflow
            ...((context as any).parentExecutionInfo && {
              parentExecutionInfo: (context as any).parentExecutionInfo,
            }),
            ...(resumeType === 'human' && {
              humanOperation,
              humanInputFormat,
            }),
            ...(resumeType === 'api' && {
              apiInputFormat,
              apiResponseMode,
              apiBuilderResponse,
              apiEditorResponse,
            }),
          },
          approvalToken,
          approvalUsed: false,
        })
        .onConflictDoNothing({ target: pausedWorkflowExecutions.executionId })
        .returning()

      // If insert was skipped due to conflict, fetch the existing record
      if (result.length === 0) {
        logger.warn('Execution already paused (duplicate call detected), fetching existing approval URL', {
          executionId,
          workflowId,
        })
        
        const [existing] = await db
          .select()
          .from(pausedWorkflowExecutions)
          .where(eq(pausedWorkflowExecutions.executionId, executionId))
          .limit(1)
        
        if (!existing) {
          throw new Error('Failed to retrieve existing paused execution')
        }
        
        const existingToken = existing.approvalToken || approvalToken
        return {
          approvalToken: existingToken,
          approveUrl: `${baseUrl}/approve/${existingToken}`,
        }
      }

      logger.info('Paused execution saved successfully', {
        executionId,
        workflowId,
        approveUrl,
      })

      return {
        approvalToken,
        approveUrl,
      }
    } catch (error) {
      logger.error('Failed to save paused execution', {
        error,
        executionId,
        workflowId,
      })
      throw new Error('Failed to save paused execution state')
    }
  }
}

export const pausedExecutionService = PausedExecutionService.getInstance()

