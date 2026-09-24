import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export default async function globalTeardown() {
  const isolatedNextDist = process.env.NEXT_DIST_DIR
  if (isolatedNextDist && resolve(dirname(isolatedNextDist)) === resolve(tmpdir()) && basename(isolatedNextDist).startsWith('base-town-pt104-next-')) {
    await rm(isolatedNextDist, { recursive: true, force: true })
  }
}
