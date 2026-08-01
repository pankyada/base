import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pin, renderPins } from '../src/context/pins.js'
import { createSession } from '../src/session/store.js'
import { skillTool } from '../src/tools/builtin/skill.js'

const profile: any = {
  name: 'test',
  model: { id: 'unknown', base_url: 'https://example.com', api_key_env: 'KEY' },
  context: { max_tokens: 1000, high_water: 0.8, low_water: 0.45, tail_turns: 3, pin_budget: 0.25, cache: false },
}

describe('context pins', () => {
  it('does not duplicate a key when pinned twice', () => {
    const session = createSession('test', 'user')
    expect(pin(session, profile, 'skill-a', 'body')).toBe('ok')
    const first = renderPins(session)
    expect(pin(session, profile, 'skill-a', 'body')).toBe('ok')
    expect(session.context?.pins).toHaveLength(1)
    expect(renderPins(session)).toBe(first)
  })

  it('refuses a pin that exceeds the prefix budget', () => {
    const session = createSession('test', 'user')
    expect(pin(session, { ...profile, context: { ...profile.context, max_tokens: 20 } }, 'huge', 'x'.repeat(1000))).toBe('over-budget')
    expect(session.context?.pins).toEqual([])
  })

  it('renders byte-identically without a new pin', () => {
    const session = createSession('test', 'user')
    pin(session, profile, 'skill-a', 'body')
    expect(renderPins(session)).toBe(renderPins(session))
  })

  it('Skill pins the body it returns using the skill name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pin-skill-'))
    const filePath = join(root, 'SKILL.md')
    writeFileSync(filePath, '# Skill body')
    const session = createSession('test', 'user')
    const result = await skillTool.execute({ name: 'demo' }, {
      profile, session, skills: [{ name: 'demo', description: 'demo', content: '', filePath }],
    } as any)
    expect(result).toBe('# Skill body')
    expect(session.context?.pins).toEqual([{ key: 'demo', text: '# Skill body' }])
  })
})
