import type { Executor, ExecutionRequest, ExecutionResult } from './interface.js'
import { UnsupportedLanguageError } from './interface.js'
import type { ToolContext } from '../tools/types.js'

export class WasmExecutor implements Executor {
  constructor(private context: ToolContext) {}

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    if (req.language !== 'python') {
      throw new UnsupportedLanguageError(req.language)
    }
    if (!this.context.events.onCodeExecute) {
      throw new Error('onCodeExecute is not wired — WasmExecutor requires a browser client')
    }
    return this.context.events.onCodeExecute(req.id, req.code, req.language, req.data)
  }
}
