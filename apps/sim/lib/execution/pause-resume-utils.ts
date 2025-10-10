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
    selectedOutputs: context.selectedOutputs,
    edges: context.edges,
  }
}

/**
 * Deserializes a stored execution context back to ExecutionContext format.
 * Reconstructs Maps and Sets from their serialized array representations.
 */
export function deserializeExecutionContext(serialized: any): ExecutionContext {
  // Debug: Log what we're deserializing
  const blockStatesType = Array.isArray(serialized.blockStates) ? 'array' : typeof serialized.blockStates
  const blockStatesLength = Array.isArray(serialized.blockStates) 
    ? serialized.blockStates.length 
    : serialized.blockStates && typeof serialized.blockStates === 'object'
      ? Object.keys(serialized.blockStates).length
      : 0
  
  console.log('[deserializeExecutionContext] Input blockStates', {
    type: blockStatesType,
    length: blockStatesLength,
    isArray: Array.isArray(serialized.blockStates),
    sample: Array.isArray(serialized.blockStates) ? serialized.blockStates[0] : serialized.blockStates,
  })
  
  // Reconstruct blockStates Map - handle both array and object formats
  let blockStates: Map<string, any>
  
  if (Array.isArray(serialized.blockStates)) {
    // Array format from proper serialization
    blockStates = new Map(
      serialized.blockStates.map((item: any) => [
        item.blockId,
        {
          output: item.output,
          executed: item.executed,
          executionTime: item.executionTime,
        },
      ])
    )
  } else if (serialized.blockStates && typeof serialized.blockStates === 'object') {
    // Object format from client-side serialization
    blockStates = new Map(Object.entries(serialized.blockStates))
  } else {
    // Fallback to empty Map
    blockStates = new Map()
  }
  
  console.log('[deserializeExecutionContext] Output blockStates Map size', blockStates.size)
  
  // Reconstruct decisions Maps - handle missing or malformed data
  // Handle both array format (proper serialization) and object format (legacy/incorrect)
  const routerData = serialized.decisions?.router
  const conditionData = serialized.decisions?.condition
  
  const decisions = {
    router: new Map<string, string>(Array.isArray(routerData) ? routerData : Object.entries(routerData || {})),
    condition: new Map<string, string>(Array.isArray(conditionData) ? conditionData : Object.entries(conditionData || {})),
  }
  
  // Reconstruct loop-related Maps and Sets - handle missing data and both array/object formats
  const loopIterations = new Map<string, number>(
    Array.isArray(serialized.loopIterations) 
      ? serialized.loopIterations 
      : Object.entries(serialized.loopIterations || {})
  )
  const loopItems = new Map<string, any>(
    Array.isArray(serialized.loopItems)
      ? serialized.loopItems
      : Object.entries(serialized.loopItems || {})
  )
  const completedLoops = new Set<string>(
    Array.isArray(serialized.completedLoops)
      ? serialized.completedLoops
      : Object.values(serialized.completedLoops || {})
  )
  
  // Reconstruct parallelExecutions Map - handle both array and object formats for nested Maps/Sets
  const parallelExecutions = serialized.parallelExecutions
    ? (new Map(
        (Array.isArray(serialized.parallelExecutions)
          ? serialized.parallelExecutions
          : Object.values(serialized.parallelExecutions)
        ).map((item: any) => [
          item.id,
          {
            parallelCount: item.parallelCount,
            distributionItems: item.distributionItems,
            completedExecutions: item.completedExecutions,
            executionResults: new Map(
              Array.isArray(item.executionResults)
                ? item.executionResults
                : Object.entries(item.executionResults || {})
            ),
            activeIterations: new Set(
              Array.isArray(item.activeIterations)
                ? item.activeIterations
                : Object.values(item.activeIterations || {})
            ),
            currentIteration: item.currentIteration,
            parallelType: item.parallelType,
          },
        ])
      ) as any)
    : undefined
  
  // Reconstruct loopExecutions Map - handle both array and object formats for nested Maps
  const loopExecutions = serialized.loopExecutions
    ? (new Map(
        (Array.isArray(serialized.loopExecutions)
          ? serialized.loopExecutions
          : Object.values(serialized.loopExecutions)
        ).map((item: any) => [
          item.id,
          {
            maxIterations: item.maxIterations,
            loopType: item.loopType,
            forEachItems: item.forEachItems,
            executionResults: new Map(
              Array.isArray(item.executionResults)
                ? item.executionResults
                : Object.entries(item.executionResults || {})
            ),
            currentIteration: item.currentIteration,
          },
        ])
      ) as any)
    : undefined
  
  // Reconstruct parallelBlockMapping Map - handle both array and object formats
  const parallelBlockMapping = serialized.parallelBlockMapping
    ? new Map<string, { originalBlockId: string; parallelId: string; iterationIndex: number }>(
        Array.isArray(serialized.parallelBlockMapping)
          ? serialized.parallelBlockMapping
          : Object.entries(serialized.parallelBlockMapping)
      )
    : undefined
  
  // Reconstruct execution tracking Sets - handle missing data and both array/object formats
  const executedBlocks = new Set<string>(
    Array.isArray(serialized.executedBlocks)
      ? serialized.executedBlocks
      : Object.values(serialized.executedBlocks || {})
  )
  const activeExecutionPath = new Set<string>(
    Array.isArray(serialized.activeExecutionPath)
      ? serialized.activeExecutionPath
      : Object.values(serialized.activeExecutionPath || {})
  )
  
  return {
    workflowId: serialized.workflowId,
    workspaceId: serialized.workspaceId,
    executionId: serialized.executionId,
    isDeployedContext: serialized.isDeployedContext,
    blockStates,
    blockLogs: serialized.blockLogs || [],
    metadata: serialized.metadata || {},
    environmentVariables: serialized.environmentVariables || {},
    workflowVariables: serialized.workflowVariables || {},
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
    selectedOutputs: serialized.selectedOutputs,
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
