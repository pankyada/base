'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { ObservatoryCollection, ObservatoryFile } from './observatory-model'

interface Props {
  collections: ObservatoryCollection[]
  selectedCollection: string | null
  selectedFileId: string | null
  reducedMotion: boolean
  onSelectCollection: (id: string) => void
  onSelectFile: (file: ObservatoryFile) => void
  onReturn: () => void
}

const WORLD_LAYOUT: Record<ObservatoryCollection['id'], { position: THREE.Vector3; tint: number; radius: number; title: string }> = {
  images: { position: new THREE.Vector3(-10, 5.5, -1), tint: 0x7abbd3, radius: 2.18, title: 'Image constellation' },
  documents: { position: new THREE.Vector3(0, 7.3, -4.8), tint: 0xd6ae72, radius: 2.05, title: 'Archive planet' },
  videos: { position: new THREE.Vector3(10, 5.4, -1), tint: 0x55bcd3, radius: 2.22, title: 'Cinema world' },
}

function makeMaterial(color: number, resources: Set<THREE.Material>, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .52, metalness: .26, ...options })
  resources.add(material)
  return material
}

function makeTextTexture(title: string, count: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 512
  const context = canvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, 512, 512)
  gradient.addColorStop(0, '#f6f2e9'); gradient.addColorStop(1, '#c7d9df')
  context.fillStyle = gradient; context.fillRect(0, 0, 512, 512)
  context.fillStyle = color; context.globalAlpha = .18
  for (let index = 0; index < 10; index++) {
    context.beginPath(); context.arc(65 + index * 43, 120 + (index % 3) * 90, 42 + index % 4 * 12, 0, Math.PI * 2); context.fill()
  }
  context.globalAlpha = 1
  context.strokeStyle = '#ae8b56'; context.lineWidth = 8; context.strokeRect(18, 18, 476, 476)
  context.fillStyle = '#28343b'; context.textAlign = 'center'
  context.font = '500 38px Georgia'; context.fillText(title, 256, 340, 440)
  context.font = '24px sans-serif'; context.fillStyle = '#6d7476'; context.fillText(count, 256, 386)
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4
  return texture
}

function makeNebulaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 768
  const context = canvas.getContext('2d')!
  context.fillStyle = '#07111d'; context.fillRect(0, 0, canvas.width, canvas.height)
  const clouds = [
    [310, 280, 350, 'rgba(49,90,157,.25)'], [550, 375, 270, 'rgba(113,70,140,.16)'],
    [920, 230, 310, 'rgba(46,111,145,.22)'], [1250, 430, 350, 'rgba(67,83,159,.20)'],
    [760, 120, 220, 'rgba(163,114,76,.09)'],
  ] as const
  for (const [x, y, radius, color] of clouds) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, color); gradient.addColorStop(1, 'rgba(7,17,29,0)')
    context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 2
  return texture
}

function requiredOverviewDistance(camera: THREE.PerspectiveCamera, width: number, height: number, target: THREE.Vector3): number {
  // Bounds include the portal arch, the outside collection cards and their labels.
  const halfWidth = Math.max(Math.abs(-19.6 - target.x), Math.abs(19.6 - target.x))
  const halfHeight = Math.max(Math.abs(-2 - target.y), Math.abs(13.8 - target.y))
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (width / Math.max(1, height)))
  return Math.max(halfHeight / Math.tan(verticalFov / 2), halfWidth / Math.tan(horizontalFov / 2)) * 1.16
}

function requiredFocusDistance(camera: THREE.PerspectiveCamera, width: number, height: number, halfWidth: number, halfHeight: number): number {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (width / Math.max(1, height)))
  return Math.max(halfHeight / Math.tan(verticalFov / 2), halfWidth / Math.tan(horizontalFov / 2)) * 1.13
}

function addRing(parent: THREE.Object3D, radius: number, tube: number, color: number, materials: Set<THREE.Material>, geometries: Set<THREE.BufferGeometry>, rotation: THREE.Euler, opacity = 1): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 120); geometries.add(geometry)
  const material = makeMaterial(color, materials, { emissive: color, emissiveIntensity: .42, transparent: opacity < 1, opacity })
  const ring = new THREE.Mesh(geometry, material); ring.rotation.copy(rotation); parent.add(ring); return ring
}

function buttonStyle(): CSSProperties {
  return { pointerEvents: 'auto', cursor: 'pointer', border: '1px solid rgba(226,192,129,.72)', borderRadius: '999px', padding: '9px 15px', color: '#fff8e8', background: 'rgba(20,27,36,.82)', boxShadow: '0 0 24px rgba(235,181,91,.15)', font: '500 12px/1.2 system-ui, sans-serif', letterSpacing: '.11em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
}

export default function ObservatoryScene(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0b1420')
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 420)
    camera.position.set(0, 19, 36)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.16
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none'
    host.appendChild(renderer.domElement)
    const labels = new CSS2DRenderer()
    labels.domElement.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none'
    host.appendChild(labels.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 4.4, 0); controls.enableDamping = true; controls.dampingFactor = .055
    controls.minDistance = 18; controls.maxDistance = 150; controls.maxPolarAngle = Math.PI * .48
    controls.enablePan = true; controls.panSpeed = .55
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', 'Observatory scene. Drag to orbit, use arrow keys to look around, plus and minus to zoom, Home to reset view.')
    let cameraTransition: { fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; toPosition: THREE.Vector3; toTarget: THREE.Vector3; elapsed: number; duration: number } | null = null
    let userInterruptedCamera = false
    const cancelCameraTransition = () => { if (cameraTransition) cameraTransition = null; userInterruptedCamera = true }
    controls.addEventListener('start', cancelCameraTransition)

    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    const textures = new Set<THREE.Texture>()
    const clickable: THREE.Object3D[] = []
    const collectionGroups = new Map<string, THREE.Group>()
    const disposers: Array<() => void> = []
    let lastFrameTime = performance.now()
    let elapsedTime = 0

    const nebulaTexture = makeNebulaTexture(); textures.add(nebulaTexture)
    const nebulaGeo = new THREE.SphereGeometry(230, 36, 24); geometries.add(nebulaGeo)
    const nebulaMat = new THREE.MeshBasicMaterial({ map: nebulaTexture, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false })
    materials.add(nebulaMat)
    const nebula = new THREE.Mesh(nebulaGeo, nebulaMat); nebula.renderOrder = -20; scene.add(nebula)

    scene.add(new THREE.HemisphereLight(0xfff0d7, 0x263b4b, 1.65))
    const key = new THREE.DirectionalLight(0xffe0a6, 2.7); key.position.set(-12, 24, 12); scene.add(key)
    const cool = new THREE.DirectionalLight(0x91c8f0, 1.35); cool.position.set(14, 11, -14); scene.add(cool)
    const centerGlow = new THREE.PointLight(0xffd58c, 48, 36, 2); centerGlow.position.set(0, 7, 0); scene.add(centerGlow)

    const random = (() => { let seed = 0x53a91; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 } })()
    const starPositions: number[] = [], starColors: number[] = []
    for (let i = 0; i < 2800; i++) {
      const radius = 68 + random() * 155, theta = random() * Math.PI * 2, phi = Math.acos(2 * random() - 1)
      starPositions.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * .72 + 24, radius * Math.sin(phi) * Math.sin(theta))
      const roll = random()
      const color = new THREE.Color(roll > .9 ? 0xffd797 : roll > .64 ? 0xc5e1ff : roll > .24 ? 0xa7b9e8 : 0xf1eee4)
      starColors.push(color.r, color.g, color.b)
    }
    const starGeometry = new THREE.BufferGeometry(); geometries.add(starGeometry)
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3))
    const starMaterial = new THREE.PointsMaterial({ size: .58, vertexColors: true, transparent: true, opacity: 1, sizeAttenuation: true, depthWrite: false }); materials.add(starMaterial)
    const starField = new THREE.Points(starGeometry, starMaterial); scene.add(starField)
    // Fine dust gives depth without a costly shader or postprocessing pass.
    const dustPositions: number[] = []
    for (let i = 0; i < 560; i++) dustPositions.push((random() - .5) * 62, random() * 22 - 3, (random() - .5) * 48)
    const dustGeometry = new THREE.BufferGeometry(); geometries.add(dustGeometry); dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3))
    const dustMaterial = new THREE.PointsMaterial({ color: 0xf2d49c, size: .07, transparent: true, opacity: .5, depthWrite: false }); materials.add(dustMaterial); scene.add(new THREE.Points(dustGeometry, dustMaterial))

    const orbitalPaths = [
      { points: [[-16, 10.5, -4], [-10, 14.2, -8], [0, 13.6, -9], [10, 14, -5], [16, 10, -1]], color: 0x6e91c4 },
      { points: [[-16, 6.8, 1], [-9, 9.6, 5], [0, 10.1, 6.5], [9, 8.7, 5], [16, 6.2, 1]], color: 0xc59c5d },
      { points: [[-12, 2.4, -8], [-7, 5.1, -12], [0, 6.1, -12], [8, 4.7, -10], [13, 2.3, -6]], color: 0x597ba7 },
    ] as const
    for (const path of orbitalPaths) {
      const curve = new THREE.CatmullRomCurve3(path.points.map(point => new THREE.Vector3(...point)))
      const curveGeometry = new THREE.TubeGeometry(curve, 96, .018, 5, false); geometries.add(curveGeometry)
      const curveMaterial = new THREE.MeshBasicMaterial({ color: path.color, transparent: true, opacity: .6, toneMapped: false }); materials.add(curveMaterial)
      scene.add(new THREE.Mesh(curveGeometry, curveMaterial))
    }

    const floor = new THREE.Mesh(new THREE.CircleGeometry(17.2, 96), makeMaterial(0x182735, materials, { roughness: .48, metalness: .48 })); floor.geometry.rotateX(-Math.PI / 2); geometries.add(floor.geometry); floor.position.y = -.16; scene.add(floor)
    addRing(floor, 16.85, .075, 0xc69b57, materials, geometries, new THREE.Euler(0, 0, 0), .82)
    const platform = new THREE.Group(); scene.add(platform)
    for (const [radius, depth, color] of [[15, .34, 0xc7b99d], [12.7, .18, 0x34495a], [10.3, .25, 0xe5d5b3], [8.5, .12, 0x657687]] as const) {
      const geo = new THREE.CylinderGeometry(radius, radius * 1.035, depth, 96); geometries.add(geo)
      const mesh = new THREE.Mesh(geo, makeMaterial(color, materials, { roughness: .58, metalness: color === 0x34495a ? .52 : .22 })); mesh.position.y = depth / 2; platform.add(mesh)
      addRing(platform, radius * .94, .055, 0xc99c55, materials, geometries, new THREE.Euler(Math.PI / 2, 0, 0), .9).position.y = depth + .04
    }
    // Fine brass index marks make the observatory read as a calibrated instrument.
    const indexMaterial = makeMaterial(0xd6b570, materials, { roughness: .3, metalness: .78, emissive: 0x4a3217, emissiveIntensity: .18 })
    const indexGeometry = new THREE.BoxGeometry(.035, .018, .25); geometries.add(indexGeometry)
    for (let i = 0; i < 96; i++) {
      const angle = i / 96 * Math.PI * 2
      const mark = new THREE.Mesh(indexGeometry, indexMaterial)
      const radius = i % 8 === 0 ? 14.28 : 14.36
      mark.position.set(Math.sin(angle) * radius, .355, Math.cos(angle) * radius)
      mark.rotation.y = angle; scene.add(mark)
    }
    // Stepped central plinth and a telescope silhouette anchor the scene.
    for (const [radius, height, y, color] of [[4.4, .42, .65, 0xf1e6d1], [3.55, .24, .98, 0xb99150], [3.1, .34, 1.24, 0x24384a], [2.7, .22, 1.52, 0xe8d6b4]] as const) {
      const geo = new THREE.CylinderGeometry(radius, radius * 1.08, height, 64); geometries.add(geo)
      const mesh = new THREE.Mesh(geo, makeMaterial(color, materials, { roughness: .44, metalness: .34 })); mesh.position.y = y; platform.add(mesh)
    }
    const telescope = new THREE.Group(); telescope.position.set(0, 1.72, .2); scene.add(telescope)
    const tubeGeo = new THREE.CylinderGeometry(.78, 1.02, 6.4, 24); geometries.add(tubeGeo)
    const tube = new THREE.Mesh(tubeGeo, makeMaterial(0xeee5d4, materials, { roughness: .28, metalness: .6 })); tube.rotation.z = -.55; tube.position.set(0, 3.58, 0); telescope.add(tube)
    for (const y of [.42, 6.74]) {
      const collarGeo = new THREE.CylinderGeometry(1.04, .95, .25, 24); geometries.add(collarGeo)
      const collar = new THREE.Mesh(collarGeo, makeMaterial(0xb68a45, materials, { roughness: .3, metalness: .82 })); collar.rotation.z = -.55; collar.position.set(0, y, 0); telescope.add(collar)
    }
    const lensGeo = new THREE.CircleGeometry(.73, 32); geometries.add(lensGeo)
    const lens = new THREE.Mesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xc8e7f3, side: THREE.DoubleSide, transparent: true, opacity: .86, toneMapped: false })); materials.add(lens.material); lens.rotation.x = Math.PI / 2; lens.rotation.z = -.55; lens.position.set(0, 6.84, 0); telescope.add(lens)
    const pivotGeo = new THREE.SphereGeometry(.42, 20, 16); geometries.add(pivotGeo)
    const pivot = new THREE.Mesh(pivotGeo, makeMaterial(0xc39a55, materials, { roughness: .24, metalness: .8 })); pivot.position.set(0, 2.45, 0); telescope.add(pivot)
    const gimbal = addRing(telescope, 1.48, .105, 0x98713a, materials, geometries, new THREE.Euler(0, 0, 0), .98); gimbal.position.set(0, 2.45, 0)
    const strutGeo = new THREE.CylinderGeometry(.105, .16, 1, 12); geometries.add(strutGeo)
    const mountMaterial = makeMaterial(0xa77f43, materials, { roughness: .28, metalness: .82 })
    const upper = new THREE.Vector3(0, 2.45, 0)
    for (const [x, z] of [[-1.35, -.9], [1.35, -.9], [0, 1.45]] as const) {
      const foot = new THREE.Vector3(x, .12, z), middle = foot.clone().add(upper).multiplyScalar(.5)
      const strut = new THREE.Mesh(strutGeo, mountMaterial); strut.position.copy(middle); strut.scale.y = foot.distanceTo(upper); strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), upper.clone().sub(foot).normalize()); telescope.add(strut)
      const footGeo = new THREE.CylinderGeometry(.3, .35, .16, 12); geometries.add(footGeo)
      const pad = new THREE.Mesh(footGeo, mountMaterial); pad.position.copy(foot); telescope.add(pad)
    }
    const braceGeo = new THREE.CylinderGeometry(.045, .045, 2.4, 8); geometries.add(braceGeo)
    const brace = new THREE.Mesh(braceGeo, mountMaterial); brace.rotation.x = Math.PI / 2; brace.position.set(0, .75, 0); telescope.add(brace)
    // Thin aiming sight and a brass focuser make the instrument silhouette legible.
    const finderGeo = new THREE.CylinderGeometry(.12, .15, 1.9, 12); geometries.add(finderGeo)
    const finder = new THREE.Mesh(finderGeo, makeMaterial(0xc7a25f, materials, { roughness: .32, metalness: .8 })); finder.rotation.z = -.55; finder.position.set(.58, 4.05, .72); telescope.add(finder)
    const focuserGeo = new THREE.CylinderGeometry(.18, .2, .9, 12); geometries.add(focuserGeo)
    const focuser = new THREE.Mesh(focuserGeo, mountMaterial); focuser.rotation.z = -.55; focuser.position.set(0, .05, 0); telescope.add(focuser)
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2
      const postGeo = new THREE.CylinderGeometry(.07, .1, .85, 8); geometries.add(postGeo)
      const post = new THREE.Mesh(postGeo, makeMaterial(0x997847, materials, { metalness: .7, roughness: .38 })); post.position.set(Math.cos(angle) * 6.8, .62, Math.sin(angle) * 6.8); scene.add(post)
      const lampGeo = new THREE.SphereGeometry(.13, 10, 8); geometries.add(lampGeo)
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffd488, toneMapped: false })); materials.add(lamp.material); lamp.position.set(post.position.x, 1.08, post.position.z); scene.add(lamp)
    }

    // Return portal is a glowing, walk-through arch on the observatory's rim.
    const portal = new THREE.Group(); portal.position.set(-15.2, 2.9, 1.6); portal.rotation.y = .22; scene.add(portal)
    const archCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2.1, -2.1, 0), new THREE.Vector3(-2.1, .9, 0), new THREE.Vector3(-1.25, 2.6, 0), new THREE.Vector3(0, 3.1, 0), new THREE.Vector3(1.25, 2.6, 0), new THREE.Vector3(2.1, .9, 0), new THREE.Vector3(2.1, -2.1, 0)])
    const archGeo = new THREE.TubeGeometry(archCurve, 48, .22, 10, false); geometries.add(archGeo)
    const archMat = makeMaterial(0xd0a452, materials, { emissive: 0xffba54, emissiveIntensity: 1.1, metalness: .72, roughness: .28 })
    const arch = new THREE.Mesh(archGeo, archMat); portal.add(arch)
    const portalGlowGeo = new THREE.PlaneGeometry(3.65, 4.7); geometries.add(portalGlowGeo)
    const portalGlow = new THREE.Mesh(portalGlowGeo, new THREE.MeshBasicMaterial({ color: 0xf4d598, transparent: true, opacity: .17, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })); materials.add(portalGlow.material); portalGlow.position.set(0, .1, -.08); portal.add(portalGlow)
    const portalOrb = new THREE.Mesh(new THREE.SphereGeometry(.17, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffdfa2, toneMapped: false })); geometries.add(portalOrb.geometry); materials.add(portalOrb.material); portalOrb.position.set(0, 2.45, .16); portal.add(portalOrb)
    portal.userData.action = 'return'; arch.userData.action = 'return'; portalGlow.userData.action = 'return'; portalOrb.userData.action = 'return'; clickable.push(arch, portalGlow, portalOrb)
    const portalButton = document.createElement('button'); portalButton.type = 'button'; portalButton.textContent = '↶  Return to Town'; portalButton.setAttribute('aria-label', 'Return to Town'); Object.assign(portalButton.style, buttonStyle())
    portalButton.addEventListener('click', () => latest.current.onReturn())
    const portalLabel = new CSS2DObject(portalButton); portalLabel.position.set(0, -2.55, .1); portal.add(portalLabel); disposers.push(() => portalButton.remove())

    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous')
    let alive = true
    const fileCollectionIds = new Map<string, string>()
    const collectionLabelButtons = new Map<string, HTMLButtonElement>()
    for (const collection of latest.current.collections) {
      const layout = WORLD_LAYOUT[collection.id]
      if (!layout) continue
      const world = new THREE.Group(); world.position.copy(layout.position); scene.add(world); collectionGroups.set(collection.id, world)
      world.userData.collectionId = collection.id
      const halo = new THREE.Group(); world.add(halo)
      const geometry = new THREE.SphereGeometry(layout.radius, 40, 28); geometries.add(geometry)
      const material = makeMaterial(layout.tint, materials, { roughness: .66, metalness: .17, emissive: layout.tint, emissiveIntensity: .12 })
      const sphere = new THREE.Mesh(geometry, material); halo.add(sphere); sphere.userData.collectionId = collection.id; clickable.push(sphere)
      // Mottled procedural surface catches the brass light and makes each world read as a celestial body.
      const cloudGeo = new THREE.SphereGeometry(layout.radius * 1.012, 36, 24); geometries.add(cloudGeo)
      const cloudMat = makeMaterial(collection.id === 'documents' ? 0xf2dfbd : collection.id === 'images' ? 0x8dc2d5 : 0x74c6d7, materials, { transparent: true, opacity: .24, roughness: .82, metalness: .06, wireframe: true })
      const cloud = new THREE.Mesh(cloudGeo, cloudMat); halo.add(cloud)
      const platformGeo = new THREE.CylinderGeometry(layout.radius * 1.2, layout.radius * 1.42, .25, 48); geometries.add(platformGeo)
      const platformMesh = new THREE.Mesh(platformGeo, makeMaterial(0x273a49, materials, { metalness: .64, roughness: .36 })); platformMesh.position.y = -layout.radius * .64; world.add(platformMesh); platformMesh.userData.collectionId = collection.id; clickable.push(platformMesh)
      addRing(world, layout.radius * 1.36, .065, layout.tint, materials, geometries, new THREE.Euler(Math.PI / 2.6, .08, .1), .84)
      addRing(world, layout.radius * 1.67, .027, 0xc89a51, materials, geometries, new THREE.Euler(Math.PI / 2.1, -.12, .15), .82)
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, orbGeo = new THREE.SphereGeometry(.09 + (i % 2) * .035, 8, 6); geometries.add(orbGeo)
        const orbMat = new THREE.MeshBasicMaterial({ color: i % 2 ? layout.tint : 0xffd28a, toneMapped: false }); materials.add(orbMat)
        const satellite = new THREE.Mesh(orbGeo, orbMat); satellite.position.set(Math.cos(a) * layout.radius * 1.67, Math.sin(a) * .8, Math.sin(a) * layout.radius * 1.3); world.add(satellite)
      }
      const files = collection.files.slice(0, 12)
      files.forEach((file, index) => {
        fileCollectionIds.set(file.id, collection.id)
        const angle = index / Math.max(files.length, 1) * Math.PI * 2 - Math.PI / 2
        const imageWithinBudget = file.kind === 'image' && Boolean(file.url) && file.bytes <= 20 * 1024 * 1024
        const texture = imageWithinBudget ? undefined : makeTextTexture(file.bytes > 20 * 1024 * 1024 ? 'LARGE IMAGE' : file.kind === 'document' ? 'FIELD NOTES' : file.kind === 'video' ? 'MOVING IMAGE' : 'IMAGE STUDY', file.name, `#${layout.tint.toString(16).padStart(6, '0')}`)
        if (texture) textures.add(texture)
        const cardMaterial = new THREE.MeshBasicMaterial({ map: texture ?? null, color: texture ? 0xffffff : 0xf1e8d7, side: THREE.DoubleSide, toneMapped: false })
        materials.add(cardMaterial)
        const cardGeo = new THREE.PlaneGeometry(1.5, 1.18); geometries.add(cardGeo)
        const card = new THREE.Mesh(cardGeo, cardMaterial)
        const cardRadius = layout.radius * 1.48
        card.position.set(Math.cos(angle) * cardRadius, .05 + Math.sin(index * 4.2) * .6, Math.sin(angle) * cardRadius)
        card.lookAt(0, 0, 0); card.userData.fileId = file.id; card.userData.collectionId = collection.id; card.userData.file = file; card.userData.action = 'file'; clickable.push(card); world.add(card)
        if (imageWithinBudget) loader.load(file.url, loaded => {
          if (!alive) { loaded.dispose(); return }
          const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512
          const context = canvas.getContext('2d')!
          const source = loaded.image as HTMLImageElement
          const scale = Math.min(512 / source.width, 512 / source.height)
          const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
          context.fillStyle = '#f4efe5'; context.fillRect(0, 0, 512, 512)
          context.drawImage(source, (512 - width) / 2, (512 - height) / 2, width, height)
          loaded.dispose()
          const thumbnail = new THREE.CanvasTexture(canvas); thumbnail.colorSpace = THREE.SRGBColorSpace; thumbnail.anisotropy = 4; textures.add(thumbnail)
          card.material.map = thumbnail; card.material.needsUpdate = true
        }, undefined, () => {})
        const frameGeo = new THREE.EdgesGeometry(cardGeo); geometries.add(frameGeo)
        const frame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0xffd58c, transparent: true, opacity: .72 })); materials.add((frame as THREE.LineSegments).material as THREE.Material); frame.position.copy(card.position); frame.quaternion.copy(card.quaternion); frame.scale.set(1.06, 1.06, 1); frame.userData.action = 'file-frame'; frame.userData.fileId = file.id; world.add(frame)
        const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(card.position.x, card.position.y, card.position.z)]); geometries.add(stemGeo)
        const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: 0xd4b274, transparent: true, opacity: .38 })); materials.add(stem.material); world.add(stem)
      })
      const labelButton = document.createElement('button'); labelButton.type = 'button'
      const countLabel = collection.status === 'missing' ? 'Folder not found' : collection.status === 'unavailable' ? 'Folder unavailable' : collection.files.length ? `${collection.files.length}${collection.truncated ? '+' : ''} items` : 'No previews'
      labelButton.textContent = `${collection.name}  ·  ${countLabel}`
      labelButton.setAttribute('aria-label', collection.status === 'ready' ? `Open ${collection.name}, ${collection.files.length} items` : `${collection.name}, ${countLabel}`); Object.assign(labelButton.style, buttonStyle())
      labelButton.addEventListener('click', () => latest.current.onSelectCollection(collection.id))
      const label = new CSS2DObject(labelButton); label.position.set(0, -layout.radius - 2, 0); world.add(label); disposers.push(() => labelButton.remove()); collectionLabelButtons.set(collection.id, labelButton)
      world.traverse(object => { if (object !== world) object.userData.collectionId ??= collection.id })
    }

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pointerDown: { x: number; y: number } | null = null
    const down = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY } }
    const up = (event: PointerEvent) => {
      if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) { pointerDown = null; return }
      pointerDown = null
      const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(clickable, false)[0]?.object
      if (!hit) return
      if (hit.userData.action === 'return') latest.current.onReturn()
      else if (hit.userData.action === 'file') { const file = hit.userData.file as ObservatoryFile; latest.current.onSelectFile(file) }
      else if (typeof hit.userData.collectionId === 'string') latest.current.onSelectCollection(hit.userData.collectionId)
    }
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up)

    const overviewTarget = new THREE.Vector3(0, 4.4, 0)
    const fitOverview = (width: number, height: number) => {
      controls.target.copy(overviewTarget)
      const distance = requiredOverviewDistance(camera, width, height, overviewTarget)
      camera.position.copy(overviewTarget).add(new THREE.Vector3(0, .22, 1).normalize().multiplyScalar(distance))
      controls.update()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Home') { event.preventDefault(); cameraTransition = null; userInterruptedCamera = false; fitOverview(host.clientWidth, host.clientHeight) }
      else if (['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); cancelCameraTransition()
        if (event.key === '+' || event.key === '=') controls.dollyIn(1.18)
        else if (event.key === '-' || event.key === '_') controls.dollyOut(1.18)
        else if (event.key === 'ArrowLeft') controls.rotateLeft(Math.PI / 18)
        else if (event.key === 'ArrowRight') controls.rotateLeft(-Math.PI / 18)
        else if (event.key === 'ArrowUp') controls.rotateUp(Math.PI / 18)
        else controls.rotateUp(-Math.PI / 18)
        controls.update()
      }
    }
    renderer.domElement.addEventListener('keydown', keydown)

    let frame = 0
    let lastFocusedCollection: string | null = null
    const startCollectionFocus = (id: string | null) => {
      userInterruptedCamera = false
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      let target: THREE.Vector3, distance: number
      if (id && collectionGroups.has(id)) {
        const layout = WORLD_LAYOUT[id as ObservatoryCollection['id']]
        target = layout.position.clone().add(new THREE.Vector3(2.1, -.45, 0))
        const halfWidth = layout.radius * 1.78 + 2.1, halfHeight = layout.radius + 2.35
        distance = Math.max(13.5, requiredFocusDistance(camera, width, height, halfWidth, halfHeight))
      } else {
        target = overviewTarget.clone(); distance = requiredOverviewDistance(camera, width, height, target)
      }
      const direction = camera.position.clone().sub(controls.target).normalize()
      if (direction.lengthSq() < .1) direction.set(0, .22, 1).normalize()
      const position = target.clone().add(direction.multiplyScalar(distance))
      if (latest.current.reducedMotion) { controls.target.copy(target); camera.position.copy(position); controls.update(); cameraTransition = null; return }
      cameraTransition = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition: position, toTarget: target, elapsed: 0, duration: .78 }
    }
    const render = () => {
      frame = requestAnimationFrame(render)
      const now = performance.now()
      const delta = Math.min((now - lastFrameTime) / 1000, .04)
      lastFrameTime = now
      elapsedTime += delta
      const motion = latest.current.reducedMotion ? 0 : delta
      controls.update()
      if (latest.current.selectedCollection !== lastFocusedCollection) {
        lastFocusedCollection = latest.current.selectedCollection
        startCollectionFocus(lastFocusedCollection)
      }
      if (cameraTransition && !userInterruptedCamera) {
        cameraTransition.elapsed = Math.min(cameraTransition.duration, cameraTransition.elapsed + delta)
        const amount = cameraTransition.elapsed / cameraTransition.duration
        const eased = amount * amount * (3 - 2 * amount)
        camera.position.lerpVectors(cameraTransition.fromPosition, cameraTransition.toPosition, eased)
        controls.target.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, eased)
        controls.update()
        if (amount >= 1) cameraTransition = null
      }
      if (motion) {
        starField.rotation.y += motion * .0013
        for (const [id, world] of collectionGroups) {
          const selected = latest.current.selectedCollection === id || fileCollectionIds.get(latest.current.selectedFileId ?? '') === id
          const speed = selected ? 0 : .048
          world.rotation.y += motion * speed
          const pulse = selected ? 1.04 + Math.sin(elapsedTime * 1.6) * .012 : 1 + Math.sin(elapsedTime * .7 + id.length) * .009
          world.scale.setScalar(pulse)
        }
        portalGlow.material && ((portalGlow.material as THREE.MeshBasicMaterial).opacity = .14 + Math.sin(elapsedTime * 1.7) * .05)
      }
      for (const [id, world] of collectionGroups) {
        const focused = latest.current.selectedCollection === id || fileCollectionIds.get(latest.current.selectedFileId ?? '') === id
        world.traverse(object => {
          const selectedFile = object.userData.fileId === latest.current.selectedFileId
          if (object.userData.action === 'file') object.scale.setScalar(selectedFile ? 1.2 : 1)
          if (object.userData.action === 'file-frame') {
            object.scale.setScalar(selectedFile ? 1.16 : 1.06)
            const material = (object as THREE.LineSegments).material as THREE.LineBasicMaterial
            material.color.set(selectedFile ? 0xffe39d : 0xffd58c); material.opacity = selectedFile ? 1 : .72
          }
        })
        const button = collectionLabelButtons.get(id)
        if (button) { button.style.borderColor = focused ? 'rgba(255,222,157,.98)' : 'rgba(226,192,129,.72)'; button.style.background = focused ? 'rgba(74,54,31,.94)' : 'rgba(20,27,36,.82)' }
      }
      renderer.render(scene, camera); labels.render(scene, camera)
    }
    let framed = false
    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); labels.setSize(width, height)
      const selectedId = latest.current.selectedCollection
      const selectedLayout = selectedId ? WORLD_LAYOUT[selectedId as ObservatoryCollection['id']] : undefined
      const required = selectedLayout
        ? Math.max(13.5, requiredFocusDistance(camera, width, height,
          selectedLayout.radius * 1.78 + Math.abs(selectedLayout.position.x - controls.target.x),
          selectedLayout.radius + 2.35 + Math.abs(selectedLayout.position.y - controls.target.y)))
        : requiredOverviewDistance(camera, width, height, controls.target)
      if (!framed) { fitOverview(width, height); framed = true }
      else if (required > controls.getDistance() * 1.02) {
        const direction = camera.position.clone().sub(controls.target).normalize()
        camera.position.copy(controls.target).add(direction.multiplyScalar(required))
        controls.update()
      }
      if (cameraTransition) {
        const direction = cameraTransition.toPosition.clone().sub(cameraTransition.toTarget).normalize()
        cameraTransition.toPosition.copy(cameraTransition.toTarget).add(direction.multiplyScalar(required))
      }
    }
    const observer = new ResizeObserver(resize); observer.observe(host); resize(); render()

    return () => {
      alive = false; cancelAnimationFrame(frame); observer.disconnect(); controls.removeEventListener('start', cancelCameraTransition); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('keydown', keydown)
      disposers.forEach(dispose => dispose())
      scene.traverse(object => { if (object instanceof CSS2DObject) object.element.remove() })
      textures.forEach(texture => texture.dispose())
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
      renderer.dispose(); renderer.domElement.remove(); labels.domElement.remove()
    }
  }, [props.collections])

  return <div ref={hostRef} aria-label="Cosmic Observatory" role="application" tabIndex={0} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0b1420', touchAction: 'none' }} />
}
