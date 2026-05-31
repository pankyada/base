export interface ExecutionRequest {
  id: string
  code: string
  language: string
  data?: Record<string, unknown>
  timeout_ms?: number
}

export interface ExecutionResult {
  id: string
  stdout: string
  stderr: string
  exit_code: number
  files: Record<string, string>   // filename → base64-encoded content
  duration_ms: number
}

export interface Executor {
  execute(req: ExecutionRequest): Promise<ExecutionResult>
}

export class UnsupportedLanguageError extends Error {
  constructor(language: string) {
    super(`Language "${language}" is not supported by this executor`)
    this.name = 'UnsupportedLanguageError'
  }
}
