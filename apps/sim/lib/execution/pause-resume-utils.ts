import type { ExecutionContext } from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'

/**
 * Serializes an ExecutionContext to a JSON-compatible format for database storage.
 * Handles Maps and Sets which are not natively JSON-serializable.
 */
export function serializeExecutionContext(context: ExecutionContext): any {
  return {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    executionId: context.executionId,
    isDeployedContext: context.isDeployedContext,
    
    // Convert Map to object for blockStates
    blockStates: Array.from(context.blockStates.entries()).map(([blockId, state]) => ({
      blockId,
      output: state.output,
      executed: state.executed,
      executionTime: state.executionTime,
    })),
    
    blockLogs: context.blockLogs,
    metadata: context.metadata,
    environmentVariables: context.environmentVariables,
    workflowVariables: context.workflowVariables,
    
    // Convert Maps to objects for decisions
    decisions: {
      router: Array.from(context.decisions.router.entries()),
      condition: Array.from(context.decisions.condition.entries()),
    },
    
    // Convert Maps and Sets to arrays
    loopIterations: Array.from(context.loopIterations.entries()),
    loopItems: Array.from(context.loopItems.entries()),
    completedLoops: Array.from(context.completedLoops),
    
    // Convert complex parallelExecutions Map
    parallelExecutions: context.parallelExecutions
      ? Array.from(context.parallelExecutions.entries()).map(([id, state]) => ({
          id,
          parallelCount: state.parallelCount,
          distributionItems: state.distributionItems,
          completedExecutions: state.completedExecutions,
          executionResults: Array.from(state.executionResults.entries()),
          activeIterations: Array.from(state.activeIterations),
          currentIteration: state.currentIteration,
          parallelType: state.parallelType,
        }))
      : undefined,
    
    // Convert loopExecutions Map
    loopExecutions: context.loopExecutions
      ? Array.from(context.loopExecutions.entries()).map(([id, state]) => ({
          id,
          maxIterations: state.maxIterations,
          loopType: state.loopType,
          forEachItems: state.forEachItems,
          executionResults: Array.from(state.executionResults.entries()),
          currentIteration: state.currentIteration,
        }))
      : undefined,
    
    // Convert parallelBlockMapping Map
    parallelBlockMapping: context.parallelBlockMapping
      ? Array.from(context.parallelBlockMapping.entries())
      : undefined,
    
    currentVirtualBlockId: context.currentVirtualBlockId,
    
    // Convert Sets to arrays
    executedBlocks: Array.from(context.executedBlocks),
    activeExecutionPath: Array.from(context.activeExecutionPath),
    
    // Store workflow reference
    workflow: context.workflow,
    
    // Streaming context
    stream: context.stream,
    selectedOutputIds: context.selectedOutputIds,
    edges: context.edges,
  }
}

/**
 * Deserializes a stored execution context back to ExecutionContext format.
 * Reconstructs Maps and Sets from their serialized array representations.
 */
export function deserializeExecutionContext(serialized: any): ExecutionContext {
  // Reconstruct blockStates Map
  const blockStates = new Map(
    serialized.blockStates.map((item: any) => [
      item.blockId,
      {
        output: item.output,
        executed: item.executed,
        executionTime: item.executionTime,
      },
    ])
  )
  
  // Reconstruct decisions Maps
  const decisions = {
    router: new Map(serialized.decisions.router),
    condition: new Map(serialized.decisions.condition),
  }
  
  // Reconstruct loop-related Maps and Sets
  const loopIterations = new Map(serialized.loopIterations)
  const loopItems = new Map(serialized.loopItems)
  const completedLoops = new Set(serialized.completedLoops)
  
  // Reconstruct parallelExecutions Map
  const parallelExecutions = serialized.parallelExecutions
    ? new Map(
        serialized.parallelExecutions.map((item: any) => [
          item.id,
          {
            parallelCount: item.parallelCount,
            distributionItems: item.distributionItems,
            completedExecutions: item.completedExecutions,
            executionResults: new Map(item.executionResults),
            activeIterations: new Set(item.activeIterations),
            currentIteration: item.currentIteration,
            parallelType: item.parallelType,
          },
        ])
      )
    : undefined
  
  // Reconstruct loopExecutions Map
  const loopExecutions = serialized.loopExecutions
    ? new Map(
        serialized.loopExecutions.map((item: any) => [
          item.id,
          {
            maxIterations: item.maxIterations,
            loopType: item.loopType,
            forEachItems: item.forEachItems,
            executionResults: new Map(item.executionResults),
            currentIteration: item.currentIteration,
          },
        ])
      )
    : undefined
  
  // Reconstruct parallelBlockMapping Map
  const parallelBlockMapping = serialized.parallelBlockMapping
    ? new Map(serialized.parallelBlockMapping)
    : undefined
  
  // Reconstruct execution tracking Sets
  const executedBlocks = new Set(serialized.executedBlocks)
  const activeExecutionPath = new Set(serialized.activeExecutionPath)
  
  return {
    workflowId: serialized.workflowId,
    workspaceId: serialized.workspaceId,
    executionId: serialized.executionId,
    isDeployedContext: serialized.isDeployedContext,
    blockStates,
    blockLogs: serialized.blockLogs,
    metadata: serialized.metadata,
    environmentVariables: serialized.environmentVariables,
    workflowVariables: serialized.workflowVariables,
    decisions,
    loopIterations,
    loopItems,
    completedLoops,
    parallelExecutions,
    loopExecutions,
    parallelBlockMapping,
    currentVirtualBlockId: serialized.currentVirtualBlockId,
    executedBlocks,
    activeExecutionPath,
    workflow: serialized.workflow as SerializedWorkflow,
    stream: serialized.stream,
    selectedOutputIds: serialized.selectedOutputIds,
    edges: serialized.edges,
  }
}

/**
 * Serializes workflow state (blocks, edges, loops, parallels) for storage
 */
export function serializeWorkflowState(workflow: SerializedWorkflow): any {
  return {
    blocks: workflow.blocks,
    connections: workflow.connections,
    loops: workflow.loops,
    parallels: workflow.parallels,
  }
}

