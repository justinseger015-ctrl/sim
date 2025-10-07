'use client'

import { Handle, Position } from 'reactflow'
import { cn } from '@/lib/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface ApprovalBranchesProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  disabled?: boolean
}

export function ApprovalBranches({
  blockId,
  subBlockId,
  isPreview = false,
  disabled = false,
}: ApprovalBranchesProps) {
  // Get the operation type to determine which branches to show
  const operationType = useSubBlockStore((state) => state.getValue(blockId, 'operationType'))

  // Determine which branches to show based on operation type
  const isApprovalMode = operationType === 'approval'
  const isFeedbackMode = operationType === 'feedback'

  // Define branches
  const branches = isApprovalMode
    ? [
        { id: 'approved', label: 'Approved' },
        { id: 'rejected', label: 'Rejected' },
      ]
    : isFeedbackMode
      ? [{ id: 'continue', label: 'Continue' }]
      : [{ id: 'continue', label: 'Continue' }] // Default fallback

  return (
    <div className='space-y-2'>
      {branches.map((branch, index) => (
        <div
          key={branch.id}
          className='group relative overflow-visible rounded-lg border bg-background'
        >
          <div className='flex h-10 items-center justify-between overflow-hidden rounded-lg bg-card px-3'>
            <span className='font-medium text-sm'>{branch.label}</span>
            <Handle
              type='source'
              position={Position.Right}
              id={`approval-${branch.id}`}
              key={`${branch.id}-${index}`}
              className={cn(
                '!w-[7px] !h-5',
                '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
                '!z-[30]',
                'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                'hover:!w-[10px] hover:!right-[-28px] hover:!rounded-r-full hover:!rounded-l-none',
                '!cursor-crosshair',
                'transition-all duration-150',
                '!right-[-25px]'
              )}
              data-nodeid={`${blockId}-${subBlockId}`}
              data-handleid={`approval-${branch.id}`}
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
              }}
              isConnectableStart={!isPreview && !disabled}
              isConnectableEnd={false}
              isValidConnection={(connection: any) => {
                // Prevent self-connections
                if (connection.source === connection.target) return false

                // Existing validation to prevent connections within the same parent node
                const sourceNodeId = connection.source?.split('-')[0]
                const targetNodeId = connection.target?.split('-')[0]
                return sourceNodeId !== targetNodeId
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

