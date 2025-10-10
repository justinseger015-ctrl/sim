'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { XCircle, Loader2, AlertCircle, Workflow, ArrowRightCircle, CheckCircle2 } from 'lucide-react'
import { FrozenCanvas } from '@/app/workspace/[workspaceId]/logs/components/frozen-canvas/frozen-canvas'
import { TraceSpansDisplay } from '@/app/workspace/[workspaceId]/logs/components/trace-spans/trace-spans-display'
import { cn } from '@/lib/utils'

interface ApprovalDetails {
  workflowId: string
  executionId: string
  pausedAt: string
  metadata: any
  workflowName: string
  humanOperation?: 'approval' | 'custom'
  humanInputFormat?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array'
    required?: boolean
  }>
}

interface ExecutionData {
  executionId: string
  workflowId: string
  workflowState: any
  traceSpans?: any[]
  totalDuration?: number
  executionMetadata?: {
    trigger?: string
    startedAt?: string
    endedAt?: string
    totalDurationMs?: number
    cost?: any
  }
}

// Header component with branding
function ApprovalHeader({ workflowName }: { workflowName?: string }) {
  return (
    <div className="sticky top-0 z-10 w-full border-b bg-card">
      <div className="flex h-12 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Workflow className="h-5 w-5 text-primary" />
          {workflowName && (
            <span className="text-sm font-medium text-foreground">{workflowName}</span>
          )}
        </div>
        <Badge variant="secondary" className="text-xs">
          Approval Required
        </Badge>
      </div>
    </div>
  )
}

// Approval Controls Component
function ApprovalControls({
  details,
  submitting,
  submittingAction,
  error,
  formData,
  setFormData,
  onSubmit,
  onApprove,
  onReject,
  result,
}: {
  details: ApprovalDetails
  submitting: boolean
  submittingAction: 'approve' | 'reject' | null
  error: string | null
  formData: Record<string, any>
  setFormData: (data: Record<string, any>) => void
  onSubmit: (e: React.FormEvent) => void
  onApprove: () => void
  onReject: () => void
  result: 'approve' | 'reject' | null
}) {
  const isCustomForm = details?.humanOperation === 'custom' && details?.humanInputFormat
  const isDisabled = submitting || !!result

  return (
    <div className="space-y-4">
      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      )}

      {isCustomForm ? (
        // Custom Form Mode
        <form onSubmit={onSubmit} className="space-y-4 min-w-0">
          <div className="space-y-3 min-w-0">
              {details.humanInputFormat?.map((field) => (
                <div key={field.id} className="space-y-2 min-w-0">
                  <Label htmlFor={field.name} className="text-sm font-medium">
                    {field.name}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {field.type === 'boolean' ? (
                    <Select
                      value={formData[field.name] === undefined ? '' : String(formData[field.name])}
                      onValueChange={(value) =>
                        setFormData({ ...formData, [field.name]: value === 'true' })
                      }
                      disabled={isDisabled}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">True</SelectItem>
                        <SelectItem value="false">False</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : field.type === 'number' ? (
                    <Input
                      id={field.name}
                      type="number"
                      placeholder="number"
                      value={formData[field.name] || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, [field.name]: Number(e.target.value) })
                      }
                      required={field.required}
                      disabled={isDisabled}
                      className="w-full"
                    />
                  ) : field.type === 'object' || field.type === 'array' ? (
                    <Textarea
                      id={field.name}
                      placeholder={field.type === 'array' ? '[]' : '{}'}
                      value={formData[field.name] || ''}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value)
                          setFormData({ ...formData, [field.name]: parsed })
                        } catch {
                          setFormData({ ...formData, [field.name]: e.target.value })
                        }
                      }}
                      required={field.required}
                      disabled={isDisabled}
                      className="min-h-[80px] w-full font-mono text-sm break-words"
                    />
                  ) : (
                    <Input
                      id={field.name}
                      type="text"
                      placeholder="text"
                      value={formData[field.name] || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, [field.name]: e.target.value })
                      }
                      required={field.required}
                      disabled={isDisabled}
                      className="w-full"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={onReject}
                disabled={isDisabled}
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
              >
                {submittingAction === 'reject' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Cancel
                    <XCircle className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
              <Button
                type="submit"
                disabled={isDisabled}
                className="flex-1 bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]/90 disabled:opacity-50"
              >
                {submittingAction === 'approve' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRightCircle className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : (
          // Approval Mode
          <div className="flex gap-3">
            <Button
              onClick={onReject}
              disabled={isDisabled}
              variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
            >
              {submittingAction === 'reject' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Reject
                  <XCircle className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              onClick={onApprove}
              disabled={isDisabled}
              className="flex-1 bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]/90 disabled:opacity-50"
            >
              {submittingAction === 'approve' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRightCircle className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}
    </div>
  )
}

export default function ApprovalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'reject' | null>(null)
  const [details, setDetails] = useState<ApprovalDetails | null>(null)
  const [executionData, setExecutionData] = useState<ExecutionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<'approve' | 'reject' | null>(null)
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [leftPanelWidth, setLeftPanelWidth] = useState(400)
  const [rightPanelWidth, setRightPanelWidth] = useState(520)
  const [isLeftDragging, setIsLeftDragging] = useState(false)
  const [isRightDragging, setIsRightDragging] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [approvalSectionHeight, setApprovalSectionHeight] = useState(200)
  const [isVerticalDragging, setIsVerticalDragging] = useState(false)
  
  // Calculate initial approval section height based on content
  useEffect(() => {
    if (details) {
      // Simple approval mode needs less space than custom form
      const isCustomForm = details.humanOperation === 'custom' && details.humanInputFormat
      
      if (isCustomForm && details.humanInputFormat) {
        // Calculate height based on number of form fields
        const fieldCount = details.humanInputFormat.length
        // Base height (header + padding + buttons) + height per field
        const calculatedHeight = 140 + (fieldCount * 90)
        setApprovalSectionHeight(Math.min(calculatedHeight, 500))
      } else {
        // Approval mode: header + padding + error space + buttons
        setApprovalSectionHeight(180)
      }
    }
  }, [details])
  
  // Handle left panel resize
  useEffect(() => {
    if (!isLeftDragging) return

    let rafId: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId) return
      
      rafId = requestAnimationFrame(() => {
        const newWidth = e.clientX
        const minWidth = 300
        const maxWidth = 600
        setLeftPanelWidth(Math.min(Math.max(newWidth, minWidth), maxWidth))
        rafId = null
      })
    }

    const handleMouseUp = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      setIsLeftDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isLeftDragging])

  // Handle right panel resize with RAF for smooth performance
  useEffect(() => {
    if (!isRightDragging) return

    let rafId: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId) return // Skip if already scheduled
      
      rafId = requestAnimationFrame(() => {
        const newWidth = window.innerWidth - e.clientX
        const minWidth = 320
        const maxWidth = 800
        setRightPanelWidth(Math.min(Math.max(newWidth, minWidth), maxWidth))
        rafId = null
      })
    }

    const handleMouseUp = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      setIsRightDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isRightDragging])

  // Handle vertical resize for approval section
  useEffect(() => {
    if (!isVerticalDragging) return

    let rafId: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId) return
      
      rafId = requestAnimationFrame(() => {
        const container = document.querySelector('.right-panel-container')
        if (!container) return
        
        const containerRect = container.getBoundingClientRect()
        const newHeight = containerRect.bottom - e.clientY
        const minHeight = 120
        const maxHeight = containerRect.height - 200
        setApprovalSectionHeight(Math.min(Math.max(newHeight, minHeight), maxHeight))
        rafId = null
      })
    }

    const handleMouseUp = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      setIsVerticalDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isVerticalDragging])

  // Fetch approval details and execution data on mount
  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const response = await fetch(`/api/approval/${token}`)
        const data = await response.json()

        if (response.status === 410 && data.alreadyUsed) {
          setAlreadyUsed(true)
          setError(data.error)
          setLoading(false) // Stop loading immediately for error page
          return
        } else if (!response.ok) {
          setError(data.error || 'Failed to load approval details')
          setLoading(false) // Stop loading immediately for error page
          return
        }
        
        // Valid approval request - set details and continue loading
        setDetails(data)
        
        // Fetch execution logs/trace spans
        try {
          const logsResponse = await fetch(`/api/logs/execution/${data.executionId}`)
          if (logsResponse.ok) {
            const logsData = await logsResponse.json()
            setExecutionData(logsData)
          }
        } catch (logsError) {
          console.error('Failed to load execution logs:', logsError)
          // Non-fatal, continue without logs
        }
        
        setLoading(false)
      } catch (err) {
        setError('Failed to connect to server')
        setLoading(false)
      }
    }

    fetchDetails()
  }, [token])

  const handleAction = async (action: 'approve' | 'reject', customData?: Record<string, any>) => {
    setSubmitting(true)
    setSubmittingAction(action)
    setError(null)

    try {
      const response = await fetch(`/api/approval/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          action,
          ...(customData && { formData: customData })
        }),
      })

      const data = await response.json()

      if (response.status === 410 && data.alreadyUsed) {
        setAlreadyUsed(true)
        setError(data.error)
      } else if (!response.ok) {
        setError(data.error || 'Failed to process action')
      } else {
        // Success - keep page as is, just set result for tracking
        setResult(action)
        // Page stays open, user can see what they just did
      }
    } catch (err) {
      setError('Failed to connect to server')
    } finally {
      setSubmitting(false)
      setSubmittingAction(null)
    }
  }

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate required fields
    if (details?.humanInputFormat) {
      for (const field of details.humanInputFormat) {
        if (field.required && !formData[field.name]) {
          setError(`Field "${field.name}" is required`)
          return
        }
      }
    }
    
    handleAction('approve', formData)
  }

  // Recursively find a trace span by blockId
  const findTraceSpanByBlockId = (spans: any[] | undefined, blockId: string): any => {
    if (!spans) return null
    
    for (const span of spans) {
      if (span.blockId === blockId) {
        return span
      }
      
      // Search in children recursively
      if (span.children && span.children.length > 0) {
        const found = findTraceSpanByBlockId(span.children, blockId)
        if (found) return found
      }
    }
    
    return null
  }

  // Show simple loading screen while checking link validity
  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-[16px] font-[380]">Loading...</span>
          </div>
        </div>
      </div>
    )
  }

  if (alreadyUsed) {
    return (
      <div className="min-h-screen bg-white">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-[410px]">
            <div className="flex flex-col items-center justify-center">
              <div className="space-y-1 text-center">
                <h1 className="font-medium text-[32px] text-black tracking-tight">
                  Link Already Used
                </h1>
                <p className="font-[380] text-[16px] text-muted-foreground">
                  This approval link has already been processed. Each link can only be used once for security.
                </p>
              </div>

              <div className="mt-8 w-full space-y-3">
                <Button
                  type="button"
                  onClick={() => router.push('/')}
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] border bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]/90 font-medium text-[15px] text-white transition-all duration-200"
                >
                  Return to Home
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error && !details) {
    return (
      <div className="min-h-screen bg-white">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-[410px]">
            <div className="flex flex-col items-center justify-center">
              <div className="space-y-1 text-center">
                <h1 className="font-medium text-[32px] text-black tracking-tight">
                  Unable to Load Request
                </h1>
                <p className="font-[380] text-[16px] text-muted-foreground">
                  {error}
                </p>
              </div>

              <div className="mt-8 w-full space-y-3">
                <Button
                  type="button"
                  onClick={() => router.push('/')}
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] border bg-[var(--brand-primary-hover-hex)] hover:bg-[var(--brand-primary-hover-hex)]/90 font-medium text-[15px] text-white transition-all duration-200"
                >
                  Return to Home
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <ApprovalHeader workflowName={details?.workflowName} />
      
      {/* Success Banner */}
      {result && (
        <div className={cn(
          "px-6 py-3 text-center font-medium text-white",
          result === 'approve' 
            ? 'bg-[var(--brand-primary-hover-hex)]' 
            : 'bg-destructive'
        )}>
          {result === 'approve' 
            ? '✓ Request approved - workflow will continue execution' 
            : '✗ Request rejected - workflow execution stopped'}
        </div>
      )}
      
      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden min-w-0" style={{ height: result ? 'calc(100vh - 96px)' : 'calc(100vh - 48px)' }}>
        {/* Left Panel: Execution Timeline & Block Details */}
        <div 
          className="flex flex-col overflow-hidden border-r bg-card min-w-0"
          style={{ width: `${leftPanelWidth}px` }}
        >
          <ScrollArea className="flex-1 min-w-0">
            <div className="flex flex-col gap-6 p-6 min-w-0">
              {/* Trace Spans */}
              {!executionData ? (
                <div className="min-w-0">
                  <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                    EXECUTION TIMELINE
                  </h3>
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading timeline...</span>
                  </div>
                </div>
              ) : executionData?.traceSpans && executionData.traceSpans.length > 0 ? (
                <div className="min-w-0">
                  <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                    EXECUTION TIMELINE
                  </h3>
                  <TraceSpansDisplay
                    traceSpans={executionData.traceSpans}
                    totalDuration={executionData.totalDuration}
                  />
                </div>
              ) : null}
              
              {/* Selected Block Details */}
              {selectedBlockId && executionData?.workflowState?.blocks?.[selectedBlockId] && (
                <div className="min-w-0">
                  <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                    BLOCK DETAILS
                  </h3>
                  <Card className="border min-w-0">
                    <div className="p-4 space-y-4 min-w-0">
                      <div className="flex items-center justify-between min-w-0">
                        <h4 className="font-semibold text-sm truncate">
                          {executionData.workflowState.blocks[selectedBlockId].name || 
                           executionData.workflowState.blocks[selectedBlockId].metadata?.name || 
                           'Block'}
                        </h4>
                        <Badge variant="secondary" className="text-xs flex-shrink-0">
                          {executionData.workflowState.blocks[selectedBlockId].type || 
                           executionData.workflowState.blocks[selectedBlockId].metadata?.id}
                        </Badge>
                      </div>
                      
                      {/* Find execution data for this block */}
                      {(() => {
                        const blockExecution = findTraceSpanByBlockId(
                          executionData.traceSpans,
                          selectedBlockId
                        )
                        
                        if (blockExecution) {
                          return (
                            <>
                              {blockExecution.input && (
                                <div className="space-y-2 min-w-0">
                                  <p className="text-xs font-medium text-muted-foreground">Input</p>
                                  <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto overflow-y-auto max-h-48 w-full max-w-full whitespace-pre-wrap break-all overflow-wrap-anywhere">
                                    {JSON.stringify(blockExecution.input, null, 2)}
                                  </pre>
                                </div>
                              )}
                              
                              {blockExecution.output && (
                                <div className="space-y-2 min-w-0">
                                  <p className="text-xs font-medium text-muted-foreground">Output</p>
                                  <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto overflow-y-auto max-h-48 w-full max-w-full whitespace-pre-wrap break-all overflow-wrap-anywhere">
                                    {JSON.stringify(blockExecution.output, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </>
                          )
                        }
                        
                        return (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            This block has not been executed yet
                          </p>
                        )
                      })()}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Left Resize Handle */}
        <div
          className={cn(
            "group relative w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30",
            isLeftDragging && "bg-primary/50"
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            setIsLeftDragging(true)
          }}
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>

        {/* Center: Frozen Canvas */}
        <div className="min-h-0 flex-1 overflow-hidden min-w-0">
          {details?.executionId ? (
            <FrozenCanvas
              executionId={details.executionId}
              traceSpans={executionData?.traceSpans}
              height="100%"
              width="100%"
              onBlockClick={setSelectedBlockId}
              showZoomControls={true}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading workflow...</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Resize Handle */}
        <div
          className={cn(
            "group relative w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30",
            isRightDragging && "bg-primary/50"
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            setIsRightDragging(true)
          }}
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>

        {/* Right Side: Content & Controls */}
        <div 
          className="right-panel-container flex flex-col overflow-hidden border-l min-w-0"
          style={{ width: `${rightPanelWidth}px` }}
        >
          {/* Content to Evaluate - Takes remaining space */}
          <div 
            className="overflow-hidden"
            style={{ height: `calc(100% - ${approvalSectionHeight}px - 4px)` }}
          >
            <ScrollArea className="h-full">
              <div className="p-6 min-w-0">
                {/* Content to Evaluate */}
                <div className="min-w-0">
                  <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                    CONTENT TO EVALUATE
                  </h3>
                  {!executionData ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading...</span>
                    </div>
                  ) : executionData?.workflowState?.blocks ? (() => {
                    // Find the HITL block
                    const hitlBlock = Object.entries(executionData.workflowState.blocks).find(
                      ([_, block]: [string, any]) => block.type === 'user_approval'
                    )
                    
                    if (hitlBlock) {
                      const [blockId, block] = hitlBlock as [string, any]
                      // Find the execution data for this block
                      const blockExecution = findTraceSpanByBlockId(
                        executionData.traceSpans,
                        blockId
                      )
                      
                      // Get content from output or subBlocks (subBlocks stores as {id, type, value})
                      let content = blockExecution?.output?.content
                      if (!content && block.subBlocks?.content) {
                        content = typeof block.subBlocks.content === 'object' 
                          ? block.subBlocks.content.value 
                          : block.subBlocks.content
                      }
                      
                      if (content && typeof content === 'string') {
                        return (
                          <div className="max-w-full whitespace-pre-wrap break-all overflow-x-auto overflow-wrap-anywhere text-sm text-foreground rounded-lg border bg-muted/30 p-4">
                            {content}
                          </div>
                        )
                      }
                    }
                    
                    return (
                      <p className="text-sm text-muted-foreground italic">
                        No content provided for evaluation
                      </p>
                    )
                  })() : (
                    <p className="text-sm text-muted-foreground italic">
                      No content provided for evaluation
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
          
          {/* Vertical Resize Handle */}
          <div
            className={cn(
              "group relative h-1 cursor-row-resize bg-transparent transition-colors hover:bg-primary/30",
              isVerticalDragging && "bg-primary/50"
            )}
            onMouseDown={(e) => {
              e.preventDefault()
              setIsVerticalDragging(true)
            }}
          >
            <div className="absolute inset-x-0 -top-2 -bottom-2" />
          </div>
          
          {/* Approval Controls - Resizable section */}
          <div 
            className="border-t bg-card overflow-hidden flex flex-col"
            style={{ height: `${approvalSectionHeight}px` }}
          >
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Approval</h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-6 min-w-0">
                {!details ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading controls...</span>
                  </div>
                ) : (
                  <ApprovalControls
                    details={details}
                    submitting={submitting}
                    submittingAction={submittingAction}
                    error={error}
                    formData={formData}
                    setFormData={setFormData}
                    onSubmit={handleCustomSubmit}
                    onApprove={() => handleAction('approve')}
                    onReject={() => handleAction('reject')}
                    result={result}
                  />
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  )
}
