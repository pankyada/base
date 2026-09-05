import type { PinnedArtifact } from './canvas'

function csvCell(value: unknown): string { const text = String(value ?? ''); const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe }
export function tableToCsv(columns: string[], rows: unknown[][]): string { return [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\n') }
export function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }

/** Caller must pass escaped text content plus its own trusted wrapper markup. */
export function sessionToHtml(title: string, body: string): string {
  const safeBody = body.replace(/<\s*\/?\s*script/gi, match => `&lt;${match.slice(1)}`)
  const safeTitle = escapeHtml(title).replace(/&lt;|&gt;/g, '')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font-family:system-ui;margin:2rem}</style></head><body>${safeBody}</body></html>`
}
export function canvasToPng(canvas: HTMLCanvasElement, pixelRatio = 2): string { const context = canvas.getContext('2d'); if (context && 'scale' in context) (context as CanvasRenderingContext2D).scale(pixelRatio, pixelRatio); return canvas.toDataURL('image/png') }
export function artifactExportMetadata(item: PinnedArtifact): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    artifact_id: item.artifact.id,
    recipe_id: item.artifact.recipeId,
    version: item.artifact.version,
    freshness: item.artifact.freshness ?? (item.stale ? 'stale' : 'unknown'),
  }
  if (item.provenance.session && item.provenance.toolCall) {
    metadata.source = {
      session_id: item.provenance.session,
      tool_call_id: item.provenance.toolCall,
      ...(item.provenance.code ? { code_ref: item.provenance.code } : {}),
      ...(item.provenance.source ? { source: item.provenance.source } : {}),
    }
  }
  if (item.staleReason) metadata.stale_reason = item.staleReason
  return metadata
}

export function serializeSvg(svg: SVGElement, metadata?: Record<string, unknown>): string {
  const serialized = svg.outerHTML
  const tag = metadata ? `<metadata>${escapeHtml(JSON.stringify(metadata))}</metadata>` : ''
  const enriched = tag ? serialized.replace('>', `>${tag}`) : serialized
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enriched)}`
}
export function downloadSvg(root: HTMLElement, filename: string, metadata?: Record<string, unknown>): boolean {
  const svg = root.querySelector('svg')
  if (!svg || typeof document === 'undefined') return false
  const anchor = document.createElement('a')
  anchor.href = serializeSvg(svg, metadata)
  anchor.download = filename.endsWith('.svg') ? filename : `${filename}.svg`
  anchor.click()
  return true
}

export async function downloadPng(root: HTMLElement, filename: string, metadata?: Record<string, unknown>): Promise<boolean> {
  const svg = root.querySelector('svg')
  if (!svg || typeof document === 'undefined') return false
  const image = new Image()
  const loaded = new Promise<boolean>(resolve => {
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, image.width * 2)
      const chartHeight = Math.max(1, image.height * 2)
      canvas.height = chartHeight + (metadata ? 32 : 0)
      const context = canvas.getContext('2d')
      if (!context) return resolve(false)
      context.drawImage(image, 0, 0, canvas.width, chartHeight)
      if (metadata) {
        context.fillStyle = '#111'
        context.font = '10px sans-serif'
        context.fillText(JSON.stringify(metadata).slice(0, 240), 4, canvas.height - 10)
      }
      const anchor = document.createElement('a')
      anchor.href = canvas.toDataURL('image/png')
      anchor.download = filename.endsWith('.png') ? filename : filename + '.png'
      anchor.click()
      resolve(true)
    }
    image.onerror = () => resolve(false)
  })
  image.src = serializeSvg(svg, metadata)
  return loaded
}

function pdfEscape(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ') }

export function canvasToPdf(root: HTMLElement, metadata?: Record<string, unknown>): string {
  const lines = (root.innerText || 'Canvas artifact').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 80)
  if (metadata) lines.push(`Source: ${JSON.stringify(metadata)}`)
  const content = ['BT', '/F1 11 Tf', '48 760 Td', ...lines.flatMap((line, index) => [index ? '0 -16 Td' : '', '(' + pdfEscape(line.slice(0, 140)) + ') Tj']).filter(Boolean), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n' })
  const xref = pdf.length
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n') + '\ntrailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF'
  return 'data:application/pdf;base64,' + btoa(unescape(encodeURIComponent(pdf)))
}

export function downloadPdf(root: HTMLElement, filename: string, metadata?: Record<string, unknown>): boolean {
  if (typeof document === 'undefined') return false
  const anchor = document.createElement('a')
  anchor.href = canvasToPdf(root, metadata)
  anchor.download = filename.endsWith('.pdf') ? filename : filename + '.pdf'
  anchor.click()
  return true
}
