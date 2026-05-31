'use client'
import { useEffect, useRef } from 'react'
import type { ExecutionResult } from '../lib/types.js'

interface PendingExecution {
  id: string
  code: string
  language: string
  data?: Record<string, unknown>
}

interface Props {
  pendingExecution: PendingExecution | null
  allowedPackages: string[]
  onResult: (result: ExecutionResult) => void
}

export function HarnessPython({ pendingExecution, allowedPackages, onResult }: Props) {
  const pyodideRef = useRef<any>(null)
  const loadingRef = useRef(false)
  const packagesInstalledRef = useRef(false)

  useEffect(() => {
    if (!pendingExecution) return

    const run = async () => {
      if (!pyodideRef.current && !loadingRef.current) {
        loadingRef.current = true
        try {
          const { loadPyodide } = await import('pyodide')
          pyodideRef.current = await loadPyodide()
          pyodideRef.current.FS.mkdir('/out')
        } finally {
          loadingRef.current = false
        }
      }
      while (loadingRef.current) {
        await new Promise(r => setTimeout(r, 50))
      }

      const py = pyodideRef.current
      if (!py) {
        onResult({ id: pendingExecution.id, stdout: '', stderr: 'Pyodide failed to load', exit_code: 1, files: {}, duration_ms: 0 })
        return
      }

      if (!packagesInstalledRef.current && allowedPackages.length > 0) {
        packagesInstalledRef.current = true
        try {
          await py.loadPackagesFromImports(`import ${allowedPackages.join('; import ')}`)
        } catch { /* non-fatal */ }
      }

      py.FS.writeFile('/data.json', JSON.stringify(pendingExecution.data ?? {}))

      let stdout = ''
      let stderr = ''
      const origStdout = py.setStdout({ batched: (s: string) => { stdout += s + '\n' } })
      const origStderr = py.setStderr({ batched: (s: string) => { stderr += s + '\n' } })

      const start = Date.now()
      let exit_code = 0

      try {
        await py.runPythonAsync(pendingExecution.code)
      } catch (e: any) {
        stderr += e.message + '\n'
        exit_code = 1
      } finally {
        py.setStdout(origStdout)
        py.setStderr(origStderr)
      }

      const files: Record<string, string> = {}
      try {
        const entries: string[] = py.FS.readdir('/out')
        for (const entry of entries) {
          if (entry === '.' || entry === '..') continue
          const content: Uint8Array = py.FS.readFile(`/out/${entry}`)
          files[entry] = btoa(String.fromCharCode(...content))
        }
      } catch { /* /out may be empty */ }

      onResult({ id: pendingExecution.id, stdout, stderr, exit_code, files, duration_ms: Date.now() - start })
    }

    run().catch(e => {
      onResult({ id: pendingExecution.id, stdout: '', stderr: e.message, exit_code: 1, files: {}, duration_ms: 0 })
    })
  }, [pendingExecution, allowedPackages, onResult])

  return null
}
