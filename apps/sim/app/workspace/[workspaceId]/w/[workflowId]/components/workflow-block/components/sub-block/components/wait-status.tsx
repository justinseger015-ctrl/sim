import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'

const logger = createLogger('WaitStatus')

interface WaitStatusProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

interface PausedExecutionInfo {
  executionId: string
  pausedAt: string
  metadata: Record<string, any>
}

export function WaitStatus({ blockId, isPreview, disabled }: WaitStatusProps) {
  const executionId = useExecutionStore((state) => state.executionId)
  const workflowId = useExecutionStore((state) => state.workflowId)
  const isExecuting = useExecutionStore((state) => state.isExecuting)
  const executor = useExecutionStore((state) => state.executor)
  const pausedContext = useExecutionStore((state) => state.pausedContext)
  const setIsExecuting = useExecutionStore((state) => state.setIsExecuting)
  const setActiveBlocks = useExecutionStore((state) => state.setActiveBlocks)
  const setExecutionIdentifiers = useExecutionStore((state) => state.setExecutionIdentifiers)
  const setExecutor = useExecutionStore((state) => state.setExecutor)
  const setPausedContext = useExecutionStore((state) => state.setPausedContext)
  
  const { addConsole, toggleConsole } = useConsoleStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pausedInfo, setPausedInfo] = useState<PausedExecutionInfo | null>(null)
  const [isResuming, setIsResuming] = useState(false)
  
  // Check if we have an in-memory paused executor (manual execution)
  const isPausedInMemory = useMemo(() => {
    if (isPreview || !executor || !executionId || !pausedContext) {
      return false
    }
    
    // Check if THIS block is the one that caused the pause
    const waitBlockInfo = (pausedContext.metadata as any)?.waitBlockInfo
    const isPausedAtThisBlock = waitBlockInfo?.blockId === blockId
    
    logger.info('isPausedInMemory check', { 
      blockId, 
      hasExecutor: !!executor, 
      hasExecutionId: !!executionId, 
      hasPausedContext: !!pausedContext,
      waitBlockId: waitBlockInfo?.blockId,
      isPausedAtThisBlock,
    })
    
    return isPausedAtThisBlock
  }, [isPreview, executor, executionId, pausedContext, blockId])

  const canInteract = useMemo(() => !isPreview && !!executionId && !!workflowId, [
    isPreview,
    executionId,
    workflowId,
  ])

  const fetchPausedInfo = useCallback(async (): Promise<boolean> => {
    if (isPreview || !workflowId) return false
    logger.info('Fetching paused info', { workflowId, executionId, blockId })
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch(`/api/workflows/${workflowId}/executions/paused`)

      if (!response.ok) {
        throw new Error('Failed to fetch paused executions')
      }

      const data = (await response.json()) as {
        pausedExecutions?: PausedExecutionInfo[]
      }

      const pausedExecutions = data.pausedExecutions || []

      logger.info('Paused executions response', {
        count: pausedExecutions.length,
        executionIds: pausedExecutions.map((e: any) => e.executionId),
      })

      const matchingExecutions = pausedExecutions.filter((pausedExecution) => {
        const waitInfo =
          (pausedExecution.metadata as { waitBlockInfo?: { blockId?: string } } | undefined)
            ?.waitBlockInfo
        return waitInfo?.blockId === blockId
      })

      let currentExecution: PausedExecutionInfo | undefined

      if (executionId) {
        currentExecution = matchingExecutions.find(
          (execution) => execution.executionId === executionId
        )
      }

      if (!currentExecution) {
        currentExecution = matchingExecutions[0]

        if (currentExecution) {
          logger.info('Falling back to most recent matching paused execution for block', {
            executionId: currentExecution.executionId,
            blockId,
          })
        }
      }

      if (!currentExecution) {
        logger.info('No paused executions found for this block', {
          blockId,
          executionId,
        })
        setPausedInfo(null)
        return false
      }

      const metadata = currentExecution.metadata as { waitBlockInfo?: any } | undefined
      const waitInfo = metadata?.waitBlockInfo

      logger.info('Wait info check', {
        hasCurrentExecution: !!currentExecution,
        waitInfo,
        blockId,
        waitBlockId: waitInfo?.blockId,
        matches: waitInfo?.blockId === blockId,
      })

      setPausedInfo(currentExecution)

      if (currentExecution.executionId !== executionId) {
        setExecutionIdentifiers({
          executionId: currentExecution.executionId,
          workflowId,
          isResuming: false,
        })
      }
      return true
    } catch (err: any) {
      logger.error('Error fetching paused execution info', err)
      setError(err.message || 'Failed to fetch paused execution info')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, executionId, blockId, isPreview, setExecutionIdentifiers])

  const handleResume = useCallback(async () => {
    // For manual executions, resume from memory
    if (isPausedInMemory && executor && pausedContext && workflowId) {
      logger.info('Resuming from in-memory executor', { executionId })
      
      try {
        setIsResuming(true)
        setIsExecuting(true)
        setActiveBlocks(new Set([blockId]))
        toggleConsole()

        // Resume execution from the paused context
        executor.resume() // Clear the pause flag
        const result = await executor.resumeFromContext(workflowId, pausedContext)
        
        // Handle the result
        const executionResult = 'stream' in result && 'execution' in result ? result.execution : result
        
        logger.info('Manual resume completed', { success: executionResult.success, isPaused: (executionResult.metadata as any)?.isPaused })
        
        // Clean up: clear executor and paused context from store
        setExecutor(null)
        setPausedContext(null)
        setIsExecuting(false)
        setActiveBlocks(new Set())
        setExecutionIdentifiers({ executionId: null, workflowId, isResuming: false })
        setIsResuming(false)
        
        // Add logs to console
        if (executionResult.logs && Array.isArray(executionResult.logs)) {
          executionResult.logs.forEach((log: any) => {
            addConsole({
              input: log.input || {},
              output: log.output || {},
              success: log.success !== false,
              error: log.error,
              durationMs: log.durationMs || 0,
              startedAt: log.startedAt || new Date().toISOString(),
              endedAt: log.endedAt || new Date().toISOString(),
              workflowId: workflowId,
              blockId: log.blockId,
              executionId: executionId || 'resumed',
              blockName: log.blockName || 'Block',
              blockType: log.blockType || 'unknown',
            })
          })
        }
        
        return
      } catch (err: any) {
        logger.error('Error resuming from memory', err)
        setError(err.message || 'Failed to resume execution')
        setExecutor(null)
        setPausedContext(null)
        setIsExecuting(false)
        setActiveBlocks(new Set())
        setIsResuming(false)
        return
      }
    }

    // For deployed executions, resume from DB
    if (!canInteract || !pausedInfo?.executionId) {
      logger.warn('Resume attempted without paused execution info', {
        canInteract,
        hasPausedInfo: !!pausedInfo,
      })
      return
    }

    // Use the executionId from pausedInfo, not from store
    const resumeExecutionId = pausedInfo.executionId
    
    logger.info('Resume clicked', { 
      workflowId, 
      storeExecutionId: executionId,
      pausedExecutionId: resumeExecutionId,
      usingExecutionId: resumeExecutionId 
    })
    
    try {
      setIsLoading(true)
      setIsResuming(true)
      setError(null)

      // Update the execution ID in the store
      setExecutionIdentifiers({ executionId: resumeExecutionId, workflowId, isResuming: true })
      
      // Mark as executing in the UI and open console
      setIsExecuting(true)
      setActiveBlocks(new Set([blockId]))
      toggleConsole()

      logger.info('Calling resume API', { 
        url: `/api/workflows/${workflowId}/executions/resume/${resumeExecutionId}`,
        workflowId,
        executionId: resumeExecutionId 
      })
      
      const response = await fetch(
        `/api/workflows/${workflowId}/executions/resume/${resumeExecutionId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Failed to resume execution')
      }

      const data = await response.json()
      logger.info('Resume response', data)

      // Add console logs for all executed blocks after resume
      if (data.logs && Array.isArray(data.logs)) {
        data.logs.forEach((log: any) => {
          addConsole({
            input: log.input || {},
            output: log.output || {},
            success: log.success !== false,
            error: log.error,
            durationMs: log.durationMs || 0,
            startedAt: log.startedAt || new Date().toISOString(),
            endedAt: log.endedAt || new Date().toISOString(),
            workflowId: workflowId!,
            blockId: log.blockId,
            executionId: resumeExecutionId,
            blockName: log.blockName || 'Block',
            blockType: log.blockType || 'unknown',
          })
        })
      }

      // No need for a summary message - the console already shows all block executions

      // Update execution state based on result
      if (data.isPaused) {
        // Still paused (hit another wait block)
        logger.info('Workflow still paused after resume', { waitBlockInfo: data.metadata?.waitBlockInfo })
        setIsExecuting(false)
        setActiveBlocks(new Set())
        setExecutionIdentifiers({ executionId: resumeExecutionId, workflowId, isResuming: false })
      } else {
        // Execution completed
        logger.info('Workflow completed after resume')
        setIsExecuting(false)
        setActiveBlocks(new Set())
        setExecutionIdentifiers({ executionId: null, workflowId, isResuming: false })
      }

      setPausedInfo(null)
      setIsResuming(false)
      
      // Add a small delay before refetching
      setTimeout(() => {
        fetchPausedInfo()
      }, 500)
    } catch (err: any) {
      logger.error('Error resuming execution', err)
      setError(err.message || 'Failed to resume execution')
      setIsExecuting(false)
      setActiveBlocks(new Set())
      setIsResuming(false)
      setExecutionIdentifiers({ executionId: resumeExecutionId, workflowId, isResuming: false })
    } finally {
      setIsLoading(false)
    }
  }, [
    isPausedInMemory,
    executor,
    pausedContext,
    canInteract,
    pausedInfo,
    workflowId,
    executionId,
    blockId,
    fetchPausedInfo,
    setIsExecuting,
    setActiveBlocks,
    setExecutionIdentifiers,
    setExecutor,
    setPausedContext,
    addConsole,
    toggleConsole,
  ])

  // Log when pausedContext changes to verify store updates
  useEffect(() => {
    logger.info('pausedContext changed in store', { 
      hasPausedContext: !!pausedContext,
      blockId,
      executionId,
      isPausedInMemory 
    })
  }, [pausedContext, blockId, executionId, isPausedInMemory])

  // Only fetch paused info for deployed executions (from DB)
  // Manual executions use isPausedInMemory instead
  useEffect(() => {
    if (isPreview || isPausedInMemory) return
    
    // Initial fetch on mount for deployed executions
    fetchPausedInfo()
  }, [isPreview, isPausedInMemory, fetchPausedInfo])
  
  // Refetch when executionId changes (for deployed executions)
  useEffect(() => {
    if (isPreview || isPausedInMemory) return
    
    if (executionId) {
      logger.info('ExecutionId changed, fetching paused info from DB', { executionId })
      fetchPausedInfo()
    }
  }, [executionId, isPreview, isPausedInMemory, fetchPausedInfo])

  if (isPreview) {
    return (
      <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
        Workflow will pause here when executed. Once paused, you can resume from this block.
      </div>
    )
  }

  const waitInfo = (pausedInfo?.metadata as { waitBlockInfo?: any } | undefined)?.waitBlockInfo

  // Show resume button if paused (either in-memory or from DB)
  const showResumeButton = isPausedInMemory || pausedInfo

  return (
    <div className="space-y-2">
      {isResuming ? (
        <div className="rounded border p-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium">Resuming workflow execution...</span>
          </div>
        </div>
      ) : showResumeButton ? (
        <div className="rounded border p-3 text-sm">
          <div className="font-medium text-foreground mb-1">Workflow paused</div>
          <div className="text-muted-foreground">
            {pausedInfo ? `Paused at ${new Date(pausedInfo.pausedAt).toLocaleString()}.` : 'Paused in memory.'}
          </div>
          {waitInfo?.description ? (
            <div className="text-muted-foreground">{waitInfo.description}</div>
          ) : null}
          {waitInfo?.triggerConfig?.type ? (
            <div className="text-muted-foreground">
              Resume trigger: {waitInfo.triggerConfig.type}
            </div>
          ) : null}
          <button
            type="button"
            className="mt-3 inline-flex items-center rounded-md border px-3 py-1 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={handleResume}
            disabled={disabled || isLoading}
          >
            {isLoading ? 'Resuming…' : 'Resume Workflow'}
          </button>
        </div>
      ) : isExecuting ? (
        <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
            Workflow is executing, checking for pause state...
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
          {executionId ? 'Checking pause state...' : 'Workflow will pause here when executed. Once paused, you can resume from this block.'}
        </div>
      )}
      {error && <div className="text-sm text-red-500">{error}</div>}
    </div>
  )
}



