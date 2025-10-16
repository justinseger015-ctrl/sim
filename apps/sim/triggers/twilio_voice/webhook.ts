import { TwilioIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

/**
 * Normalize Twilio Voice config to only include valid fields
 * This prevents errors when loading configs from other providers
 */
export function normalizeTwilioVoiceConfig(config: Record<string, any>): Record<string, any> {
  const validFields = ['accountSid', 'authToken', 'twimlResponse']
  const normalized: Record<string, any> = {}

  // If config has fields that suggest it's from another provider, clear everything
  const invalidProviderFields = [
    'email',
    'password',
    'username',
    'apiKey',
    'api_key',
    'botToken',
    'signingSecret',
    'verificationToken',
    'hmacSecret',
    'clientId',
    'clientSecret',
    'credential',
    'credentialId',
  ]

  const hasInvalidFields = invalidProviderFields.some((field) => field in config)
  if (hasInvalidFields) {
    // Config is from another provider, return empty to force fresh configuration
    return {}
  }

  // Only keep valid Twilio Voice fields
  for (const field of validFields) {
    if (field in config) {
      normalized[field] = config[field]
    }
  }

  return normalized
}

export const twilioVoiceWebhookTrigger: TriggerConfig = {
  id: 'twilio_voice_webhook',
  name: 'Twilio Voice Webhook',
  provider: 'twilio_voice',
  description: 'Trigger workflow when phone calls are received via Twilio Voice',
  version: '1.0.0',
  icon: TwilioIcon,

  configFields: {
    accountSid: {
      type: 'string',
      label: 'Twilio Account SID',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      description: 'Your Twilio Account SID from the Twilio Console',
      required: true,
      isSecret: false,
    },
    authToken: {
      type: 'string',
      label: 'Auth Token',
      placeholder: 'Your Twilio Auth Token',
      description: 'Your Twilio Auth Token for webhook signature verification',
      required: true,
      isSecret: true,
    },
    twimlResponse: {
      type: 'textarea',
      label: 'TwiML Response',
      placeholder: '<Response><Say>Please hold.</Say></Response>',
      description:
        'TwiML XML to return immediately to Twilio. This controls what happens when the call comes in (e.g., play a message, record, gather input). Your workflow will execute in the background.',
      required: false,
    },
  },

  outputs: {
    callSid: {
      type: 'string',
      description: 'Unique identifier for this call',
    },
    accountSid: {
      type: 'string',
      description: 'Twilio Account SID',
    },
    from: {
      type: 'string',
      description: "Caller's phone number (E.164 format)",
    },
    to: {
      type: 'string',
      description: 'Recipient phone number (your Twilio number)',
    },
    callStatus: {
      type: 'string',
      description: 'Status of the call (queued, ringing, in-progress, completed, etc.)',
    },
    direction: {
      type: 'string',
      description: 'Call direction: inbound or outbound',
    },
    apiVersion: {
      type: 'string',
      description: 'Twilio API version',
    },
    callerName: {
      type: 'string',
      description: 'Caller ID name if available',
    },
    forwardedFrom: {
      type: 'string',
      description: 'Phone number that forwarded this call',
    },
    digits: {
      type: 'string',
      description: 'DTMF digits entered by caller (from <Gather>)',
    },
    speechResult: {
      type: 'string',
      description: 'Speech recognition result (if using <Gather> with speech)',
    },
    recordingUrl: {
      type: 'string',
      description: 'URL of call recording if available',
    },
    recordingSid: {
      type: 'string',
      description: 'Recording SID if available',
    },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Twilio as JSON string',
    },
  },

  instructions: [
    'Enter a <strong>TwiML Response</strong> above - this tells Twilio what to do when a call comes in (e.g., play a message, record, gather input).',
    'Example TwiML for recording with transcription: <code>&lt;Response&gt;&lt;Say&gt;Please leave a message.&lt;/Say&gt;&lt;Record transcribe="true" maxLength="120"/&gt;&lt;/Response&gt;</code>',
    'Go to your <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer" class="text-muted-foreground underline transition-colors hover:text-muted-foreground/80">Twilio Console Phone Numbers</a> page.',
    'Select the phone number you want to use for incoming calls.',
    'Scroll down to the "Voice Configuration" section.',
    'In the "A CALL COMES IN" field, select "Webhook" and paste the <strong>Webhook URL</strong> (from above).',
    'Ensure the HTTP method is set to <strong>POST</strong>.',
    'Click "Save configuration".',
    '<strong>How it works:</strong> When a call comes in, Twilio receives your TwiML response immediately and executes those instructions. Your workflow runs in the background with access to caller information, call status, and any recorded/transcribed data.',
  ],

  samplePayload: {
    CallSid: 'CA_NOT_A_REAL_SID',
    AccountSid: 'AC_NOT_A_REAL_SID',
    From: '+14155551234',
    To: '+14155556789',
    CallStatus: 'ringing',
    ApiVersion: '2010-04-01',
    Direction: 'inbound',
    ForwardedFrom: '',
    CallerName: 'John Doe',
    FromCity: 'SAN FRANCISCO',
    FromState: 'CA',
    FromZip: '94105',
    FromCountry: 'US',
    ToCity: 'SAN FRANCISCO',
    ToState: 'CA',
    ToZip: '94105',
    ToCountry: 'US',
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  },
}
