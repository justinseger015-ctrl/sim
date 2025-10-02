import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const { executionId, workflowId, isExecuting, setIsExecuting, setActiveBlocks, setExecutionIdentifiers } = useExecutionStore((state) => state)
  const { addConsole, toggleConsole } = useConsoleStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pausedInfo, setPausedInfo] = useState<PausedExecutionInfo | null>(null)
  const [isResuming, setIsResuming] = useState(false)
  
  logger.info('WaitStatus render', { blockId, executionId, workflowId, isPreview, isExecuting, disabled })

  const canInteract = useMemo(() => !isPreview && !!executionId && !!workflowId, [
    isPreview,
    executionId,
    workflowId,
  ])

  const fetchPausedInfo = useCallback(async () => {
    if (isPreview || !workflowId) return
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
        return
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
    } catch (err: any) {
      logger.error('Error fetching paused execution info', err)
      setError(err.message || 'Failed to fetch paused execution info')
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, executionId, blockId, isPreview, setExecutionIdentifiers])

  const handleResume = useCallback(async () => {
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

      // First add a resume started log
      addConsole({
        input: { action: 'resume', blockId },
        output: { message: 'Resuming workflow execution from Wait block' },
        success: true,
        durationMs: 0,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        workflowId: workflowId!,
        blockId: blockId,
        executionId: resumeExecutionId,
        blockName: 'Wait',
        blockType: 'wait',
      })

      // Add console logs for all executed blocks
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

      // Add final status log
      const statusMessage = data.isPaused 
        ? 'Workflow paused again at another Wait block' 
        : data.success 
          ? 'Workflow execution completed successfully' 
          : `Workflow execution failed: ${data.error || 'Unknown error'}`
      
      addConsole({
        input: { action: 'resume_complete' },
        output: {
          message: statusMessage,
          finalOutput: data.output,
          isPaused: data.isPaused,
          duration: data.metadata?.duration,
        },
        success: data.success && !data.error,
        error: data.error,
        durationMs: data.metadata?.duration || 0,
        startedAt: data.metadata?.startTime || new Date().toISOString(),
        endedAt: data.metadata?.endTime || new Date().toISOString(),
        workflowId: workflowId!,
        blockId: blockId,
        executionId: resumeExecutionId,
        blockName: 'Wait',
        blockType: 'wait',
      })

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
    canInteract,
    pausedInfo,
    workflowId,
    blockId,
    fetchPausedInfo,
    setIsExecuting,
    setActiveBlocks,
    setExecutionIdentifiers,
    addConsole,
    toggleConsole,
  ])

  useEffect(() => {
    fetchPausedInfo()
  }, [fetchPausedInfo])
  
  // Refetch paused info when executionId changes
  useEffect(() => {
    if (executionId && !isPreview) {
      logger.info('ExecutionId changed, scheduling fetch', { executionId })
      // Add a small delay to ensure database write completes
      const timer = setTimeout(() => {
        fetchPausedInfo()
      }, 200) // Reduced to 200ms for faster response
      return () => clearTimeout(timer)
    }
  }, [executionId, isPreview, fetchPausedInfo])
  
  // Poll for paused info while executing or when we have an executionId
  useEffect(() => {
    if (!isPreview && workflowId && (isExecuting || executionId)) {
      // Initial fetch
      fetchPausedInfo()
      
      // Then poll
      const interval = setInterval(() => {
        fetchPausedInfo()
      }, 1000) // Poll every second
      return () => clearInterval(interval)
    }
  }, [isExecuting, executionId, isPreview, workflowId, fetchPausedInfo])

  if (isPreview) {
    return (
      <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
        Workflow will pause here when executed. Once paused, you can resume from this block.
      </div>
    )
  }

  const waitInfo = (pausedInfo?.metadata as { waitBlockInfo?: any } | undefined)?.waitBlockInfo

  return (
    <div className="space-y-2">
      {isResuming ? (
        <div className="rounded border p-3 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium">Resuming workflow execution...</span>
          </div>
        </div>
      ) : pausedInfo ? (
        <div className="rounded border p-3 text-sm">
          <div className="font-medium text-foreground mb-1">Workflow paused</div>
          <div className="text-muted-foreground">
            Paused at {new Date(pausedInfo.pausedAt).toLocaleString()}.
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



