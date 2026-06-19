import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Executor, ExecutionRequest, ExecutionResult } from './interface.js'
import type { ExecutorConfig } from '../profiles/schema.js'
import { sanitizeEnv } from '../tools/builtin/env-filter.js'

export const MAX_STDOUT_BYTES = 256_000
export const MAX_STDERR_BYTES = 64_000
export const MAX_FILE_BYTES = 512_000

const EXTENSIONS: Record<string, string> = {
  python: 'py', javascript: 'js', typescript: 'ts',
  bash: 'sh', ruby: 'rb', go: 'go', rust: 'rs',
}

const INTERPRETERS: Record<string, string[]> = {
  python: ['python3', '/work/code.py'],
  javascript: ['node', '/work/code.js'],
  typescript: ['ts-node', '/work/code.ts'],
  bash: ['bash', '/work/code.sh'],
  ruby: ['ruby', '/work/code.rb'],
}

function truncateOutput(output: string, maxBytes: number): string {
  const encoded = Buffer.from(output, 'utf-8')
  if (encoded.length <= maxBytes) return output
  const truncated = encoded.slice(0, maxBytes).toString('utf-8', 0, maxBytes)
  return truncated + '\n[output truncated]'
}

export class DockerExecutor implements Executor {
  constructor(private cfg: ExecutorConfig) {}

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const workDir = mkdtempSync(join(tmpdir(), 'harness-exec-'))
    const outDir = join(workDir, 'out')
    mkdirSync(outDir, { mode: 0o777 })

    const ext = EXTENSIONS[req.language] ?? 'txt'
    writeFileSync(join(workDir, `code.${ext}`), req.code, 'utf-8')
    writeFileSync(join(workDir, 'data.json'), JSON.stringify(req.data ?? {}), 'utf-8')

    const interpreter = INTERPRETERS[req.language] ?? ['bash', `/work/code.${ext}`]
    const timeout = req.timeout_ms ?? this.cfg.timeout_ms ?? 30000

    const dockerArgs = [
      'run', '--rm',
      '--network', 'none',
      '--memory', '512m',
      '--cpus', '1',
      '--user', '1000:1000',
      '-v', `${workDir}:/work:ro`,
      '-v', `${outDir}:/out`,
      this.cfg.docker_image,
      ...interpreter,
    ]

    const start = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false

    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const proc = spawn('docker', dockerArgs, { env: sanitizeEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
        const timer = setTimeout(() => {
          timedOut = true
          proc.kill('SIGKILL')
        }, timeout)
        proc.stdout.on('data', (d: Buffer) => {
          if (Buffer.from(stdout, 'utf-8').length < MAX_STDOUT_BYTES) {
            stdout += d.toString()
          }
        })
        proc.stderr.on('data', (d: Buffer) => {
          if (Buffer.from(stderr, 'utf-8').length < MAX_STDERR_BYTES) {
            stderr += d.toString()
          }
        })
        proc.on('close', (code) => {
          clearTimeout(timer)
          resolve(timedOut ? 124 : (code ?? 1))
        })
        proc.on('error', (err) => {
          clearTimeout(timer)
          stderr += `docker unavailable: ${err.message}`
          reject(new Error(`docker unavailable: ${err.message}`))
        })
      })

      const files: Record<string, string> = {}
      for (const entry of readdirSync(outDir)) {
        const content = readFileSync(join(outDir, entry))
        const fileKey = content.length > MAX_FILE_BYTES ? entry + '__TRUNCATED' : entry
        const truncated = content.length > MAX_FILE_BYTES ? content.slice(0, MAX_FILE_BYTES) : content
        files[fileKey] = Buffer.from(truncated).toString('base64')
      }

      const finalStdout = truncateOutput(stdout, MAX_STDOUT_BYTES)
      const finalStderr = truncateOutput(stderr, MAX_STDERR_BYTES)
      return { id: req.id, stdout: finalStdout, stderr: finalStderr, exit_code: exitCode, files, duration_ms: Date.now() - start }
    } catch (err) {
      // Handle spawn errors and other execution failures
      return { id: req.id, stdout, stderr, exit_code: 1, files: {}, duration_ms: Date.now() - start }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
}
