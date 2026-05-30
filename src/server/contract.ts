import { Ajv } from 'ajv'
import type { ValidateFunction } from 'ajv'
import type { Profile } from '../profiles/schema.js'
import { parseJsonContract } from '../shared/json-contract.js'

export interface CompiledContract {
  inputValidator?: ValidateFunction
  outputValidator?: ValidateFunction
  outputSchema?: Record<string, unknown>
}

export type InputResult =
  | { ok: true; userMessage: string }
  | { ok: false; error: string; details?: string[] }

export type OutputResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string; kind: 'parse' | 'validation' }

export function compileContract(profile: Profile): CompiledContract {
  const c = profile.contract
  if (!c) return {}
  const ajv = new Ajv()
  return {
    inputValidator: c.input ? ajv.compile(c.input) : undefined,
    outputValidator: c.output ? ajv.compile(c.output) : undefined,
    outputSchema: c.output as Record<string, unknown> | undefined,
  }
}

function withOutputInstruction(base: string, c: CompiledContract): string {
  if (!c.outputSchema) return base
  return `${base}\n\nRespond with a JSON object matching this schema: ${JSON.stringify(c.outputSchema)}`
}

export function validateAndBuildInput(input: unknown, c: CompiledContract): InputResult {
  if (c.inputValidator) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, error: 'input must be an object for this profile' }
    }
    if (!c.inputValidator(input)) {
      const details = (c.inputValidator.errors ?? []).map(e => `${e.instancePath} ${e.message}`)
      return { ok: false, error: 'input validation failed', details }
    }
    return { ok: true, userMessage: withOutputInstruction(JSON.stringify(input, null, 2), c) }
  }

  // No input schema → require a plain string user message.
  if (typeof input !== 'string') {
    return { ok: false, error: 'input must be a string for this profile (no input contract)' }
  }
  return { ok: true, userMessage: withOutputInstruction(input, c) }
}

export function processOutput(finalText: string, c: CompiledContract): OutputResult {
  if (!c.outputValidator) return { ok: true, output: finalText }
  const r = parseJsonContract(finalText, c.outputValidator)
  if (r.ok) return { ok: true, output: r.value }
  return { ok: false, error: r.error, kind: r.kind }
}
