import type { ValidateFunction } from 'ajv'

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; kind: 'parse' | 'validation'; error: string }

/** Strip a ```json ...``` fence if present, JSON.parse, then optionally ajv-validate. */
export function parseJsonContract(raw: string, validator?: ValidateFunction): ParseResult {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const toParse = fenceMatch ? fenceMatch[1] : raw.trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(toParse)
  } catch {
    return { ok: false, kind: 'parse', error: `non-JSON output: ${raw.slice(0, 200)}` }
  }

  if (validator && !validator(parsed)) {
    const errs = (validator.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')
    return { ok: false, kind: 'validation', error: `output validation failed: ${errs}` }
  }

  return { ok: true, value: parsed }
}
