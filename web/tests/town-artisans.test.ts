import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ARTISAN_LOOKS, artisanSlots, artisanStatus, artisanWorldPoint, rosterOrder, simplifyRoute, stagingReason, townRoadGraph, townWalkRoute, type ArtisanRecord, type ArtisanTask } from '../app/town/town-artisans'
import { GUILD_HALL_SITE, layoutProjects, STAGING_SITE, TOWN_CIVIC_SITES } from '../app/town/town-model'
import { createTownAssetLibrary } from '../app/town/town-assets'
import type { TownCommunicationMessage } from '../app/town/town-world-model'

const now = Date.parse('2026-09-25T12:00:00Z')
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
const agent = (patch: Partial<ArtisanRecord> = {}): ArtisanRecord => ({ id: 'artisan-vishwakarma', display_name: 'Vishwakarma', persona: 'vishwakarma', craft: 'builder', lifecycle: 'persistent', state: 'idle', ...patch })
const task = (patch: Partial<ArtisanTask>): ArtisanTask => ({ id: 't1', project_id: 'repo-a', title: 'Build it', state: 'ready', agent_id: 'artisan-vishwakarma', updated_at: iso(1), ...patch })
const question = (taskId: string): TownCommunicationMessage => ({ project_id: 'repo-a', task_id: taskId, from: 'artisan-vishwakarma', to: 'user', kind: 'question', state: 'delivered', continuation_id: 'c1' })
const status = (a: ArtisanRecord, tasks: ArtisanTask[], messages: TownCommunicationMessage[] = [], live = true) => artisanStatus(a, tasks, messages, 'user', live, now)

describe('artisan place and pose projection (PT-116 table)', () => {
  it('rests an idle artisan at the Guild Hall', () => {
    expect(status(agent(), [])).toMatchObject({ place: 'guild', pose: 'rest', lamp: 'idle', needsYou: false })
  })

  it('holds queued and dispatching orders at staging with the truthful gate reason', () => {
    expect(status(agent(), [task({ state: 'queued_quota', block_reason: 'quota' })])).toMatchObject({ place: 'staging', pose: 'stand', lamp: 'queued', detail: 'Waiting for provider capacity' })
    expect(status(agent(), [task({ state: 'queued_concurrency', block_reason: 'agent_busy' })]).detail).toBe('Finishing earlier work first')
    expect(status(agent(), [task({ state: 'dispatching' })])).toMatchObject({ place: 'staging', label: 'Setting out' })
    expect(stagingReason({ state: 'queued_workspace', block_reason: 'workspace' })).toBe('Workshop in use by another artisan')
  })

  it('works at the house only with complete run linkage', () => {
    const running = task({ state: 'running', session_id: 's1', run_id: 'r1' })
    expect(status(agent({ task_id: 't1', session_id: 's1', run_id: 'r1', last_activity_at: iso(0.1) }), [running])).toMatchObject({ place: 'house', pose: 'work', lamp: 'working', projectId: 'repo-a', toolActive: true })
    expect(status(agent({ task_id: 't1', session_id: 's1', run_id: 'other' }), [running])).toMatchObject({ place: 'staging', lamp: 'unknown' })
    expect(status(agent({ task_id: 't1', session_id: 's1', run_id: 'r1', last_activity_at: iso(5) }), [running]).toolActive).toBe(false)
  })

  it('raises the leaf at the gate only for an open question', () => {
    const waiting = task({ state: 'waiting_user' })
    expect(status(agent(), [waiting], [question('t1')])).toMatchObject({ place: 'gate', pose: 'raise', lamp: 'attention', needsYou: true })
    expect(status(agent(), [waiting], [])).toMatchObject({ place: 'gate', pose: 'still', lamp: 'unknown', needsYou: false })
  })

  it('shows blocked, failed and completed truthfully without mocking the figure', () => {
    expect(status(agent(), [task({ state: 'blocked', block_reason: 'needs credentials' })])).toMatchObject({ place: 'gate', pose: 'still', lamp: 'alert' })
    expect(status(agent(), [task({ state: 'failed', terminal_evidence: 'tests failed' })])).toMatchObject({ place: 'guild', pose: 'still', lamp: 'alert', label: 'Last order failed' })
    expect(status(agent(), [task({ state: 'completed', updated_at: iso(5) })])).toMatchObject({ place: 'guild', lamp: 'done' })
    expect(status(agent(), [task({ state: 'completed', updated_at: iso(120) })])).toMatchObject({ place: 'guild', lamp: 'idle' })
  })

  it('prefers active work over queued orders and counts the extra queue', () => {
    const running = task({ id: 't1', state: 'running', session_id: 's1', run_id: 'r1' })
    const later = task({ id: 't2', state: 'queued_concurrency', block_reason: 'agent_busy' })
    expect(status(agent({ task_id: 't1', session_id: 's1', run_id: 'r1' }), [running, later])).toMatchObject({ place: 'house', queuedCount: 1 })
  })

  it('keeps the last known place translucent when disconnected', () => {
    const running = task({ state: 'running', session_id: 's1', run_id: 'r1' })
    expect(status(agent({ task_id: 't1', session_id: 's1', run_id: 'r1' }), [running], [], false)).toMatchObject({ place: 'house', pose: 'still', lamp: 'unknown', ghost: true, toolActive: false })
  })

  it('orders the roster with needs-you first, then trouble, work, queue and rest', () => {
    const make = (persona: string, lamp: ArtisanTask['state'], extra: Partial<ArtisanTask> = {}) => {
      const id = `artisan-${persona}`
      return status(agent({ id, persona, display_name: persona, task_id: id, session_id: 's', run_id: 'r' }), [task({ id: `task-${persona}`, agent_id: id, state: lamp, session_id: 's', run_id: 'r', ...extra })], lamp === 'waiting_user' ? [{ ...question(`task-${persona}`), from: id }] : [])
    }
    const order = rosterOrder([
      status(agent({ id: 'artisan-panini', persona: 'panini', display_name: 'Panini' }), []),
      make('aryabhata', 'queued_quota', { block_reason: 'quota' }),
      make('gargi', 'failed'),
      make('sushruta', 'waiting_user'),
    ]).map(item => item.persona)
    expect(order).toEqual(['sushruta', 'gargi', 'aryabhata', 'panini'])
  })
})

describe('artisan world placement and road walking', () => {
  const project = (id: string) => ({ id, path: `/code/${id}`, display: { name: id }, git: { status: 'known', last_commit_at: iso(60) } })
  const layout = layoutProjects(Array.from({ length: 30 }, (_, index) => project(`repo-${index}`)), new Set(['repo-0']), new Set(), now)

  it('reserves the Guild Hall and staging mandapam away from every lot', () => {
    for (const lot of layout.values()) {
      for (const site of TOWN_CIVIC_SITES) {
        const dx = Math.max(0, Math.abs(lot.x - site.x) - lot.lotWidth / 2 - site.width / 2)
        const dz = Math.max(0, Math.abs(lot.z - site.z) - lot.lotDepth / 2 - site.depth / 2)
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(site.clearance)
      }
    }
  })

  it('places each projected state at its site and spreads shared places into slots', () => {
    const guild = artisanWorldPoint({ place: 'guild' }, layout, 0)
    expect(Math.abs(guild.z - GUILD_HALL_SITE.z)).toBeLessThan(6)
    expect(guild.x).toBeGreaterThan(GUILD_HALL_SITE.x)
    const staging = artisanWorldPoint({ place: 'staging', projectId: 'repo-0' }, layout, 1)
    expect(Math.abs(staging.x - STAGING_SITE.x)).toBeLessThan(STAGING_SITE.width / 2)
    const lot = layout.get('repo-0')!
    const gate = artisanWorldPoint({ place: 'gate', projectId: 'repo-0' }, layout, 1)
    expect(gate).toEqual({ x: lot.entrance.x, z: lot.entrance.z })
    const bench = artisanWorldPoint({ place: 'house', projectId: 'repo-0' }, layout, 1)
    expect(Math.hypot(bench.x - lot.x, bench.z - lot.z)).toBeLessThan(Math.hypot(gate.x - lot.x, gate.z - lot.z))
    expect(artisanWorldPoint({ place: 'house', projectId: 'missing' }, layout, 0)).toEqual(artisanWorldPoint({ place: 'staging' }, layout, 0))
    const slots = artisanSlots([
      status(agent({ id: 'a', persona: 'panini' }), []),
      status(agent({ id: 'b', persona: 'gargi' }), []),
    ])
    expect(new Set(slots.values())).toEqual(new Set([0, 1]))
  })

  it('walks from the Guild Hall through staging to a project along connected roads', () => {
    const graph = townRoadGraph(layout.roads)
    const from = artisanWorldPoint({ place: 'guild' }, layout, 0)
    const to = artisanWorldPoint({ place: 'house', projectId: 'repo-7' }, layout, 0)
    const route = townWalkRoute(layout, from, to, graph)
    expect(route[0]).toEqual(from)
    expect(route.at(-1)).toEqual(to)
    expect(route.length).toBeGreaterThan(3)
    const interior = route.slice(1, -1)
    for (const point of interior) expect(graph.has(`${point.x},${point.z}`)).toBe(true)
    // Guild Hall and staging share the temple approach, so the walk passes the mandapam's road.
    expect(interior.some(point => Math.abs(point.x) <= 2 && Math.abs(point.z - STAGING_SITE.z) <= 4)).toBe(true)
  })

  it('drops collinear waypoints', () => {
    expect(simplifyRoute([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }])).toEqual([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }])
  })
})

describe('artisan assets', () => {
  it('builds an articulated figure with a status lamp for every catalog artisan', () => {
    const library = createTownAssetLibrary()
    for (const look of ARTISAN_LOOKS) {
      const figure = library.createArtisan(look)
      expect(figure.userData.persona).toBe(look.key)
      expect(figure.getObjectByName('statusLamp')).toBeTruthy()
      expect(figure.getObjectByName('lampFlame')).toBeTruthy()
      expect(figure.getObjectByName('orderLeaf')?.visible).toBe(false)
      expect((figure.userData.legs as THREE.Object3D[]).length).toBe(look.form === 'nandi' ? 4 : 2)
      if (look.form !== 'nandi') expect(figure.getObjectByName('craftProp')).toBeTruthy()
      const bounds = new THREE.Box3().setFromObject(figure)
      expect(bounds.max.y).toBeGreaterThan(2.8)
      expect(bounds.max.y).toBeLessThan(4.5)
    }
    const lit = library.artisanLampMaterial('attention') as THREE.MeshStandardMaterial
    expect(lit.emissiveIntensity).toBeGreaterThan(1)
    expect(library.artisanLampMaterial('attention')).toBe(lit)
    library.dispose()
  })

  it('builds the Guild Hall and staging mandapam within their reserved footprints', () => {
    const library = createTownAssetLibrary()
    for (const [asset, site] of [[library.createGuildHall('g'), GUILD_HALL_SITE], [library.createStagingMandapam('s'), STAGING_SITE]] as const) {
      asset.rotation.y = site.facing * Math.PI / 2
      asset.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(asset)
      expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(site.width + .5)
      expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(site.depth + .5)
    }
    library.dispose()
  })
})
