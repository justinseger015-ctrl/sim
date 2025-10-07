'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react'

interface ApprovalDetails {
  workflowId: string
  executionId: string
  pausedAt: string
  metadata: any
  workflowName: string
}

export default function ApprovalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [details, setDetails] = useState<ApprovalDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<'approve' | 'reject' | null>(null)
  const [alreadyUsed, setAlreadyUsed] = useState(false)

  // Fetch approval details on mount
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
        }
      } catch (err) {
        setError('Failed to connect to server')
      } finally {
        setLoading(false)
      }
    }

    fetchDetails()
  }, [token])

  const handleAction = async (action: 'approve' | 'reject') => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/approval/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading approval request...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (alreadyUsed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-6 w-6 text-yellow-500" />
              <CardTitle>Link Already Used</CardTitle>
            </div>
            <CardDescription>
              This approval link has already been used and cannot be used again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              This was a one-time use link. If you need to make another approval decision, please
              request a new approval link.
            </p>
            <Button onClick={() => router.push('/')} className="w-full">
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error && !details) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <XCircle className="h-6 w-6 text-destructive" />
              <CardTitle>Error</CardTitle>
            </div>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/')} className="w-full">
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (result) {
    const isApproved = result === 'approve'
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center space-x-2">
              {isApproved ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <XCircle className="h-6 w-6 text-red-500" />
              )}
              <CardTitle>{isApproved ? 'Approved!' : 'Rejected'}</CardTitle>
            </div>
            <CardDescription>
              {isApproved
                ? 'The workflow has been approved and execution has been resumed.'
                : 'The workflow has been rejected and execution has stopped.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mb-4">
              <div className="text-sm">
                <span className="font-medium">Workflow:</span>{' '}
                <span className="text-muted-foreground">{details?.workflowName}</span>
              </div>
              <div className="text-sm">
                <span className="font-medium">Execution ID:</span>{' '}
                <span className="text-muted-foreground font-mono text-xs">
                  {details?.executionId}
                </span>
              </div>
            </div>
            <Button onClick={() => router.push('/')} className="w-full">
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Approval Required</CardTitle>
          <CardDescription>
            A workflow is waiting for your decision to continue execution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 mb-6">
            <div>
              <div className="text-sm font-medium mb-1">Workflow</div>
              <div className="text-sm text-muted-foreground">{details?.workflowName}</div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Paused At</div>
              <div className="text-sm text-muted-foreground">
                {details?.pausedAt ? new Date(details.pausedAt).toLocaleString() : 'Unknown'}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Execution ID</div>
              <div className="text-xs text-muted-foreground font-mono">
                {details?.executionId}
              </div>
            </div>
            {details?.metadata?.description && (
              <div>
                <div className="text-sm font-medium mb-1">Description</div>
                <div className="text-sm text-muted-foreground">
                  {details.metadata.description}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-md">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => handleAction('approve')}
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
            <Button
              onClick={() => handleAction('reject')}
              disabled={submitting}
              variant="destructive"
              className="flex-1"
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
          </div>

          <p className="text-xs text-muted-foreground text-center mt-4">
            This is a one-time use link. Once you make a decision, this link will no longer be
            valid.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

