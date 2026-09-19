import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { addSupplementalPin, pin, renderPins } from '../src/context/pins.js'
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

  it('lets a future explicit pin evict supplemental pins while preserving explicit order', () => {
    const session = createSession('test', 'user')
    for (let index = 0; index < 4; index++) expect(addSupplementalPin(session, profile, { key: `semantic-${index}`, text: 'evidence '.repeat(20), source_revision: `r${index}` })).toBe('ok')
    expect(session.context?.supplemental_pins).toHaveLength(4)
    expect(pin(session, profile, 'explicit-skill', 'skill '.repeat(100))).toBe('ok')
    expect(session.context?.pins).toEqual([{ key: 'explicit-skill', text: 'skill '.repeat(100) }])
    expect((session.context?.supplemental_pins?.length ?? 0)).toBeLessThan(4)
    expect(renderPins(session).indexOf('[explicit-skill]')).toBeLessThan(renderPins(session).indexOf('[semantic-'))
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
