'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Copy, Check, Eye, EyeOff } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'

interface WebhookResumeModalProps {
  isOpen: boolean
  onClose: () => void
  config: any
  onSave: (config: any) => void
  blockId: string
}

export function WebhookResumeModal({
  isOpen,
  onClose,
  config,
  onSave,
  blockId,
}: WebhookResumeModalProps) {
  const [requireAuth, setRequireAuth] = useState(config?.requireAuth || false)
  const [token, setToken] = useState(config?.token || '')
  const [secretHeaderName, setSecretHeaderName] = useState(config?.secretHeaderName || '')
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Load existing configuration
  useEffect(() => {
    if (config) {
      setRequireAuth(config.requireAuth || false)
      setToken(config.token || '')
      setSecretHeaderName(config.secretHeaderName || '')
    }
  }, [config])

  // Track unsaved changes
  useEffect(() => {
    const hasChanges =
      requireAuth !== (config?.requireAuth || false) ||
      token !== (config?.token || '') ||
      secretHeaderName !== (config?.secretHeaderName || '')
    setHasUnsavedChanges(hasChanges)
  }, [requireAuth, token, secretHeaderName, config])

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSave = useCallback(() => {
    const newConfig = {
      requireAuth,
      token: requireAuth ? token : '',
      secretHeaderName: requireAuth ? secretHeaderName : '',
    }
    onSave(newConfig)
  }, [requireAuth, token, secretHeaderName, onSave])

  const handleCancel = useCallback(() => {
    if (hasUnsavedChanges) {
      // Reset to original values
      setRequireAuth(config?.requireAuth || false)
      setToken(config?.token || '')
      setSecretHeaderName(config?.secretHeaderName || '')
    }
    onClose()
  }, [hasUnsavedChanges, config, onClose])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='max-w-2xl max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Configure Webhook Resume</DialogTitle>
          <DialogDescription>
            Configure how external systems can resume this workflow when it pauses
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          {/* Webhook URL Section */}
          <div className='space-y-2'>
            <Label>Resume Webhook URL</Label>
            <div className='rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 p-4 text-center'>
              <p className='text-sm text-muted-foreground mb-2'>
                <span className='font-medium'>Dynamically generated at runtime</span>
              </p>
              <p className='text-xs text-muted-foreground'>
                The webhook URL will be created when this block executes and will be available in the block output as{' '}
                <code className='bg-muted px-1.5 py-0.5 rounded font-mono'>resumeUrl</code>
              </p>
            </div>
            <p className='text-xs text-muted-foreground'>
              Format: <code className='bg-muted px-1 rounded font-mono text-[10px]'>/api/webhooks/resume/{'{workflowId}'}/{'{executionId}'}</code>
            </p>
          </div>

          {/* Authentication Section */}
          <div className='space-y-4 rounded-lg border border-border bg-card p-4'>
            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label htmlFor='require-auth'>Require Authentication</Label>
                <p className='text-xs text-muted-foreground'>
                  Require authentication token for webhook requests
                </p>
              </div>
              <Switch
                id='require-auth'
                checked={requireAuth}
                onCheckedChange={setRequireAuth}
              />
            </div>

            {requireAuth && (
              <>
                <div className='space-y-2'>
                  <Label htmlFor='token'>Authentication Token</Label>
                  <div className='relative'>
                    <Input
                      id='token'
                      type={showToken ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder='Enter or generate a token'
                      className='pr-20 font-mono text-sm'
                      autoComplete='new-password'
                    />
                    <div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1'>
                      <button
                        type='button'
                        onClick={() => setShowToken(!showToken)}
                        className='text-muted-foreground hover:text-foreground'
                      >
                        {showToken ? (
                          <EyeOff className='h-4 w-4' />
                        ) : (
                          <Eye className='h-4 w-4' />
                        )}
                      </button>
                      <button
                        type='button'
                        onClick={() => copyToClipboard(token, 'token')}
                        className='text-muted-foreground hover:text-foreground'
                      >
                        {copied === 'token' ? (
                          <Check className='h-4 w-4 text-green-600' />
                        ) : (
                          <Copy className='h-4 w-4' />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    This token will be used to authenticate webhook requests
                  </p>
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='secret-header'>Secret Header Name (Optional)</Label>
                  <Input
                    id='secret-header'
                    value={secretHeaderName}
                    onChange={(e) => setSecretHeaderName(e.target.value)}
                    placeholder='X-Webhook-Secret'
                    className='font-mono text-sm'
                  />
                  <p className='text-xs text-muted-foreground'>
                    Custom HTTP header name for the auth token. If blank, uses{' '}
                    <code className='bg-muted px-1 rounded'>Authorization: Bearer TOKEN</code>
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Instructions Section */}
          <div className='space-y-2 rounded-lg border border-border bg-muted/30 p-4'>
            <h4 className='font-medium text-sm'>How to Resume the Workflow</h4>
            <ul className='space-y-1 text-xs text-muted-foreground'>
              <li>• Send a POST request to the webhook URL when you want to resume the workflow</li>
              <li>• The URL will be available in the block output as <code className='bg-muted px-1 rounded'>resumeUrl</code></li>
              {requireAuth && (
                <li>
                  • Include the authentication token in the request header:{' '}
                  {secretHeaderName ? (
                    <code className='bg-muted px-1 rounded'>
                      {secretHeaderName}: {token}
                    </code>
                  ) : (
                    <code className='bg-muted px-1 rounded'>Authorization: Bearer {token}</code>
                  )}
                </li>
              )}
              <li>• Any JSON body sent with the request will be available as <code className='bg-muted px-1 rounded'>webhook.*</code> variables</li>
            </ul>
          </div>

          {/* Example curl command */}
          {requireAuth && token && (
            <div className='space-y-2'>
              <Label>Example Request</Label>
              <div className='relative'>
                <Textarea
                  readOnly
                  value={`curl -X POST <RESUME_URL> \\
  -H "Content-Type: application/json" \\
  ${secretHeaderName ? `-H "${secretHeaderName}: ${token}"` : `-H "Authorization: Bearer ${token}"`} \\
  -d '{"status": "approved", "comment": "Looks good!"}'`}
                  className='font-mono text-xs resize-none'
                  rows={5}
                />
                <button
                  type='button'
                  onClick={() =>
                    copyToClipboard(
                      `curl -X POST <RESUME_URL> -H "Content-Type: application/json" ${
                        secretHeaderName
                          ? `-H "${secretHeaderName}: ${token}"`
                          : `-H "Authorization: Bearer ${token}"`
                      } -d '{"status": "approved", "comment": "Looks good!"}'`,
                      'curl'
                    )
                  }
                  className='absolute right-2 top-2 text-muted-foreground hover:text-foreground'
                >
                  {copied === 'curl' ? (
                    <Check className='h-4 w-4 text-green-600' />
                  ) : (
                    <Copy className='h-4 w-4' />
                  )}
                </button>
              </div>
              <p className='text-xs text-muted-foreground'>
                Replace <code className='bg-muted px-1 rounded'>{'<RESUME_URL>'}</code> with the actual URL from the block output
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={handleCancel} type='button'>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasUnsavedChanges} type='button'>
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

