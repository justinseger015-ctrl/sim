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
import { CheckCircle2, XCircle, Loader2, AlertCircle, Workflow } from 'lucide-react'
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
  error,
  formData,
  setFormData,
  onSubmit,
  onApprove,
  onReject,
}: {
  details: ApprovalDetails
  submitting: boolean
  error: string | null
  formData: Record<string, any>
  setFormData: (data: Record<string, any>) => void
  onSubmit: (e: React.FormEvent) => void
  onApprove: () => void
  onReject: () => void
}) {
  const isCustomForm = details?.humanOperation === 'custom' && details?.humanInputFormat

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
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-3">
              {details.humanInputFormat?.map((field) => (
                <div key={field.id} className="space-y-2">
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
                    >
                      <SelectTrigger>
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
                      className="min-h-[80px] font-mono text-sm"
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
                    />
                  )}
                </div>
              ))}
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Submit
                </>
              )}
            </Button>
          </form>
        ) : (
          // Approval Mode
          <div className="flex gap-3">
            <Button
              onClick={onReject}
              disabled={submitting}
              variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </>
              )}
            </Button>
            <Button
              onClick={onApprove}
              disabled={submitting}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
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
  const [details, setDetails] = useState<ApprovalDetails | null>(null)
  const [executionData, setExecutionData] = useState<ExecutionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<'approve' | 'reject' | null>(null)
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [rightPanelWidth, setRightPanelWidth] = useState(520)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [approvalSectionHeight, setApprovalSectionHeight] = useState(() => {
    // Initialize with 60% of viewport height
    if (typeof window !== 'undefined') {
      const viewportHeight = window.innerHeight - 48 // Subtract header height
      return viewportHeight * 0.6
    }
    return 400
  })
  const [isVerticalDragging, setIsVerticalDragging] = useState(false)

  // Handle horizontal panel resize with RAF for smooth performance
  useEffect(() => {
    if (!isDragging) return

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
      setIsDragging(false)
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
  }, [isDragging])

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
        const minHeight = 200
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
        } else if (!response.ok) {
          setError(data.error || 'Failed to load approval details')
        } else {
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
        }
      } catch (err) {
        setError('Failed to connect to server')
      } finally {
        setLoading(false)
      }
    }

    fetchDetails()
  }, [token])

  const handleAction = async (action: 'approve' | 'reject', customData?: Record<string, any>) => {
    setSubmitting(true)
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
        setResult(action)
      }
    } catch (err) {
      setError('Failed to connect to server')
    } finally {
      setSubmitting(false)
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

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <ApprovalHeader />
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="flex flex-col items-center justify-center border-none p-12 shadow-lg">
            <div className="relative mb-6">
              <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-xl" />
              <Loader2 className="relative h-12 w-12 animate-spin text-primary" />
            </div>
            <p className="text-lg font-medium text-foreground">Loading approval request</p>
            <p className="mt-2 text-sm text-muted-foreground">Please wait...</p>
          </Card>
        </div>
      </div>
    )
  }

  if (alreadyUsed) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <ApprovalHeader />
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-lg border-none p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-500/10">
                <AlertCircle className="h-8 w-8 text-yellow-500" />
              </div>
              <h1 className="mb-3 text-2xl font-semibold">Link Already Used</h1>
              <p className="mb-6 text-muted-foreground">
                This approval link has already been used and cannot be used again.
              </p>
              <Button onClick={() => router.push('/')} size="lg" className="w-full">
                Return to Home
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (error && !details) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <ApprovalHeader />
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-lg border-none p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <XCircle className="h-8 w-8 text-destructive" />
              </div>
              <h1 className="mb-3 text-2xl font-semibold">Unable to Load Request</h1>
              <p className="mb-6 text-muted-foreground">{error}</p>
              <Button onClick={() => router.push('/')} size="lg" className="w-full">
                Return to Home
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (result) {
    const isApproved = result === 'approve'
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <ApprovalHeader workflowName={details?.workflowName} />
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-lg border-none p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <div className={cn(
                "mb-6 flex h-20 w-20 items-center justify-center rounded-full",
                isApproved ? 'bg-green-500/10' : 'bg-red-500/10'
              )}>
                {isApproved ? (
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                ) : (
                  <XCircle className="h-10 w-10 text-red-500" />
                )}
              </div>
              <h1 className="mb-3 text-3xl font-semibold">
                {isApproved ? 'Request Approved' : 'Request Rejected'}
              </h1>
              <p className="mb-8 text-muted-foreground">
                {isApproved
                  ? 'The workflow has been approved and will continue execution.'
                  : 'The workflow has been rejected and execution has been stopped.'}
              </p>
              <div className="mb-8 w-full space-y-3 rounded-lg border bg-muted/30 p-6 text-left">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Workflow Name</p>
                  <p className="text-base font-medium">{details?.workflowName}</p>
                </div>
                <div className="h-px bg-border" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Execution ID</p>
                  <p className="font-mono text-xs">{details?.executionId}</p>
                </div>
              </div>
              <Button onClick={() => router.push('/')} size="lg" className="w-full">
                Return to Home
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <ApprovalHeader workflowName={details?.workflowName} />
      
      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 48px)' }}>
        {/* Left Side: Frozen Canvas */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <FrozenCanvas
            executionId={details!.executionId}
            traceSpans={executionData?.traceSpans}
            height="100%"
            width="100%"
            onBlockClick={setSelectedBlockId}
          />
        </div>

        {/* Resize Handle */}
        <div
          className={cn(
            "group relative w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30",
            isDragging && "bg-primary/50"
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>

        {/* Right Side: Execution Details & Controls */}
        <div 
          className="right-panel-container flex flex-col overflow-hidden border-l"
          style={{ width: `${rightPanelWidth}px` }}
        >
          <div 
            className="overflow-hidden"
            style={{ height: `calc(100% - ${approvalSectionHeight}px - 4px)` }}
          >
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-6 p-6">
              {/* Trace Spans */}
              {executionData?.traceSpans && executionData.traceSpans.length > 0 ? (
                <div>
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
                <div>
                  <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                    BLOCK DETAILS
                  </h3>
                  <Card className="border">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">
                          {executionData.workflowState.blocks[selectedBlockId].name || 
                           executionData.workflowState.blocks[selectedBlockId].metadata?.name || 
                           'Block'}
                        </h4>
                        <Badge variant="secondary" className="text-xs">
                          {executionData.workflowState.blocks[selectedBlockId].type || 
                           executionData.workflowState.blocks[selectedBlockId].metadata?.id}
                        </Badge>
                      </div>
                      
                      {/* Find execution data for this block */}
                      {(() => {
                        const blockExecution = executionData.traceSpans?.find(
                          (span: any) => span.blockId === selectedBlockId
                        )
                        
                        if (blockExecution) {
                          return (
                            <>
                              {blockExecution.input && (
                                <div className="space-y-2">
                                  <p className="text-xs font-medium text-muted-foreground">Input</p>
                                  <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-48">
                                    {JSON.stringify(blockExecution.input, null, 2)}
                                  </pre>
                                </div>
                              )}
                              
                              {blockExecution.output && (
                                <div className="space-y-2">
                                  <p className="text-xs font-medium text-muted-foreground">Output</p>
                                  <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-48">
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
          
          {/* Approval Controls - Resizable section at bottom of right panel */}
          <div 
            className="border-t bg-card overflow-hidden"
            style={{ height: `${approvalSectionHeight}px` }}
          >
            <ScrollArea className="h-full">
              <div className="p-6">
                <ApprovalControls
                  details={details!}
                  submitting={submitting}
                  error={error}
                  formData={formData}
                  setFormData={setFormData}
                  onSubmit={handleCustomSubmit}
                  onApprove={() => handleAction('approve')}
                  onReject={() => handleAction('reject')}
                />
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  )
}
