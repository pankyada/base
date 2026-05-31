import type { ExecutionRequest, ExecutionResult } from './interface.js'
import { UnsupportedLanguageError } from './interface.js'
import { WasmExecutor } from './wasm.js'
import { DockerExecutor } from './docker.js'
import type { Profile } from '../profiles/schema.js'
import type { ToolContext } from '../tools/types.js'

export async function executeWithFallback(
  profile: Profile,
  context: ToolContext,
  req: ExecutionRequest
): Promise<ExecutionResult> {
  const cfg = profile.executor!
  const canWasm = context.wasmSupported === true && cfg.default === 'wasm'

  if (canWasm) {
    try {
      return await new WasmExecutor(context).execute(req)
    } catch (e) {
      if (!(e instanceof UnsupportedLanguageError)) throw e
      // non-python: fall through to Docker
    }
  }

  return new DockerExecutor(cfg).execute(req)
}
