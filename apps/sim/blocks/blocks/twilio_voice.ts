import { TwilioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const TwilioVoiceBlock: BlockConfig<ToolResponse> = {
  type: 'twilio_voice',
  name: 'Twilio Voice',
  description: 'Make and manage phone calls',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Twilio Voice into the workflow. Make outbound calls and retrieve call recordings.',
  category: 'tools',
  bgColor: '#F22F46', // Twilio brand color
  icon: TwilioIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Make Call', id: 'make_call' },
        { label: 'List Calls', id: 'list_calls' },
        { label: 'Get Recording', id: 'get_recording' },
      ],
      value: () => 'make_call',
    },
    // Common credentials
    {
      id: 'accountSid',
      title: 'Twilio Account SID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      required: true,
    },
    {
      id: 'authToken',
      title: 'Auth Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Twilio Auth Token',
      password: true,
      required: true,
    },
    // Make Call fields
    {
      id: 'to',
      title: 'To Phone Number',
      type: 'short-input',
      layout: 'half',
      placeholder: '+14155551234',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
      required: true,
    },
    {
      id: 'from',
      title: 'From Twilio Number',
      type: 'short-input',
      layout: 'half',
      placeholder: '+14155556789',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
      required: true,
    },
    {
      id: 'url',
      title: 'TwiML URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'https://example.com/twiml',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'twiml',
      title: 'TwiML Instructions',
      type: 'long-input',
      layout: 'full',
      placeholder: '<Response><Say>Hello from Twilio!</Say></Response>',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'record',
      title: 'Record Call',
      type: 'switch',
      layout: 'half',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: '60',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'statusCallback',
      title: 'Status Callback URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'https://example.com/status',
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    {
      id: 'machineDetection',
      title: 'Machine Detection',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Disabled', id: '' },
        { label: 'Enable', id: 'Enable' },
        { label: 'Detect Message End', id: 'DetectMessageEnd' },
      ],
      condition: {
        field: 'operation',
        value: 'make_call',
      },
    },
    // List Calls fields
    {
      id: 'listTo',
      title: 'Filter by To Number',
      type: 'short-input',
      layout: 'half',
      placeholder: '+14155551234',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'listFrom',
      title: 'Filter by From Number',
      type: 'short-input',
      layout: 'half',
      placeholder: '+14155556789',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'listStatus',
      title: 'Filter by Status',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'All', id: '' },
        { label: 'Queued', id: 'queued' },
        { label: 'Ringing', id: 'ringing' },
        { label: 'In Progress', id: 'in-progress' },
        { label: 'Completed', id: 'completed' },
        { label: 'Failed', id: 'failed' },
        { label: 'Busy', id: 'busy' },
        { label: 'No Answer', id: 'no-answer' },
        { label: 'Canceled', id: 'canceled' },
      ],
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'listPageSize',
      title: 'Page Size',
      type: 'short-input',
      layout: 'half',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'startTimeAfter',
      title: 'Start Time After (YYYY-MM-DD)',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-01-01',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    {
      id: 'startTimeBefore',
      title: 'Start Time Before (YYYY-MM-DD)',
      type: 'short-input',
      layout: 'half',
      placeholder: '2025-12-31',
      condition: {
        field: 'operation',
        value: 'list_calls',
      },
    },
    // Get Recording fields
    {
      id: 'recordingSid',
      title: 'Recording SID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      condition: {
        field: 'operation',
        value: 'get_recording',
      },
      required: true,
    },
    // TRIGGER MODE: Trigger configuration (only shown when trigger mode is active)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'twilio_voice',
      availableTriggers: ['twilio_voice_webhook'],
    },
  ],
  tools: {
    access: ['twilio_voice_make_call', 'twilio_voice_list_calls', 'twilio_voice_get_recording'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'make_call':
            return 'twilio_voice_make_call'
          case 'list_calls':
            return 'twilio_voice_list_calls'
          case 'get_recording':
            return 'twilio_voice_get_recording'
          default:
            return 'twilio_voice_make_call'
        }
      },
      params: (params) => {
        const { operation, timeout, record, listTo, listFrom, listStatus, listPageSize, ...rest } =
          params

        const baseParams = { ...rest }

        // Convert timeout string to number for make_call
        if (operation === 'make_call' && timeout) {
          baseParams.timeout = Number.parseInt(timeout, 10)
        }

        // Convert record to proper boolean for make_call
        if (operation === 'make_call' && record !== undefined && record !== null) {
          // Handle various input types: boolean, string, number
          if (typeof record === 'string') {
            baseParams.record = record.toLowerCase() === 'true' || record === '1'
          } else if (typeof record === 'number') {
            baseParams.record = record !== 0
          } else {
            baseParams.record = Boolean(record)
          }
        }

        // Map list_calls specific fields
        if (operation === 'list_calls') {
          if (listTo) baseParams.to = listTo
          if (listFrom) baseParams.from = listFrom
          if (listStatus) baseParams.status = listStatus
          if (listPageSize) baseParams.pageSize = Number.parseInt(listPageSize, 10)
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Voice operation to perform' },
    accountSid: { type: 'string', description: 'Twilio Account SID' },
    authToken: { type: 'string', description: 'Twilio Auth Token' },
    to: { type: 'string', description: 'Destination phone number' },
    from: { type: 'string', description: 'Source Twilio number' },
    url: { type: 'string', description: 'TwiML URL' },
    twiml: { type: 'string', description: 'TwiML instructions' },
    record: { type: 'boolean', description: 'Record the call' },
    timeout: { type: 'string', description: 'Call timeout in seconds' },
    statusCallback: { type: 'string', description: 'Status callback URL' },
    machineDetection: { type: 'string', description: 'Answering machine detection' },
    listTo: { type: 'string', description: 'Filter calls by To number' },
    listFrom: { type: 'string', description: 'Filter calls by From number' },
    listStatus: { type: 'string', description: 'Filter calls by status' },
    listPageSize: { type: 'string', description: 'Number of calls to return per page' },
    startTimeAfter: { type: 'string', description: 'Filter calls that started after this date' },
    startTimeBefore: { type: 'string', description: 'Filter calls that started before this date' },
    recordingSid: { type: 'string', description: 'Recording SID to retrieve' },
  },
  outputs: {
    // Tool outputs (when using voice operations)
    success: { type: 'boolean', description: 'Operation success status' },
    callSid: { type: 'string', description: 'Call unique identifier' },
    status: { type: 'string', description: 'Call or recording status' },
    direction: { type: 'string', description: 'Call direction' },
    duration: { type: 'number', description: 'Call/recording duration in seconds' },
    price: { type: 'string', description: 'Cost of the operation' },
    priceUnit: { type: 'string', description: 'Currency of the price' },
    recordingSid: { type: 'string', description: 'Recording unique identifier' },
    channels: { type: 'number', description: 'Number of recording channels' },
    source: { type: 'string', description: 'Recording source' },
    mediaUrl: { type: 'string', description: 'URL to download recording' },
    uri: { type: 'string', description: 'Resource URI' },
    transcriptionText: {
      type: 'string',
      description: 'Transcribed text (only if TwiML includes <Record transcribe="true">)',
    },
    transcriptionStatus: {
      type: 'string',
      description: 'Transcription status (completed, in-progress, failed)',
    },
    calls: { type: 'array', description: 'Array of call objects (for list_calls operation)' },
    total: { type: 'number', description: 'Total number of calls returned' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of calls per page' },
    error: { type: 'string', description: 'Error message if operation failed' },
    // Trigger outputs (when used as webhook trigger for incoming calls)
    accountSid: { type: 'string', description: 'Twilio Account SID from webhook' },
    from: { type: 'string', description: "Caller's phone number (E.164 format)" },
    to: { type: 'string', description: 'Recipient phone number (your Twilio number)' },
    callStatus: {
      type: 'string',
      description: 'Status of the incoming call (queued, ringing, in-progress, completed, etc.)',
    },
    apiVersion: { type: 'string', description: 'Twilio API version' },
    callerName: { type: 'string', description: 'Caller ID name if available' },
    forwardedFrom: { type: 'string', description: 'Phone number that forwarded this call' },
    digits: { type: 'string', description: 'DTMF digits entered by caller (from <Gather>)' },
    speechResult: { type: 'string', description: 'Speech recognition result (if using <Gather>)' },
    recordingUrl: { type: 'string', description: 'URL of call recording if available' },
    raw: { type: 'string', description: 'Complete raw webhook payload as JSON string' },
  },
  triggers: {
    enabled: true,
    available: ['twilio_voice_webhook'],
  },
}
