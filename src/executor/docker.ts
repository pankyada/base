import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Executor, ExecutionRequest, ExecutionResult } from './interface.js'
import type { ExecutorConfig } from '../profiles/schema.js'

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
      const exitCode = await new Promise<number>((resolve) => {
        const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
        const timer = setTimeout(() => {
          timedOut = true
          proc.kill('SIGKILL')
        }, timeout)
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
          clearTimeout(timer)
          resolve(timedOut ? 124 : (code ?? 1))
        })
      })

      const files: Record<string, string> = {}
      for (const entry of readdirSync(outDir)) {
        const content = readFileSync(join(outDir, entry))
        files[entry] = Buffer.from(content).toString('base64')
      }

      return { id: req.id, stdout, stderr, exit_code: exitCode, files, duration_ms: Date.now() - start }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
}
