import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  listServers,
  matchingServers,
  registerServer,
  removeServerRecord,
  serverRecordFor,
} from '../src/server/process-registry.js'

describe('server process registry', () => {
  it('registers live servers and identifies stale records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-servers-'))
    try {
      registerServer({ ...serverRecordFor(7337, 'coding', ['coding'], process.cwd()), pid: process.pid }, directory)
      registerServer({ ...serverRecordFor(7338, 'old', ['old'], process.cwd()), pid: 99999999 }, directory)

      expect(listServers(directory).map(server => [server.port, server.status])).toEqual([
        [7337, 'running'],
        [7338, 'stale'],
      ])
      expect(matchingServers('coding', directory).map(server => server.port)).toEqual([7337])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('removes only the matching server record', () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-servers-'))
    try {
      const record = { ...serverRecordFor(7337, 'coding', ['coding'], process.cwd()), pid: process.pid }
      registerServer(record, directory)
      removeServerRecord(record, directory)
      expect(listServers(directory)).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
