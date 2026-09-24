import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { GET as getFile, HEAD as headFile } from '../app/api/observatory/file/route'
import {
  getObservatoryCollections,
  resolveObservatoryFile,
  type ObservatoryCollectionId,
} from '../lib/observatory-files'

const tempRoots: string[] = []
async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-observatory-'))
  tempRoots.push(root)
  return root
}
async function put(root: string, collection: ObservatoryCollectionId, name: string, data = 'fixture') {
  const folder = path.join(root, ...({ images: ['Downloads', 'images'], documents: ['Downloads', 'PDFs & Documents'], videos: ['Downloads', 'Videos'] }[collection]))
  await mkdir(folder, { recursive: true })
  const fullPath = path.join(folder, name)
  await writeFile(fullPath, data)
  return fullPath
}
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('observatory file catalog', () => {
  it('lists only immediate regular files with safe kinds and opaque preview URLs', async () => {
    const root = await fixtureRoot()
    await put(root, 'images', 'nebula.webp')
    await put(root, 'images', '.secret.jpg')
    await put(root, 'images', 'unsafe.svg')
    await mkdir(path.join(root, 'Downloads', 'images', 'nested.jpg'), { recursive: true })
    await writeFile(path.join(root, 'Downloads', 'images', 'nested.jpg', 'ignored.jpg'), 'nested')
    await put(root, 'documents', 'guide.pdf')
    const [images, docs, videos] = (await getObservatoryCollections({ root })).collections
    expect(images).toMatchObject({ id: 'images', status: 'ready', truncated: false })
    expect(images.files.map((file) => file.name)).toEqual(['nebula.webp'])
    expect(images.files[0]).toMatchObject({ kind: 'image', bytes: 7 })
    expect(images.files[0].url).toMatch(/^\/api\/observatory\/file\?collection=images&id=/)
    expect(images.files[0].url).not.toContain('nebula.webp')
    expect(docs.files.map((file) => file.name)).toEqual(['guide.pdf'])
    expect(videos).toMatchObject({ id: 'videos', status: 'missing', files: [] })
  })

  it('serves collection files by opaque ids and rejects traversal, malformed ids, hidden files and unknown types', async () => {
    const root = await fixtureRoot()
    const visible = await put(root, 'documents', 'space name.md', 'hello')
    await put(root, 'documents', '.private.md')
    await put(root, 'documents', 'payload.html')
    const id = Buffer.from('space name.md').toString('base64url')
    expect(path.basename((await resolveObservatoryFile('documents', id, { root }))?.path ?? '')).toBe(path.basename(visible))
    for (const bad of ['..', Buffer.from('../outside.md').toString('base64url'), Buffer.from('.private.md').toString('base64url'), '%%%']) {
      await expect(resolveObservatoryFile('documents', bad, { root })).resolves.toBeNull()
    }
    await expect(resolveObservatoryFile('images', id, { root })).resolves.toBeNull()
  })

  it('does not follow symlinks, including links that escape the allowlisted root', async () => {
    const root = await fixtureRoot()
    const secret = path.join(root, 'outside.pdf')
    await writeFile(secret, 'secret')
    const folder = path.join(root, 'Downloads', 'PDFs & Documents')
    await mkdir(folder, { recursive: true })
    await symlink(secret, path.join(folder, 'escape.pdf'))
    const result = (await getObservatoryCollections({ root })).collections.find((c) => c.id === 'documents')!
    expect(result.files).toEqual([])
    await expect(resolveObservatoryFile('documents', Buffer.from('escape.pdf').toString('base64url'), { root })).resolves.toBeNull()
  })

  it('bounds the returned list and marks truncation only when additional files exist', async () => {
    const root = await fixtureRoot()
    const folder = path.join(root, 'Downloads', 'images')
    await mkdir(folder, { recursive: true })
    await Promise.all(Array.from({ length: 140 }, (_, index) => writeFile(path.join(folder, `${String(index).padStart(3, '0')}.jpg`), 'x')))
    const result = (await getObservatoryCollections({ root, maxFiles: 12 })).collections[0]
    expect(result.files).toHaveLength(12)
    expect(result.truncated).toBe(true)
    const exactRoot = await fixtureRoot()
    const exactFolder = path.join(exactRoot, 'Downloads', 'images')
    await mkdir(exactFolder, { recursive: true })
    await Promise.all(Array.from({ length: 12 }, (_, index) => writeFile(path.join(exactFolder, `${String(index).padStart(3, '0')}.jpg`), 'x')))
    const exact = (await getObservatoryCollections({ root: exactRoot, maxFiles: 12 })).collections[0]
    expect(exact.files).toHaveLength(12)
    expect(exact.truncated).toBe(false)
  })

  it('rejects symlinked Downloads and collection roots during listing and file resolution', async () => {
    for (const linkDownloads of [true, false]) {
      const root = await fixtureRoot()
      const actual = path.join(root, 'real')
      const actualImages = linkDownloads ? path.join(actual, 'images') : path.join(root, 'Downloads', 'real-images')
      await mkdir(actualImages, { recursive: true })
      await writeFile(path.join(actualImages, 'linked.jpg'), 'linked')
      if (linkDownloads) {
        await symlink(actual, path.join(root, 'Downloads'))
      } else {
        await mkdir(path.join(root, 'Downloads'), { recursive: true })
        await symlink(actualImages, path.join(root, 'Downloads', 'images'))
      }
      const listed = (await getObservatoryCollections({ root })).collections[0]
      expect(listed.status).toBe('unavailable')
      expect(listed.files).toEqual([])
      await expect(resolveObservatoryFile('images', Buffer.from('linked.jpg').toString('base64url'), { root })).resolves.toBeNull()
    }
  })

  it('marks an existing but inaccessible or invalid collection root unavailable without exposing paths', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'Downloads', 'images'), { recursive: true })
    await writeFile(path.join(root, 'Downloads', 'PDFs & Documents'), 'not a directory')
    const results = (await getObservatoryCollections({ root })).collections
    expect(results.find((c) => c.id === 'images')?.status).toBe('ready')
    expect(results.find((c) => c.id === 'documents')).toMatchObject({ status: 'unavailable', files: [] })
    expect(JSON.stringify(results)).not.toContain(root)
  })
})


describe('observatory file route', () => {
  const originalRoot = process.env.HARNESS_OBSERVATORY_ROOT
  afterEach(() => {
    if (originalRoot === undefined) delete process.env.HARNESS_OBSERVATORY_ROOT
    else process.env.HARNESS_OBSERVATORY_ROOT = originalRoot
  })

  it('streams a bounded byte range with safe type and nosniff headers, and supports HEAD', async () => {
    const root = await fixtureRoot()
    process.env.HARNESS_OBSERVATORY_ROOT = root
    await put(root, 'videos', 'clip.mp4', '0123456789')
    const url = `http://localhost/api/observatory/file?collection=videos&id=${Buffer.from('clip.mp4').toString('base64url')}`
    const response = await getFile(new Request(url, { headers: { range: 'bytes=2-5' } }))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('2345')
    const head = await headFile(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
  })

  it('returns empty files with correct GET and HEAD lengths and rejects ranges on empty files', async () => {
    const root = await fixtureRoot()
    process.env.HARNESS_OBSERVATORY_ROOT = root
    await put(root, 'documents', 'empty.txt', '')
    const url = `http://localhost/api/observatory/file?collection=documents&id=${Buffer.from('empty.txt').toString('base64url')}`
    const get = await getFile(new Request(url))
    expect(get.status).toBe(200)
    expect(get.headers.get('content-length')).toBe('0')
    expect(await get.text()).toBe('')
    const head = await headFile(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('0')
    const range = await getFile(new Request(url, { headers: { range: 'bytes=0-' } }))
    expect(range.status).toBe(416)
    expect(range.headers.get('content-range')).toBe('bytes */0')
  })

  it('supports suffix ranges, rejects unsatisfiable ranges, and denies cross-origin preview requests', async () => {
    const root = await fixtureRoot()
    process.env.HARNESS_OBSERVATORY_ROOT = root
    await put(root, 'documents', 'manual.pdf', 'abcdef')
    const url = `http://localhost/api/observatory/file?collection=documents&id=${Buffer.from('manual.pdf').toString('base64url')}`
    const suffix = await getFile(new Request(url, { headers: { range: 'bytes=-2' } }))
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-type')).toBe('application/pdf')
    expect(await suffix.text()).toBe('ef')
    const invalid = await getFile(new Request(url, { headers: { range: 'bytes=9-' } }))
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */6')
    const crossOrigin = await getFile(new Request(url, { headers: { origin: 'https://attacker.example' } }))
    expect(crossOrigin.status).toBe(403)
  })
})
