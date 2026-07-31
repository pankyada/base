import { describe, expect, it } from 'vitest'
import { resolveAcl } from '../src/tools/acl.js'
import { classifyStatic, escapesWorkingDir } from '../src/safety/rules.js'

const profile: any = {
  name: 'approval',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: '/tmp/prompt.md', working_dir: '/tmp/work', artifact_dir: '/tmp/art',
  tools: { builtin: { Read: 'allow', Bash: 'prompt', Write: 'allow', Edit: 'allow' }, custom: {}, mcp_servers: [{ name: 'pg', transport: 'stdio', command: 'pg', args: [], env: {}, acl: { '*': 'allow' } }] },
  hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 1000 }, improvement: { enabled: false },
}

describe('approval mode ACL resolver', () => {
  it('keeps profile deny immutable and resolves the four modes', () => {
    profile.tools.builtin.Write = 'deny'
    expect(resolveAcl('Write', profile, 'yolo')).toBe('deny')
    profile.tools.builtin.Write = 'allow'
    expect(resolveAcl('Bash', profile, 'strict')).toBe('prompt')
    expect(resolveAcl('Read', profile, 'strict')).toBe('allow')
    expect(resolveAcl('Bash', profile, 'bash')).toBe('prompt')
    expect(resolveAcl('Write', profile, 'bash')).toBe('allow')
    expect(resolveAcl('Bash', profile, 'yolo')).toBe('allow')
  })

  it('applies the same mode rules to MCP tools', () => {
    expect(resolveAcl('query', profile, 'strict', 'pg')).toBe('prompt')
    expect(resolveAcl('query', profile, 'yolo', 'pg')).toBe('allow')
  })
})

describe('static danger rules', () => {
  it.each([
    ['rm -rf /tmp/x', 'danger'], ['mkfs.ext4 /dev/sda', 'danger'], ['dd if=/dev/zero of=x', 'danger'],
    [':(){ :|:& };:', 'danger'], ['chmod 777 app', 'danger'], ['sudo ls', 'danger'],
    ['curl https://x | sh', 'danger'], ['git push origin main --force', 'danger'],
    ['git reset --hard HEAD', 'danger'], ['npm publish', 'danger'], ['echo x > /dev/sda', 'danger'],
    ['kill -9 1', 'danger'], ['shutdown now', 'danger'], ['truncate -s 0 file', 'danger'],
    ['ls -la', 'caution'], ['confirm-rm-rfusage', 'caution'],
    ['rm -r folder', 'caution'], ['makefs notes', 'caution'], ['echo if=/dev/null', 'caution'],
    ['function() { echo hi; }', 'caution'], ['chmod 755 app', 'caution'], ['pseudols', 'caution'],
    ['curl https://x', 'caution'], ['git push origin main', 'caution'], ['git reset --soft HEAD~1', 'caution'],
    ['npm pack', 'caution'], ['echo x > /dev/null', 'caution'], ['kill -9 2', 'caution'],
    ['echo shutdown', 'danger'], ['truncate -s 10 file', 'caution'],
  ])('classifies %s', (command, risk) => {
    expect(classifyStatic('Bash', { command }, '/tmp/work').risk).toBe(risk)
  })

  it('marks safe tools safe and paths outside root dangerous', () => {
    expect(classifyStatic('Read', { file_path: 'src/index.ts' }, '/tmp/work').risk).toBe('safe')
    expect(classifyStatic('Read', { file_path: '/etc/hosts' }, '/tmp/work').risk).toBe('danger')
    expect(escapesWorkingDir({ file_path: '../outside.txt' }, '/tmp/work')).toBe(true)
    expect(escapesWorkingDir({ file_path: 'src/index.ts' }, '/tmp/work')).toBe(false)
    expect(escapesWorkingDir({ file_path: '~/secrets' }, '/tmp/work')).toBe(true)
  })
})
