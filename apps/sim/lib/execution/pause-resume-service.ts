import { db } from '@sim/db'
import { pausedWorkflowExecutions } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import { createLogger } from '@/lib/logs/console/logger'
import {
  deserializeExecutionContext,
  serializeExecutionContext,
  serializeWorkflowState,
} from './pause-resume-utils'

const logger = createLogger('PauseResumeService')

export interface PausedExecutionData {
  id: string
  workflowId: string
  executionId: string
  userId: string
  pausedAt: Date
  executionContext: ExecutionContext
  workflowState: SerializedWorkflow
  environmentVariables: Record<string, string>
  workflowInput?: any
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface PauseExecutionParams {
  workflowId: string
  executionId: string
  userId: string
  executionContext: ExecutionContext
  workflowState: SerializedWorkflow
  environmentVariables: Record<string, string>
  workflowInput?: any
  metadata?: Record<string, any>
}

export interface ResumeExecutionData {
  executionContext: ExecutionContext
  workflowState: SerializedWorkflow
  environmentVariables: Record<string, string>
  workflowInput?: any
  metadata: Record<string, any>
}

/**
 * Service for managing paused and resumed workflow executions
 */
export class PauseResumeService {
  /**
   * Pauses a workflow execution and stores its state in the database
   */
  async pauseExecution(params: PauseExecutionParams): Promise<PausedExecutionData> {
    const {
      workflowId,
      executionId,
      userId,
      executionContext,
      workflowState,
      environmentVariables,
      workflowInput,
      metadata = {},
    } = params

    logger.info(`Pausing execution ${executionId} for workflow ${workflowId}`)

    // Serialize the execution context
    const serializedContext = serializeExecutionContext(executionContext)
    const serializedWorkflowState = serializeWorkflowState(workflowState)

    // Check if this execution is already paused
    const existing = await db
      .select()
      .from(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.executionId, executionId))
      .limit(1)

    if (existing.length > 0) {
      logger.warn(`Execution ${executionId} is already paused, updating...`)
      
      const [updated] = await db
        .update(pausedWorkflowExecutions)
        .set({
          executionContext: serializedContext,
          workflowState: serializedWorkflowState,
          environmentVariables,
          workflowInput,
          metadata,
          pausedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(pausedWorkflowExecutions.executionId, executionId))
        .returning()

      return {
        id: updated.id,
        workflowId: updated.workflowId,
        executionId: updated.executionId,
        userId: updated.userId,
        pausedAt: updated.pausedAt,
        executionContext: deserializeExecutionContext(updated.executionContext),
        workflowState: updated.workflowState as SerializedWorkflow,
        environmentVariables: updated.environmentVariables as Record<string, string>,
        workflowInput: updated.workflowInput,
        metadata: updated.metadata as Record<string, any>,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      }
    }

    // Create new paused execution record
    const [paused] = await db
      .insert(pausedWorkflowExecutions)
      .values({
        id: uuidv4(),
        workflowId,
        executionId,
        userId,
        pausedAt: new Date(),
        executionContext: serializedContext,
        workflowState: serializedWorkflowState,
        environmentVariables,
        workflowInput,
        metadata,
      })
      .returning()

    logger.info(`Successfully paused execution ${executionId}`)

    return {
      id: paused.id,
      workflowId: paused.workflowId,
      executionId: paused.executionId,
      userId: paused.userId,
      pausedAt: paused.pausedAt,
      executionContext: deserializeExecutionContext(paused.executionContext),
      workflowState: paused.workflowState as SerializedWorkflow,
      environmentVariables: paused.environmentVariables as Record<string, string>,
      workflowInput: paused.workflowInput,
      metadata: paused.metadata as Record<string, any>,
      createdAt: paused.createdAt,
      updatedAt: paused.updatedAt,
    }
  }

  /**
   * Retrieves a paused execution by execution ID
   */
  async getPausedExecution(executionId: string): Promise<PausedExecutionData | null> {
    const [paused] = await db
      .select()
      .from(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.executionId, executionId))
      .limit(1)

    if (!paused) {
      return null
    }

    return {
      id: paused.id,
      workflowId: paused.workflowId,
      executionId: paused.executionId,
      userId: paused.userId,
      pausedAt: paused.pausedAt,
      executionContext: deserializeExecutionContext(paused.executionContext),
      workflowState: paused.workflowState as SerializedWorkflow,
      environmentVariables: paused.environmentVariables as Record<string, string>,
      workflowInput: paused.workflowInput,
      metadata: paused.metadata as Record<string, any>,
      createdAt: paused.createdAt,
      updatedAt: paused.updatedAt,
    }
  }

  /**
   * Lists all paused executions for a specific workflow
   */
  async listPausedExecutions(
    workflowId: string,
    userId?: string
  ): Promise<PausedExecutionData[]> {
    const conditions = [eq(pausedWorkflowExecutions.workflowId, workflowId)]
    
    if (userId) {
      conditions.push(eq(pausedWorkflowExecutions.userId, userId))
    }

    const paused = await db
      .select()
      .from(pausedWorkflowExecutions)
      .where(and(...conditions))
      .orderBy(desc(pausedWorkflowExecutions.pausedAt))

    return paused.map((p) => ({
      id: p.id,
      workflowId: p.workflowId,
      executionId: p.executionId,
      userId: p.userId,
      pausedAt: p.pausedAt,
      executionContext: deserializeExecutionContext(p.executionContext),
      workflowState: p.workflowState as SerializedWorkflow,
      environmentVariables: p.environmentVariables as Record<string, string>,
      workflowInput: p.workflowInput,
      metadata: p.metadata as Record<string, any>,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }))
  }

  /**
   * Resumes a paused execution and removes it from the paused executions table
   */
  async resumeExecution(executionId: string): Promise<ResumeExecutionData | null> {
    logger.info(`Resuming execution ${executionId}`)

    const paused = await this.getPausedExecution(executionId)

    if (!paused) {
      logger.warn(`No paused execution found for ${executionId}`)
      return null
    }

    // Delete the paused execution record (it's being resumed)
    await db
      .delete(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.executionId, executionId))

    logger.info(`Successfully retrieved paused state for execution ${executionId}`)

    return {
      executionContext: paused.executionContext,
      workflowState: paused.workflowState,
      environmentVariables: paused.environmentVariables,
      workflowInput: paused.workflowInput,
      metadata: paused.metadata,
    }
  }

  /**
   * Deletes a paused execution without resuming it
   */
  async deletePausedExecution(executionId: string, userId?: string): Promise<boolean> {
    logger.info(`Deleting paused execution ${executionId}`)

    const conditions = [eq(pausedWorkflowExecutions.executionId, executionId)]
    
    if (userId) {
      conditions.push(eq(pausedWorkflowExecutions.userId, userId))
    }

    const result = await db
      .delete(pausedWorkflowExecutions)
      .where(and(...conditions))
      .returning()

    return result.length > 0
  }

  /**
   * Checks if an execution is currently paused
   */
  async isExecutionPaused(executionId: string): Promise<boolean> {
    const [paused] = await db
      .select({ id: pausedWorkflowExecutions.id })
      .from(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.executionId, executionId))
      .limit(1)

    return !!paused
  }
}

// Export a singleton instance
export const pauseResumeService = new PauseResumeService()

