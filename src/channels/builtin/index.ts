import { registerChannel } from '../registry.js'
import { stdoutChannel } from './stdout.js'
import { webhookChannel } from './webhook.js'

export function registerBuiltinChannels(): void {
  registerChannel(stdoutChannel)
  registerChannel(webhookChannel)
}

