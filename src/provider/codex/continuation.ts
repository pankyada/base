const MAX_ITEMS = 64
const MAX_ANCHORS = 128
const MAX_STRING = 512 * 1024
const MAX_SUMMARY_ITEMS = 16
const MAX_ENVELOPE_BYTES = 1_000_000

export interface CodexSummaryItem {
  type: 'summary_text'
  text: string
}

export interface CodexOpaqueItem {
  type: 'reasoning'
  id?: string
  encrypted_content?: string
  summary?: CodexSummaryItem[]
}

export interface CodexContinuation {
  version: 1
  accountGeneration: string
  model: string
  items: CodexOpaqueItem[]
  anchorCallIds: string[]
}

export interface ContinuationValidationOptions {
  accountGeneration?: string
  model?: string
  anchorCallIds?: readonly string[]
}

export function encodeContinuation(value: CodexContinuation): string {
  validateContinuation(value)
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_ENVELOPE_BYTES) throw new Error('Codex continuation exceeds size limit')
  return encoded
}

export function decodeContinuation(value: unknown): CodexContinuation | undefined {
  if (typeof value !== 'string' || value.length > MAX_STRING * 2) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    validateContinuation(parsed)
    return parsed
  } catch {
    return undefined
  }
}

export function validateContinuation(
  value: unknown,
  options: ContinuationValidationOptions = {},
): asserts value is CodexContinuation {
  if (!isRecord(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'accountGeneration', 'model', 'items', 'anchorCallIds'].includes(key))) {
    throw new Error('invalid Codex continuation')
  }

  const accountGeneration = value.accountGeneration
  const model = value.model
  const items = value.items
  const anchors = value.anchorCallIds
  if (!isIdentity(accountGeneration) || !isIdentity(model)) {
    throw new Error('invalid Codex continuation identity')
  }
  if (options.accountGeneration !== undefined && accountGeneration !== options.accountGeneration) {
    throw new Error('Codex continuation belongs to another credential generation')
  }
  if (options.model !== undefined && model !== options.model) {
    throw new Error('Codex continuation belongs to another model')
  }
  if (!Array.isArray(items) || items.length > MAX_ITEMS || !Array.isArray(anchors) || anchors.length > MAX_ANCHORS) {
    throw new Error('invalid Codex continuation bounds')
  }
  for (const anchor of anchors) {
    if (!isIdentity(anchor)) throw new Error('invalid Codex continuation anchor')
  }
  if (new Set(anchors).size !== anchors.length) throw new Error('duplicate Codex continuation anchor')
  if (options.anchorCallIds) {
    const expected = new Set(options.anchorCallIds)
    if (expected.size !== anchors.length) throw new Error('Codex continuation anchors do not match this turn')
    for (const anchor of anchors) {
      if (!expected.has(anchor)) throw new Error('Codex continuation anchor does not belong to this turn')
    }
  }
  for (const item of items) validateItem(item)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ENVELOPE_BYTES) throw new Error('Codex continuation exceeds size limit')
}

function validateItem(value: unknown): asserts value is CodexOpaqueItem {
  if (!isRecord(value) || value.type !== 'reasoning') {
    throw new Error('invalid Codex continuation item')
  }
  for (const key of Object.keys(value)) {
    if (key !== 'type' && key !== 'id' && key !== 'encrypted_content' && key !== 'summary') {
      throw new Error('invalid Codex continuation item field')
    }
  }
  if (value.id !== undefined && !isIdentity(value.id)) {
    throw new Error('invalid Codex continuation item id')
  }
  if (value.encrypted_content !== undefined && !isBoundedString(value.encrypted_content)) {
    throw new Error('invalid Codex continuation encrypted content')
  }
  if (value.summary !== undefined) {
    if (!Array.isArray(value.summary) || value.summary.length > MAX_SUMMARY_ITEMS) {
      throw new Error('invalid Codex continuation summary')
    }
    for (const summary of value.summary) {
      if (!isRecord(summary) || summary.type !== 'summary_text' || !isBoundedText(summary.text)) {
        throw new Error('invalid Codex continuation summary item')
      }
      if (Object.keys(summary).some(key => key !== 'type' && key !== 'text')) {
        throw new Error('invalid Codex continuation summary field')
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING && !/[\u0000\r\n]/.test(value)
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING && !/\u0000/.test(value)
}

function isIdentity(value: unknown): value is string {
  return isBoundedString(value) && value.length <= 512
}
