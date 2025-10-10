import type { SVGProps } from 'react'
import { createElement } from 'react'
import { UserCheck } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const UserApprovalIcon = (props: SVGProps<SVGSVGElement>) => createElement(UserCheck, props)

export const UserApprovalBlock: BlockConfig = {
  type: 'user_approval',
  name: 'Human in the Loop',
  description: 'Pause workflow and wait for webhook trigger or human approval',
  longDescription:
    'Pauses workflow execution for manual approval, API approval, or webhook trigger. Human mode generates one-time approval links. API mode creates authenticated endpoints for programmatic approval. Webhook waits generate resume URLs with optional notifications. Perfect for human-in-the-loop workflows requiring manual review or external system coordination.',
  bestPractices: `
  - Use "Human" for one-time approval links (works in both deployed and non-deployed workflows)
  - Use "API" for programmatic approval via authenticated API endpoints (requires workflow to be deployed)
  - Use "Webhook" to pause until an external system triggers resumption
  - For API mode: Define your input schema with the fields you want to accept
  - Always set a webhook secret for security when using webhook mode
  - Optionally configure a notification webhook to alert external systems when the workflow pauses
  - Use mock response for client-side testing without triggering real webhooks
  - Access the resumeUrl/approveUrl outputs to share URLs with external systems
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
        { label: 'Human', id: 'human' },
        { label: 'API', id: 'api' },
        { label: 'Webhook', id: 'webhook' },
      ],
      value: () => 'human',
    },
    // Human mode operation type
    {
      id: 'humanOperation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Approval', id: 'approval' },
        { label: 'Custom', id: 'custom' },
      ],
      value: () => 'approval',
      description: 'Choose the type of human interaction',
      condition: { field: 'resumeTriggerType', value: 'human' },
    },
    // Custom input format for Human mode
    {
      id: 'humanInputFormat',
      title: 'Form Fields',
      type: 'input-format',
      layout: 'full',
      description: 'Define the form fields that the user will fill out',
      condition: {
        field: 'resumeTriggerType',
        value: 'human',
        and: { field: 'humanOperation', value: 'custom' },
      },
    },
    // Notification tool
    {
      id: 'notificationTool',
      title: 'Send Notification',
      type: 'tool-input',
      layout: 'full',
      description: 'Configure a tool to send the approval link notification',
      condition: { field: 'resumeTriggerType', value: 'human' },
    },
    // Content to evaluate
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      description: 'Structure what you want to evaluate. Reference variables and format the information for human review. You can reference previous block outputs and format the information for easy review.',
      condition: { field: 'resumeTriggerType', value: 'human' },
    },
    // Full approval view toggle (only in advanced mode)
    {
      id: 'fullApprovalView',
      title: 'Full Approval View',
      type: 'switch',
      layout: 'full',
      mode: 'advanced',
      description: 'Show frozen canvas and execution logs on the approval page. When disabled, shows a simplified view with only the content and approval controls.',
      condition: { field: 'resumeTriggerType', value: 'human' },
      defaultValue: true, // Default to true (show full view)
    },
    // API input format configuration
    {
      id: 'apiInputFormat',
      title: 'API Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the JSON schema for the API resume payload. You can add any custom fields here.',
      condition: { field: 'resumeTriggerType', value: 'api' },
    },
    // API response configuration
    {
      id: 'apiResponseMode',
      title: 'Response Data Mode',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Builder', id: 'structured' },
        { label: 'Editor', id: 'json' },
      ],
      value: () => 'structured',
      description: 'Choose how to define the data returned when this block executes',
      condition: { field: 'resumeTriggerType', value: 'api' },
    },
    {
      id: 'apiBuilderResponse',
      title: 'Response Structure',
      type: 'response-format',
      layout: 'full',
      condition: {
        field: 'resumeTriggerType',
        value: 'api',
        and: { field: 'apiResponseMode', value: 'structured' },
      },
      description:
        'Define what data this block returns when executed. Use <variable.name> to reference workflow variables or API inputs.',
    },
    {
      id: 'apiEditorResponse',
      title: 'Response Data',
      type: 'code',
      layout: 'full',
      placeholder: '',
      language: 'json',
      condition: {
        field: 'resumeTriggerType',
        value: 'api',
        and: { field: 'apiResponseMode', value: 'json' },
      },
      description:
        'Define what data this block returns when executed. Use <api.fieldName> to reference API input fields, or <variable.name> for other workflow variables.',
    },
    {
      id: 'apiStatus',
      title: 'Status Code',
      type: 'short-input',
      layout: 'half',
      placeholder: '200',
      description: 'HTTP status code (default: 200)',
      condition: { field: 'resumeTriggerType', value: 'api' },
    },
    {
      id: 'apiHeaders',
      title: 'Response Headers',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
      description: 'Additional HTTP headers to include in the response',
      condition: { field: 'resumeTriggerType', value: 'api' },
    },
    // Webhook resume configuration
    {
      id: 'webhookResumeConfig',
      title: 'Configure Trigger',
      type: 'webhook-resume-config',
      layout: 'full',
      description: 'Configure how external systems can resume this workflow',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
    // Notification webhook configuration section
    {
      id: 'webhookSendUrl',
      title: 'Notification Webhook URL (Optional)',
      type: 'long-input',
      layout: 'full',
      description: 'Optionally send a notification to an external webhook when the workflow pauses. Configure the URL, method, headers, and body below.',
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
    {
      id: 'webhookSendBody',
      title: 'Body',
      type: 'code',
      layout: 'full',
      language: 'json',
      description: 'Use {{resumeUrl}}, {{workflowId}}, {{executionId}} as placeholders',
      placeholder: '',
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
      placeholder: '',
      condition: { field: 'resumeTriggerType', value: 'webhook' },
    },
  ],
  tools: {
    access: [
      'gmail_send',
      'outlook_send_email',
      'slack_message',
      'discord_send_message',
      'telegram_send_message',
      'twilio_send_sms',
      'whatsapp_send_message',
    ],
  },
  inputs: {
    resumeTriggerType: {
      type: 'string',
      description: 'Type of trigger to resume execution (human, api, or webhook)',
    },
    webhookResumeConfig: {
      type: 'json',
      description: 'Webhook resume configuration including auth settings',
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
    humanOperation: {
      type: 'string',
      description: 'Type of human operation (approval or custom)',
    },
    humanInputFormat: {
      type: 'json',
      description: 'Input schema for custom form fields in Human mode',
    },
    notificationTool: {
      type: 'json',
      description: 'Tool configuration for sending approval notifications',
    },
    content: {
      type: 'string',
      description: 'Content to display to the approver for evaluation',
    },
    fullApprovalView: {
      type: 'boolean',
      description: 'Show frozen canvas and execution logs on approval page',
    },
    apiInputFormat: {
      type: 'json',
      description: 'Input schema for API resume type',
    },
    apiResponseMode: {
      type: 'string',
      description: 'Response data mode for API resume (structured or json)',
    },
    apiBuilderResponse: {
      type: 'json',
      description: 'Structured response data for API resume (builder mode)',
    },
    apiEditorResponse: {
      type: 'json',
      description: 'JSON response data for API resume (editor mode)',
    },
    apiStatus: {
      type: 'number',
      description: 'HTTP status code for API resume response',
    },
    apiHeaders: {
      type: 'json',
      description: 'HTTP headers for API resume response',
    },
  },
  outputs: {
    // Dynamic outputs - actual outputs are determined by getBlockOutputs() in lib/workflows/block-outputs.ts
    // based on resumeTriggerType, humanOperation, and input formats
    // 
    // Base outputs that may be available:
    approved: {
      type: 'boolean',
      description: 'Whether approved or rejected (Human - Approval mode only)',
    },
    approveUrl: {
      type: 'string',
      description: 'One-time approval URL (Human mode)',
    },
    content: {
      type: 'string',
      description: 'Content displayed to the approver for evaluation',
    },
    resumeUrl: {
      type: 'string',
      description: 'API/Webhook endpoint to resume workflow (API/Webhook modes)',
    },
    waitDuration: {
      type: 'number',
      description: 'Time taken for approval/resume in ms',
    },
    webhook: {
      type: 'json',
      description: 'Webhook payload data (Webhook mode)',
    },
    // Additional dynamic outputs from humanInputFormat, apiInputFormat will be added at runtime
  },
}

