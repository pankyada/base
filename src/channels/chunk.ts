import type { ChannelCapabilities, ChannelMessage } from './types.js'

function stripRich(text: string): string {
  return text.replace(/[*_`~]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

function splitAt(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const paragraph = rest.lastIndexOf('\n\n', limit)
    const sentence = Math.max(rest.lastIndexOf('. ', limit), rest.lastIndexOf('! ', limit), rest.lastIndexOf('? ', limit))
    const cut = paragraph > limit * 0.4 ? paragraph + 2 : sentence > limit * 0.4 ? sentence + 1 : limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export function prepareChannelMessages(message: ChannelMessage, capabilities: ChannelCapabilities): ChannelMessage[] {
  let text = capabilities.rich ? message.text : stripRich(message.text)
  const files = capabilities.files ? message.files : message.files?.map(file => ({ path: file.path, name: file.name }))
  if (!capabilities.files && message.files?.length) {
    text += `\n${message.files.map(file => `[file: ${file.name ?? file.path}]`).join('\n')}`
  }
  let buttons = message.buttons
  if (buttons?.length && !capabilities.buttons) {
    text += `\n${buttons.map((button, index) => `${index + 1}. ${button.label}`).join('\n')}`
    buttons = undefined
  }
  const chunks = splitAt(text, capabilities.max_chars ?? Number.MAX_SAFE_INTEGER)
  return chunks.map((chunk, index) => ({
    ...message,
    text: chunk,
    buttons: index === chunks.length - 1 ? buttons : undefined,
    files: index === chunks.length - 1 ? files : undefined,
  }))
}

