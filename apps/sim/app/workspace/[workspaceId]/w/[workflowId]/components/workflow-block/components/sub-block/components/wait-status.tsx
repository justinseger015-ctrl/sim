import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useExecutionStore } from '@/stores/execution/store'

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
  const { executionId, workflowId, isExecuting } = useExecutionStore((state) => state)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pausedInfo, setPausedInfo] = useState<PausedExecutionInfo | null>(null)
  
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

      logger.info('Paused executions response', {
        count: data.pausedExecutions?.length || 0,
        executionIds: data.pausedExecutions?.map(e => e.executionId),
      })

      // First try exact match, then try any execution for this workflow
      let currentExecution = data.pausedExecutions?.find(
        (execution) => execution.executionId === executionId
      )
      
      // If no exact match, check if we have any paused execution for this workflow
      if (!currentExecution && data.pausedExecutions?.length > 0) {
        logger.info('No exact executionId match, checking recent executions')
        currentExecution = data.pausedExecutions[0] // Get most recent
      }

      const metadata = currentExecution?.metadata
      const waitInfo = (metadata as { waitBlockInfo?: any } | undefined)?.waitBlockInfo
      
      logger.info('Wait info check', {
        hasCurrentExecution: !!currentExecution,
        waitInfo,
        blockId,
        waitBlockId: waitInfo?.blockId,
        matches: waitInfo?.blockId === blockId,
      })
      
      if (waitInfo && waitInfo.blockId === blockId) {
        setPausedInfo(currentExecution || null)
      } else {
        setPausedInfo(null)
      }
    } catch (err: any) {
      logger.error('Error fetching paused execution info', err)
      setError(err.message || 'Failed to fetch paused execution info')
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, executionId, blockId, isPreview])

  const handleResume = useCallback(async () => {
    if (!canInteract) return
    logger.info('Resume clicked', { workflowId, executionId })
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(
        `/api/workflows/${workflowId}/executions/resume/${executionId}`,
        {
          method: 'POST',
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Failed to resume execution')
      }

      const data = await response.json()
      logger.info('Resume response', data)

      setPausedInfo(null)
      // Add a small delay before refetching
      setTimeout(() => {
        fetchPausedInfo()
      }, 500)
    } catch (err: any) {
      logger.error('Error resuming execution', err)
      setError(err.message || 'Failed to resume execution')
    } finally {
      setIsLoading(false)
    }
  }, [canInteract, workflowId, executionId, fetchPausedInfo])

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
      }, 1000) // Increased to 1 second
      return () => clearTimeout(timer)
    }
  }, [executionId, isPreview, fetchPausedInfo])
  
  // Poll for paused info while executing
  useEffect(() => {
    if (isExecuting && !isPreview && workflowId) {
      const interval = setInterval(() => {
        fetchPausedInfo()
      }, 1000) // Poll every second
      return () => clearInterval(interval)
    }
  }, [isExecuting, isPreview, workflowId, fetchPausedInfo])

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
      {pausedInfo ? (
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



