'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { WebhookResumeModal } from './components/webhook-resume-modal'
import { ExternalLink } from 'lucide-react'

interface WebhookResumeConfigProps {
  blockId: string
  isConnecting?: boolean
  isPreview?: boolean
  value?: any
  disabled?: boolean
}

export function WebhookResumeConfig({
  blockId,
  isConnecting = false,
  isPreview = false,
  value: propValue,
  disabled = false,
}: WebhookResumeConfigProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [resumeConfig, setResumeConfig] = useState<any>(propValue || {})
  
  const setValue = useSubBlockStore((state) => state.setValue)
  const getValue = useSubBlockStore((state) => state.getValue)

  // Sync with store value
  useEffect(() => {
    const storeValue = getValue(blockId, 'webhookResumeConfig')
    if (storeValue !== undefined) {
      setResumeConfig(storeValue)
    }
  }, [blockId, getValue])

  const handleSave = useCallback(
    (config: any) => {
      setResumeConfig(config)
      setValue(blockId, 'webhookResumeConfig', config)
      setIsModalOpen(false)
    },
    [blockId, setValue]
  )

  const hasConfig = resumeConfig && Object.keys(resumeConfig).length > 0

  return (
    <div className='w-full'>
      {hasConfig ? (
        <div className='flex flex-col space-y-2'>
          <div
            className='flex h-10 cursor-pointer items-center justify-center rounded border border-border bg-background px-3 py-2 transition-colors duration-200 hover:bg-accent hover:text-accent-foreground'
            onClick={() => setIsModalOpen(true)}
          >
            <div className='flex items-center gap-2'>
              <div className='flex items-center'>
                <ExternalLink className='mr-2 h-4 w-4' />
                <span className='font-normal text-sm'>Webhook Resume Configured</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          className='flex h-10 w-full items-center bg-background font-normal text-sm'
          onClick={() => setIsModalOpen(true)}
          disabled={disabled || isConnecting}
          type='button'
        >
          <ExternalLink className='mr-2 h-4 w-4' />
          Configure Webhook
        </Button>
      )}

      <WebhookResumeModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        config={resumeConfig}
        onSave={handleSave}
        blockId={blockId}
      />
    </div>
  )
}

