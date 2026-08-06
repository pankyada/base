import { realpathSync } from 'fs'
import { resolve, sep } from 'path'

export interface Predicate { arg: string; equals?: unknown; in_list?: string; matches?: string; under_path?: string; lt?: number; gt?: number; absent?: boolean; present?: boolean }

function get(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, input)
}
function glob(value: string, pattern: string): boolean {
  if (pattern.startsWith('**/')) return glob(value, pattern.slice(3)) || value.split('/').some(part => glob(part, pattern.slice(3)))
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`).test(value)
}

export function validatePredicate(value: Predicate): void {
  const keys = ['equals', 'in_list', 'matches', 'under_path', 'lt', 'gt', 'absent', 'present'].filter(key => (value as any)[key] !== undefined)
  if (!value.arg || keys.length !== 1) throw new Error('predicate needs arg and exactly one known operation')
}

export function matchesPredicate(predicate: Predicate, input: Record<string, unknown>, lists: Record<string, unknown[]>): boolean {
  validatePredicate(predicate)
  const value = get(input, predicate.arg)
  if (predicate.absent !== undefined) return predicate.absent === (value === undefined)
  if (predicate.present !== undefined) return predicate.present === (value !== undefined)
  if (value === undefined) return false
  if (predicate.equals !== undefined) return value === predicate.equals
  if (predicate.in_list) return (lists[predicate.in_list] ?? []).some(item => item === value)
  if (predicate.matches) return typeof value === 'string' && glob(value, predicate.matches)
  if (predicate.lt !== undefined) return typeof value === 'number' && value < predicate.lt
  if (predicate.gt !== undefined) return typeof value === 'number' && value > predicate.gt
  if (predicate.under_path) {
    if (typeof value !== 'string') return false
    try {
      const target = realpathSync(resolve(value)); const root = realpathSync(resolve(predicate.under_path))
      return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
    } catch { return false }
  }
  return false
}
