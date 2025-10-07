import type { SVGProps } from 'react'
import { createElement } from 'react'
import { UserCheck } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const UserApprovalIcon = (props: SVGProps<SVGSVGElement>) => createElement(UserCheck, props)

export const UserApprovalBlock: BlockConfig = {
  type: 'user_approval',
  name: 'User Approval',
  description: 'Pause workflow and wait for user approval',
  longDescription:
    'Pauses workflow execution and waits for manual approval from a user. Once approved (or rejected), the workflow continues with the approval decision. Perfect for human-in-the-loop workflows requiring manual review.',
  bestPractices: `
  - Use User Approval blocks for workflows that require human review or decision-making
  - Add a clear description explaining what needs to be approved
  - Use input forms to collect approval comments or additional data
  - Configure webhook triggers for external approval systems
  - All parallel branches and loops will complete before the workflow pauses at this block
  `,
  category: 'blocks',
  bgColor: '#10B981',
  icon: UserApprovalIcon,
  subBlocks: [
    {
      id: 'resumeTriggerType',
      title: 'Resume Trigger',
      type: 'dropdown',
      layout: 'full',
      description: 'Select how this workflow should be resumed after pausing',
      options: [
        { label: 'Manual', id: 'manual' },
        { label: 'API', id: 'api' },
        { label: 'Webhook', id: 'webhook' },
        { label: 'Schedule', id: 'schedule' },
        { label: 'Input Form', id: 'input' },
      ],
      value: () => 'manual',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      layout: 'full',
      description: 'Optional description of what needs approval and what should trigger resumption',
      placeholder: 'E.g., "Waiting for manager approval" or "Waiting for customer confirmation"',
    },
    // Manual trigger - show resume button in block UI
    {
      id: 'waitStatus',
      title: 'Approval Status',
      type: 'wait-status',
      layout: 'full',
      description: 'Current pause/approval status and controls',
      condition: { field: 'resumeTriggerType', value: 'manual' },
    },
    // Input Form trigger configuration
    {
      id: 'inputInputFormat',
      title: 'Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the input schema for resuming with an input form',
      condition: { field: 'resumeTriggerType', value: 'input' },
    },
    // API trigger configuration
    {
      id: 'apiInputFormat',
      title: 'API Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the JSON input schema for resuming via API',
      condition: { field: 'resumeTriggerType', value: 'api' },
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
    // Schedule configuration
    {
      id: 'scheduleType',
      title: 'Schedule Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Every X Minutes', id: 'minutes' },
        { label: 'Hourly', id: 'hourly' },
        { label: 'Daily', id: 'daily' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Monthly', id: 'monthly' },
        { label: 'Custom Cron', id: 'custom' },
      ],
      value: () => 'daily',
      condition: { field: 'resumeTriggerType', value: 'schedule' },
    },
    {
      id: 'minutesInterval',
      title: 'Interval (minutes)',
      type: 'short-input',
      layout: 'full',
      placeholder: '5',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'minutes' },
      },
    },
    {
      id: 'hourlyMinute',
      title: 'Minute (0-59)',
      type: 'short-input',
      layout: 'full',
      placeholder: '0',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'hourly' },
      },
    },
    {
      id: 'dailyTime',
      title: 'Time (HH:MM)',
      type: 'short-input',
      layout: 'full',
      placeholder: '09:00',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'daily' },
      },
    },
    {
      id: 'weeklyDay',
      title: 'Day of Week',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Monday', id: 'MON' },
        { label: 'Tuesday', id: 'TUE' },
        { label: 'Wednesday', id: 'WED' },
        { label: 'Thursday', id: 'THU' },
        { label: 'Friday', id: 'FRI' },
        { label: 'Saturday', id: 'SAT' },
        { label: 'Sunday', id: 'SUN' },
      ],
      value: () => 'MON',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'weekly' },
      },
    },
    {
      id: 'weeklyTime',
      title: 'Time (HH:MM)',
      type: 'short-input',
      layout: 'full',
      placeholder: '09:00',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'weekly' },
      },
    },
    {
      id: 'monthlyDay',
      title: 'Day of Month (1-31)',
      type: 'short-input',
      layout: 'full',
      placeholder: '1',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'monthly' },
      },
    },
    {
      id: 'monthlyTime',
      title: 'Time (HH:MM)',
      type: 'short-input',
      layout: 'full',
      placeholder: '09:00',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'monthly' },
      },
    },
    {
      id: 'cronExpression',
      title: 'Cron Expression',
      type: 'short-input',
      layout: 'full',
      placeholder: '0 9 * * *',
      condition: {
        field: 'resumeTriggerType',
        value: 'schedule',
        and: { field: 'scheduleType', value: 'custom' },
      },
    },
    {
      id: 'scheduleTimezone',
      title: 'Timezone',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'UTC', id: 'UTC' },
        { label: 'US Eastern', id: 'America/New_York' },
        { label: 'US Central', id: 'America/Chicago' },
        { label: 'US Mountain', id: 'America/Denver' },
        { label: 'US Pacific', id: 'America/Los_Angeles' },
        { label: 'London', id: 'Europe/London' },
        { label: 'Paris', id: 'Europe/Paris' },
        { label: 'Singapore', id: 'Asia/Singapore' },
        { label: 'Tokyo', id: 'Asia/Tokyo' },
        { label: 'Sydney', id: 'Australia/Sydney' },
      ],
      value: () => 'UTC',
      condition: { field: 'resumeTriggerType', value: 'schedule' },
    },
    // Mock response for client-side testing
    {
      id: 'mockResponse',
      title: '🧪 Mock Response (Testing)',
      type: 'code',
      layout: 'full',
      language: 'json',
      description: 'Optional: Mock approval data for manual runs from the client. When filled, the approval block will immediately continue with this data instead of waiting. No external systems will be contacted.',
      placeholder: '{\n  "approved": true,\n  "approver": "test-user",\n  "comment": "Test approval"\n}',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    resumeTriggerType: {
      type: 'string',
      description: 'Type of trigger to resume execution',
    },
    description: {
      type: 'string',
      description: 'Description of what needs approval',
    },
    inputInputFormat: {
      type: 'json',
      description: 'Input format for input form trigger',
    },
    apiInputFormat: {
      type: 'json',
      description: 'Input format for API trigger',
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
    scheduleType: {
      type: 'string',
      description: 'Schedule type (minutes, hourly, daily, etc.)',
    },
    minutesInterval: {
      type: 'string',
      description: 'Interval in minutes',
    },
    hourlyMinute: {
      type: 'string',
      description: 'Minute of the hour (0-59)',
    },
    dailyTime: {
      type: 'string',
      description: 'Time of day (HH:MM)',
    },
    weeklyDay: {
      type: 'string',
      description: 'Day of the week',
    },
    weeklyTime: {
      type: 'string',
      description: 'Time on weekly day',
    },
    monthlyDay: {
      type: 'string',
      description: 'Day of the month (1-31)',
    },
    monthlyTime: {
      type: 'string',
      description: 'Time on monthly day',
    },
    cronExpression: {
      type: 'string',
      description: 'Custom cron expression',
    },
    scheduleTimezone: {
      type: 'string',
      description: 'Timezone for schedule',
    },
    mockResponse: {
      type: 'json',
      description: 'Mock approval data for client-side testing',
    },
  },
  outputs: {
    webhook: {
      type: 'json',
      description: 'Approval data provided when resuming. When using mock response in client testing, this contains the mock data.',
    },
    waitDuration: {
      type: 'number',
      description: 'Wait duration in milliseconds',
    },
    status: {
      type: 'string',
      description: 'Status of the approval (waiting, approved, rejected, timeout, cancelled)',
    },
  },
}

