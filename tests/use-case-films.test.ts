import { existsSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  films, NODE_BY_ID, ARCH_NODES, ARCH_GROUPS, PLACED_BY_ID, PLACED_NODES, SERVER_BOX, STAGE,
  type Film,
} from '../docs-site/.vitepress/theme/films.js'

const repoRoot = join(__dirname, '..')

function existsInRepo(relativePath: string): boolean {
  return existsSync(join(repoRoot, relativePath))
}

describe('use-case films — architecture model', () => {
  it('every node belongs to a declared group', () => {
    const groups = new Set(ARCH_GROUPS.map(g => g.id))
    for (const node of ARCH_NODES) {
      expect(groups.has(node.group), `node "${node.id}" has unknown group "${node.group}"`).toBe(true)
    }
  })

  it('every node gets a position, and node ids are unique', () => {
    expect(PLACED_NODES).toHaveLength(ARCH_NODES.length)
    expect(new Set(ARCH_NODES.map(n => n.id)).size).toBe(ARCH_NODES.length)
    for (const node of ARCH_NODES) {
      expect(PLACED_BY_ID[node.id], `node "${node.id}" was never placed`).toBeDefined()
    }
  })

  it('lays every node out inside the stage, and server nodes inside the server box', () => {
    for (const node of PLACED_NODES) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.w).toBeLessThanOrEqual(STAGE.width)
      expect(node.y + node.h).toBeLessThanOrEqual(STAGE.height)

      const group = ARCH_GROUPS.find(g => g.id === node.group)!
      if (group.zone !== 'server') continue
      expect(node.x, `${node.id} escapes the server box`).toBeGreaterThanOrEqual(SERVER_BOX.x)
      expect(node.x + node.w).toBeLessThanOrEqual(SERVER_BOX.x + SERVER_BOX.w)
      expect(node.y).toBeGreaterThanOrEqual(SERVER_BOX.y)
      expect(node.y + node.h).toBeLessThanOrEqual(SERVER_BOX.y + SERVER_BOX.h)
    }
  })

  it('nodes within a band do not overlap', () => {
    for (const group of ARCH_GROUPS) {
      const row = PLACED_NODES.filter(n => n.group === group.id).sort((a, b) => a.x - b.x || a.y - b.y)
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1]
        const current = row[i]
        const separated = current.x >= prev.x + prev.w || current.y >= prev.y + prev.h
        expect(separated, `${prev.id} and ${current.id} overlap in group "${group.id}"`).toBe(true)
      }
    }
  })
})

describe('use-case films — anti-drift citations', () => {
  it('covers all four documented use cases exactly once', () => {
    expect(films.map(f => f.id).sort()).toEqual(['assistant', 'coding', 'data', 'ops'])
  })

  for (const film of films) {
    describe(`film: ${film.id}`, () => {
      it('references a profile that exists on disk', () => {
        expect(existsInRepo(film.profile)).toBe(true)
      })

      it('every beat actor and target is a real architecture node', () => {
        for (const beat of film.beats) {
          expect(NODE_BY_ID[beat.actor], `beat ${beat.id}: unknown actor "${beat.actor}"`).toBeDefined()
          if (beat.to) expect(NODE_BY_ID[beat.to], `beat ${beat.id}: unknown target "${beat.to}"`).toBeDefined()
        }
      })

      it('every beat actor and target is in the film\'s cast', () => {
        for (const beat of film.beats) {
          expect(film.cast, `beat ${beat.id}: actor "${beat.actor}" not in cast`).toContain(beat.actor)
          if (beat.to) expect(film.cast, `beat ${beat.id}: target "${beat.to}" not in cast`).toContain(beat.to)
        }
      })

      it('crosses the transport boundary or starts at a trigger', () => {
        // Every scenario must show how work enters the server — either a client
        // comes through ws/rest, or an internal trigger starts the run itself.
        const entry = film.beats.some(b =>
          ['wss', 'rest', 'triggers'].includes(b.actor) || (b.to && ['wss', 'rest'].includes(b.to)),
        )
        expect(entry, `film "${film.id}" never shows how a run enters the server`).toBe(true)
      })

      it('beats are ordered and non-overlapping', () => {
        const beats = film.beats
        for (let i = 1; i < beats.length; i++) {
          expect(
            beats[i].t,
            `beat ${beats[i].id} starts before beat ${beats[i - 1].id} ends`,
          ).toBeGreaterThanOrEqual(beats[i - 1].t + beats[i - 1].dur)
        }
      })

      it('runtime matches the last beat\'s end', () => {
        const last = film.beats[film.beats.length - 1]
        expect(film.runtime).toBe(last.t + last.dur)
      })

      it('cites at least one source path per beat, and every cited path exists', () => {
        for (const beat of film.beats) {
          expect(beat.source.length, `beat ${beat.id} cites no source`).toBeGreaterThan(0)
          for (const path of beat.source) {
            expect(
              existsInRepo(path),
              `film "${film.id}" beat "${beat.id}" cites "${path}", which does not exist in the repo`,
            ).toBe(true)
          }
        }
      })
    })
  }

  it('sanity: films are non-trivial', () => {
    const total = films.reduce((sum: number, f: Film) => sum + f.beats.length, 0)
    expect(total).toBeGreaterThanOrEqual(35)
  })
})
