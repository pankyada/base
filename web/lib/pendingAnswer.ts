export function validatePendingAnswer(item: { kind: 'text' | 'select' | 'multi_select'; options?: string[] }, value: string | string[]): { ok: true; value: string } | { ok: false; error: string } {
  if (item.kind === 'text') return typeof value === 'string' ? { ok: true, value } : { ok: false, error: 'Enter a text answer.' }
  const options = item.options ?? []
  if (item.kind === 'select') return typeof value === 'string' && options.includes(value) ? { ok: true, value } : { ok: false, error: 'Choose one of the available options.' }
  return Array.isArray(value) && new Set(value).size === value.length && value.every(entry => options.includes(entry))
    ? { ok: true, value: JSON.stringify(value) } : { ok: false, error: 'Choose only available options, without duplicates.' }
}
