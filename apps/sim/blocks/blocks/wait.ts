import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlock: BlockConfig = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution with time delay or webhook trigger',
  longDescription:
    'Pauses workflow execution for a specified time interval or until a webhook is received. Time-based waits execute a simple sleep. Webhook waits pause the workflow and provide two webhook capabilities: an incoming webhook URL to resume execution and an optional outgoing webhook to notify external systems when the workflow pauses.',
  bestPractices: `
  - Use "After Time Interval" to add delays between workflow steps (max 5 minutes)
  - Use "On Webhook Call" to pause until an external system triggers resumption
  - Resume Configuration: The unique webhook URL and secret for resuming this specific execution
  - Notification Configuration: Optional webhook to notify external systems when workflow pauses
  - Always set a webhook secret for security when using webhook triggers
  - Add headers like Authorization, API keys, etc. in the Headers table
  - Notification webhooks automatically retry on failure (5xx or 429 errors)
  - Time-based waits are interruptible - cancelling the workflow will stop the wait
  - All parallel branches complete before the workflow pauses at this block
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
    // Resume webhook configuration (incoming)
    {
      id: 'webhookStatus',
      title: '🔙 Resume Webhook URL',
      type: 'wait-status',
      layout: 'full',
      description: 'The webhook URL will be generated when the workflow pauses',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSecret',
      title: '🔑 Resume Webhook Secret',
      type: 'short-input',
      layout: 'full',
      description: 'Secret that must be provided in X-Sim-Secret header to resume',
      placeholder: 'your-resume-secret',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
      required: true,
    },
    // Notification webhook configuration (outgoing)
    {
      id: 'webhookSendUrl',
      title: '📤 Notification URL',
      type: 'long-input',
      layout: 'full',
      description: 'Optional: Send a webhook notification when workflow pauses',
      placeholder: 'https://example.com/webhook',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendMethod',
      title: 'HTTP Method',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'POST', id: 'POST' },
        { label: 'PUT', id: 'PUT' },
        { label: 'PATCH', id: 'PATCH' },
      ],
      value: () => 'POST',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendParams',
      title: 'Query Params',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      description: 'URL query parameters to append',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendHeaders',
      title: 'Headers',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      description: 'Headers to include (e.g., Authorization, Content-Type, API keys)',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendBody',
      title: 'Notification Body',
      type: 'code',
      layout: 'full',
      language: 'json',
      description: 'JSON body to send. Use {{resumeUrl}}, {{workflowId}}, {{executionId}} as templates.',
      placeholder: '{\n  "event": "workflow_paused",\n  "resumeUrl": "{{resumeUrl}}",\n  "workflowId": "{{workflowId}}",\n  "executionId": "{{executionId}}"\n}',
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
    webhookSecret: {
      type: 'string',
      description: 'Webhook authentication secret for resuming',
    },
    webhookSendUrl: {
      type: 'string',
      description: 'URL to send webhook notification when pausing',
    },
    webhookSendMethod: {
      type: 'string',
      description: 'HTTP method for sending webhook',
    },
    webhookSendParams: {
      type: 'json',
      description: 'Query parameters to send with the webhook',
    },
    webhookSendHeaders: {
      type: 'json',
      description: 'Headers to send with the webhook',
    },
    webhookSendBody: {
      type: 'json',
      description: 'Body to send with the webhook',
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
    webhookSent: {
      type: 'boolean',
      description: 'Whether a webhook was successfully sent (only for webhook trigger)',
    },
    webhookResponse: {
      type: 'json',
      description: 'Response from the webhook endpoint (only for webhook trigger)',
    },
  },
}

