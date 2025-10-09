'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, XCircle, Loader2, AlertCircle, Clock, Workflow, FileText } from 'lucide-react'
import { getBrandConfig } from '@/lib/branding/branding'
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
  traceSpans?: any[]
  totalDuration?: number
  workflowState?: any
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
  const brand = getBrandConfig()
  
  return (
    <div className="sticky top-0 z-10 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            <Image
              src={brand.logoUrl}
              alt={`${brand.name} Logo`}
              width={32}
              height={32}
              className="h-7 w-auto object-contain"
            />
          ) : (
            <Image
              src="/logo/b&w/text/b&w.svg"
              alt="Sim - Workflows for LLMs"
              width={32}
              height={15.6}
              className="h-[15.6px] w-auto"
            />
          )}
          {workflowName && (
            <>
              <div className="h-4 w-px bg-border" />
              <span className="text-sm font-medium text-foreground">{workflowName}</span>
            </>
          )}
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Workflow className="h-3 w-3" />
          <span className="text-xs">Workflow Approval</span>
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
    <div className="sticky bottom-0 z-10 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container mx-auto px-4 py-4 sm:px-6 lg:px-8">
        {/* Error Display */}
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
            <p className="text-sm font-medium text-destructive">{error}</p>
          </div>
        )}

        {isCustomForm ? (
          // Custom Form Mode
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {details.humanInputFormat?.map((field) => (
                <div key={field.id} className="space-y-2">
                  <Label htmlFor={field.name} className="text-sm font-medium">
                    {field.name}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {field.type === 'boolean' ? (
                    <div className="flex items-center space-x-3 rounded-md border bg-background p-3">
                      <Checkbox
                        id={field.name}
                        checked={formData[field.name] || false}
                        onCheckedChange={(checked) =>
                          setFormData({ ...formData, [field.name]: checked })
                        }
                      />
                      <label htmlFor={field.name} className="text-sm cursor-pointer">
                        Enable
                      </label>
                    </div>
                  ) : field.type === 'number' ? (
                    <Input
                      id={field.name}
                      type="number"
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
            <div className="flex justify-end gap-3">
              <Button
                type="submit"
                disabled={submitting}
                size="lg"
                className="min-w-[140px]"
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
            </div>
          </form>
        ) : (
          // Approval Mode
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              onClick={onReject}
              disabled={submitting}
              variant="outline"
              size="lg"
              className="min-w-[140px] border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
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
              size="lg"
              className="min-w-[140px] bg-green-600 hover:bg-green-700"
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

        {/* One-time use notice */}
        <p className="mt-3 text-center text-xs text-muted-foreground">
          🔒 This is a one-time use link. Once you make a decision, this link will no longer be valid.
        </p>
      </div>
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
    <div className="flex min-h-screen flex-col bg-background">
      <ApprovalHeader workflowName={details?.workflowName} />
      
      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: Frozen Canvas */}
        <div className="flex w-full flex-col overflow-hidden lg:w-[60%]">
          <div className="flex-shrink-0 border-b border-r bg-muted/30 px-6 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Workflow State</h2>
                <p className="text-xs text-muted-foreground">
                  Click on blocks to see their input and output data
                </p>
              </div>
              {details?.pausedAt && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(details.pausedAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-r">
            {executionData?.workflowState ? (
              <FrozenCanvas
                executionId={details!.executionId}
                traceSpans={executionData.traceSpans}
                height="100%"
                width="100%"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <div className="text-center text-muted-foreground">
                  <Workflow className="mx-auto mb-3 h-12 w-12 opacity-50" />
                  <p className="text-sm">Workflow state not available</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Execution Logs */}
        <div className="hidden w-[40%] flex-col overflow-hidden lg:flex">
          <div className="flex-shrink-0 border-b bg-muted/30 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Execution Details</h2>
              </div>
              {details?.metadata?.description && (
                <Badge variant="outline" className="text-xs">
                  {details.humanOperation === 'custom' ? 'Input Required' : 'Approval Required'}
                </Badge>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-6 p-6">
              {/* Workflow Info */}
              <div className="space-y-3 rounded-lg border bg-card p-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Workflow</p>
                  <p className="text-sm font-medium">{details?.workflowName}</p>
                </div>
                <div className="h-px bg-border" />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Execution ID</p>
                  <p className="font-mono text-xs">{details?.executionId}</p>
                </div>
                {details?.metadata?.description && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Description</p>
                      <p className="text-sm leading-relaxed">{details.metadata.description}</p>
                    </div>
                  </>
                )}
              </div>

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
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground opacity-50" />
                  <p className="text-sm text-muted-foreground">No execution logs available yet</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Bottom: Approval Controls */}
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
  )
}
