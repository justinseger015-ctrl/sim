'use client'

import { useMemo } from 'react'
import { cloneDeep } from 'lodash'
import ReactFlow, {
  Background,
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import { getBlock } from '@/blocks'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Plus, Minus } from 'lucide-react'

const logger = createLogger('WorkflowPreview')

// Zoom Controls Component (must be child of ReactFlowProvider)
function ZoomControls({ showControls = false }: { showControls?: boolean }) {
  if (!showControls) return null
  
  const { zoomIn, zoomOut } = useReactFlow()
  const zoom = useStore((s: any) =>
    Array.isArray(s.transform) ? s.transform[2] : s.viewport?.zoom
  )
  
  const currentZoom = Math.round(((zoom as number) || 1) * 100)
  
  return (
    <div className='absolute bottom-6 left-1/2 -translate-x-1/2 z-10'>
      <div className='flex items-center gap-1 rounded-[14px] border bg-card/95 p-1 shadow-lg backdrop-blur-sm'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => zoomOut({ duration: 200 })}
              disabled={currentZoom <= 10}
              className={cn(
                'h-9 w-9 rounded-[10px]',
                'hover:bg-muted/80',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Minus className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>

        <div className='flex w-12 items-center justify-center font-medium text-muted-foreground text-sm'>
          {currentZoom}%
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => zoomIn({ duration: 200 })}
              disabled={currentZoom >= 200}
              className={cn(
                'h-9 w-9 rounded-[10px]',
                'hover:bg-muted/80',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Plus className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

interface WorkflowPreviewProps {
  workflowState: WorkflowState
  showSubBlocks?: boolean
  className?: string
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultPosition?: { x: number; y: number }
  defaultZoom?: number
  fitPadding?: number
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
  executedBlockIds?: string[]
  pausedBlockId?: string | null
  isPaused?: boolean
  triggerBlockId?: string | null
  showZoomControls?: boolean
}

// Define node types - the components now handle preview mode internally
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  subflowNode: SubflowNodeComponent,
}

// Define edge types
const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge, // Keep for backward compatibility
}

export function WorkflowPreview({
  workflowState,
  showSubBlocks = true,
  height = '100%',
  width = '100%',
  isPannable = false,
  defaultPosition,
  defaultZoom = 0.8,
  fitPadding = 0.25,
  onNodeClick,
  executedBlockIds = [],
  pausedBlockId = null,
  isPaused = false,
  triggerBlockId = null,
  showZoomControls = false,
}: WorkflowPreviewProps) {
  // Check if the workflow state is valid
  const isValidWorkflowState = workflowState?.blocks && workflowState.edges

  const blocksStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.blocks || {}).length,
      ids: Object.keys(workflowState.blocks || {}).join(','),
    }
  }, [workflowState.blocks, isValidWorkflowState])

  const loopsStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.loops || {}).length,
      ids: Object.keys(workflowState.loops || {}).join(','),
    }
  }, [workflowState.loops, isValidWorkflowState])

  const parallelsStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: Object.keys(workflowState.parallels || {}).length,
      ids: Object.keys(workflowState.parallels || {}).join(','),
    }
  }, [workflowState.parallels, isValidWorkflowState])

  const edgesStructure = useMemo(() => {
    if (!isValidWorkflowState) return { count: 0, ids: '' }
    return {
      count: workflowState.edges?.length || 0,
      ids: workflowState.edges?.map((e) => e.id).join(',') || '',
    }
  }, [workflowState.edges, isValidWorkflowState])

  const calculateAbsolutePosition = (
    block: any,
    blocks: Record<string, any>
  ): { x: number; y: number } => {
    if (!block.data?.parentId) {
      return block.position
    }

    const parentBlock = blocks[block.data.parentId]
    if (!parentBlock) {
      logger.warn(`Parent block not found for child block: ${block.id}`)
      return block.position
    }

    const parentAbsolutePosition = calculateAbsolutePosition(parentBlock, blocks)

    return {
      x: parentAbsolutePosition.x + block.position.x,
      y: parentAbsolutePosition.y + block.position.y,
    }
  }

  const nodes: Node[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    // Debug execution state
    logger.debug('WorkflowPreview execution state:', {
      isPaused,
      pausedBlockId,
      executedBlockIds,
      triggerBlockId,
      totalBlocks: Object.keys(workflowState.blocks || {}).length,
    })

    const nodeArray: Node[] = []

    Object.entries(workflowState.blocks || {}).forEach(([blockId, block]) => {
      if (!block || !block.type) {
        logger.warn(`Skipping invalid block: ${blockId}`)
        return
      }

      const absolutePosition = calculateAbsolutePosition(block, workflowState.blocks)

      if (block.type === 'loop') {
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: absolutePosition,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          draggable: false,
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            state: 'valid',
            isPreview: true,
            kind: 'loop',
          },
        })
        return
      }

      if (block.type === 'parallel') {
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: absolutePosition,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          draggable: false,
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            state: 'valid',
            isPreview: true,
            kind: 'parallel',
          },
        })
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, { blockId })
        return
      }

      const subBlocksClone = block.subBlocks ? cloneDeep(block.subBlocks) : {}
      
      // Determine execution status for styling
      const isExecuted = executedBlockIds.includes(blockId)
      const isUsedTrigger = triggerBlockId === blockId
      const isTriggerCategory = blockConfig.category === 'triggers'
      
      // Check if this is a HITL block that has been executed (meaning execution paused here)
      const isHITLBlock = block.type === 'user_approval'
      const isPausedAtBlock = isHITLBlock && isExecuted
      
      // Log HITL blocks
      if (isHITLBlock) {
        logger.debug(`HITL block found:`, {
          blockId,
          blockName: block.name,
          blockType: block.type,
          isExecuted,
          isPausedAtBlock,
        })
      }
      
      // Log trigger block logic
      if (isTriggerCategory) {
        logger.debug(`Trigger block ${blockId}:`, {
          blockId,
          blockName: block.name,
          isExecuted,
          isUsedTrigger,
          triggerBlockId,
          isPaused,
        })
      }
      
      // If we have executedBlockIds, we're in a frozen/paused state
      // Gray out blocks that haven't been executed (unless it's the paused block itself or the used trigger)
      const hasExecutionData = executedBlockIds.length > 0
      const isPending = hasExecutionData && !isExecuted && !isPausedAtBlock && !isUsedTrigger
      
      // Debug pending blocks
      if (isPending) {
        logger.debug(`Block ${blockId} (${block.name}) marked as pending`)
      }
      
      // Debug paused block
      if (isPausedAtBlock) {
        logger.debug(`Block ${blockId} (${block.name}) is the PAUSED HITL BLOCK`)
      }

      nodeArray.push({
        id: blockId,
        type: 'workflowBlock',
        position: absolutePosition,
        draggable: false,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name || (block as any).metadata?.name || blockConfig.name,
          blockState: block,
          canEdit: false,
          isPreview: true,
          subBlockValues: subBlocksClone,
          executionStatus: isPausedAtBlock ? 'paused' : isExecuted ? 'executed' : isPending ? 'pending' : undefined,
          isPending: isPending,
          isPausedAt: isPausedAtBlock,
        },
        className: isPausedAtBlock 
          ? 'ring-2 ring-amber-500 rounded-lg' 
          : undefined,
      })

      if (block.type === 'loop') {
        const childBlocks = Object.entries(workflowState.blocks || {}).filter(
          ([_, childBlock]) => childBlock.data?.parentId === blockId
        )

        childBlocks.forEach(([childId, childBlock]) => {
          const childConfig = getBlock(childBlock.type)

          if (childConfig) {
            // Check execution status for child blocks too
            const isChildExecuted = executedBlockIds.includes(childId)
            const isChildPausedAt = pausedBlockId === childId
            const isChildPending = hasExecutionData && !isChildExecuted && !isChildPausedAt
            
            nodeArray.push({
              id: childId,
              type: 'workflowBlock',
              position: {
                x: block.position.x + 50,
                y: block.position.y + (childBlock.position?.y || 100),
              },
              data: {
                type: childBlock.type,
                config: childConfig,
                name: childBlock.name,
                blockState: childBlock,
                showSubBlocks,
                isChild: true,
                parentId: blockId,
                canEdit: false,
                isPreview: true,
                isPending: isChildPending,
              },
              draggable: false,
              className: isChildPausedAt 
                ? 'ring-2 ring-amber-500 ring-offset-2 rounded-lg' 
                : undefined,
            })
          }
        })
      }
    })

    return nodeArray
  }, [
    blocksStructure,
    loopsStructure,
    parallelsStructure,
    showSubBlocks,
    workflowState.blocks,
    isValidWorkflowState,
    executedBlockIds,
    pausedBlockId,
    isPaused,
    triggerBlockId,
  ])

  const edges: Edge[] = useMemo(() => {
    if (!isValidWorkflowState) return []

    return (workflowState.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }))
  }, [edgesStructure, workflowState.edges, isValidWorkflowState])

  // Handle migrated logs that don't have complete workflow state
  if (!isValidWorkflowState) {
    return (
      <div
        style={{ height, width }}
        className='flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'
      >
        <div className='text-center text-gray-500 dark:text-gray-400'>
          <div className='mb-2 font-medium text-lg'>⚠️ Logged State Not Found</div>
          <div className='text-sm'>
            This log was migrated from the old system and doesn't contain workflow state data.
          </div>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div style={{ height, width }} className={cn('preview-mode relative')}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
          fitViewOptions={{ padding: fitPadding }}
          panOnScroll={false}
          panOnDrag={isPannable}
          zoomOnScroll={false}
          draggable={false}
          defaultViewport={{
            x: defaultPosition?.x ?? 0,
            y: defaultPosition?.y ?? 0,
            zoom: defaultZoom ?? 1,
          }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          elementsSelectable={false}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={
            onNodeClick
              ? (event, node) => {
                  logger.debug('Node clicked:', { nodeId: node.id, event })
                  onNodeClick(node.id, { x: event.clientX, y: event.clientY })
                }
              : undefined
          }
        >
          <Background
            color='hsl(var(--workflow-dots))'
            size={4}
            gap={40}
            style={{ backgroundColor: 'hsl(var(--workflow-background))' }}
          />
        </ReactFlow>
        <ZoomControls showControls={showZoomControls} />
      </div>
    </ReactFlowProvider>
  )
}
