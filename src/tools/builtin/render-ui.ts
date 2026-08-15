import { randomUUID } from 'crypto'
import type { ToolDefinition, SurfaceSpec } from '../types.js'

/** Hard ceiling on a single surface payload, so a runaway generation can't wedge the client. */
const MAX_SURFACE_BYTES = 512 * 1024

const DESCRIPTION = `Render generated UI into an isolated browser surface and get back render diagnostics.

The surface is an opaque-origin iframe with no access to the host page: no parent DOM, no cookies,
no storage, no network egress. Anything you send here is display-only — it cannot read user data.

Fields:
- html: markup mounted into the surface root. Plain HTML; no <script> tags (use js instead).
- css: stylesheet for the surface.
- js: JavaScript run after mount. Has access to the surface DOM, a shared \`state\` object, \`emit(name, payload)\`
  to report user interactions back to you, and \`py.run(code)\` to call Python.
- python: Python run in a Pyodide worker inside the same surface. Import \`ui\` to drive the DOM:
  ui.mount(html) / ui.set_text(sel, s) / ui.set_html(sel, s) / ui.set_attr(sel, k, v) / ui.style(sel, {..}) /
  await ui.get_text(sel) / await ui.get_value(sel) / await ui.query_all(sel) / ui.state / ui.emit(name, payload) /
  @ui.on("click", sel). Python stdlib only unless the deployment has vendored extra packages.
- data: JSON handed to both js (as \`data\`) and python (as \`ui.data\`).
- mode: "replace" swaps the whole surface; "patch" keeps the existing surface and applies only the fields you send.
- id: reuse the same id to update a surface in place; omit for a new one.

Prefer building one rich surface and patching it over emitting many. Charts, tables, forms, dashboards, and
simulations all belong here rather than in chat text.`

export const renderUiTool: ToolDefinition = {
  name: 'RenderUI',
  description: DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Surface id. Reuse to update an existing surface; omit to create one.' },
      title: { type: 'string', description: 'Short tab label for the surface.' },
      mode: { type: 'string', enum: ['replace', 'patch'], description: 'replace (default) or patch' },
      html: { type: 'string', description: 'Markup for the surface root' },
      css: { type: 'string', description: 'Stylesheet for the surface' },
      js: { type: 'string', description: 'JavaScript run after mount' },
      python: { type: 'string', description: 'Python run in the surface Pyodide worker' },
      data: { type: 'object', description: 'JSON data exposed to js and python' },
      open: { type: 'boolean', description: 'Focus this surface after rendering (default true)' },
    },
    required: [],
  },
  async execute(input, context) {
    if (!context.events.onRenderUI) {
      return 'RenderUI needs a browser client with a surface sandbox — this client cannot render UI.'
    }

    const { id, title, mode, html, css, js, python, data, open } = input as {
      id?: string; title?: string; mode?: string
      html?: string; css?: string; js?: string; python?: string
      data?: Record<string, unknown>; open?: boolean
    }

    if (!html && !css && !js && !python) {
      return 'Error: RenderUI needs at least one of html, css, js, or python.'
    }
    if (mode && mode !== 'replace' && mode !== 'patch') {
      return `Error: mode must be "replace" or "patch", got ${JSON.stringify(mode)}.`
    }

    const bytes = Buffer.byteLength(
      (html ?? '') + (css ?? '') + (js ?? '') + (python ?? '') + JSON.stringify(data ?? {}),
      'utf-8'
    )
    if (bytes > MAX_SURFACE_BYTES) {
      return `Error: surface payload is ${Math.round(bytes / 1024)} KB, over the ${MAX_SURFACE_BYTES / 1024} KB limit. Split it across surfaces or load data at runtime.`
    }

    const surface: SurfaceSpec = {
      id: id?.trim() || `s_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      title,
      mode: mode === 'patch' ? 'patch' : 'replace',
      html, css, js, python, data,
      open: open !== false,
    }

    try {
      const result = await context.events.onRenderUI(surface)
      return [
        `surface: ${result.id}${surface.title ? ` (${surface.title})` : ''}`,
        `status: ${result.ok ? 'rendered' : 'failed'}`,
        `size: ${Math.round(result.bytes / 102.4) / 10} KB · ${result.duration_ms}ms`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.errors.length ? `errors:\n${result.errors.map(e => `  ${e}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  },
}
