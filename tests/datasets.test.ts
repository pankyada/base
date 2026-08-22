import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatasetStore } from '../src/datasets/store.js'

const roots: string[] = []

function store(maxBytes?: number): DatasetStore {
  const root = mkdtempSync(join(tmpdir(), 'datasets-'))
  roots.push(root)
  return new DatasetStore(root, maxBytes)
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('dataset store', () => {
  it('keeps client filenames as metadata and rejects unsupported paths and extensions', () => {
    const datasets = store()
    const saved = datasets.upload('alice', { filename: '../../escape.csv', content: Buffer.from('a\n1\n') })

    expect(saved.filename).toBe('../../escape.csv')
    expect(saved.path).not.toContain('escape.csv')
    expect(() => datasets.upload('alice', { filename: 'bad.exe', content: Buffer.from('x') })).toThrow('unsupported')
  })

  it('rejects oversized uploads with 413', () => {
    const datasets = store(3)

    try {
      datasets.upload('alice', { filename: 'small.csv', content: Buffer.from('1234') })
      throw new Error('expected upload to fail')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 413 })
    }
  })

  it('sniffs BOM CSV data with quoted commas, ragged rows, and all-null columns', () => {
    const datasets = store()
    const saved = datasets.upload('alice', { filename: 'data.csv', content: Buffer.from('\ufeffname,score,empty\n"A,B",10,\nC,,\nD,12,\n') })
    const schema = datasets.schema('alice', saved.id)

    expect(schema.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'name', dtype: 'string', nulls: 0 }),
      expect.objectContaining({ name: 'score', dtype: 'number', nulls: 1 }),
      expect.objectContaining({ name: 'empty', dtype: 'null', nulls: 3 }),
    ]))
    expect(datasets.preview('alice', saved.id, 2).rows).toHaveLength(2)
    expect(saved.provenance).toBe('untrusted')
  })

  it('rejects malformed JSON as a client error', () => {
    const datasets = store()
    try {
      datasets.upload('alice', { filename: 'broken.json', content: Buffer.from('{') })
      throw new Error('expected upload to fail')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 })
    }
  })

  it('deletes only datasets in the requesting user namespace', () => {
    const datasets = store()
    const saved = datasets.upload('alice', { filename: 'data.csv', content: Buffer.from('a\n1\n') })
    datasets.upload('bob', { filename: 'other.csv', content: Buffer.from('b\n2\n') })

    datasets.delete('alice', saved.id)
    expect(datasets.list('alice')).toEqual([])
    expect(() => datasets.schema('alice', saved.id)).toThrow('unknown dataset')
    expect(() => datasets.preview('alice', saved.id)).toThrow('unknown dataset')
    expect(() => datasets.delete('bob', saved.id)).toThrow('unknown dataset')
    expect(() => datasets.delete('alice', 'not-valid!')).toThrow('unknown dataset')
  })
})
