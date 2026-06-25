import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sanitizeEnv } from '../src/tools/builtin/env-filter.js'

describe('sanitizeEnv', () => {
  const original = process.env

  beforeEach(() => {
    process.env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      OPENAI_API_KEY: 'sk-secret',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      MY_APP_TOKEN: 'tok-secret',
      SOME_SECRET: 'very-secret',
      HARNESS_API_KEY: 'harness-key',
      NODE_ENV: 'test',
    } as any
  })

  afterEach(() => {
    process.env = original
  })

  it('keeps safe vars', () => {
    const env = sanitizeEnv()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/user')
    expect(env.NODE_ENV).toBe('test')
  })

  it('strips API keys and secrets', () => {
    const env = sanitizeEnv()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.MY_APP_TOKEN).toBeUndefined()
    expect(env.SOME_SECRET).toBeUndefined()
    expect(env.HARNESS_API_KEY).toBeUndefined()
  })

})
