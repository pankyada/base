import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const script = readFileSync(resolve(process.cwd(), 'scripts/install.sh'), 'utf-8')

describe('release installer', () => {
  it('installs default profiles without overwriting an existing profile directory', () => {
    expect(script).toContain('harness-profiles.tar.gz')
    expect(script).toContain('if [ ! -f "${PROFILE_DIR}/coding.yaml" ]; then')
    expect(script).toContain('tar -xzf "${INSTALL_DIR}/harness-profiles.tar.gz" -C "${HARNESS_DIR}"')
  })

  it('delegates interactive onboarding only from a TTY and supports --no-init', () => {
    expect(script).toContain('for ARG in "$@"')
    expect(script).toContain('--no-init')
    expect(script).toContain('if [ "${NO_INIT}" -eq 0 ] && [ -t 0 ]; then')
    expect(script).toContain('exec "${INSTALL_DIR}/harness" init')
  })
})
