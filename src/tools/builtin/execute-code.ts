import { randomUUID } from 'crypto'
import type { ToolDefinition } from '../types.js'
import { executeWithFallback } from '../../executor/factory.js'

export const executeCodeTool: ToolDefinition = {
  name: 'ExecuteCode',
  description: 'Execute code in a sandbox. Use language="python" for WASM (browser) or any language for Docker. Code can read input data via `/work/data.json` and write output files to `/out/`. Returns stdout, stderr, exit code, and any files written to /out.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Source code to execute' },
      language: { type: 'string', description: 'Language: python, javascript, bash, ruby, typescript, etc.' },
      data: { type: 'object', description: 'Optional data object passed to executor as /work/data.json' },
      timeout_ms: { type: 'number', description: 'Execution timeout in ms (default: profile executor.timeout_ms)' },
    },
    required: ['code', 'language'],
  },
  async execute(input, context) {
    if (!context.profile.executor) {
      return 'Code execution not enabled in this profile — add an executor: block to enable it'
    }

    const { code, language, data, timeout_ms } = input as {
      code: string; language: string; data?: Record<string, unknown>; timeout_ms?: number
    }

    try {
      const result = await executeWithFallback(context.profile, context, {
        id: randomUUID().replace(/-/g, '').slice(0, 8),
        code, language, data, timeout_ms,
      })

      const fileList = Object.entries(result.files)
        .map(([name, b64]) => `  ${name} (${Math.round(Buffer.from(b64, 'base64').length / 1024 * 10) / 10} KB)`)
        .join('\n')

      return [
        `exit_code: ${result.exit_code}`,
        `duration: ${result.duration_ms}ms`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
        fileList ? `files:\n${fileList}` : '',
      ].filter(Boolean).join('\n')
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  },
}
