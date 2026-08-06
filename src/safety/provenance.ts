import { resolve } from 'path'
import { wasTaintedWrite } from '../audit/query.js'
import type { ToolContext, ToolProvenance } from '../tools/types.js'

export function defaultProvenance(tool: string, input: Record<string, unknown>, context: ToolContext, isMcp: boolean): { provenance: ToolProvenance; source?: string } {
  if (isMcp) return { provenance: 'untrusted', source: `MCP ${tool}` }
  if (tool === 'Bash' || tool === 'ExecuteCode') return { provenance: 'untrusted', source: `${tool} output` }
  if (tool === 'Read') {
    const path = typeof input.file_path === 'string' ? resolve(input.file_path) : ''
    const root = resolve(context.workingDir)
    if (!path.startsWith(root + '/') && path !== root) return { provenance: 'untrusted', source: `file outside working directory: ${path}` }
    if (path && wasTaintedWrite(context.session.user, path)) return { provenance: 'untrusted', source: `tainted file: ${path}` }
  }
  return { provenance: 'trusted' }
}
