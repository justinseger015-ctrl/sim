import { db } from '@sim/db'
import { workflowExecutionLogs, workflowExecutionSnapshots, pausedWorkflowExecutions } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks'

const logger = createLogger('LogsByExecutionIdAPI')

/**
 * Reconstructs subBlocks from block configuration and params
 */
function reconstructSubBlocks(block: any): Record<string, any> {
  const blockConfig = getBlock(block.metadata?.id || block.type)
  if (!blockConfig || !blockConfig.subBlocks) {
    return {}
  }
  
  const subBlocks: Record<string, any> = {}
  const params = block.config?.params || {}
  
  blockConfig.subBlocks.forEach((subBlockConfig) => {
    subBlocks[subBlockConfig.id] = {
      ...subBlockConfig,
      value: params[subBlockConfig.id] ?? subBlockConfig.defaultValue ?? null,
    }
  })
  
  return subBlocks
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params

    logger.debug(`Fetching execution data for: ${executionId}`)

    // First, try to get the workflow execution log (for completed executions)
    const [workflowLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (workflowLog) {
      // This is a completed execution - fetch from snapshots
      const [snapshot] = await db
        .select()
        .from(workflowExecutionSnapshots)
        .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
        .limit(1)

      if (!snapshot) {
        return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
      }

      // Extract trace spans from execution data if available
      const executionData = workflowLog.executionData as any
      const traceSpans = executionData?.traceSpans || []
      
      // Convert blocks from array to Record if needed (for WorkflowPreview compatibility)
      const snapshotState = snapshot.stateData as any
      let blocksAsRecord: Record<string, any> = {}
      
      if (Array.isArray(snapshotState?.blocks)) {
        blocksAsRecord = snapshotState.blocks.reduce((acc: any, block: any) => {
          if (block && block.id) {
            acc[block.id] = {
              ...block,
              type: block.type ?? block.metadata?.id ?? 'unknown',
              subBlocks: block.subBlocks || reconstructSubBlocks(block),
            }
          }
          return acc
        }, {})
      } else if (snapshotState?.blocks && typeof snapshotState.blocks === 'object') {
        // Ensure each block has a type field (from metadata.id if missing)
        blocksAsRecord = Object.entries(snapshotState.blocks).reduce((acc: any, [blockId, block]: [string, any]) => {
          if (block) {
            acc[blockId] = {
              ...block,
              type: block.type ?? block.metadata?.id ?? 'unknown',
              subBlocks: block.subBlocks || reconstructSubBlocks(block),
            }
          }
          return acc
        }, {})
      }
      
      // Find the trigger block ID from trace spans
      let triggerBlockIdFromSpans: string | null = null
      for (const span of traceSpans) {
        if (span.blockId && blocksAsRecord[span.blockId]) {
          const block = blocksAsRecord[span.blockId]
          const blockConfig = getBlock(block.type || block.metadata?.id)
          if (blockConfig?.category === 'triggers') {
            triggerBlockIdFromSpans = span.blockId
            break
          }
        }
      }
      
      const response = {
        executionId,
        workflowId: workflowLog.workflowId,
        workflowState: {
          blocks: blocksAsRecord,
          edges: (snapshotState?.edges || snapshotState?.connections || []).map((edge: any, index: number) => ({
            ...edge,
            id: edge.id || `${edge.source}-${edge.target}-${index}`,
          })),
          loops: snapshotState?.loops || {},
          parallels: snapshotState?.parallels || {},
        },
        traceSpans,
        totalDuration: workflowLog.totalDurationMs,
        executionMetadata: {
          trigger: workflowLog.trigger,
          startedAt: workflowLog.startedAt.toISOString(),
          endedAt: workflowLog.endedAt?.toISOString(),
          totalDurationMs: workflowLog.totalDurationMs,
          cost: workflowLog.cost || null,
          triggerBlockId: triggerBlockIdFromSpans,
        },
      }

      logger.debug(`Successfully fetched completed execution data for: ${executionId}`)
      logger.debug(
        `Workflow state contains ${Object.keys(blocksAsRecord || {}).length} blocks`
      )
      logger.debug(`Trace spans count: ${traceSpans.length}`)

      return NextResponse.json(response)
    }

    // If not found in completed logs, check paused executions
    const [pausedExecution] = await db
      .select()
      .from(pausedWorkflowExecutions)
      .where(eq(pausedWorkflowExecutions.executionId, executionId))
      .limit(1)

    if (!pausedExecution) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    // For paused executions, the workflow state is stored directly
    const workflowState = pausedExecution.workflowState as any
    const metadata = pausedExecution.metadata as any
    
    // Validate workflow state exists
    if (!workflowState || !workflowState.blocks) {
      logger.error(`Paused execution ${executionId} has invalid or missing workflow state`, {
        hasWorkflowState: !!workflowState,
        workflowStateType: typeof workflowState,
        workflowStateKeys: workflowState ? Object.keys(workflowState) : [],
        hasBlocks: !!workflowState?.blocks,
      })
      return NextResponse.json(
        { 
          error: 'Workflow state is corrupted or missing',
          details: 'This paused execution has invalid workflow state data. Please try running the workflow again.',
        },
        { status: 500 }
      )
    }
    
    // Convert blocks from array to Record if needed (for WorkflowPreview compatibility)
    let blocksAsRecord: Record<string, any> = {}
    
    if (Array.isArray(workflowState.blocks)) {
      blocksAsRecord = workflowState.blocks.reduce((acc: any, block: any) => {
        if (block && block.id) {
          acc[block.id] = {
            ...block,
            type: block.type ?? block.metadata?.id ?? 'unknown',
            name: block.name || block.metadata?.name,
            subBlocks: block.subBlocks || reconstructSubBlocks(block),
          }
        }
        return acc
      }, {})
    } else if (workflowState.blocks && typeof workflowState.blocks === 'object') {
      // Ensure each block has a type field (from metadata.id if missing)
      blocksAsRecord = Object.entries(workflowState.blocks).reduce((acc: any, [blockId, block]: [string, any]) => {
        if (block) {
          acc[blockId] = {
            ...block,
            type: block.type ?? block.metadata?.id ?? 'unknown',
            subBlocks: block.subBlocks || reconstructSubBlocks(block),
          }
        }
        return acc
      }, {})
    }
    
    // Build trace spans from logs if available
    const logs = metadata?.logs || []
    const traceSpans: any[] = []
    
    // Convert block logs to trace spans format
    for (const log of logs) {
      if (log.blockId) {
        traceSpans.push({
          id: log.logId || `${log.blockId}-${log.startedAt}`,
          name: log.blockName || log.blockId,
          type: log.blockType || 'unknown',
          blockId: log.blockId,
          status: log.pending ? 'pending' : log.success === false ? 'error' : 'success',
          startTime: log.startedAt,
          endTime: log.endedAt,
          duration: log.durationMs || 0,
          input: log.input,
          output: log.output,
          error: log.error,
          cost: log.cost,
          tokens: log.tokens,
          model: log.modelUsed,
        })
      }
    }

    // Find the trigger block ID - it should be the FIRST block in activeExecutionPath
    let triggerBlockId: string | null = null
    
    // The trigger is always the first block in the execution path
    const activePathList = Array.isArray(metadata?.activeExecutionPath) ? metadata.activeExecutionPath : []
    const executedBlocksList = Array.isArray(metadata?.executedBlocks) ? metadata.executedBlocks : []
    
    logger.debug('Finding trigger block:', {
      activePathList,
      executedBlocksList,
      firstInPath: activePathList[0],
    })
    
    // First, check the first block in activeExecutionPath (this should be the trigger)
    if (activePathList.length > 0) {
      const firstBlockId = activePathList[0]
      const block = blocksAsRecord[firstBlockId]
      const blockType = block?.type || block?.metadata?.id
      const blockConfig = blockType ? getBlock(blockType) : null
      
      logger.debug(`First block in path ${firstBlockId}:`, {
        blockType,
        category: blockConfig?.category,
        isTrigger: blockConfig?.category === 'triggers',
      })
      
      if (blockConfig?.category === 'triggers') {
        triggerBlockId = firstBlockId
      }
    }
    
    // If not found, try executedBlocks (should also start with trigger)
    if (!triggerBlockId && executedBlocksList.length > 0) {
      const firstBlockId = executedBlocksList[0]
      const block = blocksAsRecord[firstBlockId]
      const blockType = block?.type || block?.metadata?.id
      const blockConfig = blockType ? getBlock(blockType) : null
      
      if (blockConfig?.category === 'triggers') {
        triggerBlockId = firstBlockId
      }
    }
    
    logger.debug(`Final trigger block ID: ${triggerBlockId}`)
    
    const response = {
      executionId,
      workflowId: pausedExecution.workflowId,
      workflowState: {
        blocks: blocksAsRecord,
        edges: (workflowState.edges || workflowState.connections || []).map((edge: any, index: number) => ({
          ...edge,
          id: edge.id || `${edge.source}-${edge.target}-${index}`,
        })),
        loops: workflowState.loops || {},
        parallels: workflowState.parallels || {},
      },
      traceSpans,
      totalDuration: metadata?.duration || 0,
      executionMetadata: {
        trigger: metadata?.triggerType || 'manual',
        startedAt: pausedExecution.pausedAt.toISOString(),
        endedAt: null,
        totalDurationMs: metadata?.duration || 0,
        cost: null,
        isPaused: true,
        pausedBlockId: metadata?.blockId || null,
        triggerBlockId,
      },
    }

    logger.debug(`Successfully fetched paused execution data for: ${executionId}`)
    logger.debug(
      `Workflow state contains ${Object.keys(blocksAsRecord).length} blocks`
    )
    logger.debug(`Trace spans count: ${traceSpans.length}`)
    logger.debug(`Trigger block ID: ${triggerBlockId}`)
    logger.debug(`Paused block ID from metadata: ${metadata?.blockId}`)
    logger.debug(`Full metadata structure:`, metadata)
    logger.debug(`Executed blocks from metadata: ${JSON.stringify(metadata?.executedBlocks || [])}`)

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Error fetching execution data:', error)
    return NextResponse.json({ error: 'Failed to fetch execution data' }, { status: 500 })
  }
}
