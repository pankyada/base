'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { BuildingForm, TownBuildingAppearance, TownCluster, TownLayout, TownPosition, TownRoadPoint } from './town-model'
import { GUILD_HALL_SITE, STAGING_SITE, projectBuildingAppearance, TEMPLE_CAMPUS, TEMPLE_SITE, townCentralDistrictRadius, townGroveSites, townOverviewDistance } from './town-model'
import { createTownAssetLibrary } from './town-assets'
import { artisanLook, artisanSlots, artisanStatus, artisanWorldPoint, isArtisan, townRoadGraph, townWalkRoute, type ArtisanRecord, type ArtisanStatus, type ArtisanTask } from './town-artisans'
import { createTownPopulation } from './town-population'
import { createTownWanderNetwork, planTownWanderRoute, townIslandAt, type TownWanderNetwork } from './town-wandering'
import { createTownBillboardLibrary, type TownBillboard } from './town-billboards'
import type { ObservatoryReturnView } from './town-portal-state'
import { townCameraDistance, townCameraFarPlane, townCameraMaxDistance } from './town-camera-state'
import { forEachExploreBox } from './town-explore-scene'
import { createExploreColliderGrid, createExploreSolidGrid, emptyExploreKeys, exploreCameraClearance, exploreGroundAt, exploreSolidFromBox, EXPLORE_KEY_MAP, EXPLORE_RUN_SPEED, EXPLORE_WALK_SPEED, exploreColliderFromBox, exploreMoveDirection, exploreSeekDirection, exploreSpawnPoint, exploreTargetVerb, nearestExploreTarget, resolveExploreMove, type ExploreCollider, type ExploreColliderGrid, type ExploreSolid, type ExploreSolidGrid, type ExploreTarget, type ExploreVec } from './town-explore'
import { HISTORICAL_REFERENCES, nightLampSites, projectAgentPresence, townBillboardSlides, townFrontagePlan, TOWN_DEFAULT_CAMERA_POSITION_DIRECTION, TOWN_MOON_DIRECTION, townCommunicationMarker, townLayoutStamp, townSceneLighting, workerAnimation, type AgentPresence, type TownAgentRecord, type TownBillboardSlide, type TownCommunicationMessage, type TownMode, type TownTaskRecord } from './town-world-model'

export interface TownSceneProject {
  id: string
  display: { name: string }
  size?: { status: string; tracked_regular_files?: number }
}

interface Props {
  projects: TownSceneProject[]
  agents: TownAgentRecord[]
  tasks: TownTaskRecord[]
  messages: TownCommunicationMessage[]
  userId: string
  layout: TownLayout
  activeProjectIds: Set<string>
  pinnedProjectIds: Set<string>
  selected?: string
  layoutRevision: number
  mode: TownMode
  labelsVisible: boolean
  reducedMotion: boolean
  liveConnected: boolean
  onSelect: (id: string) => void
  onSelectAgent: (person: AgentPresence) => void
  onSelectDiscovery: (id: string) => void
  onSelectHall: () => void
  onReady: (controls: OrbitControls) => void
  onFocusReady: (focus: ((id: string) => void) | null) => void
  onOverviewReady: (overview: (() => void) | null) => void
  onEnterObservatory?: () => void
  /** Persistent artisan click (roster card); legacy agents keep onSelectAgent. */
  onSelectArtisan?: (id: string) => void
  /** While true, a house click chooses the project for the pending assignment instead of opening its card. */
  pickMode?: boolean
  onPickProject?: (id: string) => void
  /** Screen-point project lookup for dropping a roster portrait onto a house. */
  onDropReady?: (pick: ((clientX: number, clientY: number) => string | undefined) | null) => void
  initialViewPose?: Pick<ObservatoryReturnView, 'position' | 'target'> | null
  /** Explore on foot: a traveller avatar replaces the free orbit camera. */
  exploring?: boolean
  onExploreExit?: () => void
  /** Nearest thing the traveller can act on, or null when nothing is in reach. */
  onExplorePrompt?: (prompt: TownExplorePrompt | null) => void
}

export interface TownExplorePrompt { id: string; label: string; run: () => void }

const TILE_SIZE = 200
const TILE_RADIUS = 5
const MAX_PAN = 360

function cameraPoseFrom(value: string | undefined): { position: THREE.Vector3; target: THREE.Vector3 } | undefined {
  if (!value) return undefined
  const [positionRaw, targetRaw] = value.split(':')
  const parseVector = (raw: string | undefined) => {
    const values = raw?.split(',').map(Number)
    return values?.length === 3 && values.every(Number.isFinite) ? new THREE.Vector3(...values as [number, number, number]) : undefined
  }
  const position = parseVector(positionRaw), target = parseVector(targetRaw)
  return position && target ? { position, target } : undefined
}

function applyTownSceneMode(
  mode: TownMode,
  scene: THREE.Scene,
  fog: THREE.Fog,
  hemisphere: THREE.HemisphereLight,
  moon: THREE.DirectionalLight,
  ground: THREE.MeshStandardMaterial,
  sky: THREE.Mesh,
  lamps: THREE.PointLight[],
  labels: CSS2DObject[],
): void {
  const lighting = townSceneLighting(mode)
  scene.background = new THREE.Color(lighting.sky)
  fog.color.setHex(lighting.sky)
  hemisphere.intensity = lighting.hemisphere
  hemisphere.color.setHex(lighting.hemisphereColor)
  hemisphere.groundColor.setHex(lighting.groundFill)
  moon.color.setHex(lighting.directionalColor)
  moon.intensity = lighting.directional
  moon.castShadow = lighting.shadows
  if (mode === 'night') moon.position.set(TOWN_MOON_DIRECTION.x, TOWN_MOON_DIRECTION.y, TOWN_MOON_DIRECTION.z).normalize().multiplyScalar(240)
  else moon.position.set(-120, 220, 80)
  ground.color.setHex(lighting.ground)
  sky.visible = mode === 'night'
  for (const lamp of lamps) lamp.intensity = lighting.lamp
  for (const label of labels) {
    if (!label.element.classList.contains('town-map-label')) label.element.dataset.theme = mode
  }
}

function seedOf(value: string): number {
  let seed = 0x811c9dc5
  for (const character of value) seed = Math.imul(seed ^ character.charCodeAt(0), 0x01000193)
  return seed >>> 0
}

function buildRibbon(paths: TownRoadPoint[][], width: number, offset: number, y: number): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const path of paths) {
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1], b = path[index]
      const dx = b.x - a.x, dz = b.z - a.z
      const length = Math.hypot(dx, dz)
      if (length < .001) continue
      const nx = -dz / length, nz = dx / length
      const start = positions.length / 3
      const left = offset - width / 2, right = offset + width / 2
      positions.push(a.x + nx * left, y, a.z + nz * left)
      positions.push(a.x + nx * right, y, a.z + nz * right)
      positions.push(b.x + nx * right, y, b.z + nz * right)
      positions.push(b.x + nx * left, y, b.z + nz * left)
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function sceneMaterial(color: number, materialPool: Set<THREE.Material>, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .93, ...options })
  materialPool.add(material)
  return material
}

// Deterministic per-angle radius wobble so an island reads as an eroded landmass
// rather than a perfect disc. Same seed reused for shore + land keeps their
// outlines roughly parallel.
function islandOutline(seed: number, segments: number): number[] {
  const waves = [
    { count: 2 + (seed % 3), amp: .16, phase: (seed % 1000) / 1000 },
    { count: 5 + (seed % 4), amp: .09, phase: ((seed >>> 8) % 1000) / 1000 },
    { count: 9 + (seed % 5), amp: .05, phase: ((seed >>> 16) % 1000) / 1000 },
  ]
  const radii: number[] = []
  for (let index = 0; index <= segments; index++) {
    const angle = (index / segments) * Math.PI * 2
    let multiplier = 1
    for (const wave of waves) multiplier += Math.sin(angle * wave.count + wave.phase * Math.PI * 2) * wave.amp
    radii.push(multiplier)
  }
  radii[segments] = radii[0]!
  return radii
}

// A single-point fan (like CircleGeometry) packs many razor-thin triangles
// into the centre; once an island is small on screen (the usual overview
// distance) those sub-pixel wedges alias into visible radiating streaks.
// Triangulating the outline as a polygon (earcut, no shared apex) keeps
// triangles reasonably sized at any zoom and renders as flat, clean fill.
function blobGeometry(baseRadius: number, outline: number[]): THREE.BufferGeometry {
  const segments = outline.length - 1
  const shape = new THREE.Shape()
  for (let index = 0; index <= segments; index++) {
    const angle = (index / segments) * Math.PI * 2
    const radius = baseRadius * outline[index]!
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius
    if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y)
  }
  return new THREE.ShapeGeometry(shape, 1)
}

function addMesh(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, resources: Set<THREE.BufferGeometry>): THREE.Mesh {
  resources.add(geometry)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  scene.add(mesh)
  return mesh
}

function makeWorldSky(resources: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1500, 32, 24)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMoonDirection: { value: new THREE.Vector3(TOWN_MOON_DIRECTION.x, TOWN_MOON_DIRECTION.y, TOWN_MOON_DIRECTION.z).normalize() },
      uMoonRadius: { value: .012 },
      uMoonColor: { value: new THREE.Color(0xfff3d0) },
      uHaloColor: { value: new THREE.Color(0xc4c5b9) },
      uHorizon: { value: new THREE.Color(0x363c3b) },
      uZenith: { value: new THREE.Color(0x24272a) },
    },
    vertexShader: `varying vec3 vWorldDirection;
      void main() {
        vWorldDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 uMoonDirection;
      uniform float uMoonRadius;
      uniform vec3 uMoonColor;
      uniform vec3 uHaloColor;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      varying vec3 vWorldDirection;
      float starHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 direction = normalize(vWorldDirection);
        float elevation = smoothstep(-0.2, 0.72, direction.y);
        vec3 color = mix(uHorizon, uZenith, elevation);
        float alignment = dot(direction, normalize(uMoonDirection));
        float disc = smoothstep(cos(uMoonRadius + 0.0015), cos(uMoonRadius - 0.0015), alignment);
        float halo = exp(-max(0.0, 1.0 - alignment) * 180.0);
        float stars = step(0.99935, starHash(floor(direction * 230.0))) * smoothstep(-0.03, 0.42, direction.y);
        color += uMoonColor * disc * 1.4 + uHaloColor * halo * 0.13 + vec3(0.46, 0.48, 0.47) * stars * 0.48;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  })
  const sky = new THREE.Mesh(geometry, material)
  sky.name = 'World-oriented moonlit sky'
  sky.renderOrder = -1000
  sky.visible = false
  resources.add(geometry); materials.add(material)
  return sky
}

function makeCloud(seed: number, resources: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>): THREE.Group {
  const group = new THREE.Group()
  const material = sceneMaterial(0xe5f0ed, materials, { roughness: 1 })
  const cloudGeometry = new THREE.SphereGeometry(4.2, 8, 6)
  resources.add(cloudGeometry)
  const shapes = [[0, 0, 0, 1.2], [3.3, .8, 0, .9], [-3.5, .5, .3, .85], [1.4, 1.7, .2, .74]]
  for (const [x, y, z, scale] of shapes) {
    const puff = new THREE.Mesh(cloudGeometry, material)
    puff.position.set(x * (seed % 3 ? 1 : -1), y, z)
    puff.scale.set(scale, .42 + scale * .17, .66 + scale * .12)
    group.add(puff)
  }
  group.userData.seed = seed
  return group
}

function makeBird(seed: number, resources: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>): THREE.Group {
  const group = new THREE.Group()
  const bodyGeometry = new THREE.SphereGeometry(.22, 6, 5)
  const bodyMaterial = sceneMaterial(0x554c3d, materials, { roughness: 1 })
  resources.add(bodyGeometry)
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.scale.set(1.5, .65, .65)
  group.add(body)
  const wingGeometry = new THREE.BufferGeometry()
  wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,-.75,.02,.05,-.13,.02,.52,0,0,0,.13,.02,.52,.75,.02,.05], 3))
  wingGeometry.computeVertexNormals(); resources.add(wingGeometry)
  const wingMaterial = sceneMaterial(0x463e34, materials, { side: THREE.DoubleSide, roughness: 1 })
  const left = new THREE.Mesh(wingGeometry, wingMaterial), right = new THREE.Mesh(wingGeometry, wingMaterial)
  left.name = 'leftWing'; right.name = 'rightWing'; left.position.x = -.08; right.position.x = .08; group.add(left, right)
  group.userData.seed = seed
  return group
}

function addDiscoveryLabel(site: { id: string; title: string }, scene: THREE.Scene, onChoose: (id: string) => void, labels: CSS2DObject[]): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'town-discovery-mark'
  button.textContent = '✧'
  button.setAttribute('aria-label', `Historical reference: ${site.title}`)
  button.dataset.discoveryId = site.id
  button.addEventListener('click', event => { event.stopPropagation(); onChoose(site.id) })
  const label = new CSS2DObject(button)
  label.position.set(0, 2.7, 0)
  scene.add(label)
  labels.push(label)
}

const WALK_SPEED = 7.5
const ghostMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, transparent: true, opacity: .38, depthWrite: false, roughness: 1 })

/** Connection lost: show the last known place as a translucent figure without implying progress. */
function setGhost(group: THREE.Group, ghost: boolean): void {
  if (Boolean(group.userData.ghost) === ghost) return
  group.userData.ghost = ghost
  group.traverse(child => {
    const item = child as THREE.Mesh
    if (!item.isMesh || item.name === 'lampFlame') return
    if (ghost) { item.userData.liveMaterial = item.material; item.material = ghostMaterial }
    else if (item.userData.liveMaterial) { item.material = item.userData.liveMaterial as THREE.Material; delete item.userData.liveMaterial }
  })
}

function setLimbs(group: THREE.Group, legSwing: number, armSwing: number, armLift = 0): void {
  for (const leg of (group.userData.legs as THREE.Object3D[] | undefined) ?? []) leg.rotation.x = legSwing * Number(leg.userData.swing ?? 1)
  const arms = (group.userData.arms as THREE.Object3D[] | undefined) ?? []
  for (const arm of arms) arm.rotation.x = -armSwing * Number(arm.userData.swing ?? 1)
  if (armLift && arms[0]) arms[0].rotation.x = armLift
}

/** Ambient residents are decorative only; their small idle/greeting motion carries no work state. */
function animateTownsperson(groups: THREE.Group[], delta: number, elapsed: number, reducedMotion: boolean, network: TownWanderNetwork): void {
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]!
    const phase = elapsed * .75 + Number(group.userData.phase ?? 0)
    const body = group.userData.body as THREE.Object3D | undefined
    if (reducedMotion) {
      setLimbs(group, 0, 0)
      if (body) body.position.y = 0
      continue
    }
    const route = group.userData.wanderRoute as Array<{ x: number; z: number }> | undefined
    if (group.userData.wander && route) {
      const speed = Number(group.userData.wanderSpeed ?? 3)
      if (route.length) {
        const next = route[0]!
        const dx = next.x - group.position.x, dz = next.z - group.position.z
        const distance = Math.hypot(dx, dz)
        const step = speed * Math.max(0, Math.min(.05, delta))
        if (distance <= Math.max(step, .001)) { group.position.set(next.x, 0, next.z); route.shift() }
        else { group.position.x += dx / distance * step; group.position.z += dz / distance * step }
        if (distance > .001) group.rotation.y = Math.atan2(dx, dz)
        setLimbs(group, Math.sin(elapsed * 7 + Number(group.userData.phase ?? 0)) * .52, Math.sin(elapsed * 7 + Number(group.userData.phase ?? 0)) * .42)
        if (body) body.position.y = Math.abs(Math.sin(elapsed * 7 + Number(group.userData.phase ?? 0))) * .045
        if (!route.length) {
          group.userData.island = group.userData.destinationIsland
          group.userData.wanderDestination = null
          group.userData.wanderDwell = Number(group.userData.nextDwell ?? 4)
        }
        continue
      }
      group.userData.wanderDwell = Math.max(0, Number(group.userData.wanderDwell ?? 0) - Math.max(0, Math.min(.05, delta)))
      if (group.userData.wanderDwell <= 0) {
        const trip = Number(group.userData.wanderTrip ?? 0) + 1
        group.userData.wanderTrip = trip
        const random = seedOf(`${group.userData.seed}:${trip}`) / 4_294_967_296
        const plan = planTownWanderRoute(network, { x: group.position.x, z: group.position.z, island: String(group.userData.island ?? '') }, String(group.userData.seed), random)
        if (plan) {
          group.userData.wanderRoute = plan.route.slice(1)
          group.userData.wanderSpeed = plan.speed
          group.userData.nextDwell = plan.dwellSeconds
          group.userData.destinationIsland = plan.destination.island
          group.userData.wanderDestination = { x: plan.destination.x, z: plan.destination.z }
        } else group.userData.wanderDwell = 3
      }
      const greeting = group.userData.sceneryPose === 'greet'
      setLimbs(group, greeting ? Math.sin(phase) * .035 : Math.sin(phase) * .06, greeting ? Math.sin(phase) * .025 : Math.sin(phase) * .045, greeting ? -1.45 + Math.sin(phase) * .08 : 0)
      if (body) body.position.y = Math.sin(phase) * .018
      continue
    }
    const greeting = group.userData.sceneryPose === 'greet'
    setLimbs(group, greeting ? Math.sin(phase) * .035 : Math.sin(phase) * .06, greeting ? Math.sin(phase) * .025 : Math.sin(phase) * .045, greeting ? -1.45 + Math.sin(phase) * .08 : 0)
    if (body) body.position.y = Math.sin(phase) * .018
  }
}

/** Road walking plus in-place poses. Location is always a projection of persisted state. */
function animateArtisans(groups: Map<string, THREE.Group>, delta: number, elapsed: number, reducedMotion: boolean, traveller?: ExploreVec): void {
  for (const [id, group] of groups) {
    const route = group.userData.route as Array<{ x: number; z: number }>
    const phase = elapsed * 7 + (seedOf(id) % 17)
    const flame = group.userData.lampFlame as THREE.Mesh | undefined
    const lamp = group.userData.lamp as string
    if (flame && !reducedMotion) {
      const pulse = lamp === 'attention' ? 1 + Math.sin(elapsed * 6) * .35 : 1 + Math.sin(phase * 1.7) * .06
      flame.scale.set(.8 * pulse, 1.45 * pulse, .8 * pulse)
    }
    if (route?.length && !reducedMotion) {
      const next = route[0]!
      const dx = next.x - group.position.x, dz = next.z - group.position.z
      const distance = Math.hypot(dx, dz)
      const step = WALK_SPEED * Math.max(0, delta)
      // The first rAF timestamp can precede setup time; never divide a zero-length step.
      if (distance <= Math.max(step, 1e-3)) { group.position.set(next.x, 0, next.z); route.shift() }
      else { group.position.x += dx / distance * step; group.position.z += dz / distance * step }
      if (distance > 1e-3) group.rotation.y = Math.atan2(dx, dz)
      setLimbs(group, Math.sin(phase) * .55, Math.sin(phase) * .45)
      const body = group.userData.body as THREE.Object3D | undefined
      if (body) body.position.y = Math.abs(Math.sin(phase)) * .05
      continue
    }
    const pose = group.userData.pose as string
    // An artisan not at the bench turns to greet a traveller who walks up.
    const greeting = traveller && pose !== 'work' && Math.hypot(traveller.x - group.position.x, traveller.z - group.position.z) < 5
    const face = greeting ? traveller : group.userData.face as { x: number; z: number } | undefined
    if (face) group.rotation.y = Math.atan2(face.x - group.position.x, face.z - group.position.z)
    const body = group.userData.body as THREE.Object3D | undefined
    if (body) body.position.y = 0
    if (reducedMotion) { setLimbs(group, 0, 0, pose === 'raise' ? -2.5 : 0); continue }
    if (pose === 'work') {
      const speed = group.userData.toolActive ? 9 : 4
      const right = group.userData.rightArm as THREE.Object3D | undefined
      setLimbs(group, 0, 0)
      if (right) right.rotation.x = -.6 + Math.sin(elapsed * speed + (seedOf(id) % 13)) * (group.userData.toolActive ? .7 : .3)
    } else if (pose === 'raise') {
      setLimbs(group, 0, 0, -2.5 + Math.sin(elapsed * 3) * .15)
    } else {
      setLimbs(group, 0, 0)
    }
  }
}

export function TownScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  // Persistent artisans have their own figures, badges and choreography; the
  // legacy presence projection keeps handling task-bound agents only.
  const legacyAgents = useMemo(() => props.agents.filter(agent => !isArtisan(agent as ArtisanRecord)), [props.agents])
  const artisanAgents = useMemo(() => (props.agents as ArtisanRecord[]).filter(isArtisan), [props.agents])
  const state = useRef({ ...props, agents: legacyAgents, artisanAgents })
  state.current = { ...props, agents: legacyAgents, artisanAgents }
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 5_000); return () => clearInterval(timer) }, [])
  const artisanStatuses = useMemo(() => artisanAgents.map(agent => artisanStatus(agent, props.tasks as ArtisanTask[], props.messages, props.userId, props.liveConnected, clock)), [artisanAgents, props.tasks, props.messages, props.userId, props.liveConnected, clock])
  const roadGraph = useMemo(() => townRoadGraph(props.layout.roads), [props.layout])
  const sceneStamp = townLayoutStamp(props.projects.map(project => project.id), props.layoutRevision)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const fogRef = useRef<THREE.Fog | null>(null)
  const hemiRef = useRef<THREE.HemisphereLight | null>(null)
  const sunRef = useRef<THREE.DirectionalLight | null>(null)
  const groundRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const skyRef = useRef<THREE.Mesh | null>(null)
  const lampLightsRef = useRef<THREE.PointLight[]>([])
  const labelsRef = useRef<CSS2DObject[]>([])
  const controlsRef = useRef<OrbitControls | null>(null)
  const workerGroupsRef = useRef(new Map<string, THREE.Group>())
  const artisanGroupsRef = useRef(new Map<string, THREE.Group>())
  const frontageAssetsRef = useRef(new Map<string, { stamp: string; assets: THREE.Group[] }>())
  const communicationMarkersRef = useRef(new Map<string, CSS2DObject>())
  const buildingsRef = useRef(new Map<string, THREE.Group>())
  const assetsRef = useRef<ReturnType<typeof createTownAssetLibrary> | null>(null)
  const resourcesRef = useRef<Set<THREE.BufferGeometry>>(new Set())
  const materialsRef = useRef<Set<THREE.Material>>(new Set())
  const billboardsRef = useRef(new Map<TownCluster, TownBillboard>())
  const billboardSlidesRef = useRef(new Map<TownCluster, TownBillboardSlide[]>())
  const exploreApiRef = useRef<((active: boolean) => void) | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const initial = state.current
    const scene = new THREE.Scene()
    const initialLighting = townSceneLighting(initial.mode)
    scene.background = new THREE.Color(initialLighting.sky)
    sceneRef.current = scene
    const resources = resourcesRef.current = new Set()
    const materials = materialsRef.current = new Set()
    const labels: CSS2DObject[] = labelsRef.current = []
    const library = assetsRef.current = createTownAssetLibrary()
    const townspersonGroups: THREE.Group[] = []
    const billboardLibrary = createTownBillboardLibrary()
    const placement = initial.layout
    // Everything a traveller on foot bumps into; colliders come from these meshes' real boxes.
    const exploreSolids: THREE.Object3D[] = []
    const currentProjects = initial.projects
    const maxRadius = Math.max(50, ...[...placement.values()].map(item => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2))
    const viewRadius = townCentralDistrictRadius(placement.values()) + 36
    const panLimit = Math.max(MAX_PAN, maxRadius + 36)
    const direction = new THREE.Vector3(TOWN_DEFAULT_CAMERA_POSITION_DIRECTION.x, TOWN_DEFAULT_CAMERA_POSITION_DIRECTION.y, TOWN_DEFAULT_CAMERA_POSITION_DIRECTION.z).normalize()
    const overviewPose = () => {
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight)
      const distance = townOverviewDistance(viewRadius, width, height) * (width > height ? .88 : 1)
      return { position: new THREE.Vector3(0, 1, 0).addScaledVector(direction, distance), distance }
    }
    const initialPose = overviewPose()
    const retainedPose = element.dataset.sceneHadProjects === 'true' ? cameraPoseFrom(element.dataset.cameraPose) : undefined
    const restoredDistance = state.current.initialViewPose
      ? townCameraDistance(state.current.initialViewPose.position, state.current.initialViewPose.target)
      : retainedPose?.position.distanceTo(retainedPose.target) ?? 0
    const farPlane = townCameraFarPlane(initialPose.distance, maxRadius, restoredDistance)
    const fog = new THREE.Fog(initialLighting.sky, Math.max(220, initialPose.distance + maxRadius * 1.5, restoredDistance + maxRadius * 1.5), Math.max(1200, farPlane))
    scene.fog = fog; fogRef.current = fog
    const camera = new THREE.PerspectiveCamera(44, Math.max(1, element.clientWidth) / Math.max(1, element.clientHeight), .2, farPlane)
    scene.add(camera)
    element.dataset.sceneHadProjects = String(currentProjects.length > 0)
    camera.position.copy(state.current.initialViewPose ? new THREE.Vector3(...state.current.initialViewPose.position) : retainedPose?.position ?? initialPose.position)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    element.appendChild(renderer.domElement)
    const labelRenderer = new CSS2DRenderer()
    labelRenderer.domElement.className = 'town-label-layer'
    element.appendChild(labelRenderer.domElement)

    const hemi = new THREE.HemisphereLight(initialLighting.hemisphereColor, initialLighting.groundFill, initialLighting.hemisphere)
    const sun = new THREE.DirectionalLight(initialLighting.directionalColor, initialLighting.directional)
    sun.position.set(-120, 220, 80); sun.castShadow = initialLighting.shadows; sun.shadow.mapSize.set(2048, 2048)
    const shadowExtent = Math.max(150, maxRadius + 60)
    sun.shadow.camera.left = -shadowExtent; sun.shadow.camera.right = shadowExtent
    sun.shadow.camera.top = shadowExtent; sun.shadow.camera.bottom = -shadowExtent
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 600
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .4
    sun.shadow.camera.updateProjectionMatrix()
    scene.add(hemi, sun); hemiRef.current = hemi; sunRef.current = sun
    const groundMaterial = sceneMaterial(initialLighting.ground, materials, { roughness: 1 })
    groundRef.current = groundMaterial
    const groundGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 1, 1)
    resources.add(groundGeometry)
    const tiles: THREE.Mesh[] = []
    for (let z = -TILE_RADIUS; z <= TILE_RADIUS; z++) for (let x = -TILE_RADIUS; x <= TILE_RADIUS; x++) {
      const tile = new THREE.Mesh(groundGeometry, groundMaterial)
      tile.rotation.x = -Math.PI / 2; tile.receiveShadow = true; tile.position.y = -.08
      tile.userData.offset = { x, z }
      tiles.push(tile); scene.add(tile)
    }

    const islandColors = [0x829d83, 0xb4a083, 0x87949d, 0x9b99b1, 0xb49b83, 0x92a595, 0xa8a595, 0x8e9a9d, 0xb3a48a, 0x98a89c, 0x9b9290, 0xaaa183, 0x929f8c, 0xa39182, 0x9ba7ac, 0xaaa48e]
    placement.islands?.forEach((island, index) => {
      const outline = islandOutline(seedOf(`island-shape-${island.cluster}-${index}`), 48)
      const shore = new THREE.Mesh(blobGeometry(island.radius + 2.5, outline), sceneMaterial(0xc3b692, materials, { roughness: 1 }))
      const land = new THREE.Mesh(blobGeometry(island.radius, outline), sceneMaterial(islandColors[index]!, materials, { roughness: 1 }))
      resources.add(shore.geometry); resources.add(land.geometry)
      shore.rotation.x = land.rotation.x = -Math.PI / 2
      shore.position.set(island.x, -.045, island.z)
      land.position.set(island.x, -.035, island.z)
      // Flat island surfaces receiving their own shadow map produced blotchy
      // self-shadow acne at this scale; huts/trees on them still cast shadows
      // onto the ground tiles around them, so nothing visually depends on this.
      shore.receiveShadow = land.receiveShadow = false
      scene.add(shore, land)
      const billboard = billboardLibrary.create(island.cluster)
      billboard.group.position.set(island.sign.x, 0, island.sign.z)
      billboard.update(townBillboardSlides({ cluster: island.cluster, layout: placement, agents: initial.agents, tasks: initial.tasks, messages: initial.messages, userId: initial.userId, liveConnected: initial.liveConnected })[0]!)
      scene.add(billboard.group); exploreSolids.push(billboard.group)
      billboardsRef.current.set(island.cluster, billboard)
    })

    const fieldOuter = Math.max(90, ...[...placement.values()].map(item => item.radius + Math.max(item.lotWidth, item.lotDepth) / 2)) + 44
    const fieldSites = Array.from({ length: 5 }, (_, index) => {
      const angle = -.7 + index * 2.399963229728653 + (seedOf(`field-angle-${index}`) / 4_294_967_296 - .5) * .12
      const radius = fieldOuter + (index % 2) * 15
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
    })
    const fieldMaterial = sceneMaterial(0x82905b, materials, { roughness: 1 })
    const bundMaterial = sceneMaterial(0xb7a77c, materials, { roughness: 1 })
    const waterMaterial = sceneMaterial(0x6c9690, materials, { roughness: .35, metalness: .05 })
    const fieldGeometry = new THREE.PlaneGeometry(31, 23)
    const bundGeometry = new THREE.BoxGeometry(32, .18, .6)
    const waterGeometry = new THREE.CircleGeometry(13, 40)
    const tankBankGeometry = new THREE.TorusGeometry(14.8, 1.15, 5, 48)
    for (const geometry of [fieldGeometry, bundGeometry, waterGeometry, tankBankGeometry]) resources.add(geometry)
    fieldSites.forEach((site, index) => {
      const field = addMesh(scene, fieldGeometry, fieldMaterial, site.x, .02, site.z, resources)
      field.rotation.set(-Math.PI / 2, 0, -index * .24)
      for (let row = -1; row <= 1; row++) {
        const bund = addMesh(scene, bundGeometry, bundMaterial, site.x, .12, site.z + row * 7.1, resources)
        bund.rotation.y = index * .24
      }
      // Broad planted patches make the irrigated plots read as working fields
      // from the town overview instead of bare green rectangles.
      for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
        const crop = library.createProp('crop-row', seedOf(`paddy-${index}-${row}-${column}`))
        crop.position.set(site.x + (column - 1) * 7.6, .04, site.z + (row ? 4.2 : -4.2))
        crop.rotation.y = index * .24
        crop.scale.set(2.25, 1.5, 1.8)
        crop.userData.ambientScenery = true
        scene.add(crop)
      }
    })
    const tankSite = { x: fieldSites[1].x + 31, z: fieldSites[1].z - 5 }
    const tankBank = addMesh(scene, tankBankGeometry, bundMaterial, tankSite.x, .12, tankSite.z, resources)
    tankBank.rotation.x = Math.PI / 2
    const tank = addMesh(scene, waterGeometry, waterMaterial, tankSite.x, .08, tankSite.z, resources)
    tank.rotation.x = -Math.PI / 2
    for (let channel = 0; channel < fieldSites.length; channel++) {
      const waterway = library.createProp('irrigation-channel', seedOf(`irrigation-channel-${channel}`))
      waterway.position.set(fieldSites[channel]!.x + (channel === 1 ? -18 : 18), .02, fieldSites[channel]!.z + 14)
      waterway.rotation.y = channel * .38
      waterway.scale.set(8.5, 1, 1.4)
      waterway.userData.ambientScenery = true
      scene.add(waterway)
    }
    for (let index = 0; index < fieldSites.length; index++) {
      const grove = library.createProp('grove', seedOf(`field-grove-${index}`))
      grove.position.set(fieldSites[index]!.x + (index % 2 ? -27 : 27), 0, fieldSites[index]!.z + (index % 2 ? 24 : -24))
      grove.rotation.y = seedOf(`field-grove-turn-${index}`) / 4_294_967_296 * Math.PI * 2
      grove.scale.set(2.6, 2.1, 2.6)
      grove.userData.ambientScenery = true
      scene.add(grove)
      if (index % 2 === 0) {
        const pond = library.createProp('pond', seedOf(`field-pond-${index}`))
        pond.position.set(fieldSites[index]!.x - 28, .01, fieldSites[index]!.z + 25)
        pond.scale.set(3.4, 1, 3.4)
        pond.userData.ambientScenery = true
        scene.add(pond)
      }
    }
    fieldSites.forEach((site, index) => {
      const kind = index % 2 ? 'well' : 'cart'
      const prop = library.createProp(kind, seedOf(`field-prop-${index}`))
      prop.position.set(site.x + (index % 2 ? -19 : 19), 0, site.z + (index % 2 ? 14 : -14))
      prop.rotation.y = (seedOf(`field-prop-turn-${index}`) / 4_294_967_296) * Math.PI * 2
      prop.userData.ambientScenery = true
      scene.add(prop); exploreSolids.push(prop)
    })

    const roadSurface = sceneMaterial(0xb79f76, materials, { roughness: 1 })
    const roadEdges = sceneMaterial(0x8d866e, materials, { roughness: 1 })
    const roadGeometry = buildRibbon(placement.roads, 1.35, 0, .04)
    const edgeLeft = buildRibbon(placement.roads, .16, -.71, .055)
    const edgeRight = buildRibbon(placement.roads, .16, .71, .055)
    for (const geometry of [roadGeometry, edgeLeft, edgeRight]) resources.add(geometry)
    scene.add(new THREE.Mesh(roadGeometry, roadSurface), new THREE.Mesh(edgeLeft, roadEdges), new THREE.Mesh(edgeRight, roadEdges))
    const townPopulation = createTownPopulation(placement)
    const townWanderNetwork = createTownWanderNetwork(placement)
    for (const resident of townPopulation) {
      const person = library.createTownsperson(resident.seed)
      person.name = 'Decorative townsperson'
      person.position.set(resident.x, 0, resident.z)
      person.rotation.y = resident.facing
      person.userData.ambientScenery = true
      person.userData.sceneryPose = resident.pose
      person.userData.wander = resident.wander
      person.userData.island = townIslandAt(placement, resident.x, resident.z) ?? ''
      person.userData.wanderRoute = []
      person.userData.wanderDwell = 2 + (seedOf(resident.seed) % 700) / 100
      person.userData.phase = (seedOf(resident.seed) % 1000) / 1000 * Math.PI * 2
      person.traverse(child => { child.userData.ambientScenery = true })
      scene.add(person)
      townspersonGroups.push(person)
    }
    element.dataset.townspersonCount = String(townspersonGroups.length)

    const hall = library.createTemple(seedOf('bell-hall'))
    hall.name = 'Town Temple · Bell Hall'
    hall.userData.hallId = 'bell-hall'
    hall.position.set(TEMPLE_CAMPUS.sanctuary.x, 0, TEMPLE_CAMPUS.sanctuary.z); hall.scale.setScalar(TEMPLE_CAMPUS.sanctuary.scale); scene.add(hall)
    hall.traverse(child => { child.userData.hallId = 'bell-hall' })
    const hallLabel = document.createElement('button')
    hallLabel.type = 'button'
    hallLabel.className = 'town-hall-label town-temple-label'
    hallLabel.dataset.hallId = 'bell-hall'
    hallLabel.innerHTML = '<b>TOWN TEMPLE</b><span>Orchestrator command & dispatch</span>'
    hallLabel.setAttribute('aria-label', 'Open Town Temple operations')
    hallLabel.addEventListener('click', event => { event.stopPropagation(); state.current.onSelectHall() })
    const hallTag = new CSS2DObject(hallLabel); hallTag.position.set(0, TEMPLE_SITE.maxHeight + 1.2, 0); hallTag.visible = initial.labelsVisible; hall.add(hallTag); labels.push(hallTag)
    const campus = library.createTempleCampus(seedOf('temple-campus'))
    // Descendants only: the hall itself stays the one scene child tagged as the host.
    campus.traverse(child => { if (child !== campus) child.userData.hallId = 'bell-hall' })
    scene.add(campus); exploreSolids.push(hall, campus)

    for (const [site, asset, title, caption] of [
      [GUILD_HALL_SITE, library.createGuildHall(seedOf('guild-hall')), 'GUILD HALL', 'Artisans rest here between orders'],
      [STAGING_SITE, library.createStagingMandapam(seedOf('staging-mandapam')), 'STAGING MANDAPAM', 'Work orders wait here for their gates'],
    ] as const) {
      asset.position.set(site.x, 0, site.z)
      asset.rotation.y = site.facing * Math.PI / 2
      asset.userData.civicSite = site.id
      scene.add(asset); exploreSolids.push(asset)
      const tag = document.createElement('div')
      tag.className = 'town-hall-label town-civic-label'
      tag.dataset.civicSite = site.id
      tag.innerHTML = `<b>${title}</b><span>${caption}</span>`
      const label = new CSS2DObject(tag); label.position.set(0, 7.2, 0); label.visible = initial.labelsVisible
      asset.add(label); labels.push(label)
    }

    const observatoryPortal = new THREE.Group()
    observatoryPortal.name = 'cosmic-observatory-portal'
    // Off the east gopuram's axis so the portal never blocks a campus gate.
    observatoryPortal.position.set(TEMPLE_CAMPUS.maxX + TEMPLE_CAMPUS.clearance + 8, 0, TEMPLE_CAMPUS.maxZ * .5)
    const portalGold = sceneMaterial(0xd9c27d, materials, { metalness: .72, roughness: .32, emissive: 0x4d3d16, emissiveIntensity: .55 })
    const portalGlow = new THREE.MeshBasicMaterial({ color: 0x8cd7eb, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false })
    materials.add(portalGlow)
    const portalColumns = new THREE.BoxGeometry(.72, 7.2, .82)
    resources.add(portalColumns)
    for (const x of [-4.1, 4.1]) {
      const column = new THREE.Mesh(portalColumns, portalGold)
      column.position.set(x, 3.6, 0); column.castShadow = true; column.userData.observatoryPortal = true
      observatoryPortal.add(column)
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(4.1, .48, 10, 32, Math.PI), portalGold)
    resources.add(arch.geometry); arch.position.set(0, 7.2, 0); arch.castShadow = true; arch.userData.observatoryPortal = true
    observatoryPortal.add(arch)
    const portalSurface = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.1), portalGlow)
    resources.add(portalSurface.geometry); portalSurface.position.set(0, 3.65, -.12); portalSurface.userData.observatoryPortal = true
    observatoryPortal.add(portalSurface)
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(9.4, .22, 2.2), portalGold)
    resources.add(threshold.geometry); threshold.position.set(0, .11, .3); threshold.userData.observatoryPortal = true
    observatoryPortal.add(threshold); scene.add(observatoryPortal); exploreSolids.push(observatoryPortal)
    const portalLabelNode = document.createElement('button')
    portalLabelNode.type = 'button'
    portalLabelNode.className = 'town-observatory-label'
    portalLabelNode.textContent = 'Cosmic Observatory'
    portalLabelNode.setAttribute('aria-label', 'Enter Cosmic Observatory')
    portalLabelNode.addEventListener('click', event => { event.stopPropagation(); state.current.onEnterObservatory?.() })
    const portalLabel = new CSS2DObject(portalLabelNode)
    portalLabel.position.set(0, 11.25, 0); observatoryPortal.add(portalLabel); labels.push(portalLabel)

    const buildings = buildingsRef.current = new Map<string, THREE.Group>()
    for (const project of [...currentProjects].sort((a, b) => a.id.localeCompare(b.id))) {
      const property = placement.get(project.id)
      if (!property) continue
      const appearance = projectBuildingAppearance(project.id, property.cluster)
      const isActive = initial.activeProjectIds.has(project.id)
      const house = library.createHouse(property.form as BuildingForm, seedOf(project.id), appearance, isActive)
      house.name = `Town office ${project.id}`
      house.position.set(property.x, 0, property.z)
      house.rotation.y = Math.atan2(property.entrance.x - property.x, property.entrance.z - property.z)
      house.userData.projectId = project.id
      house.userData.form = property.form
      house.userData.activeAppearance = isActive
      house.userData.houseTheme = appearance.theme
      house.userData.cluster = property.cluster
      const markerGeometry = new THREE.RingGeometry(Math.max(property.footprintWidth, property.footprintDepth) * .68, Math.max(property.footprintWidth, property.footprintDepth) * .73, 36)
      const markerMaterial = sceneMaterial(0x8b6b27, materials, { side: THREE.DoubleSide, transparent: true, opacity: .76, emissive: 0x5c471f, emissiveIntensity: .22 })
      const marker = new THREE.Mesh(markerGeometry, markerMaterial)
      marker.rotation.x = -Math.PI / 2; marker.position.y = .08; marker.userData.activeMarker = true
      marker.visible = initial.activeProjectIds.has(project.id)
      house.add(marker)
      buildings.set(project.id, house)
      scene.add(house); exploreSolids.push(house)

      const name = document.createElement('button')
      name.type = 'button'; name.className = 'town-map-label'; name.textContent = project.display.name
      name.title = `${project.display.name} · ${property.cluster} · ${appearance.theme}`
      name.setAttribute('aria-label', `Open ${project.display.name} project board · ${property.cluster} · ${appearance.theme} house`)
      name.dataset.projectId = project.id
      name.addEventListener('click', event => { event.stopPropagation(); state.current.onSelect(project.id) })
      const label = new CSS2DObject(name); label.position.set(0, property.form === 'courtyard-compound' ? 8.8 : 7.2, 0); label.visible = initial.labelsVisible; house.add(label); labels.push(label)
      for (const side of [-1, 1]) {
        const porchLamp = library.createLamp(seedOf(`porch-lamp-${project.id}-${side}`))
        porchLamp.scale.setScalar(.72)
        porchLamp.position.set(side * Math.min(property.footprintWidth * .35, 1.7), 0, property.footprintDepth / 2 + .36)
        house.add(porchLamp)
      }
      if (property.form === 'courtyard-house' || property.form === 'courtyard-compound') {
        const courtLamp = library.createLamp(seedOf(`court-lamp-${project.id}`))
        courtLamp.scale.setScalar(.78)
        courtLamp.position.set(0, 0, 0)
        house.add(courtLamp)
      }
      house.traverse(child => { child.userData.projectId = project.id })
    }

    const trees = placement.trees
    trees.forEach((tree, index) => {
      const kind = index % 3 === 0 ? 'palmyra' : 'broadleaf'
      const asset = library.createTree(kind, seedOf(`tree-${index}`))
      asset.position.set(tree.x, 0, tree.z); scene.add(asset); exploreSolids.push(asset)
    })
    const innerGroveSites = townGroveSites(trees)
    innerGroveSites.forEach((site, index) => {
      const grove = library.createProp('grove', seedOf(`roadside-grove-${index}`))
      grove.position.set(site.x, 0, site.z)
      grove.scale.setScalar(1.25)
      grove.userData.ambientScenery = true
      scene.add(grove); exploreSolids.push(grove)
    })

    const animals: Array<'cattle' | 'goat' | 'chicken'> = ['cattle', 'goat', 'chicken', 'goat', 'chicken', 'cattle', 'chicken', 'goat', 'chicken']
    animals.forEach((kind, index) => {
      const site = fieldSites[index % fieldSites.length]
      const offset = { x: ((index % 3) - 1) * 4.2, z: Math.floor(index / 3) * 3.3 - 4 }
      const animal = library.createAnimal(kind, seedOf(`animal-${index}-${kind}`))
      animal.position.set(site.x + offset.x, 0, site.z + offset.z)
      animal.rotation.y = (index % 4) * Math.PI / 2
      animal.userData.ambientScenery = true
      scene.add(animal)
    })

    const discoverySites = HISTORICAL_REFERENCES
    for (const site of discoverySites) {
      const group = new THREE.Group(); group.position.set(site.x, 0, site.z); group.userData.discoveryId = site.id
      const prop = library.createProp(site.id === 'rajaraja' ? 'low-wall' : site.id === 'aryabhata' ? 'basket' : 'cart', seedOf(`reference-${site.id}`))
      group.add(prop); scene.add(group); exploreSolids.push(group)
      addDiscoveryLabel(site, scene, id => state.current.onSelectDiscovery(id), labels)
      labels[labels.length - 1]!.position.set(site.x, 2.7, site.z)
      labels[labels.length - 1]!.visible = initial.labelsVisible
    }

    const nightLights: THREE.PointLight[] = []
    const lampSites = nightLampSites(placement)
    for (let index = 0; index < lampSites.length; index++) {
      const site = lampSites[index]
      const lamp = library.createLamp(seedOf(`lamp-${index}`))
      lamp.position.set(site.x, 0, site.z); scene.add(lamp); exploreSolids.push(lamp)
      const emitter = lamp.userData.lampEmitter as THREE.Vector3 | undefined
      const light = new THREE.PointLight(0xffbd68, initialLighting.lamp, initialLighting.lampDistance, initialLighting.lampDecay)
      light.position.set(site.x + (emitter?.x ?? 0), (emitter?.y ?? .82) + .42, site.z + (emitter?.z ?? 0)); light.castShadow = false; scene.add(light); nightLights.push(light)
    }
    lampLightsRef.current = nightLights

    const clouds: THREE.Group[] = []
    for (let index = 0; index < 12; index++) {
      const cloud = makeCloud(index, resources, materials)
      cloud.position.set((index % 4 - 1.5) * 210 + (index % 3) * 20, 65 + (index % 3) * 12, (Math.floor(index / 4) - 1) * 230)
      cloud.scale.setScalar(.52)
      cloud.userData.homeX = cloud.position.x
      clouds.push(cloud); scene.add(cloud)
    }
    const flocks: THREE.Group[][] = []
    for (let flockIndex = 0; flockIndex < 3; flockIndex++) {
      const flock: THREE.Group[] = []
      for (let birdIndex = 0; birdIndex < 7; birdIndex++) {
        const bird = makeBird(seedOf(`bird-${flockIndex}-${birdIndex}`), resources, materials)
        bird.position.set((birdIndex - 3) * 1.25, Math.sin(birdIndex) * .6, (birdIndex % 2) * 1.1)
        flock.push(bird); scene.add(bird)
      }
      flocks.push(flock)
    }
    const sky = skyRef.current = makeWorldSky(resources, materials)
    scene.add(sky)
    applyTownSceneMode(initial.mode, scene, fog, hemi, sun, groundMaterial, sky, nightLights, labels)

    const explore = {
      active: false,
      keys: emptyExploreKeys(),
      destination: undefined as ExploreVec | undefined,
      saved: undefined as { position: THREE.Vector3; target: THREE.Vector3; minDistance: number; maxDistance: number; maxPolarAngle: number; enablePan: boolean } | undefined,
      grid: undefined as ExploreColliderGrid | undefined,
      solids: undefined as ExploreSolidGrid | undefined,
      camera: new THREE.Vector3(),
      promptId: '',
      stride: 0,
      ground: 0,
    }
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.dampingFactor = .085; controls.minDistance = 13
    controls.maxDistance = townCameraMaxDistance(initialPose.distance, restoredDistance); controls.maxPolarAngle = Math.PI * .47
    controls.target.copy(state.current.initialViewPose ? new THREE.Vector3(...state.current.initialViewPose.target) : retainedPose?.target ?? new THREE.Vector3(0, 1, 0)); controlsRef.current = controls; state.current.onReady(controls)
    const rememberCamera = () => {
      // The follow camera is transient; a rebuild or return trip should restore the free view.
      if (explore.active) return
      const target = controls.target, p = camera.position
      element.dataset.cameraPose = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}:${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}`
    }
    controls.addEventListener('change', rememberCamera)
    rememberCamera()
    const leaveExploreForCamera = () => {
      if (!explore.active) return
      exitExplore(); state.current.onExploreExit?.()
    }
    const overview = () => {
      leaveExploreForCamera()
      const pose = overviewPose()
      controls.target.set(0, 1, 0); controls.maxDistance = Math.max(380, pose.distance * 1.3)
      camera.far = Math.max(2200, pose.distance + maxRadius * 4); camera.updateProjectionMatrix()
      camera.position.copy(pose.position); controls.update()
    }
    const focus = (id: string) => {
      leaveExploreForCamera()
      if (id.startsWith('agent:')) {
        const figure = artisanGroupsRef.current.get(id.slice('agent:'.length))
        if (!figure) return
        const target = new THREE.Vector3(figure.position.x, 2, figure.position.z)
        controls.target.copy(target)
        camera.position.copy(target).addScaledVector(new THREE.Vector3(.32, .58, .75).normalize(), 42)
        controls.update()
        return
      }
      if (id === 'bell-hall' || id === 'town-temple' || id === 'temple') {
        const target = new THREE.Vector3(0, TEMPLE_CAMPUS.maxHeight * .3, 0)
        const viewDirection = camera.position.clone().sub(controls.target).normalize()
        const bounds = Math.hypot(TEMPLE_CAMPUS.width / 2, TEMPLE_CAMPUS.depth / 2, TEMPLE_CAMPUS.maxHeight / 2) * .8
        const distance = townOverviewDistance(bounds, element.clientWidth, element.clientHeight)
        controls.target.copy(target)
        camera.position.copy(target).addScaledVector(viewDirection, distance)
        controls.maxDistance = Math.max(controls.maxDistance, distance * 1.2)
        camera.far = Math.max(camera.far, distance + maxRadius * 2)
        camera.updateProjectionMatrix(); controls.update()
        return
      }
      const building = buildings.get(id)
      if (!building) return
      const cluster = placement.get(id)?.cluster
      const sign = cluster ? billboardsRef.current.get(cluster)?.group : undefined
      const target = sign
        ? new THREE.Vector3((building.position.x + sign.position.x) / 2, 3, (building.position.z + sign.position.z) / 2)
        : new THREE.Vector3(building.position.x, 3, building.position.z)
      const separation = sign ? Math.hypot(building.position.x - sign.position.x, building.position.z - sign.position.z) : 0
      const distance = Math.max(70, separation * 2.1)
      const viewDirection = new THREE.Vector3(.32, .58, .75).normalize()
      controls.target.copy(target)
      camera.position.copy(target).addScaledVector(viewDirection, distance)
      controls.update()
    }
    state.current.onFocusReady(focus); state.current.onOverviewReady(overview)
    if (!currentProjects.length) overview()

    const resize = () => {
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight)
      camera.aspect = width / height; camera.updateProjectionMatrix()
      renderer.setSize(width, height); labelRenderer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    let lastTileX = NaN, lastTileZ = NaN
    const updateTerrainTiles = () => {
      const tileX = Math.floor(controls.target.x / TILE_SIZE), tileZ = Math.floor(controls.target.z / TILE_SIZE)
      if (tileX === lastTileX && tileZ === lastTileZ) return
      lastTileX = tileX; lastTileZ = tileZ
      for (const tile of tiles) {
        const offset = tile.userData.offset as { x: number; z: number }
        tile.position.x = (tileX + offset.x) * TILE_SIZE
        tile.position.z = (tileZ + offset.z) * TILE_SIZE
      }
      element.dataset.terrainTileCount = String(tiles.length)
    }
    updateTerrainTiles()
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
    let pointerStart: { x: number; y: number } | undefined
    const pointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY } }
    const click = (event: MouseEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) { pointerStart = undefined; return }
      pointerStart = undefined
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      if (state.current.pickMode) {
        const picked = raycaster.intersectObjects([...buildings.values()], true).find(result => result.object.userData.projectId)
        if (picked) state.current.onPickProject?.(picked.object.userData.projectId as string)
        return
      }
      const hit = raycaster.intersectObjects([observatoryPortal, hall, campus, ...buildings.values(), ...workerGroupsRef.current.values(), ...artisanGroupsRef.current.values()], true).find(result => result.object.userData.observatoryPortal || result.object.userData.projectId || result.object.userData.agentId || result.object.userData.hallId || result.object.userData.artisanId)
      if (explore.active && !hit) {
        const ground = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
        if (ground) explore.destination = { x: ground.x, z: ground.z }
        return
      }
      if (hit?.object.userData.artisanId) { state.current.onSelectArtisan?.(hit.object.userData.artisanId as string); return }
      if (hit?.object.userData.observatoryPortal) { state.current.onEnterObservatory?.(); return }
      if (hit?.object.userData.hallId) state.current.onSelectHall()
      else if (hit?.object.userData.agentId) {
        const person = projectAgentPresence(state.current.agents, state.current.tasks, state.current.layout, state.current.messages, state.current.userId, state.current.liveConnected).find(item => item.id === hit.object.userData.agentId)
        if (person) state.current.onSelectAgent(person)
      } else if (hit?.object.userData.projectId) state.current.onSelect(hit.object.userData.projectId as string)
    }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('click', click)
    const pickAt = (clientX: number, clientY: number): string | undefined => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObjects([...buildings.values()], true).find(result => result.object.userData.projectId)?.object.userData.projectId as string | undefined
    }
    state.current.onDropReady?.(pickAt)

    // ---- Explore on foot: traveller avatar, follow camera, collision and interaction ----
    const traveller = library.createTraveller()
    traveller.name = 'Traveller (you)'
    traveller.visible = false
    traveller.userData.traveller = true
    scene.add(traveller)
    const travellerTag = document.createElement('div')
    travellerTag.className = 'town-traveller-tag'
    travellerTag.textContent = 'You'
    const travellerLabel = new CSS2DObject(travellerTag)
    travellerLabel.position.set(0, 2.3, 0); travellerLabel.visible = false; traveller.add(travellerLabel)
    const buildExploreGrids = () => {
      const colliders: ExploreCollider[] = [], solids: ExploreSolid[] = []
      forEachExploreBox(exploreSolids, box => {
        const collider = exploreColliderFromBox(box); if (collider) colliders.push(collider)
        const solid = exploreSolidFromBox(box); if (solid) solids.push(solid)
      })
      element.dataset.exploreColliders = String(colliders.length)
      explore.grid = createExploreColliderGrid(colliders)
      explore.solids = createExploreSolidGrid(solids)
    }
    const insideCampus = (x: number, z: number) => x > TEMPLE_CAMPUS.minX && x < TEMPLE_CAMPUS.maxX && z > TEMPLE_CAMPUS.minZ && z < TEMPLE_CAMPUS.maxZ
    // The prakaram flagstones are too broad to be colliders; they are the campus's base ground.
    const baseGround = (point: ExploreVec) => insideCampus(point.x, point.z) ? .15 : 0
    // The whole inner court, from the axial mandapa's steps inward, counts as arriving at the temple.
    const templeReach = Math.hypot(TEMPLE_SITE.width, TEMPLE_SITE.depth) * TEMPLE_CAMPUS.sanctuary.scale / 2 + 14
    let projectNames = new Map<string, string>(), namesFrom: TownSceneProject[] | undefined
    const exploreTargets = (): ExploreTarget[] => {
      if (namesFrom !== state.current.projects) { namesFrom = state.current.projects; projectNames = new Map(namesFrom.map(project => [project.id, project.display.name])) }
      const targets: ExploreTarget[] = []
      for (const [id, house] of buildings) {
        const lot = placement.get(id)
        if (lot) targets.push({ id: `project:${id}`, kind: 'project', label: projectNames.get(id) ?? 'project', x: house.position.x, z: house.position.z, reach: Math.hypot(lot.footprintWidth, lot.footprintDepth) / 2 + 3 })
      }
      for (const [id, figure] of artisanGroupsRef.current) targets.push({ id: `artisan:${id}`, kind: 'artisan', label: String(figure.userData.displayName ?? 'the artisan'), x: figure.position.x, z: figure.position.z, reach: 3 })
      targets.push({ id: 'temple', kind: 'temple', label: 'Town Temple', x: TEMPLE_CAMPUS.sanctuary.x, z: TEMPLE_CAMPUS.sanctuary.z, reach: templeReach })
      targets.push({ id: 'portal', kind: 'portal', label: 'Cosmic Observatory', x: observatoryPortal.position.x, z: observatoryPortal.position.z, reach: 7 })
      for (const site of discoverySites) targets.push({ id: `discovery:${site.id}`, kind: 'discovery', label: site.title, x: site.x, z: site.z, reach: 4 })
      return targets
    }
    const runExploreTarget = (target: ExploreTarget) => {
      const id = target.id.slice(target.id.indexOf(':') + 1)
      if (target.kind === 'project') state.current.onSelect(id)
      else if (target.kind === 'artisan') state.current.onSelectArtisan?.(id)
      else if (target.kind === 'temple') state.current.onSelectHall()
      else if (target.kind === 'portal') state.current.onEnterObservatory?.()
      else state.current.onSelectDiscovery(id)
    }
    const reportPrompt = (target: ExploreTarget | undefined) => {
      const id = target?.id ?? ''
      if (id === explore.promptId) return
      explore.promptId = id
      element.dataset.explorePrompt = id
      state.current.onExplorePrompt?.(target ? { id, label: exploreTargetVerb(target), run: () => runExploreTarget(target) } : null)
    }
    /** Drop leftover orbit inertia so a pose applied next is exactly the pose shown. */
    const settleControls = () => {
      const damping = controls.enableDamping
      controls.enableDamping = false; controls.update(); controls.enableDamping = damping
    }
    const enterExplore = () => {
      if (explore.active) return
      if (!explore.grid) buildExploreGrids()
      explore.saved = { position: camera.position.clone(), target: controls.target.clone(), minDistance: controls.minDistance, maxDistance: controls.maxDistance, maxPolarAngle: controls.maxPolarAngle, enablePan: controls.enablePan }
      // Arrive on the plaza before the south gopuram, between Guild Hall and Staging, facing the temple.
      const spawn = exploreSpawnPoint({ x: TEMPLE_CAMPUS.entrance.x, z: TEMPLE_CAMPUS.entrance.z + 8 }, explore.grid!)
      explore.ground = exploreGroundAt(spawn, explore.grid!, baseGround(spawn), baseGround(spawn))
      traveller.position.set(spawn.x, explore.ground, spawn.z)
      traveller.rotation.y = Math.PI
      traveller.visible = travellerLabel.visible = true
      explore.active = true; explore.keys = emptyExploreKeys(); explore.destination = undefined; explore.promptId = ''
      settleControls()
      controls.enablePan = false; controls.minDistance = 3.5; controls.maxDistance = 45; controls.maxPolarAngle = Math.PI * .49
      controls.target.set(spawn.x, 1.6, spawn.z)
      camera.position.set(spawn.x, 6.5, spawn.z + 12)
      controls.update()
      element.dataset.exploring = 'true'
      element.focus({ preventScroll: true })
    }
    const exitExplore = () => {
      if (!explore.active) return
      explore.active = false; traveller.visible = travellerLabel.visible = false
      explore.keys = emptyExploreKeys(); explore.destination = undefined
      const saved = explore.saved
      settleControls()
      if (saved) {
        controls.enablePan = saved.enablePan; controls.minDistance = saved.minDistance; controls.maxDistance = saved.maxDistance; controls.maxPolarAngle = saved.maxPolarAngle
        controls.target.copy(saved.target); camera.position.copy(saved.position); controls.update()
      }
      reportPrompt(undefined)
      element.dataset.exploring = 'false'
      rememberCamera()
    }
    exploreApiRef.current = (active: boolean) => { if (active) enterExplore(); else exitExplore() }
    const typingInto = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    const exploreKeyDown = (event: KeyboardEvent) => {
      if (!explore.active || typingInto(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const key = EXPLORE_KEY_MAP[event.code]
      if (key) { explore.keys[key] = true; if (key !== 'run') explore.destination = undefined; event.preventDefault(); return }
      if (event.code === 'KeyE' && !event.repeat) {
        const target = nearestExploreTarget({ x: traveller.position.x, z: traveller.position.z }, exploreTargets())
        if (target) { event.preventDefault(); runExploreTarget(target) }
      }
    }
    const exploreKeyUp = (event: KeyboardEvent) => {
      const key = EXPLORE_KEY_MAP[event.code]
      if (key) explore.keys[key] = false
    }
    const exploreBlur = () => { explore.keys = emptyExploreKeys() }
    window.addEventListener('keydown', exploreKeyDown)
    window.addEventListener('keyup', exploreKeyUp)
    window.addEventListener('blur', exploreBlur)
    const stepExplore = (delta: number) => {
      const grid = explore.grid
      if (!explore.active || !grid) return
      const from = { x: traveller.position.x, z: traveller.position.z }
      let direction = exploreMoveDirection(explore.keys, { x: controls.target.x - camera.position.x, z: controls.target.z - camera.position.z })
      if (!direction.x && !direction.z && explore.destination) {
        const seek = exploreSeekDirection(from, explore.destination)
        if (seek) direction = seek; else explore.destination = undefined
      }
      const moving = Boolean(direction.x || direction.z)
      const speed = explore.keys.run ? EXPLORE_RUN_SPEED : EXPLORE_WALK_SPEED
      const next = moving ? resolveExploreMove(from, { x: direction.x * speed * delta, z: direction.z * speed * delta }, grid, panLimit, undefined, explore.ground, baseGround) : { ...from, ground: explore.ground }
      const moved = Math.hypot(next.x - from.x, next.z - from.z)
      // A click-to-walk destination behind a wall is abandoned rather than pushed against forever.
      if (moving && explore.destination && delta > .005 && moved < speed * delta * .05) explore.destination = undefined
      explore.ground = next.ground
      // Ease the figure up and down steps instead of snapping between heights.
      const footY = state.current.reducedMotion ? next.ground : THREE.MathUtils.lerp(traveller.position.y, next.ground, Math.min(1, delta * 14))
      traveller.position.set(next.x, footY, next.z)
      if (moving) {
        const goal = Math.atan2(direction.x, direction.z)
        const turn = Math.atan2(Math.sin(goal - traveller.rotation.y), Math.cos(goal - traveller.rotation.y))
        traveller.rotation.y += state.current.reducedMotion ? turn : turn * Math.min(1, delta * 12)
      }
      const body = traveller.userData.body as THREE.Object3D | undefined
      if (moved > 1e-4 && !state.current.reducedMotion) {
        explore.stride += moved * (explore.keys.run ? .8 : 1.15)
        setLimbs(traveller, Math.sin(explore.stride) * .6, Math.sin(explore.stride) * .5)
        if (body) body.position.y = Math.abs(Math.sin(explore.stride)) * .06
      } else {
        setLimbs(traveller, 0, 0)
        if (body) body.position.y = 0
      }
      if (moved > 1e-4 || !element.dataset.travellerPosition) element.dataset.travellerPosition = `${next.x.toFixed(1)},${next.z.toFixed(1)}`
      camera.position.x += next.x - from.x; camera.position.z += next.z - from.z
      camera.position.y += traveller.position.y + 1.6 - controls.target.y
      controls.target.set(next.x, traveller.position.y + 1.6, next.z)
      reportPrompt(nearestExploreTarget(next, exploreTargets()))
    }
    /** Draw this frame from in front of any wall between camera and traveller; returns the orbit pose to restore. */
    const pullExploreCamera = (): boolean => {
      if (!explore.active || !explore.solids) return false
      const head = controls.target
      const clear = exploreCameraClearance(head, camera.position, explore.solids)
      if (clear >= 1) return false
      explore.camera.copy(camera.position)
      const distance = camera.position.distanceTo(head)
      camera.position.lerpVectors(head, explore.camera, Math.max(.6 / Math.max(distance, 1e-3), clear - .15 / Math.max(distance, 1e-3)))
      return true
    }
    const keyboard = (event: KeyboardEvent) => {
      if (explore.active) return
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) return
      event.preventDefault()
      const step = .08
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
        spherical.theta += event.key === 'ArrowLeft' ? -step : step
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical))
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
        spherical.phi = THREE.MathUtils.clamp(spherical.phi + (event.key === 'ArrowUp' ? -step : step), .12, Math.PI * .47)
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical))
      } else if (event.key === '-') controls.dollyOut(1.15)
      else controls.dollyIn(1.15)
      controls.update()
    }
    element.addEventListener('keydown', keyboard)
    let raf = 0, lastFrame = performance.now(), elapsed = 0
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate)
      if (document.hidden) return
      const delta = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now; elapsed += delta
      stepExplore(delta)
      const beforeX = controls.target.x, beforeZ = controls.target.z
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -panLimit, panLimit)
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -panLimit, panLimit)
      camera.position.x += controls.target.x - beforeX; camera.position.z += controls.target.z - beforeZ
      controls.update(); updateTerrainTiles()
      const cameraPulled = pullExploreCamera()
      // Track only camera translation. The sky's world axes never rotate with
      // the camera, so pan/dolly have no lunar parallax and orbit changes view.
      sky.position.copy(camera.position)
      for (const cloud of clouds) {
        if (!state.current.reducedMotion) cloud.position.x += delta * .38
        if (cloud.position.x > Number(cloud.userData.homeX) + 210) cloud.position.x = Number(cloud.userData.homeX) - 210
      }
      for (const flock of flocks) {
        for (const bird of flock) {
          if (!state.current.reducedMotion) {
            bird.position.x += delta * .22
            const left = bird.getObjectByName('leftWing'), right = bird.getObjectByName('rightWing')
            if (left) left.rotation.x = Math.sin(elapsed * 8 + Number(bird.userData.seed) % 7) * .36
            if (right) right.rotation.x = -Math.sin(elapsed * 8 + Number(bird.userData.seed) % 7) * .36
          }
        }
      }
      if (!state.current.reducedMotion) {
        for (const [id, person] of workerGroupsRef.current) {
          if (person.userData.animation !== 'tool-loop' && person.userData.animation !== 'prep-loop') continue
          const phase = elapsed * (person.userData.animation === 'prep-loop' ? 2.1 : 3.4) + (seedOf(id) % 13)
          const left = person.getObjectByName('leftArm'), right = person.getObjectByName('rightArm')
          if (left) left.rotation.x = Math.sin(phase) * (person.userData.animation === 'prep-loop' ? .06 : .11)
          if (right) right.rotation.x = Math.sin(phase + 1.1) * (person.userData.animation === 'prep-loop' ? .09 : .16)
        }
      }
      animateArtisans(artisanGroupsRef.current, delta, elapsed, state.current.reducedMotion, explore.active ? traveller.position : undefined)
      animateTownsperson(townspersonGroups, delta, elapsed, state.current.reducedMotion, townWanderNetwork)
      const slideIndex = Math.floor(now / 8000) % 3
      for (const [cluster, billboard] of billboardsRef.current) {
        const slide = billboardSlidesRef.current.get(cluster)?.[slideIndex]
        if (slide) billboard.update(slide)
      }
      element.dataset.billboardSlide = ['identity', 'agents', 'work'][slideIndex]!
      element.dataset.billboardCount = String(billboardsRef.current.size)
      if (Math.floor(now / 1000) !== Math.floor((now - delta * 1000) / 1000)) {
        element.dataset.artisanPositions = JSON.stringify(Object.fromEntries([...artisanGroupsRef.current].map(([id, figure]) => [id, { x: Number(figure.position.x.toFixed(1)), z: Number(figure.position.z.toFixed(1)), walking: Boolean((figure.userData.route as unknown[] | undefined)?.length) }])))
        element.dataset.townspersonPositions = JSON.stringify(townspersonGroups.filter(person => person.userData.wander).map(person => ({ seed: String(person.userData.seed), x: Number(person.position.x.toFixed(1)), z: Number(person.position.z.toFixed(1)), walking: Boolean((person.userData.wanderRoute as unknown[] | undefined)?.length), island: String(person.userData.island ?? '') })))
        element.dataset.rendererResources = JSON.stringify({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tiles: tiles.length, lights: nightLights.length, clouds: clouds.length, flocks: flocks.length })
      }
      renderer.render(scene, camera); labelRenderer.render(scene, camera)
      // Restore the orbit distance so the view springs back once the wall is passed.
      if (cameraPulled) camera.position.copy(explore.camera)
      const ordered = [...labels].sort((a, b) => {
        const rank = (label: CSS2DObject) => {
          const id = label.element.dataset.projectId
          if (label.element.classList.contains('town-observatory-label')) return 7
          if (label.element.classList.contains('town-communication-marker')) return 6
          if (label.element.dataset.hallId) return 5
          if (id === state.current.selected) return 4
          if (state.current.pinnedProjectIds.has(id ?? '')) return 3
          if (label.element.dataset.agentId) return 2
          return 1
        }
        return rank(b) - rank(a)
      })
      const occupied: DOMRect[] = []
      for (const label of ordered) {
        const node = label.element as HTMLElement
        node.style.visibility = ''
        const rect = node.getBoundingClientRect()
        if (!rect.width || !rect.height) continue
        const collides = occupied.some(box => rect.left < box.right + 3 && rect.right + 3 > box.left && rect.top < box.bottom + 3 && rect.bottom + 3 > box.top)
        const persistent = Boolean(node.classList.contains('town-observatory-label') || node.classList.contains('town-communication-marker') || node.dataset.hallId || node.dataset.agentId || node.dataset.projectId === state.current.selected || state.current.pinnedProjectIds.has(node.dataset.projectId ?? ''))
        if (collides && !persistent) { node.style.visibility = 'hidden'; continue }
        occupied.push(rect)
      }
    }
    raf = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(raf); observer.disconnect()
      element.removeEventListener('keydown', keyboard)
      window.removeEventListener('keydown', exploreKeyDown); window.removeEventListener('keyup', exploreKeyUp); window.removeEventListener('blur', exploreBlur)
      if (explore.promptId) state.current.onExplorePrompt?.(null)
      exploreApiRef.current = null
      travellerTag.remove()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('click', click)
      controls.removeEventListener('change', rememberCamera); controls.dispose()
      state.current.onFocusReady(null); state.current.onOverviewReady(null); state.current.onDropReady?.(null)
      labels.splice(0).forEach(label => label.element.remove())
      communicationMarkersRef.current.clear()
      for (const { assets } of frontageAssetsRef.current.values()) for (const asset of assets) library.releaseAsset(asset)
      for (const person of townspersonGroups) library.releaseAsset(person)
      frontageAssetsRef.current.clear()
      workerGroupsRef.current.clear(); artisanGroupsRef.current.clear(); buildingsRef.current.clear()
      for (const geometry of resources) geometry.dispose()
      for (const material of materials) material.dispose()
      billboardLibrary.dispose(); billboardsRef.current.clear(); billboardSlidesRef.current.clear()
      library.dispose()
      renderer.dispose(); renderer.domElement.remove(); labelRenderer.domElement.remove()
      sceneRef.current = null; fogRef.current = null; hemiRef.current = null; sunRef.current = null; groundRef.current = null; skyRef.current = null; lampLightsRef.current = []; assetsRef.current = null; controlsRef.current = null
    }
  }, [sceneStamp])

  useEffect(() => { exploreApiRef.current?.(Boolean(props.exploring)) }, [props.exploring, sceneStamp])

  useEffect(() => {
    const slides = new Map<TownCluster, TownBillboardSlide[]>()
    for (const island of props.layout.islands) {
      const current = townBillboardSlides({ cluster: island.cluster, layout: props.layout, agents: legacyAgents, tasks: props.tasks, messages: props.messages, userId: props.userId, liveConnected: props.liveConnected })
      slides.set(island.cluster, current)
      billboardsRef.current.get(island.cluster)?.update(current[Math.floor(performance.now() / 8000) % 3]!)
    }
    billboardSlidesRef.current = slides
  }, [props.layout, legacyAgents, props.tasks, props.messages, props.userId, props.liveConnected, sceneStamp])

  useEffect(() => {
    const scene = sceneRef.current, fog = fogRef.current, hemi = hemiRef.current, sun = sunRef.current, ground = groundRef.current
    if (!scene || !fog || !hemi || !sun || !ground) return
    const sky = skyRef.current
    if (!sky) return
    applyTownSceneMode(props.mode, scene, fog, hemi, sun, ground, sky, lampLightsRef.current, labelsRef.current)
  }, [props.mode, sceneStamp])

  useEffect(() => {
    const active = props.activeProjectIds
    for (const [id, building] of buildingsRef.current) {
      const marker = building.children.find(child => child.userData.activeMarker)
      const isActive = active.has(id)
      if (marker) marker.visible = isActive
      if (building.userData.activeAppearance === isActive) continue
      const appearance = projectBuildingAppearance(id, props.layout.get(id)?.cluster)
      const updateAppearance = building.userData.setAppearance
      if (typeof updateAppearance === 'function') updateAppearance(appearance, isActive)
      building.userData.activeAppearance = isActive
    }
  }, [props.activeProjectIds, sceneStamp])

  useEffect(() => {
    const library = assetsRef.current
    if (!library) return
    const presence = projectAgentPresence(legacyAgents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected)
    for (const project of props.projects) {
      const position = props.layout.get(project.id)
      const house = buildingsRef.current.get(project.id)
      if (!position || !house) continue
      const running = props.liveConnected && (presence.some(person => person.pose === 'working' && person.projectId === project.id)
        || artisanStatuses.some(status => status.pose === 'work' && status.projectId === project.id))
      const specs = townFrontagePlan(position, props.tasks, props.messages, props.userId, running)
      const stamp = specs.map(item => `${item.slot}:${item.kind}`).join('|')
      const existing = frontageAssetsRef.current.get(project.id)
      if (existing?.stamp === stamp) continue
      if (existing) for (const asset of existing.assets) { library.releaseAsset(asset); asset.removeFromParent() }
      const assets = specs.map(item => {
        const asset = library.createProp(item.kind, `${project.id}:${item.slot}`)
        asset.position.set(item.x, 0, item.z)
        asset.rotation.y = 0
        asset.userData.projectId = project.id
        asset.userData.frontageKind = item.slot
        asset.userData.ambientScenery = false
        asset.traverse(child => { child.userData.projectId = project.id })
        house.add(asset)
        return asset
      })
      frontageAssetsRef.current.set(project.id, { stamp, assets })
    }
    for (const [projectId, current] of frontageAssetsRef.current) {
      if (props.layout.has(projectId)) continue
      for (const asset of current.assets) { library.releaseAsset(asset); asset.removeFromParent() }
      frontageAssetsRef.current.delete(projectId)
    }
  }, [props.projects, props.tasks, legacyAgents, artisanStatuses, props.messages, props.userId, props.liveConnected, props.layout, sceneStamp])

  useEffect(() => {
    const presence = projectAgentPresence(legacyAgents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected)
    const library = assetsRef.current
    const groups = workerGroupsRef.current
    if (!library) return
    const known = new Set(presence.map(person => person.id))
    for (const [id, group] of groups) {
      if (!known.has(id)) {
        const label = group.userData.nameLabel as CSS2DObject | undefined
        if (label) {
          const index = labelsRef.current.indexOf(label)
          if (index >= 0) labelsRef.current.splice(index, 1)
          label.element.remove()
        }
        library.releaseAsset(group)
        group.removeFromParent(); groups.delete(id)
      }
    }
    for (const person of presence) {
      let group = groups.get(person.id)
      if (!group) {
        group = library.createWorker(seedOf(person.id))
        group.userData.agentId = person.id
        group.traverse(child => { child.userData.agentId = person.id })
        const name = document.createElement('button')
        name.type = 'button'; name.className = 'town-agent-label'
        name.dataset.agentId = person.id
        name.setAttribute('aria-label', `Open ${person.name} resident card`)
        name.addEventListener('click', event => {
          event.stopPropagation()
          const current = projectAgentPresence(state.current.agents, state.current.tasks, state.current.layout, state.current.messages, state.current.userId, state.current.liveConnected).find(item => item.id === person.id)
          if (current) state.current.onSelectAgent(current)
        })
        const label = new CSS2DObject(name)
        label.position.set(0, 3.4, 0); label.visible = state.current.labelsVisible
        group.add(label); labelsRef.current.push(label); group.userData.nameLabel = label
        groups.set(person.id, group); sceneRef.current?.add(group)
      }
      group.position.set(person.position.x, 0, person.position.z)
      group.userData.pose = person.pose
      group.userData.animation = workerAnimation(person, props.reducedMotion)
      group.userData.taskId = person.taskId
      group.userData.taskState = person.taskState
      group.visible = true
      const nameLabel = group.userData.nameLabel as CSS2DObject | undefined
      if (nameLabel) {
        nameLabel.element.textContent = `${person.name} · ${person.label}`
        nameLabel.element.setAttribute('aria-label', `Open ${person.name} resident card, ${person.label}`)
        nameLabel.element.dataset.pose = person.pose
        nameLabel.element.dataset.taskId = person.taskId ?? ''
      }
    }
  }, [legacyAgents, props.tasks, props.layout, props.reducedMotion, props.messages, props.userId, props.liveConnected])

  useEffect(() => {
    const library = assetsRef.current
    const scene = sceneRef.current
    const groups = artisanGroupsRef.current
    if (!library || !scene) return
    const known = new Set(artisanStatuses.map(status => status.id))
    for (const [id, group] of groups) {
      if (known.has(id)) continue
      const badge = group.userData.badge as CSS2DObject | undefined
      if (badge) { const index = labelsRef.current.indexOf(badge); if (index >= 0) labelsRef.current.splice(index, 1); badge.element.remove() }
      library.releaseAsset(group)
      group.removeFromParent(); groups.delete(id)
    }
    const slots = artisanSlots(artisanStatuses)
    for (const status of artisanStatuses) {
      let group = groups.get(status.id)
      const look = artisanLook(status.persona, status.craft)
      if (!look) continue
      const target = artisanWorldPoint(status, props.layout, slots.get(status.id) ?? 0)
      if (!group) {
        group = library.createArtisan(look)
        group.userData.artisanId = status.id
        group.userData.displayName = status.name
        group.traverse(child => { child.userData.artisanId = status.id })
        const badge = document.createElement('button')
        badge.type = 'button'; badge.className = 'town-artisan-badge'
        badge.dataset.agentId = status.id
        badge.addEventListener('click', event => { event.stopPropagation(); state.current.onSelectArtisan?.(status.id) })
        const label = new CSS2DObject(badge)
        label.position.set(0, look.form === 'ganesha' ? 3.0 : 2.75, 0)
        group.add(label); labelsRef.current.push(label); group.userData.badge = label
        group.position.set(target.x, 0, target.z)
        group.userData.route = []
        groups.set(status.id, group); scene.add(group)
      }
      const previous = group.userData.target as { x: number; z: number } | undefined
      if (!previous || Math.hypot(previous.x - target.x, previous.z - target.z) > .5) {
        group.userData.target = target
        group.userData.route = props.reducedMotion ? [] : townWalkRoute(props.layout, { x: group.position.x, z: group.position.z }, target, roadGraph).slice(1)
        if (props.reducedMotion) group.position.set(target.x, 0, target.z)
      }
      const lot = status.projectId ? props.layout.get(status.projectId) : undefined
      group.userData.face = status.place === 'guild' ? { x: target.x + 10, z: target.z } : status.place === 'staging' ? { x: target.x - 10, z: target.z } : lot ? { x: lot.x, z: lot.z } : undefined
      group.userData.pose = status.pose
      group.userData.lamp = status.lamp
      group.userData.toolActive = status.toolActive
      const flame = group.userData.lampFlame as THREE.Mesh | undefined
      if (flame) flame.material = library.artisanLampMaterial(status.lamp)
      const leaf = group.getObjectByName('orderLeaf')
      if (leaf) leaf.visible = status.pose === 'stand' || status.pose === 'raise'
      setGhost(group, status.ghost)
      const badge = (group.userData.badge as CSS2DObject).element as HTMLButtonElement
      badge.innerHTML = `<i aria-hidden="true"></i><b></b><span></span>`
      badge.querySelector('b')!.textContent = status.name
      badge.querySelector('span')!.textContent = status.queuedCount ? `${status.label} · +${status.queuedCount}` : status.label
      badge.dataset.lamp = status.lamp
      // Resting artisans yield their badge on overlap; anyone with work in hand keeps it.
      if (status.place === 'guild' && status.lamp === 'idle') delete badge.dataset.agentId
      else badge.dataset.agentId = status.id
      badge.dataset.place = status.place
      badge.setAttribute('aria-label', `${status.name}, ${look.epithet}: ${status.detail}`)
      badge.title = status.detail
    }
    if (host.current) host.current.dataset.artisanCount = String(groups.size)
  }, [artisanStatuses, props.layout, props.reducedMotion, roadGraph, sceneStamp])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const markers = communicationMarkersRef.current
    const presence = projectAgentPresence(legacyAgents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected)
    const hosts = new Map<string, THREE.Object3D>()
    for (const [id, building] of buildingsRef.current) hosts.set(`project:${id}`, building)
    for (const [id, worker] of workerGroupsRef.current) hosts.set(`agent:${id}`, worker)
    const hall = scene.children.find(child => child.userData.hallId === 'bell-hall')
    if (hall) hosts.set('hall', hall)
    const desired = new Map<string, ReturnType<typeof townCommunicationMarker> | undefined>()
    for (const project of props.projects) desired.set(`project:${project.id}`, townCommunicationMarker({ messages: props.messages, tasks: props.tasks, agents: legacyAgents, anchor: { type: 'project', id: project.id }, userId: props.userId, allowLiveActivity: props.liveConnected }))
    for (const person of presence) desired.set(`agent:${person.id}`, townCommunicationMarker({ messages: props.messages, tasks: props.tasks, agents: legacyAgents, anchor: { type: 'agent', id: person.id }, userId: props.userId, allowLiveActivity: props.liveConnected }))
    desired.set('hall', townCommunicationMarker({ messages: props.messages, tasks: props.tasks, agents: legacyAgents, anchor: { type: 'hall' }, userId: props.userId, allowLiveActivity: props.liveConnected }))
    for (const [key, marker] of markers) {
      if (!desired.get(key) || !hosts.has(key)) { marker.element.remove(); markers.delete(key); const index = labelsRef.current.indexOf(marker); if (index >= 0) labelsRef.current.splice(index, 1) }
    }
    for (const [key, value] of desired) {
      const host = hosts.get(key)
      if (!host || !value) continue
      let marker = markers.get(key)
      if (!marker) {
        const button = document.createElement('button')
        button.type = 'button'; button.className = 'town-communication-marker'
        button.addEventListener('click', event => { event.stopPropagation(); const current = key === 'hall' ? undefined : key.split(':')[1]; if (key === 'hall') state.current.onSelectHall(); else if (key.startsWith('agent:')) { const person = projectAgentPresence(state.current.agents, state.current.tasks, state.current.layout, state.current.messages, state.current.userId, state.current.liveConnected).find(item => item.id === current); if (person) state.current.onSelectAgent(person) } else if (current) state.current.onSelect(current) })
        marker = new CSS2DObject(button); markers.set(key, marker); labelsRef.current.push(marker); host.add(marker)
      }
      const button = marker.element as HTMLButtonElement
      button.textContent = value.glyph + (value.count > 1 ? ` ${value.count}` : '')
      button.setAttribute('aria-label', `${value.label}${value.count > 1 ? ` (${value.count})` : ''}`)
      button.dataset.markerKind = value.kind
      button.dataset.projectId = key.startsWith('project:') ? key.slice('project:'.length) : ''
      button.dataset.agentId = key.startsWith('agent:') ? key.slice('agent:'.length) : ''
      marker.position.set(0, key === 'hall' ? TEMPLE_SITE.maxHeight + 3.1 : key.startsWith('agent:') ? 4.8 : 9.2, 0)
    }
  }, [legacyAgents, props.tasks, props.messages, props.projects, props.layout, props.userId, props.liveConnected])

  useEffect(() => {
    for (const label of labelsRef.current) {
      const projectId = label.element.dataset.projectId
      if (projectId) {
        const project = props.projects.find(item => item.id === projectId)
        if (project) label.element.textContent = project.display.name
      }
      label.element.classList.toggle('is-selected', projectId === props.selected)
    }
  }, [props.projects, props.selected])

  useEffect(() => {
    for (const label of labelsRef.current) if (!label.element.classList.contains('town-communication-marker') && !label.element.classList.contains('town-observatory-label') && !label.element.classList.contains('town-artisan-badge')) label.visible = props.labelsVisible
    if (host.current) host.current.dataset.labelsVisible = String(props.labelsVisible)
  }, [props.labelsVisible, sceneStamp])

  const people = useMemo(() => projectAgentPresence(legacyAgents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected), [legacyAgents, props.tasks, props.messages, props.layout, props.userId, props.liveConnected])
  return <div className="town-world" ref={host} aria-label="Interactive 3D map of the Kaveri countryside with decorative townspeople. Use arrow keys to orbit and plus or minus to zoom." role="application" tabIndex={0} data-layout-revision={props.layoutRevision} data-person-count={people.length} data-labels-visible={props.labelsVisible}>
    <div className="town-map-hint">{props.exploring ? 'WASD / ARROWS WALK · SHIFT RUN · DRAG LOOK · CLICK GROUND TO WALK · E ACT · ESC LEAVE' : 'DRAG ORBIT · RIGHT-DRAG PAN · SCROLL ZOOM · ARROWS ORBIT'}</div>
  </div>
}
