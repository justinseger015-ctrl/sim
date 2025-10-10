import { useEffect, useRef, useState } from 'react'
import { Plus, Trash } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useParams } from 'next/navigation'
import type { Variable } from '@/stores/panel/variables/types'

interface VariableAssignment {
  id: string
  variableId?: string // ID of the workflow variable being updated
  variableName: string
  type: 'string' | 'plain' | 'number' | 'boolean' | 'object' | 'array' | 'json'
  value: string
  isExisting: boolean // Whether this references an existing workflow variable
}

interface VariablesInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: VariableAssignment[] | null
  disabled?: boolean
  isConnecting?: boolean
}

const DEFAULT_ASSIGNMENT: Omit<VariableAssignment, 'id'> = {
  variableName: '',
  type: 'string',
  value: '',
  isExisting: false,
}

export function VariablesInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  isConnecting = false,
}: VariablesInputProps) {
  const params = useParams()
  const workflowId = params.workflowId as string
  const [storeValue, setStoreValue] = useSubBlockValue<VariableAssignment[]>(blockId, subBlockId)
  const { variables: workflowVariables } = useVariablesStore()
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  
  // Tag dropdown state
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const [dragHighlight, setDragHighlight] = useState<Record<string, boolean>>({})
  
  // Get workflow variables for this workflow
  const currentWorkflowVariables = Object.values(workflowVariables).filter(
    (v: Variable) => v.workflowId === workflowId
  )

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue
  const assignments: VariableAssignment[] = value || []

  // Helper to get available variables for a specific assignment (excluding others)
  const getAvailableVariablesFor = (currentAssignmentId: string) => {
    const otherSelectedIds = new Set(
      assignments
        .filter((a) => a.id !== currentAssignmentId)
        .map((a) => a.variableId)
        .filter((id): id is string => !!id)
    )
    
    return currentWorkflowVariables.filter((variable) => !otherSelectedIds.has(variable.id))
  }

  // Check if all variables have been assigned
  const allVariablesAssigned = getAvailableVariablesFor('new').length === 0

  // Add new assignment
  const addAssignment = () => {
    if (isPreview || disabled) return

    const newAssignment: VariableAssignment = {
      ...DEFAULT_ASSIGNMENT,
      id: crypto.randomUUID(),
    }
    setStoreValue([...(assignments || []), newAssignment])
  }

  // Remove assignment
  const removeAssignment = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue((assignments || []).filter((a) => a.id !== id))
  }

  // Update assignment field
  const updateAssignment = (id: string, updates: Partial<VariableAssignment>) => {
    if (isPreview || disabled) return
    setStoreValue(
      (assignments || []).map((a) => (a.id === id ? { ...a, ...updates } : a))
    )
  }

  // Handle variable selection from dropdown
  const handleVariableSelect = (assignmentId: string, variableId: string) => {
    const selectedVariable = currentWorkflowVariables.find((v) => v.id === variableId)
    if (selectedVariable) {
      updateAssignment(assignmentId, {
        variableId: selectedVariable.id,
        variableName: selectedVariable.name,
        type: selectedVariable.type as any,
        isExisting: true,
      })
    }
  }

  // Tag dropdown handlers
  const handleTagSelect = (tag: string) => {
    if (!activeFieldId) return

    const assignment = assignments.find((a) => a.id === activeFieldId)
    if (!assignment) return

    const currentValue = assignment.value || ''
    
    // Find the position of the last '<' before cursor
    const textBeforeCursor = currentValue.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    
    // Replace from '<' to cursor position with the full tag
    const newValue = 
      currentValue.slice(0, lastOpenBracket) + 
      tag + 
      currentValue.slice(cursorPosition)
    
    updateAssignment(activeFieldId, { value: newValue })
    setShowTags(false)

    // Focus back on input and move cursor after the tag
    setTimeout(() => {
      const inputEl = valueInputRefs.current[activeFieldId]
      if (inputEl) {
        inputEl.focus()
        const newCursorPos = lastOpenBracket + tag.length
        inputEl.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 10)
  }

  const handleValueInputChange = (
    assignmentId: string,
    newValue: string,
    selectionStart?: number
  ) => {
    updateAssignment(assignmentId, { value: newValue })
    
    if (selectionStart !== undefined) {
      setCursorPosition(selectionStart)
      setActiveFieldId(assignmentId)
      
      const shouldShowTags = checkTagTrigger(newValue, selectionStart)
      setShowTags(shouldShowTags.show)
      
      // Extract source block ID from the text if tag is being typed
      if (shouldShowTags.show) {
        const textBeforeCursor = newValue.slice(0, selectionStart)
        const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
        const tagContent = textBeforeCursor.slice(lastOpenBracket + 1)
        const dotIndex = tagContent.indexOf('.')
        const sourceBlock = dotIndex > 0 ? tagContent.slice(0, dotIndex) : null
        setActiveSourceBlockId(sourceBlock)
      }
    }
  }

  const handleDrop = (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [assignmentId]: false }))
    
    const tag = e.dataTransfer.getData('text/plain')
    if (tag && tag.startsWith('<')) {
      const assignment = assignments.find((a) => a.id === assignmentId)
      if (!assignment) return
      
      const currentValue = assignment.value || ''
      updateAssignment(assignmentId, { value: currentValue + tag })
    }
  }

  const handleDragOver = (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [assignmentId]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [assignmentId]: false }))
  }

  if (isPreview && (!assignments || assignments.length === 0)) {
    return (
      <div className='flex items-center justify-center rounded-md border border-dashed border-border/40 bg-muted/20 p-4 text-center text-muted-foreground text-sm'>
        No variable assignments defined
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {assignments && assignments.length > 0 ? (
        <div className='space-y-2'>
          {assignments.map((assignment, index) => {
            const isUnconfigured = !assignment.variableName || assignment.variableName.trim() === ''
            
            return (
              <div
                key={assignment.id}
                className={cn(
                  'group relative rounded-lg border bg-background p-3 transition-all',
                  isUnconfigured
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-border/60 hover:border-border'
                )}
              >
                {/* Remove Button - positioned absolutely */}
                {!isPreview && !disabled && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100'
                    onClick={() => removeAssignment(assignment.id)}
                  >
                    <Trash className='h-3.5 w-3.5' />
                  </Button>
                )}

                <div className='space-y-3'>
                  {/* Variable Name - Dropdown of existing variables */}
                  <div className='space-y-1.5'>
                    <Label className='text-xs text-muted-foreground'>Variable</Label>
                    <Select
                      value={assignment.variableId || assignment.variableName || ''}
                      onValueChange={(value) => {
                        if (value === '__new__') {
                          // Allow custom variable name (not implemented in this version)
                          return
                        }
                        handleVariableSelect(assignment.id, value)
                      }}
                      disabled={isPreview || disabled}
                    >
                      <SelectTrigger
                        className={cn(
                          'h-9 bg-white dark:bg-background',
                          isUnconfigured && 'border-amber-500/40'
                        )}
                      >
                        <SelectValue placeholder='Select a variable...' />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const availableVars = getAvailableVariablesFor(assignment.id)
                          return availableVars.length > 0 ? (
                            availableVars.map((variable) => (
                              <SelectItem key={variable.id} value={variable.id}>
                                <div className='flex items-center gap-2'>
                                  <span>{variable.name}</span>
                                  <Badge variant='outline' className='text-[10px]'>
                                    {variable.type}
                                  </Badge>
                                </div>
                              </SelectItem>
                            ))
                          ) : (
                            <div className='p-2 text-center text-muted-foreground text-sm'>
                              {currentWorkflowVariables.length > 0
                                ? 'All variables have been assigned.'
                                : 'No variables defined in this workflow.'}
                              {currentWorkflowVariables.length === 0 && (
                                <>
                                  <br />
                                  Add them in the Variables panel.
                                </>
                              )}
                            </div>
                          )
                        })()}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Type - Read-only when existing variable is selected */}
                  <div className='space-y-1.5'>
                    <Label className='text-xs text-muted-foreground'>Type</Label>
                    <Input
                      value={assignment.type || 'string'}
                      disabled={true}
                      className='h-9 bg-muted/50 text-muted-foreground'
                    />
                  </div>

                  {/* Value Input */}
                  <div className='relative space-y-1.5'>
                    <Label className='text-xs text-muted-foreground'>Value</Label>
                    {assignment.type === 'object' || assignment.type === 'array' ? (
                      <Textarea
                        ref={(el) => {
                          if (el) valueInputRefs.current[assignment.id] = el
                        }}
                        value={assignment.value || ''}
                        onChange={(e) =>
                          handleValueInputChange(
                            assignment.id,
                            e.target.value,
                            e.target.selectionStart ?? undefined
                          )
                        }
                        placeholder={
                          assignment.type === 'object' ? '{\n  "key": "value"\n}' : '[\n  1, 2, 3\n]'
                        }
                        disabled={isPreview || disabled}
                        className={cn(
                          'min-h-[120px] border border-input bg-white font-mono text-sm dark:bg-background',
                          dragHighlight[assignment.id] && 'ring-2 ring-blue-500 ring-offset-2',
                          isConnecting && 'ring-2 ring-blue-500 ring-offset-2'
                        )}
                        onDrop={(e) => handleDrop(e, assignment.id)}
                        onDragOver={(e) => handleDragOver(e, assignment.id)}
                        onDragLeave={(e) => handleDragLeave(e, assignment.id)}
                      />
                    ) : (
                      <div className='relative'>
                        <Input
                          ref={(el) => {
                            if (el) valueInputRefs.current[assignment.id] = el
                          }}
                          value={assignment.value || ''}
                          onChange={(e) =>
                            handleValueInputChange(
                              assignment.id,
                              e.target.value,
                              e.target.selectionStart ?? undefined
                            )
                          }
                          placeholder={`Enter ${assignment.type} value or use <block.output>`}
                          disabled={isPreview || disabled}
                          className={cn(
                            'h-9 bg-white text-transparent caret-foreground dark:bg-background',
                            dragHighlight[assignment.id] && 'ring-2 ring-blue-500 ring-offset-2',
                            isConnecting && 'ring-2 ring-blue-500 ring-offset-2'
                          )}
                          onDrop={(e) => handleDrop(e, assignment.id)}
                          onDragOver={(e) => handleDragOver(e, assignment.id)}
                          onDragLeave={(e) => handleDragLeave(e, assignment.id)}
                        />
                        {/* Overlay for blue highlighting */}
                        <div
                          ref={(el) => {
                            if (el) overlayRefs.current[assignment.id] = el
                          }}
                          className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'
                        >
                          <div className='w-full whitespace-nowrap'>
                            {formatDisplayText(assignment.value || '', {
                              accessiblePrefixes,
                              highlightAll: !accessiblePrefixes,
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Tag Dropdown */}
                    {showTags && activeFieldId === assignment.id && (
                      <TagDropdown
                        visible={showTags}
                        onSelect={handleTagSelect}
                        blockId={blockId}
                        activeSourceBlockId={activeSourceBlockId}
                        inputValue={assignment.value || ''}
                        cursorPosition={cursorPosition}
                        onClose={() => setShowTags(false)}
                        className='absolute top-full left-0 z-50 mt-1'
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {!isPreview && !disabled && (
        <Button
          onClick={addAssignment}
          variant='outline'
          size='sm'
          className='w-full border-dashed'
          disabled={allVariablesAssigned}
        >
          <Plus className='mr-2 h-4 w-4' />
          {allVariablesAssigned ? 'All Variables Assigned' : 'Add Variable Assignment'}
        </Button>
      )}
    </div>
  )
}
