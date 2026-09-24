import { constants } from 'node:fs'
import { lstat, opendir, open, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type ObservatoryCollectionId = 'images' | 'documents' | 'videos'
export type ObservatoryFileKind = 'image' | 'document' | 'video'
export interface ObservatoryFile {
  id: string
  name: string
  kind: ObservatoryFileKind
  bytes: number
  modifiedAt: string
  url: string
}
export interface ObservatoryCollection {
  id: ObservatoryCollectionId
  name: string
  status: 'ready' | 'missing' | 'unavailable'
  files: ObservatoryFile[]
  truncated: boolean
  rootLabel?: string
}
export interface ObservatoryCatalog { collections: ObservatoryCollection[] }

const collectionDefinitions: ReadonlyArray<{
  id: ObservatoryCollectionId
  name: string
  folder: readonly string[]
  kind: ObservatoryFileKind
  extensions: readonly string[]
}> = [
  { id: 'images', name: 'Images', folder: ['Downloads', 'images'], kind: 'image', extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'] },
  { id: 'documents', name: 'Documents', folder: ['Downloads', 'PDFs & Documents'], kind: 'document', extensions: ['.pdf', '.txt', '.md'] },
  { id: 'videos', name: 'Videos', folder: ['Downloads', 'Videos'], kind: 'video', extensions: ['.mp4', '.webm', '.ogg', '.mov'] },
]
const extensionMime: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
}
const DEFAULT_MAX_FILES = 120
const MAX_DIRECTORY_ENTRIES = 4096
const PREVIEW_PREFIX = '/api/observatory/file'

export interface ObservatoryOptions { root?: string; maxFiles?: number; maxEntries?: number }
export interface ResolvedObservatoryFile {
  path: string
  name: string
  kind: ObservatoryFileKind
  bytes: number
  modifiedAt: string
  contentType: string
}

function configuredRoot(root?: string): string {
  return path.resolve(root ?? process.env.HARNESS_OBSERVATORY_ROOT ?? os.homedir())
}
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
function definitionFor(id: string) {
  return collectionDefinitions.find((collection) => collection.id === id)
}
function opaqueId(name: string): string { return Buffer.from(name, 'utf8').toString('base64url') }
function fileUrl(collection: ObservatoryCollectionId, id: string): string {
  return `${PREVIEW_PREFIX}?collection=${collection}&id=${encodeURIComponent(id)}`
}
function safeName(name: string): boolean {
  return !!name && !name.startsWith('.') && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\') && path.basename(name) === name
}
async function canonicalRoot(root: string): Promise<string> {
  try { return await realpath(root) } catch { return root }
}
async function resolveCollectionDirectory(root: string, folders: readonly string[]): Promise<string> {
  let current = root
  for (const folder of folders) {
    current = path.join(current, folder)
    const info = await lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error('invalid collection path'), { code: 'EINVAL' })
  }
  return current
}

export async function getObservatoryCollections(options: ObservatoryOptions = {}): Promise<ObservatoryCatalog> {
  const root = configuredRoot(options.root)
  const canonicalBase = await canonicalRoot(root)
  const maxFiles = Math.max(1, Math.min(DEFAULT_MAX_FILES, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES)))
  const maxEntries = Math.max(1, Math.min(MAX_DIRECTORY_ENTRIES, Math.floor(options.maxEntries ?? MAX_DIRECTORY_ENTRIES)))
  const collections = await Promise.all(collectionDefinitions.map(async (definition): Promise<ObservatoryCollection> => {
    const rootLabel = definition.folder.join('/')
    let directory: string
    try {
      directory = await resolveCollectionDirectory(canonicalBase, definition.folder)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { id: definition.id, name: definition.name, rootLabel, status: code === 'ENOENT' ? 'missing' : 'unavailable', files: [], truncated: false }
    }

    const files: ObservatoryFile[] = []
    let truncated = false
    try {
      const handle = await opendir(directory)
      let entries = 0
      for await (const entry of handle) {
        entries += 1
        if (entries > maxEntries) { truncated = true; break }
        if (!entry.isFile() || !safeName(entry.name)) continue
        const extension = path.extname(entry.name).toLowerCase()
        if (!definition.extensions.includes(extension)) continue
        try {
          const fullPath = path.join(directory, entry.name)
          const info = await lstat(fullPath)
          if (!info.isFile() || info.isSymbolicLink()) continue
          if (files.length >= maxFiles) { truncated = true; break }
          files.push({ id: opaqueId(entry.name), name: entry.name, kind: definition.kind, bytes: info.size, modifiedAt: info.mtime.toISOString(), url: fileUrl(definition.id, opaqueId(entry.name)) })
        } catch { /* A concurrently removed or replaced entry is omitted. */ }
      }
    } catch {
      return { id: definition.id, name: definition.name, rootLabel, status: 'unavailable', files: [], truncated: false }
    }
    files.sort((left, right) => left.name.localeCompare(right.name))
    return { id: definition.id, name: definition.name, rootLabel, status: 'ready', files, truncated }
  }))
  return { collections }
}

export async function resolveObservatoryFile(collectionId: string, id: string, options: ObservatoryOptions = {}): Promise<ResolvedObservatoryFile | null> {
  const definition = definitionFor(collectionId)
  if (!definition || !id || id.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(id)) return null
  let name: string
  try { name = Buffer.from(id, 'base64url').toString('utf8') } catch { return null }
  if (!name || opaqueId(name) !== id || !safeName(name)) return null
  const extension = path.extname(name).toLowerCase()
  if (!definition.extensions.includes(extension)) return null

  const root = configuredRoot(options.root)
  const canonicalBase = await canonicalRoot(root)
  try {
    const directory = await resolveCollectionDirectory(canonicalBase, definition.folder)
    const candidate = path.join(directory, name)
    const [info, canonicalFile] = await Promise.all([lstat(candidate), realpath(candidate)])
    if (!info.isFile() || info.isSymbolicLink() || canonicalFile !== candidate || path.dirname(canonicalFile) !== directory || !inside(canonicalBase, canonicalFile)) return null
    return { path: canonicalFile, name, kind: definition.kind, bytes: info.size, modifiedAt: info.mtime.toISOString(), contentType: extensionMime[extension] }
  } catch { return null }
}

export async function openObservatoryFile(file: ResolvedObservatoryFile, start: number, end: number) {
  const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const info = await handle.stat()
  if (!info.isFile() || info.size !== file.bytes) {
    await handle.close()
    throw new Error('file changed')
  }
  return handle.createReadStream({ start, end, autoClose: true })
}
