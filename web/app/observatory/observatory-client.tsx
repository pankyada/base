'use client'

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { fileIdentity, fileSize, matchingFiles, type ObservatoryCollection, type ObservatoryFile } from './observatory-model'

const Scene = dynamic(() => import('./observatory-scene'), { ssr: false })
const collectionCopy: Record<string, { symbol: string; eyebrow: string; description: string; color: string }> = {
  images: { symbol: '◈', eyebrow: 'THE IMAGE ATLAS', description: 'Places, people, perspectives', color: '#8ed8e6' },
  documents: { symbol: '▤', eyebrow: 'THE PAPER ARCHIVE', description: 'Ideas worth keeping', color: '#eed399' },
  videos: { symbol: '▷', eyebrow: 'THE MOTION VAULT', description: 'Moments in motion', color: '#c5b2ee' },
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <div className="observatory-scene-fallback" role="status">The 3D view is unavailable on this device. Your collections remain accessible below.</div>
      : this.props.children
  }
}

function FileGlyph({ kind }: { kind: ObservatoryFile['kind'] }) {
  return <span aria-hidden="true">{kind === 'image' ? '◈' : kind === 'video' ? '▷' : '▤'}</span>
}

function FilePreview({ file, onClose }: { file: ObservatoryFile; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pdfSupported, setPdfSupported] = useState(true)
  const isText = file.kind === 'document' && /\.(md|txt)$/i.test(file.name)
  useEffect(() => {
    const node = dialog.current
    setPdfSupported(navigator.pdfViewerEnabled !== false)
    const previousFocus = document.activeElement as HTMLElement | null
    node?.showModal()
    return () => { node?.close(); previousFocus?.focus() }
  }, [])
  useEffect(() => {
    if (!isText) return
    const controller = new AbortController()
    if (file.bytes > 1024 * 1024) { setError('This text file is too large for the preview. Open the original instead.'); return }
    void fetch(file.url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Preview unavailable (${response.status})`)
      setText(await response.text())
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Preview unavailable') })
    return () => controller.abort()
  }, [file, isText])
  return <dialog ref={dialog} className="observatory-preview" aria-labelledby="observatory-preview-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><div><small>{file.kind} · {fileSize(file.bytes)}</small><h2 id="observatory-preview-title">{file.name}</h2></div><button type="button" onClick={onClose} aria-label="Close preview">×</button></header>
    <div className="observatory-preview-body">
      {error ? <p role="status">{error}</p> : file.kind === 'image'
        ? <img src={file.url} alt={file.name} onError={() => setError('This image could not be displayed. Open the original to try another viewer.')} />
        : file.kind === 'video'
          ? <video src={file.url} controls playsInline preload="metadata" onError={() => setError('This video format could not be played by your browser. Open the original to use another viewer.')} />
          : isText ? <pre>{text ?? 'Loading document…'}</pre>
            : pdfSupported ? <iframe src={file.url} title={`Preview of ${file.name}`} /> : <p>This browser does not have an embedded PDF viewer. Use Open original to view or save this document.</p>}
    </div>
    <footer><span>{file.kind === 'document' && !isText ? 'PDF blank? Open the original in your PDF viewer.' : 'Original file · read only'}</span><a href={file.url} target="_blank" rel="noopener noreferrer">Open original ↗</a></footer>
  </dialog>
}

export function ObservatoryClient() {
  const router = useRouter()
  const [collections, setCollections] = useState<ObservatoryCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<ObservatoryFile | null>(null)
  const [preview, setPreview] = useState<ObservatoryFile | null>(null)
  const [query, setQuery] = useState('')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [paused, setPaused] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const returnToTown = useCallback(() => router.push('/town?from=observatory'), [router])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const changed = () => setReducedMotion(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setLoadError('')
    void fetch('/api/observatory', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(`Collections unavailable (${response.status})`)
      const body = await response.json() as { collections: ObservatoryCollection[] }
      if (!Array.isArray(body.collections)) throw new Error('The collection response was incomplete.')
      setCollections(body.collections)
      setSelectedFile(current => current && body.collections.some(collection => collection.files.some(file => file.url === current.url)) ? current : null)
    }).catch(reason => {
      if (!controller.signal.aborted) { setCollections([]); setSelectedFile(null); setLoadError(reason instanceof Error ? reason.message : 'Collections unavailable') }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select') || target.isContentEditable || preview) return
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'Escape') { setSelectedFile(null); setSelectedCollection(null); setQuery(''); setListOpen(false) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [preview])

  const chooseCollection = useCallback((id: string) => {
    setSelectedCollection(id); setSelectedFile(null); setQuery(''); setListOpen(true)
  }, [])
  const chooseFile = useCallback((file: ObservatoryFile) => setSelectedFile(file), [])
  const files = useMemo(() => matchingFiles(collections, selectedCollection, query), [collections, selectedCollection, query])
  const currentCollection = collections.find(collection => collection.id === selectedCollection)
  const total = collections.reduce((sum, collection) => sum + collection.files.length, 0)
  const showingList = listOpen || query.trim().length > 0
  const truncated = collections.some(collection => collection.truncated)

  return <main className="observatory-page" data-testid="cosmic-observatory" data-reduced-motion={reducedMotion || paused}>
    <div className="observatory-atmosphere" aria-hidden="true" />
    <SceneBoundary><Scene collections={collections} selectedCollection={selectedCollection} selectedFileId={selectedFile?.id ?? null} reducedMotion={reducedMotion || paused} onSelectCollection={chooseCollection} onSelectFile={chooseFile} onReturn={returnToTown} /></SceneBoundary>
    <header className="observatory-header">
      <div className="observatory-brand"><span className="observatory-brand-mark" aria-hidden="true">✧</span><div><span className="observatory-eyebrow">BASE / PERSONAL UNIVERSE</span><h1>Cosmic Observatory</h1></div></div>
      <label className="observatory-search"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="Search files" placeholder="Find something in your universe…" value={query} onChange={event => { setQuery(event.target.value); setSelectedFile(null) }} /><kbd>/</kbd>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</label>
      <div className="observatory-header-actions"><button type="button" aria-label={paused ? 'Resume orbital motion' : 'Pause orbital motion'} aria-pressed={paused || reducedMotion} disabled={reducedMotion} onClick={() => setPaused(value => !value)} title={reducedMotion ? 'Reduced motion enabled by your device' : 'Toggle orbital motion'}>{paused || reducedMotion ? '▷' : 'Ⅱ'}</button><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label="Refresh collections">↻</button></div>
    </header>

    <div className="observatory-coordinates" aria-hidden="true"><span>EST. 2026</span><i /><span>YOUR EVERYDAY, ELSEWHERE</span></div>

    {loadError && <div className="observatory-alert" role="alert"><b>Unable to read your collections</b><span>{loadError}</span><button type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {loading && <div className="observatory-loading" role="status"><span />Mapping your collections…</div>}

    <nav className="observatory-worlds" aria-label="Collection worlds">
      {(['images', 'documents', 'videos'] as const).map((id, index) => {
        const collection = collections.find(item => item.id === id)
        const copy = collectionCopy[id]
        const status = !collection ? loading ? 'Mapping…' : 'Unavailable' : collection.status === 'missing' ? 'Folder not found' : collection.status === 'unavailable' ? 'Folder unavailable' : `${collection.files.length}${collection.truncated ? '+' : ''} files`
        return <button key={id} type="button" className={`observatory-world-card${selectedCollection === id ? ' is-active' : ''}`} aria-pressed={selectedCollection === id} onClick={() => chooseCollection(id)} style={{ '--world-color': copy.color } as React.CSSProperties}>
          <span className="observatory-world-symbol" aria-hidden="true">{copy.symbol}</span><span className="observatory-world-copy"><small>0{index + 1} / {copy.eyebrow}</small><b>{collection?.name ?? `${id[0].toUpperCase()}${id.slice(1)}`}</b><span>{status} <i>·</i> {copy.description}</span></span><span className="observatory-world-arrow" aria-hidden="true">↗</span>
        </button>
      })}
    </nav>

    {showingList && <section className="observatory-catalog" aria-label="Files in your collections">
      <header><div><span className="observatory-eyebrow">{query.trim() ? 'SEARCH RESULTS' : 'COLLECTION INDEX'}</span><h2>{currentCollection?.name ?? 'All collections'} <span>{files.length}</span></h2></div><button type="button" aria-label="Close collection index" onClick={() => { setListOpen(false); setQuery('') }}>×</button></header>
      <div className="observatory-catalog-tools"><button type="button" aria-pressed={!selectedCollection} onClick={() => setSelectedCollection(null)}>All collections</button><span>{currentCollection?.rootLabel ?? 'Local files · Web server host'}</span></div>
      {currentCollection?.status === 'missing' ? <p className="observatory-empty">This folder was not found on the Web server host.</p>
        : currentCollection?.status === 'unavailable' ? <p className="observatory-empty">This folder could not be read. Check its permissions, then refresh.</p>
          : !files.length ? <p className="observatory-empty">{loading ? 'Reading files…' : loadError ? 'Files are unavailable until the connection recovers.' : query.trim() ? 'No matching files. Try a different name.' : 'No supported files in this collection yet.'}</p>
            : <div className="observatory-file-list">{files.map(file => <button type="button" className={`observatory-file${selectedFile?.url === file.url ? ' is-selected' : ''}`} key={fileIdentity(file)} onClick={() => chooseFile(file)} onDoubleClick={() => setPreview(file)}>
              <span className="observatory-file-thumb">{file.kind === 'image' ? <img src={file.url} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : <FileGlyph kind={file.kind} />}</span><span><b>{file.name}</b><small>{file.kind} · {fileSize(file.bytes)}</small></span><span aria-hidden="true">↗</span>
            </button>)}</div>}
      {(currentCollection?.truncated || (!selectedCollection && truncated)) && <p className="observatory-limit">Showing a bounded selection. Some files were omitted.</p>}
    </section>}

    {selectedFile && <aside className="observatory-file-detail" aria-label="Selected file">
      <button type="button" className="observatory-detail-close" aria-label="Close file details" onClick={() => setSelectedFile(null)}>×</button>
      <div className={`observatory-detail-art observatory-detail-art--${selectedFile.kind}`}>{selectedFile.kind === 'image' ? <img src={selectedFile.url} alt={selectedFile.name} /> : <FileGlyph kind={selectedFile.kind} />}</div>
      <div className="observatory-detail-info"><span className="observatory-eyebrow">{selectedFile.kind} / ORIGINAL FILE</span><h2>{selectedFile.name}</h2><p>{fileSize(selectedFile.bytes)} · {new Date(selectedFile.modifiedAt).toLocaleDateString()}</p><div className="observatory-detail-actions"><button type="button" onClick={() => setPreview(selectedFile)}>Preview</button><a href={selectedFile.url} target="_blank" rel="noopener noreferrer">Open ↗</a></div></div>
    </aside>}

    <footer className="observatory-footer"><button type="button" className="observatory-return" onClick={returnToTown}><span aria-hidden="true">←</span> Return to Town</button><span className="observatory-controls-hint">DRAG TO ORBIT <i>·</i> SCROLL TO EXPLORE</span><button type="button" className="observatory-index-toggle" aria-expanded={showingList} onClick={() => { setListOpen(value => !value); setQuery('') }}>▦ <span>{loading ? 'Mapping' : `${total}${truncated ? '+' : ''} files`}</span><span>{showingList ? 'Hide index' : 'Browse index'}</span></button></footer>
    {preview && <FilePreview key={preview.url} file={preview} onClose={() => setPreview(null)} />}
  </main>
}
