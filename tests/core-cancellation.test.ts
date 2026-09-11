import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bashTool } from '../src/tools/builtin/bash.js'
import { runHooks } from '../src/hooks/runner.js'
import { getMcpToolDefinitions } from '../src/mcp/client.js'

describe('Core cancellation boundaries', () => {
  it('kills Bash and reports cancellation without accepting a late shell result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-bash-cancel-'))
    const marker = join(dir, 'late.txt')
    const controller = new AbortController()
    try {
      const pidFile = join(dir, 'child.pid')
      const running = bashTool.execute({
        command: `sleep 10 & child=$!; printf %s "$child" > ${JSON.stringify(pidFile)}; wait "$child"; printf late > ${JSON.stringify(marker)}`,
        timeout: 10_000,
      }, { signal: controller.signal } as any)
      const deadline = Date.now() + 2_000
      while (!existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      expect(existsSync(pidFile)).toBe(true)
      const childPid = Number(readFileSync(pidFile, 'utf8'))
      controller.abort()
      const result = await running
      expect(String(result)).toContain('[cancelled')
      expect(existsSync(marker)).toBe(false)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(() => process.kill(childPid, 0)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 5_000)

  it('does not spawn Bash when its signal is already aborted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-bash-preabort-'))
    const marker = join(dir, 'spawned.txt')
    const controller = new AbortController()
    controller.abort()
    try {
      const result = await bashTool.execute({ command: `printf spawned > ${JSON.stringify(marker)}` }, { signal: controller.signal } as any)
      expect(String(result)).toContain('[cancelled')
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops a running hook on abort and does not start later hooks', async () => {
    const controller = new AbortController()
    const dir = mkdtempSync(join(tmpdir(), 'core-hook-cancel-'))
    const started = join(dir, 'started.txt')
    const pidFile = join(dir, 'child.pid')
    const late = join(dir, 'late.txt')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const profile: any = { name: 'cancel', hooks: { pre_tool: [`touch ${JSON.stringify(started)}; sleep 10 & child=$!; printf %s "$child" > ${JSON.stringify(pidFile)}; wait "$child"`, `touch ${JSON.stringify(late)}`], post_tool: [], on_stop: [], timeout_ms: 10_000 } }
      const running = runHooks('pre_tool', profile, {}, controller.signal)
      const deadline = Date.now() + 2_000
      while ((!existsSync(started) || !existsSync(pidFile)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      expect(existsSync(started)).toBe(true)
      expect(existsSync(pidFile)).toBe(true)
      const childPid = Number(readFileSync(pidFile, 'utf8'))
      controller.abort()
      await running
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[hook:pre_tool] cancelled'))
      expect(existsSync(late)).toBe(false)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(() => process.kill(childPid, 0)).toThrow()
    } finally {
      spy.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 5_000)

  it('passes ToolContext signal through normal MCP tool execution', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const profile: any = { tools: { mcp_servers: [{ name: 'fixture', transport: 'stdio', command: 'fixture', args: [], env: {}, acl: {} }] } }
    const entries: any[] = [{ client: { callTool }, serverName: 'fixture', tools: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }] }]
    const signal = new AbortController().signal
    const [tool] = getMcpToolDefinitions(profile, entries)
    await tool.execute({ value: 'x' }, { signal } as any)
    expect(callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { value: 'x' } }, undefined, { signal })
  })
})
