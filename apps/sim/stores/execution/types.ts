import type { Executor } from '@/executor'
import type { ExecutionContext } from '@/executor/types'

export interface ExecutionState {
  activeBlockIds: Set<string>
  isExecuting: boolean
  isDebugging: boolean
  pendingBlocks: string[]
  executionId: string | null
  workflowId: string | null
  executor: Executor | null
  debugContext: ExecutionContext | null
  pausedContext: ExecutionContext | null // Context when workflow paused (for manual resume)
  autoPanDisabled: boolean
  isResuming: boolean
}

export interface ExecutionActions {
  setActiveBlocks: (blockIds: Set<string>) => void
  setIsExecuting: (isExecuting: boolean) => void
  setIsDebugging: (isDebugging: boolean) => void
  setExecutionIdentifiers: (ids: {
    executionId?: string | null
    workflowId?: string | null
    isResuming?: boolean
  }) => void
  setPendingBlocks: (blockIds: string[]) => void
  setExecutor: (executor: Executor | null) => void
  setDebugContext: (context: ExecutionContext | null) => void
  setPausedContext: (context: ExecutionContext | null) => void
  setAutoPanDisabled: (disabled: boolean) => void
  reset: () => void
}

export const initialState: ExecutionState = {
  activeBlockIds: new Set(),
  isExecuting: false,
  isDebugging: false,
  pendingBlocks: [],
  executionId: null,
  workflowId: null,
  executor: null,
  debugContext: null,
  pausedContext: null,
  autoPanDisabled: false,
  isResuming: false,
}

// Types for panning functionality
export type PanToBlockCallback = (blockId: string) => void
export type SetPanToBlockCallback = (callback: PanToBlockCallback | null) => void
