import type { SVGProps } from 'react'
import { createElement } from 'react'
import { UserCheck } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const UserApprovalIcon = (props: SVGProps<SVGSVGElement>) => createElement(UserCheck, props)

export const UserApprovalBlock: BlockConfig = {
  type: 'user_approval',
  name: 'Human in the Loop',
  description: 'Pause workflow and wait for webhook trigger or time delay',
  longDescription:
    'Pauses workflow execution for a specified time interval or until a webhook is received. Time-based waits execute a simple sleep. Webhook waits generate a unique resume URL and optionally send notifications to external systems. Perfect for human-in-the-loop workflows requiring manual review or external system coordination.',
  bestPractices: `
  - Use "Time Interval" for simple delays (max 5 minutes)
  - Use "Webhook" to pause until an external system or user triggers resumption
  - Always set a webhook secret for security when using webhook mode
  - Optionally configure a notification webhook to alert external systems when the workflow pauses
  - Use mock response for client-side testing without triggering real webhooks
  - Access the resumeUrl output to share the webhook URL with external systems
  `,
  category: 'blocks',
  bgColor: '#10B981',
  icon: UserApprovalIcon,
  subBlocks: [
    {
      id: 'resumeTriggerType',
      title: 'Resume Type',
      type: 'dropdown',
      layout: 'full',
      description: 'Select how this workflow should be resumed after pausing',
      options: [
        { label: 'Time Interval', id: 'time' },
        { label: 'Webhook', id: 'webhook' },
        { label: 'Human', id: 'human' },
      ],
      value: () => 'human',
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
    // Security
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      layout: 'full',
      description: 'Required secret for webhook authentication (X-Sim-Secret header)',
      placeholder: 'your-secret-key',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
      required: true,
    },
    // Notification webhook (optional)
    {
      id: 'webhookSendUrl',
      title: 'Notification Webhook URL',
      type: 'long-input',
      layout: 'full',
      description: 'Send a notification when workflow pauses (optional)',
      placeholder: 'https://example.com/notify',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendMethod',
      title: 'Method',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'POST', id: 'POST' },
        { label: 'PUT', id: 'PUT' },
        { label: 'PATCH', id: 'PATCH' },
      ],
      value: () => 'POST',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendBody',
      title: 'Body',
      type: 'code',
      layout: 'full',
      language: 'json',
      description: 'Use {{resumeUrl}}, {{workflowId}}, {{executionId}} as placeholders',
      placeholder: '{\n  "resumeUrl": "{{resumeUrl}}"\n}',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendHeaders',
      title: 'Headers',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    {
      id: 'webhookSendParams',
      title: 'Query Parameters',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    // Testing
    {
      id: 'mockResponse',
      title: 'Mock Response',
      type: 'code',
      layout: 'full',
      language: 'json',
      description: 'For client testing: provide mock data to skip waiting',
      placeholder: '{\n  "approved": true\n}',
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
    mockResponse: {
      type: 'json',
      description: 'Mock webhook data for client-side testing',
    },
  },
  outputs: {
    webhook: {
      type: 'json',
      description: 'Payload data from the webhook that resumed the workflow. When using mock response in client testing, this contains the mock data.',
    },
    waitDuration: {
      type: 'number',
      description: 'Wait duration in milliseconds (for time-based waits)',
    },
    status: {
      type: 'string',
      description: 'Status of the wait block (waiting, resumed, completed, cancelled, timeout)',
    },
    resumeUrl: {
      type: 'string',
      description: 'The unique URL that can be used to resume the workflow',
    },
    approveUrl: {
      type: 'string',
      description: 'One-time approval URL for human review (only available in Human mode)',
    },
    approved: {
      type: 'boolean',
      description: 'Whether the human approved (true) or rejected (false)',
    },
  },
}

