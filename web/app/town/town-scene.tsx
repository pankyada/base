'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { BuildingForm, TownBuildingAppearance, TownCluster, TownLayout, TownPosition, TownRoadPoint } from './town-model'
import { projectBuildingAppearance, TEMPLE_SITE, townCentralDistrictRadius, townGroveSites, townOverviewDistance } from './town-model'
import { createTownAssetLibrary } from './town-assets'
import { createTownBillboardLibrary, type TownBillboard } from './town-billboards'
import type { ObservatoryReturnView } from './town-portal-state'
import { townCameraDistance, townCameraFarPlane, townCameraMaxDistance } from './town-camera-state'
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
  initialViewPose?: Pick<ObservatoryReturnView, 'position' | 'target'> | null
}

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

export function TownScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef(props)
  state.current = props
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
  const frontageAssetsRef = useRef(new Map<string, { stamp: string; assets: THREE.Group[] }>())
  const communicationMarkersRef = useRef(new Map<string, CSS2DObject>())
  const buildingsRef = useRef(new Map<string, THREE.Group>())
  const assetsRef = useRef<ReturnType<typeof createTownAssetLibrary> | null>(null)
  const resourcesRef = useRef<Set<THREE.BufferGeometry>>(new Set())
  const materialsRef = useRef<Set<THREE.Material>>(new Set())
  const billboardsRef = useRef(new Map<TownCluster, TownBillboard>())
  const billboardSlidesRef = useRef(new Map<TownCluster, TownBillboardSlide[]>())

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
    const billboardLibrary = createTownBillboardLibrary()
    const placement = initial.layout
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
    sun.position.set(-120, 220, 80); sun.castShadow = initialLighting.shadows; sun.shadow.mapSize.set(1024, 1024)
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
      const shore = new THREE.Mesh(new THREE.CircleGeometry(island.radius + 2.5, 64), sceneMaterial(0xc3b692, materials, { roughness: 1 }))
      const land = new THREE.Mesh(new THREE.CircleGeometry(island.radius, 64), sceneMaterial(islandColors[index]!, materials, { roughness: 1 }))
      resources.add(shore.geometry); resources.add(land.geometry)
      shore.rotation.x = land.rotation.x = -Math.PI / 2
      shore.position.set(island.x, -.045, island.z)
      land.position.set(island.x, -.035, island.z)
      shore.receiveShadow = land.receiveShadow = true
      scene.add(shore, land)
      const billboard = billboardLibrary.create(island.cluster)
      billboard.group.position.set(island.sign.x, 0, island.sign.z)
      billboard.update(townBillboardSlides({ cluster: island.cluster, layout: placement, agents: initial.agents, tasks: initial.tasks, messages: initial.messages, userId: initial.userId, liveConnected: initial.liveConnected })[0]!)
      scene.add(billboard.group)
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
      scene.add(prop)
    })

    const roadSurface = sceneMaterial(0xb79f76, materials, { roughness: 1 })
    const roadEdges = sceneMaterial(0x8d866e, materials, { roughness: 1 })
    const roadGeometry = buildRibbon(placement.roads, 1.35, 0, .04)
    const edgeLeft = buildRibbon(placement.roads, .16, -.71, .055)
    const edgeRight = buildRibbon(placement.roads, .16, .71, .055)
    for (const geometry of [roadGeometry, edgeLeft, edgeRight]) resources.add(geometry)
    scene.add(new THREE.Mesh(roadGeometry, roadSurface), new THREE.Mesh(edgeLeft, roadEdges), new THREE.Mesh(edgeRight, roadEdges))

    const hall = library.createTemple(seedOf('bell-hall'))
    hall.name = 'Town Temple · Bell Hall'
    hall.userData.hallId = 'bell-hall'
    hall.position.set(0, 0, 0); scene.add(hall)
    hall.traverse(child => { child.userData.hallId = 'bell-hall' })
    const hallLabel = document.createElement('button')
    hallLabel.type = 'button'
    hallLabel.className = 'town-hall-label town-temple-label'
    hallLabel.dataset.hallId = 'bell-hall'
    hallLabel.innerHTML = '<b>TOWN TEMPLE</b><span>Orchestrator command & dispatch</span>'
    hallLabel.setAttribute('aria-label', 'Open Town Temple operations')
    hallLabel.addEventListener('click', event => { event.stopPropagation(); state.current.onSelectHall() })
    const hallTag = new CSS2DObject(hallLabel); hallTag.position.set(0, TEMPLE_SITE.maxHeight + 1.2, 0); hallTag.visible = initial.labelsVisible; hall.add(hallTag); labels.push(hallTag)

    const observatoryPortal = new THREE.Group()
    observatoryPortal.name = 'cosmic-observatory-portal'
    observatoryPortal.position.set(TEMPLE_SITE.maxX + TEMPLE_SITE.clearance + 8, 0, 0)
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
    observatoryPortal.add(threshold); scene.add(observatoryPortal)
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
      scene.add(house)

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
      asset.position.set(tree.x, 0, tree.z); scene.add(asset)
    })
    const innerGroveSites = townGroveSites(trees)
    innerGroveSites.forEach((site, index) => {
      const grove = library.createProp('grove', seedOf(`roadside-grove-${index}`))
      grove.position.set(site.x, 0, site.z)
      grove.scale.setScalar(1.25)
      grove.userData.ambientScenery = true
      scene.add(grove)
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
      group.add(prop); scene.add(group)
      addDiscoveryLabel(site, scene, id => state.current.onSelectDiscovery(id), labels)
      labels[labels.length - 1]!.position.set(site.x, 2.7, site.z)
      labels[labels.length - 1]!.visible = initial.labelsVisible
    }

    const nightLights: THREE.PointLight[] = []
    const lampSites = nightLampSites(placement)
    for (let index = 0; index < lampSites.length; index++) {
      const site = lampSites[index]
      const lamp = library.createLamp(seedOf(`lamp-${index}`))
      lamp.position.set(site.x, 0, site.z); scene.add(lamp)
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

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.dampingFactor = .085; controls.minDistance = 13
    controls.maxDistance = townCameraMaxDistance(initialPose.distance, restoredDistance); controls.maxPolarAngle = Math.PI * .47
    controls.target.copy(state.current.initialViewPose ? new THREE.Vector3(...state.current.initialViewPose.target) : retainedPose?.target ?? new THREE.Vector3(0, 1, 0)); controlsRef.current = controls; state.current.onReady(controls)
    const rememberCamera = () => {
      const target = controls.target, p = camera.position
      element.dataset.cameraPose = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}:${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}`
    }
    controls.addEventListener('change', rememberCamera)
    rememberCamera()
    const overview = () => {
      const pose = overviewPose()
      controls.target.set(0, 1, 0); controls.maxDistance = Math.max(380, pose.distance * 1.3)
      camera.far = Math.max(2200, pose.distance + maxRadius * 4); camera.updateProjectionMatrix()
      camera.position.copy(pose.position); controls.update()
    }
    const focus = (id: string) => {
      if (id === 'bell-hall' || id === 'town-temple' || id === 'temple') {
        const target = new THREE.Vector3(0, TEMPLE_SITE.maxHeight * .38, 0)
        const viewDirection = camera.position.clone().sub(controls.target).normalize()
        const bounds = Math.hypot(TEMPLE_SITE.width / 2, TEMPLE_SITE.depth / 2, TEMPLE_SITE.maxHeight / 2)
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
      const hit = raycaster.intersectObjects([observatoryPortal, hall, ...buildings.values(), ...workerGroupsRef.current.values()], true).find(result => result.object.userData.observatoryPortal || result.object.userData.projectId || result.object.userData.agentId || result.object.userData.hallId)
      if (hit?.object.userData.observatoryPortal) { state.current.onEnterObservatory?.(); return }
      if (hit?.object.userData.hallId) state.current.onSelectHall()
      else if (hit?.object.userData.agentId) {
        const person = projectAgentPresence(state.current.agents, state.current.tasks, state.current.layout, state.current.messages, state.current.userId, state.current.liveConnected).find(item => item.id === hit.object.userData.agentId)
        if (person) state.current.onSelectAgent(person)
      } else if (hit?.object.userData.projectId) state.current.onSelect(hit.object.userData.projectId as string)
    }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('click', click)
    const keyboard = (event: KeyboardEvent) => {
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
      const beforeX = controls.target.x, beforeZ = controls.target.z
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -panLimit, panLimit)
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -panLimit, panLimit)
      camera.position.x += controls.target.x - beforeX; camera.position.z += controls.target.z - beforeZ
      controls.update(); updateTerrainTiles()
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
      const slideIndex = Math.floor(now / 8000) % 3
      for (const [cluster, billboard] of billboardsRef.current) {
        const slide = billboardSlidesRef.current.get(cluster)?.[slideIndex]
        if (slide) billboard.update(slide)
      }
      element.dataset.billboardSlide = ['identity', 'agents', 'work'][slideIndex]!
      element.dataset.billboardCount = String(billboardsRef.current.size)
      if (Math.floor(now / 1000) !== Math.floor((now - delta * 1000) / 1000)) {
        element.dataset.rendererResources = JSON.stringify({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tiles: tiles.length, lights: nightLights.length, clouds: clouds.length, flocks: flocks.length })
      }
      renderer.render(scene, camera); labelRenderer.render(scene, camera)
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
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('click', click)
      controls.removeEventListener('change', rememberCamera); controls.dispose()
      state.current.onFocusReady(null); state.current.onOverviewReady(null)
      labels.splice(0).forEach(label => label.element.remove())
      communicationMarkersRef.current.clear()
      for (const { assets } of frontageAssetsRef.current.values()) for (const asset of assets) library.releaseAsset(asset)
      frontageAssetsRef.current.clear()
      workerGroupsRef.current.clear(); buildingsRef.current.clear()
      for (const geometry of resources) geometry.dispose()
      for (const material of materials) material.dispose()
      billboardLibrary.dispose(); billboardsRef.current.clear(); billboardSlidesRef.current.clear()
      library.dispose()
      renderer.dispose(); renderer.domElement.remove(); labelRenderer.domElement.remove()
      sceneRef.current = null; fogRef.current = null; hemiRef.current = null; sunRef.current = null; groundRef.current = null; skyRef.current = null; lampLightsRef.current = []; assetsRef.current = null; controlsRef.current = null
    }
  }, [sceneStamp])

  useEffect(() => {
    const slides = new Map<TownCluster, TownBillboardSlide[]>()
    for (const island of props.layout.islands) {
      const current = townBillboardSlides({ cluster: island.cluster, layout: props.layout, agents: props.agents, tasks: props.tasks, messages: props.messages, userId: props.userId, liveConnected: props.liveConnected })
      slides.set(island.cluster, current)
      billboardsRef.current.get(island.cluster)?.update(current[Math.floor(performance.now() / 8000) % 3]!)
    }
    billboardSlidesRef.current = slides
  }, [props.layout, props.agents, props.tasks, props.messages, props.userId, props.liveConnected, sceneStamp])

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
    const presence = projectAgentPresence(props.agents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected)
    for (const project of props.projects) {
      const position = props.layout.get(project.id)
      const house = buildingsRef.current.get(project.id)
      if (!position || !house) continue
      const running = props.liveConnected && presence.some(person => person.pose === 'working' && person.projectId === project.id)
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
  }, [props.projects, props.tasks, props.agents, props.messages, props.userId, props.liveConnected, props.layout, sceneStamp])

  useEffect(() => {
    const presence = projectAgentPresence(props.agents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected)
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
  }, [props.agents, props.tasks, props.layout, props.reducedMotion, props.messages, props.userId, props.liveConnected])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const markers = communicationMarkersRef.current
    const presence = projectAgentPresence(props.agents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected)
    const hosts = new Map<string, THREE.Object3D>()
    for (const [id, building] of buildingsRef.current) hosts.set(`project:${id}`, building)
    for (const [id, worker] of workerGroupsRef.current) hosts.set(`agent:${id}`, worker)
    const hall = scene.children.find(child => child.userData.hallId === 'bell-hall')
    if (hall) hosts.set('hall', hall)
    const desired = new Map<string, ReturnType<typeof townCommunicationMarker> | undefined>()
    for (const project of props.projects) desired.set(`project:${project.id}`, townCommunicationMarker({ messages: props.messages, tasks: props.tasks, agents: props.agents, anchor: { type: 'project', id: project.id }, userId: props.userId, allowLiveActivity: props.liveConnected }))
    for (const person of presence) desired.set(`agent:${person.id}`, townCommunicationMarker({ messages: props.messages, tasks: props.tasks, agents: props.agents, anchor: { type: 'agent', id: person.id }, userId: props.userId, allowLiveActivity: props.liveConnected }))
    desired.set('hall', townCommunicationMarker({ messages: props.messages, tasks: props.tasks, agents: props.agents, anchor: { type: 'hall' }, userId: props.userId, allowLiveActivity: props.liveConnected }))
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
  }, [props.agents, props.tasks, props.messages, props.projects, props.layout, props.userId, props.liveConnected])

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
    for (const label of labelsRef.current) if (!label.element.classList.contains('town-communication-marker') && !label.element.classList.contains('town-observatory-label')) label.visible = props.labelsVisible
    if (host.current) host.current.dataset.labelsVisible = String(props.labelsVisible)
  }, [props.labelsVisible, sceneStamp])

  const people = useMemo(() => projectAgentPresence(props.agents, props.tasks, props.layout, props.messages, props.userId, props.liveConnected), [props.agents, props.tasks, props.messages, props.layout, props.userId, props.liveConnected])
  return <div className="town-world" ref={host} aria-label="Interactive 3D map of the Kaveri countryside. Use arrow keys to orbit and plus or minus to zoom." role="application" tabIndex={0} data-layout-revision={props.layoutRevision} data-person-count={people.length} data-labels-visible={props.labelsVisible}>
    <div className="town-map-hint">DRAG ORBIT · RIGHT-DRAG PAN · SCROLL ZOOM · ARROWS ORBIT</div>
  </div>
}
