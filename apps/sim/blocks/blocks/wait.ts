import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlock: BlockConfig = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution until resumed by a trigger',
  longDescription:
    'Pauses workflow execution at this point (after all parallel branches finish) and waits to be resumed by a configured trigger. This enables multi-step workflows that span across time or wait for external events.',
  bestPractices: `
  - Use Wait blocks to create approval workflows, where execution pauses until manual approval
  - Configure API triggers to resume workflows programmatically from external systems
  - Use webhook triggers to wait for external events before continuing
  - Schedule triggers can resume workflows at specific times
  - All parallel branches and loops will complete before the workflow pauses at this block
  `,
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: WaitIcon,
  subBlocks: [
    {
      id: 'resumeTriggerType',
      title: 'Resume Type',
      type: 'dropdown',
      layout: 'full',
      description: 'Select how this workflow should be resumed after pausing',
      options: [
        { label: 'After Time Interval', id: 'time' },
        { label: 'On Webhook Call', id: 'webhook' },
      ],
      value: () => 'time',
    },
    // Time interval configuration
    {
      id: 'timeValue',
      title: 'Wait Amount',
      type: 'short-input',
      layout: 'half',
      description: 'How long to wait (max 5 minutes)',
      placeholder: '10',
      value: () => '10',
      condition: { field: 'resumeTriggerType', value: 'time' },
    },
    {
      id: 'timeUnit',
      title: 'Unit',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Seconds', id: 'seconds' },
        { label: 'Minutes', id: 'minutes' },
      ],
      value: () => 'seconds',
      condition: { field: 'resumeTriggerType', value: 'time' },
    },
    // Webhook configuration
    {
      id: 'webhookPath',
      title: 'Webhook Path',
      type: 'short-input',
      layout: 'full',
      description: 'Custom path for the webhook URL (optional)',
      placeholder: '/my-custom-path',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      layout: 'full',
      description: 'Secret for webhook authentication (optional)',
      placeholder: 'your-secret-key',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookInputFormat',
      title: 'Webhook Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the JSON input schema expected from the webhook',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    resumeTriggerType: {
      type: 'string',
      description: 'Type of trigger to resume execution (time or webhook)',
    },
    timeValue: {
      type: 'string',
      description: 'Wait duration value',
    },
    timeUnit: {
      type: 'string',
      description: 'Wait duration unit (seconds or minutes)',
    },
    webhookPath: {
      type: 'string',
      description: 'Custom webhook path',
    },
    webhookSecret: {
      type: 'string',
      description: 'Webhook authentication secret',
    },
    webhookInputFormat: {
      type: 'json',
      description: 'Input format for webhook trigger',
    },
  },
  outputs: {
    pausedAt: {
      type: 'string',
      description: 'ISO timestamp when wait started',
    },
    resumedAt: {
      type: 'string',
      description: 'ISO timestamp when wait completed (for time-based waits)',
    },
    resumeInput: {
      type: 'json',
      description: 'Input data provided when resuming via webhook',
    },
    triggerType: {
      type: 'string',
      description: 'Type of trigger used (time or webhook)',
    },
    resumeUrl: {
      type: 'string',
      description: 'Unique webhook URL to resume this specific execution (only for webhook trigger)',
    },
    waitDuration: {
      type: 'number',
      description: 'Actual wait duration in milliseconds (only for time-based waits)',
    },
    status: {
      type: 'string',
      description: 'Status of the wait block (waiting, resumed, completed)',
    },
    message: {
      type: 'string',
      description: 'Human-readable status message',
    },
  },
}

