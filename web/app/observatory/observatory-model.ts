export type ObservatoryCollectionId = 'images' | 'documents' | 'videos'

export interface ObservatoryFile {
  id: string
  name: string
  kind: 'image' | 'document' | 'video'
  bytes: number
  modifiedAt: string
  url: string
}

export interface ObservatoryCollection {
  id: ObservatoryCollectionId
  name: string
  status: 'ready' | 'missing' | 'unavailable'
  rootLabel?: string
  files: ObservatoryFile[]
  truncated: boolean
}

export function matchingFiles(collections: ObservatoryCollection[], selected: string | null, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return collections.filter(collection => !selected || collection.id === selected)
    .flatMap(collection => collection.files.map(file => ({ ...file, collectionId: collection.id })))
    .filter(file => !normalized || file.name.toLocaleLowerCase().includes(normalized))
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fileIdentity(file: ObservatoryFile): string {
  return file.url
}
