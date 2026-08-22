import { loadPyodide } from 'pyodide'

let runtime: any
let loading: Promise<any> | undefined
const getRuntime = async () => { if (runtime) return runtime; loading ??= loadPyodide(); runtime = await loading; try { runtime.FS.mkdir('/out') } catch {} return runtime }

self.onmessage = async event => {
  const request = event.data as { id: string; code: string; data?: Record<string, unknown>; allowedPackages: string[] }
  const started = Date.now()
  try {
    const py = await getRuntime()
    if (request.allowedPackages.length) { try { await py.loadPackagesFromImports(request.allowedPackages.map(item => `import ${item}`).join('; ')) } catch {} }
    py.FS.writeFile('/data.json', JSON.stringify(request.data ?? {}))
    let stdout = ''; let stderr = ''; let exit_code = 0
    const originalStdout = py.setStdout({ batched: (value: string) => { stdout += value + '\n' } })
    const originalStderr = py.setStderr({ batched: (value: string) => { stderr += value + '\n' } })
    try { await py.runPythonAsync(request.code) } catch (error) { stderr += `${error instanceof Error ? error.message : String(error)}\n`; exit_code = 1 } finally { py.setStdout(originalStdout); py.setStderr(originalStderr) }
    const files: Record<string, string> = {}
    for (const entry of py.FS.readdir('/out') as string[]) { if (entry === '.' || entry === '..') continue; const content = py.FS.readFile(`/out/${entry}`) as Uint8Array; files[entry] = btoa(String.fromCharCode(...content)) }
    self.postMessage({ id: request.id, stdout, stderr, exit_code, files, duration_ms: Date.now() - started })
  } catch (error) { self.postMessage({ id: request.id, stdout: '', stderr: error instanceof Error ? error.message : String(error), exit_code: 1, files: {}, duration_ms: Date.now() - started }) }
}
