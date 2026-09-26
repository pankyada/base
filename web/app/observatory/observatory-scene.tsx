'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { ObservatoryCollection, ObservatoryFile } from './observatory-model'
import {
  ATMOSPHERE_FRAG, CLOUD_FRAG, GIANT_FRAG, ICE_FRAG, MOON_FRAG, RING_FRAG, RING_VERT, SKY_FRAG, SKY_VERT,
  STAR_FRAG, STAR_VERT, SURFACE_VERT, TERRESTRIAL_FRAG, WORMHOLE_VERT, WORMHOLE_FRAG, INFALL_VERT, SOFT_POINT_FRAG, COMET_VERT,
} from './observatory-shaders'

interface Props {
  collections: ObservatoryCollection[]
  selectedCollection: string | null
  selectedFileId: string | null
  reducedMotion: boolean
  onSelectCollection: (id: string) => void
  onSelectFile: (file: ObservatoryFile) => void
  departing: boolean
  onRequestReturn: () => void
  onReturn: () => void
}

interface WorldLayout {
  position: THREE.Vector3
  radius: number
  kind: 'terrestrial' | 'giant' | 'ice'
  seed: number
  atmosphere: number
  accent: string
  tilt: number
  spin: number
  cardOrbit: number
  ring?: readonly [number, number]
  moon?: boolean
}

// One sun, far to the left and slightly toward the viewer, so every world reads as a lit gibbous disc.
const SUN = new THREE.Vector3(-1, .34, .42).normalize()
const MAX_CARDS = 12
const CARD_ASPECT = 4 / 3

const WORLD_LAYOUT: Record<ObservatoryCollection['id'], WorldLayout> = {
  images: { position: new THREE.Vector3(-22, -.4, 3), radius: 2.3, kind: 'terrestrial', seed: 3.7, atmosphere: 0x5d9bff, accent: '#8ed8e6', tilt: .41, spin: .05, cardOrbit: 6.4, moon: true },
  documents: { position: new THREE.Vector3(.5, 1.4, -16), radius: 3.4, kind: 'giant', seed: 1.9, atmosphere: 0xf0c68a, accent: '#eed399', tilt: .38, spin: .07, cardOrbit: 9.4, ring: [1.32, 2.35] },
  videos: { position: new THREE.Vector3(23, -.8, 2), radius: 2.5, kind: 'ice', seed: 5.3, atmosphere: 0x9d8cff, accent: '#c5b2ee', tilt: .52, spin: .04, cardOrbit: 6.6 },
}

// Overview bounds (world units) that must stay in frame: every world, the ring and the tags.
const OVERVIEW_TARGET = new THREE.Vector3(.5, 2.6, -6)
const OVERVIEW_HALF = { width: 31, height: 9.5 }
// The way home: a wormhole high in the background between the giant and the ice world.
const WORMHOLE = { position: new THREE.Vector3(13, 9.5, -32), radius: 3.8 }
const DEPART_SECONDS = 1.9

function fovs(camera: THREE.PerspectiveCamera, width: number, height: number) {
  const vertical = THREE.MathUtils.degToRad(camera.fov)
  return { vertical, horizontal: 2 * Math.atan(Math.tan(vertical / 2) * (width / Math.max(1, height))) }
}

// Top header and bottom dock cover part of the canvas; frame content in the space between them.
function overviewDistance(camera: THREE.PerspectiveCamera, width: number, height: number): number {
  const { vertical, horizontal } = fovs(camera, width, height)
  const usable = Math.max(.45, (height - 190) / height)
  return Math.max(OVERVIEW_HALF.height / (Math.tan(vertical / 2) * usable), OVERVIEW_HALF.width / Math.tan(horizontal / 2)) * 1.06
}

// When the index panel is open on wide screens, frame the world in the space left of it.
function focusFrame(camera: THREE.PerspectiveCamera, width: number, height: number, halfSize: number) {
  const { vertical, horizontal } = fovs(camera, width, height)
  const panel = width > 760 ? 380 : 0
  const usableWidth = (width - panel) / width
  const usableHeight = Math.max(.45, (height - 200) / height)
  const distance = Math.max(halfSize / (Math.tan(vertical / 2) * usableHeight), halfSize / (Math.tan(horizontal / 2) * usableWidth)) * 1.08
  const shift = distance * Math.tan(horizontal / 2) * (panel / width)
  return { distance, shift }
}

function roundedClip(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  context.beginPath(); context.roundRect(0, 0, width, height, radius); context.clip()
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/[_-]+/g, ' ').split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (context.measureText(next).width <= maxWidth || !line) line = next
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…` }
  return lines.map(entry => { while (context.measureText(entry).width > maxWidth && entry.length > 2) entry = `${entry.slice(0, -2)}…`; return entry })
}

function extension(name: string): string {
  return (name.split('.').pop() ?? '').slice(0, 4).toUpperCase()
}

// Document cards look like a sheet of paper; video cards like a film frame; images show a cover crop.
function makeCardCanvas(file: ObservatoryFile, accent: string, image?: HTMLImageElement): HTMLCanvasElement {
  const width = 512, height = Math.round(512 / CARD_ASPECT)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')!
  roundedClip(context, width, height, 18)
  if (image) {
    const scale = Math.max(width / image.width, height / image.height)
    context.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale)
    const fade = context.createLinearGradient(0, height * .58, 0, height)
    fade.addColorStop(0, 'rgba(6,10,18,0)'); fade.addColorStop(1, 'rgba(6,10,18,.86)')
    context.fillStyle = fade; context.fillRect(0, 0, width, height)
    context.fillStyle = '#f5efe3'; context.font = '500 25px system-ui, sans-serif'
    context.fillText(wrapLines(context, file.name, width - 48, 1)[0], 24, height - 26)
  } else if (file.kind === 'document') {
    const paper = context.createLinearGradient(0, 0, width, height)
    paper.addColorStop(0, '#f7f1e4'); paper.addColorStop(1, '#e4dac6')
    context.fillStyle = paper; context.fillRect(0, 0, width, height)
    context.fillStyle = '#b8894433'; context.fillRect(40, 0, 3, height)
    context.fillStyle = '#9a6b2f'; context.font = '600 17px system-ui, sans-serif'; context.fillText(extension(file.name), 64, 50)
    context.fillStyle = '#23303d'; context.font = '400 34px Georgia, serif'
    wrapLines(context, file.name.replace(/\.[^.]+$/, ''), width - 110, 3).forEach((line, index) => context.fillText(line, 64, 104 + index * 42))
    context.fillStyle = '#23303d22'
    for (let row = 0; row < 5; row++) context.fillRect(64, 250 + row * 20, (width - 130) * (row === 4 ? .55 : 1), 6)
  } else if (file.kind === 'video') {
    const film = context.createLinearGradient(0, 0, width, height)
    film.addColorStop(0, '#171a33'); film.addColorStop(1, '#0a0d19')
    context.fillStyle = film; context.fillRect(0, 0, width, height)
    context.fillStyle = '#ffffff14'
    for (let x = 14; x < width; x += 34) { context.fillRect(x, 12, 18, 12); context.fillRect(x, height - 24, 18, 12) }
    context.strokeStyle = accent; context.lineWidth = 3
    context.beginPath(); context.arc(width / 2, height / 2 - 18, 44, 0, Math.PI * 2); context.stroke()
    context.fillStyle = accent; context.beginPath()
    context.moveTo(width / 2 - 14, height / 2 - 42); context.lineTo(width / 2 + 22, height / 2 - 18); context.lineTo(width / 2 - 14, height / 2 + 6); context.fill()
    context.fillStyle = '#ece7f7'; context.font = '500 24px system-ui, sans-serif'; context.textAlign = 'center'
    context.fillText(wrapLines(context, file.name, width - 70, 1)[0], width / 2, height - 60)
  } else {
    context.fillStyle = '#101a2a'; context.fillRect(0, 0, width, height)
    context.fillStyle = accent; context.font = '64px Georgia, serif'; context.textAlign = 'center'; context.fillText('◈', width / 2, height / 2)
    context.fillStyle = '#d7dde8'; context.font = '500 22px system-ui, sans-serif'
    context.fillText(file.bytes > 20 * 1024 * 1024 ? 'Large image · open to view' : wrapLines(context, file.name, width - 60, 1)[0], width / 2, height - 44)
  }
  return canvas
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 200
  const context = canvas.getContext('2d')!
  context.shadowColor = '#ffffff'; context.shadowBlur = 26
  context.fillStyle = '#ffffff'; context.beginPath(); context.roundRect(34, 34, 188, 132, 12); context.fill()
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeRadialTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.18, 'rgba(255,240,215,.55)'); gradient.addColorStop(1, 'rgba(255,220,180,0)')
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// A distant barred spiral: a few thousand soft points along two logarithmic arms.
function makeGalaxyTexture(random: () => number): THREE.CanvasTexture {
  const size = 512, canvas = document.createElement('canvas'); canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  context.translate(size / 2, size / 2); context.rotate(-.45); context.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 7000; i++) {
    const t = Math.pow(random(), .8), arm = i % 2
    const angle = t * Math.PI * 3.4 + arm * Math.PI + (random() - .5) * (.7 - t * .35)
    const radius = t * 210 + (random() - .5) * 14
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * .38
    const warm = 1 - t
    context.fillStyle = `rgba(${Math.round(170 + warm * 85)},${Math.round(180 + warm * 40)},${Math.round(255 - warm * 90)},${.05 + random() * .09})`
    context.fillRect(x, y, 1.6, 1.6)
  }
  const core = context.createRadialGradient(0, 0, 0, 0, 0, 70)
  core.addColorStop(0, 'rgba(255,236,200,.95)'); core.addColorStop(.25, 'rgba(255,214,160,.35)'); core.addColorStop(1, 'rgba(255,200,150,0)')
  context.setTransform(1, 0, 0, .42, size / 2, size / 2); context.rotate(-.45)
  context.fillStyle = core; context.fillRect(-80, -80, 160, 160)
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function statusLabel(collection: ObservatoryCollection): string {
  if (collection.status === 'missing') return 'Folder not found'
  if (collection.status === 'unavailable') return 'Folder unavailable'
  return collection.files.length ? `${collection.files.length}${collection.truncated ? '+' : ''} ${collection.files.length === 1 ? 'file' : 'files'}` : 'Empty'
}

interface CardEntry { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; file: ObservatoryFile }
interface WorldEntry {
  id: string
  layout: WorldLayout
  dim: THREE.IUniform<number>
  baseDim: number
  group: THREE.Group
  spinner: THREE.Object3D
  clouds?: THREE.Mesh
  moon?: THREE.Object3D
  cards: CardEntry[]
  cardRing: THREE.Group
  orbitLine: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>
  ringOpacity: number
  ringAngle: number
  tag: HTMLDivElement
}

export default function ObservatoryScene(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 2400)
    camera.position.set(0, 3, 40)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25)
    renderer.setPixelRatio(pixelRatio)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none'
    host.appendChild(renderer.domElement)
    const labels = new CSS2DRenderer()
    labels.domElement.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none'
    host.appendChild(labels.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(OVERVIEW_TARGET); controls.enableDamping = true; controls.dampingFactor = .06
    controls.minDistance = 7; controls.maxDistance = 140; controls.minPolarAngle = Math.PI * .2; controls.maxPolarAngle = Math.PI * .72
    controls.enablePan = false; controls.rotateSpeed = .6; controls.zoomSpeed = .8
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', 'Observatory scene. Drag to orbit, scroll to zoom, arrow keys to look around, plus and minus to zoom, Home to reset view.')
    let cameraTransition: { fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; toPosition: THREE.Vector3; toTarget: THREE.Vector3; elapsed: number; duration: number } | null = null
    const cancelCameraTransition = () => { cameraTransition = null }
    controls.addEventListener('start', cancelCameraTransition)
    // Idle scenes redraw at 30 fps; dragging, zooming and camera flights get full frame rate.
    let interacting = false
    const startInteraction = () => { interacting = true }, endInteraction = () => { interacting = false }
    controls.addEventListener('start', startInteraction); controls.addEventListener('end', endInteraction)

    const disposables = new Set<{ dispose: () => void }>()
    const track = <T extends { dispose: () => void }>(resource: T): T => { disposables.add(resource); return resource }
    const random = (() => { let seed = 0x53a91; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 } })()

    // Sky: the galactic band, stars and a distant galaxy travel with the camera (infinitely far).
    const sky = new THREE.Group(); scene.add(sky)
    const skyMaterial = track(new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: { uBand: { value: new THREE.Vector3(.28, 1, .36).normalize() }, uCore: { value: new THREE.Vector3(.35, -.22, -1).normalize() }, uSun: { value: SUN } },
    }))
    // The Milky Way never changes, so bake it once into a cube map instead of running noise per pixel every frame.
    const skyScene = new THREE.Scene()
    skyScene.add(new THREE.Mesh(track(new THREE.SphereGeometry(1000, 64, 32)), skyMaterial))
    const skyTarget = track(new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false }))
    new THREE.CubeCamera(1, 2000, skyTarget).update(renderer, skyScene)
    scene.background = skyTarget.texture

    const band = skyMaterial.uniforms.uBand.value as THREE.Vector3
    const starPositions: number[] = [], starColors: number[] = [], starSizes: number[] = [], starPhases: number[] = []
    const starPalette = [[.72, .82, 1], [.86, .9, 1], [1, .97, .9], [1, .88, .7], [1, .72, .52]] as const
    const direction = new THREE.Vector3()
    while (starSizes.length < 7000) {
      direction.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      const length = direction.length(); if (length > 1 || length < .01) continue
      direction.divideScalar(length)
      const latitude = direction.dot(band)
      if (random() > .3 + .7 * Math.exp(-latitude * latitude * 14)) continue
      const distance = 760 + random() * 180
      starPositions.push(direction.x * distance, direction.y * distance, direction.z * distance)
      const magnitude = Math.pow(random(), 7)
      const tint = starPalette[Math.min(4, Math.floor(Math.pow(random(), 1.6) * 5))]
      const brightness = .5 + magnitude * 1.8 + random() * .35
      starColors.push(tint[0] * brightness, tint[1] * brightness, tint[2] * brightness)
      starSizes.push(1.4 + magnitude * 5.2); starPhases.push(random())
    }
    const starGeometry = track(new THREE.BufferGeometry())
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3))
    starGeometry.setAttribute('aColor', new THREE.Float32BufferAttribute(starColors, 3))
    starGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(starSizes, 1))
    starGeometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(starPhases, 1))
    const starMaterial = track(new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    }))
    const stars = new THREE.Points(starGeometry, starMaterial); stars.renderOrder = -9; stars.frustumCulled = false; sky.add(stars)

    const galaxyMaterial = track(new THREE.SpriteMaterial({ map: track(makeGalaxyTexture(random)), transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending }))
    const galaxy = new THREE.Sprite(galaxyMaterial); galaxy.position.set(.62, .4, -1).normalize().multiplyScalar(820); galaxy.scale.setScalar(78); galaxy.renderOrder = -8; sky.add(galaxy)

    // Worlds.
    const worlds = new Map<string, WorldEntry>()
    const pickable: THREE.Object3D[] = []
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous')
    const glowTexture = track(makeGlowTexture())
    const cardGeometry = track(new THREE.PlaneGeometry(1, 1 / CARD_ASPECT))
    let alive = true
    const fileWorld = new Map<string, string>()

    // Every world material shares one dim uniform so unfocused worlds can recede together.
    let worldDim: THREE.IUniform<number> = { value: 1 }
    const surfaceMaterial = (fragmentShader: string, seed: number, extra: Record<string, THREE.IUniform> = {}, options: THREE.ShaderMaterialParameters = {}) => track(new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT, fragmentShader, ...options,
      uniforms: { uSun: { value: SUN }, uSeed: { value: seed }, uDim: worldDim, ...extra },
    }))

    for (const collection of latest.current.collections) {
      const layout = WORLD_LAYOUT[collection.id]
      if (!layout) continue
      const baseDim = collection.status === 'ready' ? 1 : .35
      worldDim = { value: baseDim }
      const group = new THREE.Group(); group.position.copy(layout.position); scene.add(group)
      const axis = new THREE.Group(); axis.rotation.set(.22, 0, layout.tilt); group.add(axis)
      const spinner = new THREE.Group(); axis.add(spinner)
      const sphereGeometry = track(new THREE.SphereGeometry(layout.radius, 128, 80))
      group.updateMatrixWorld(true)
      const ringNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(axis.getWorldQuaternion(new THREE.Quaternion()))
      const ringUniforms: Record<string, THREE.IUniform> = layout.ring ? {
        uRingN: { value: ringNormal }, uCenter: { value: layout.position.clone() },
        uRingIn: { value: layout.ring[0] * layout.radius }, uRingOut: { value: layout.ring[1] * layout.radius },
      } : {}
      const fragment = layout.kind === 'terrestrial' ? TERRESTRIAL_FRAG : layout.kind === 'giant' ? GIANT_FRAG : ICE_FRAG
      const planet = new THREE.Mesh(sphereGeometry, surfaceMaterial(fragment, layout.seed, ringUniforms))
      planet.userData.collectionId = collection.id; spinner.add(planet); pickable.push(planet)

      let clouds: THREE.Mesh | undefined
      if (layout.kind === 'terrestrial') {
        clouds = new THREE.Mesh(track(new THREE.SphereGeometry(layout.radius * 1.012, 96, 64)), surfaceMaterial(CLOUD_FRAG, layout.seed + 11, {}, { transparent: true, depthWrite: false }))
        axis.add(clouds)
      }
      const atmosphere = new THREE.Mesh(track(new THREE.SphereGeometry(layout.radius * (layout.kind === 'terrestrial' ? 1.075 : 1.05), 96, 64)), track(new THREE.ShaderMaterial({
        vertexShader: SURFACE_VERT, fragmentShader: ATMOSPHERE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uSun: { value: SUN }, uColor: { value: new THREE.Color(layout.atmosphere) }, uStrength: { value: layout.kind === 'terrestrial' ? 1.6 : .6 }, uDim: worldDim },
      })))
      group.add(atmosphere)

      if (layout.ring) {
        const ring = new THREE.Mesh(track(new THREE.RingGeometry(layout.ring[0] * layout.radius, layout.ring[1] * layout.radius, 256, 1)), track(new THREE.ShaderMaterial({
          vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          uniforms: { uSun: { value: SUN }, uDim: worldDim, uRadius: { value: layout.radius }, ...ringUniforms },
        })))
        ring.rotation.x = -Math.PI / 2; axis.add(ring)
      }

      let moon: THREE.Object3D | undefined
      if (layout.moon) {
        moon = new THREE.Group(); moon.rotation.set(.18, 0, -.12); group.add(moon)
        const moonMesh = new THREE.Mesh(track(new THREE.SphereGeometry(layout.radius * .2, 48, 32)), surfaceMaterial(MOON_FRAG, 8.1))
        moonMesh.position.set(layout.radius * 1.9, 0, 0); moon.add(moonMesh)
      }

      // Files orbit as a tidy card ring that only appears when this world is in focus.
      const cardRing = new THREE.Group(); cardRing.rotation.x = .4; cardRing.visible = false; group.add(cardRing)
      const orbitPoints = Array.from({ length: 160 }, (_, index) => { const angle = index / 160 * Math.PI * 2; return new THREE.Vector3(Math.cos(angle) * layout.cardOrbit, 0, Math.sin(angle) * layout.cardOrbit) })
      const orbitLine = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(orbitPoints)), track(new THREE.LineBasicMaterial({ color: layout.accent, transparent: true, opacity: 0, depthWrite: false })))
      cardRing.add(orbitLine)
      const cardWidth = layout.cardOrbit * .3
      const cards: CardEntry[] = collection.files.slice(0, MAX_CARDS).map(file => {
        fileWorld.set(file.id, collection.id)
        const texture = track(new THREE.CanvasTexture(makeCardCanvas(file, layout.accent))); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4
        const mesh = new THREE.Mesh(cardGeometry, track(new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })))
        mesh.scale.setScalar(cardWidth); mesh.userData.file = file; mesh.userData.collectionId = collection.id
        const glow = new THREE.Mesh(cardGeometry, track(new THREE.MeshBasicMaterial({ map: glowTexture, color: layout.accent, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })))
        glow.scale.set(1.36, 1.36, 1); glow.position.z = -.01; mesh.add(glow)
        cardRing.add(mesh); pickable.push(mesh)
        if (file.kind === 'image' && file.url && file.bytes <= 20 * 1024 * 1024) loader.load(file.url, loaded => {
          if (!alive) { loaded.dispose(); return }
          const thumbnail = track(new THREE.CanvasTexture(makeCardCanvas(file, layout.accent, loaded.image as HTMLImageElement))); thumbnail.colorSpace = THREE.SRGBColorSpace; thumbnail.anisotropy = 4
          loaded.dispose(); mesh.material.map = thumbnail; mesh.material.needsUpdate = true
        }, undefined, () => {})
        return { mesh, glow, file }
      })

      const tag = document.createElement('div'); tag.className = 'observatory-tag'; tag.dataset.collection = collection.id
      tag.style.setProperty('--world-color', layout.accent)
      tag.innerHTML = '<b></b><span></span>'
      tag.querySelector('b')!.textContent = collection.name
      tag.querySelector('span')!.textContent = statusLabel(collection)
      tag.setAttribute('aria-hidden', 'true')
      tag.addEventListener('click', () => latest.current.onSelectCollection(collection.id))
      const label = new CSS2DObject(tag); label.center.set(.5, 1); label.position.set(0, layout.radius * (layout.ring ? 1.12 : 1.14) + .2, 0); group.add(label)

      worlds.set(collection.id, { id: collection.id, layout, dim: worldDim, baseDim, group, spinner, clouds, moon, cards, cardRing, orbitLine, ringOpacity: 0, ringAngle: -Math.PI / 2, tag })
    }

    // Wormhole back to Town: a throat that always faces the viewer, with matter spiralling in.
    const wormhole = new THREE.Group(); wormhole.position.copy(WORMHOLE.position); scene.add(wormhole)
    const facing = new THREE.Group(); wormhole.add(facing)
    const wormholeMaterial = track(new THREE.ShaderMaterial({ vertexShader: WORMHOLE_VERT, fragmentShader: WORMHOLE_FRAG, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } } }))
    const throat = new THREE.Mesh(track(new THREE.PlaneGeometry(WORMHOLE.radius * 2, WORMHOLE.radius * 2)), wormholeMaterial)
    throat.userData.action = 'return'; facing.add(throat); pickable.push(throat)
    const infallSeeds: number[] = []
    for (let i = 0; i < 900; i++) infallSeeds.push(random(), random(), random())
    const infallGeometry = track(new THREE.BufferGeometry())
    infallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(900 * 3), 3))
    infallGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(infallSeeds, 3))
    const infallMaterial = track(new THREE.ShaderMaterial({
      vertexShader: INFALL_VERT, fragmentShader: SOFT_POINT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uRadius: { value: WORMHOLE.radius / 2 }, uPixelRatio: { value: pixelRatio } },
    }))
    const infall = new THREE.Points(infallGeometry, infallMaterial); infall.frustumCulled = false; facing.add(infall)
    const portalTag = document.createElement('div'); portalTag.className = 'observatory-tag observatory-tag--portal'
    portalTag.style.setProperty('--world-color', '#f4b27a')
    portalTag.innerHTML = '<b>Return to Town</b><span>Wormhole</span>'
    portalTag.setAttribute('aria-hidden', 'true')
    portalTag.addEventListener('click', () => latest.current.onRequestReturn())
    const portalLabel = new CSS2DObject(portalTag); portalLabel.center.set(.5, 1); portalLabel.position.set(0, WORMHOLE.radius * .92, 0); wormhole.add(portalLabel)

    // A comet on a long orbit. Its tails are fixed relative to the sun, so they always stream away from it.
    const comaTexture = track(makeRadialTexture())
    const comet = new THREE.Group(); scene.add(comet)
    const coma = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: comaTexture, color: 0xfff1d6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })))
    coma.scale.setScalar(2.2); comet.add(coma)
    const antiSun = SUN.clone().negate()
    const bend = new THREE.Vector3().crossVectors(antiSun, new THREE.Vector3(0, 1, 0)).normalize()
    const gauss = () => (random() + random() + random() - 1.5) / 1.5
    const tailPositions: number[] = [], tailAlong: number[] = [], tailColors: number[] = [], tailSizes: number[] = []
    for (let i = 0; i < 1500; i++) {
      const ion = i >= 1000
      const along = ion ? random() : Math.pow(random(), 1.4)
      const point = antiSun.clone().multiplyScalar(along * (ion ? 26 : 17))
      if (!ion) point.addScaledVector(bend, along * along * 4)
      point.add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar((ion ? .25 : 1.1) * along + .06))
      tailPositions.push(point.x, point.y, point.z); tailAlong.push(along)
      if (ion) tailColors.push(.4, .6, 1); else tailColors.push(1, .82, .55)
      tailSizes.push(ion ? 1.4 : 1.8 + random() * 2.4)
    }
    const tailGeometry = track(new THREE.BufferGeometry())
    tailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tailPositions, 3))
    tailGeometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(tailAlong, 1))
    tailGeometry.setAttribute('aColor', new THREE.Float32BufferAttribute(tailColors, 3))
    tailGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(tailSizes, 1))
    const tailMaterial = track(new THREE.ShaderMaterial({
      vertexShader: COMET_VERT, fragmentShader: SOFT_POINT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    }))
    const tail = new THREE.Points(tailGeometry, tailMaterial); tail.frustumCulled = false; comet.add(tail)

    // Occasional shooting stars streak across whatever part of the sky is in view.
    const meteorGeometry = track(new THREE.BufferGeometry())
    meteorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
    meteorGeometry.setAttribute('color', new THREE.Float32BufferAttribute([1, .95, .85, 0, 0, 0], 3))
    const meteorMaterial = track(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    const meteor = new THREE.Line(meteorGeometry, meteorMaterial); meteor.frustumCulled = false; sky.add(meteor)
    const meteorState = { wait: 3 + random() * 4, age: -1, start: new THREE.Vector3(), velocity: new THREE.Vector3() }
    const METEOR_LIFE = .85

    // Picking: click selects, hover shows a pointer and lifts the matching tag.
    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2()
    let pointerDown: { x: number; y: number } | null = null
    let hovered: string | null = null
    let hoveringPortal = false
    const visibleInScene = (object: THREE.Object3D) => { for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false; return true }
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObjects(pickable.filter(visibleInScene), false)[0]?.object
    }
    const down = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY } }
    const up = (event: PointerEvent) => {
      if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) { pointerDown = null; return }
      pointerDown = null
      const hit = pick(event)
      if (hit?.userData.action === 'return') latest.current.onRequestReturn()
      else if (hit?.userData.file) latest.current.onSelectFile(hit.userData.file as ObservatoryFile)
      else if (typeof hit?.userData.collectionId === 'string') latest.current.onSelectCollection(hit.userData.collectionId)
    }
    const move = (event: PointerEvent) => {
      if (event.buttons) return
      const hit = pick(event)
      hovered = typeof hit?.userData.collectionId === 'string' ? hit.userData.collectionId : null
      hoveringPortal = hit?.userData.action === 'return'
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab'
    }
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointermove', move)

    const frameFor = (id: string | null, width: number, height: number) => {
      const world = id ? worlds.get(id) : undefined
      const toCamera = camera.position.clone().sub(controls.target).normalize()
      if (!world) {
        const distance = overviewDistance(camera, width, height)
        return { target: OVERVIEW_TARGET.clone(), position: OVERVIEW_TARGET.clone().add(new THREE.Vector3(0, .16, 1).normalize().multiplyScalar(distance)) }
      }
      // Look from outside the system so neighbouring worlds fall away from the frame.
      const lateral = THREE.MathUtils.clamp(world.layout.position.x / 22, -1, 1) * .7
      toCamera.set(lateral, world.layout.ring ? .62 : .3, 1).normalize()
      const { distance, shift } = focusFrame(camera, width, height, world.layout.cardOrbit + world.layout.radius * .5)
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCamera).normalize()
      const target = world.layout.position.clone().addScaledVector(right, shift)
      return { target, position: target.clone().addScaledVector(toCamera, distance) }
    }
    const startFocus = (id: string | null) => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      const { target, position } = frameFor(id, width, height)
      if (latest.current.reducedMotion) { controls.target.copy(target); camera.position.copy(position); controls.update(); cameraTransition = null; return }
      cameraTransition = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition: position, toTarget: target, elapsed: 0, duration: 1.1 }
    }

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Home') { event.preventDefault(); cameraTransition = null; const { target, position } = frameFor(null, host.clientWidth, host.clientHeight); controls.target.copy(target); camera.position.copy(position); controls.update() }
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
    let lastFrameTime = performance.now()
    let elapsedTime = 0
    let lastFocused: string | null = null
    let departure: { elapsed: number; from: THREE.Vector3; fromTarget: THREE.Vector3; end: THREE.Vector3; done: boolean } | null = null
    const cardPosition = new THREE.Vector3()
    const render = () => {
      frame = requestAnimationFrame(render)
      const now = performance.now()
      if (!interacting && !cameraTransition && !departure && now - lastFrameTime < 1000 / 30 - 2) return
      const delta = Math.min((now - lastFrameTime) / 1000, .05)
      lastFrameTime = now
      const { selectedCollection, selectedFileId, reducedMotion } = latest.current
      const motion = reducedMotion ? 0 : delta
      elapsedTime += motion
      if (latest.current.departing && !departure) {
        cameraTransition = null; controls.enabled = false
        const approach = camera.position.clone().sub(WORMHOLE.position).normalize()
        departure = { elapsed: 0, from: camera.position.clone(), fromTarget: controls.target.clone(), end: WORMHOLE.position.clone().addScaledVector(approach, .05), done: reducedMotion }
        if (reducedMotion) latest.current.onReturn()
      }
      if (!departure && selectedCollection !== lastFocused) { lastFocused = selectedCollection; startFocus(selectedCollection) }
      if (cameraTransition) {
        cameraTransition.elapsed = Math.min(cameraTransition.duration, cameraTransition.elapsed + delta)
        const amount = cameraTransition.elapsed / cameraTransition.duration
        const eased = amount < .5 ? 4 * amount ** 3 : 1 - (-2 * amount + 2) ** 3 / 2
        camera.position.lerpVectors(cameraTransition.fromPosition, cameraTransition.toPosition, eased)
        controls.target.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, eased)
        if (amount >= 1) cameraTransition = null
      }
      if (departure && !departure.done) {
        // Dive through the throat: accelerate in, widen the lens, then hand off to Town.
        departure.elapsed += delta
        const amount = Math.min(1, departure.elapsed / DEPART_SECONDS)
        const eased = amount ** 3
        camera.position.lerpVectors(departure.from, departure.end, eased)
        controls.target.lerpVectors(departure.fromTarget, WORMHOLE.position, Math.min(1, amount * 2.2))
        camera.lookAt(controls.target)
        camera.fov = 36 + eased * 44; camera.updateProjectionMatrix()
        if (amount >= 1) { departure.done = true; latest.current.onReturn() }
      } else if (!departure) controls.update()
      sky.position.copy(camera.position)
      starMaterial.uniforms.uTime.value = elapsedTime
      facing.quaternion.copy(camera.quaternion)
      wormholeMaterial.uniforms.uTime.value = elapsedTime
      infallMaterial.uniforms.uTime.value = elapsedTime
      const open = departure ? Math.min(1, departure.elapsed / DEPART_SECONDS) : hoveringPortal ? .35 : 0
      wormholeMaterial.uniforms.uOpen.value = reducedMotion ? open : THREE.MathUtils.damp(wormholeMaterial.uniforms.uOpen.value, open, 6, delta)
      portalTag.classList.toggle('is-hovered', hoveringPortal)

      const cometPhase = elapsedTime / 140 * Math.PI * 2 + 2.5
      comet.position.set(Math.cos(cometPhase) * 62, 15 + Math.sin(cometPhase) * 7, -48 + Math.sin(cometPhase) * 14)
      tailMaterial.uniforms.uTime.value = elapsedTime

      if (motion) {
        if (meteorState.age < 0 && (meteorState.wait -= motion) <= 0) {
          const forward = camera.getWorldDirection(new THREE.Vector3())
          const side = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
          meteorState.start.copy(forward).addScaledVector(side, (random() - .5) * 1.1).addScaledVector(camera.up, .12 + random() * .3).normalize().multiplyScalar(600)
          meteorState.velocity.copy(side).multiplyScalar(random() > .5 ? 1 : -1).addScaledVector(camera.up, -.35 - random() * .3).normalize().multiplyScalar(220 + random() * 120)
          meteorState.age = 0; meteorState.wait = 6 + random() * 10
        }
        if (meteorState.age >= 0) {
          meteorState.age += motion
          const head = meteorState.start.clone().addScaledVector(meteorState.velocity, meteorState.age)
          const tailEnd = head.clone().addScaledVector(meteorState.velocity, -Math.min(meteorState.age, .22))
          const positions = meteorGeometry.attributes.position as THREE.BufferAttribute
          positions.setXYZ(0, head.x, head.y, head.z); positions.setXYZ(1, tailEnd.x, tailEnd.y, tailEnd.z); positions.needsUpdate = true
          meteorMaterial.opacity = Math.sin(Math.PI * Math.min(1, meteorState.age / METEOR_LIFE))
          if (meteorState.age > METEOR_LIFE) { meteorState.age = -1; meteorMaterial.opacity = 0 }
        }
      }

      const activeWorld = selectedCollection ?? (selectedFileId ? fileWorld.get(selectedFileId) ?? null : null)
      for (const world of worlds.values()) {
        world.spinner.rotation.y += motion * world.layout.spin
        if (world.clouds) world.clouds.rotation.y += motion * world.layout.spin * 1.35
        if (world.moon) world.moon.rotation.y += motion * .09
        const active = world.id === activeWorld
        const holdsSelection = world.cards.some(card => card.file.id === selectedFileId)
        world.ringOpacity = reducedMotion ? (active ? 1 : 0) : THREE.MathUtils.damp(world.ringOpacity, active ? 1 : 0, 5, delta)
        world.cardRing.visible = world.ringOpacity > .01
        if (!holdsSelection) world.ringAngle += motion * .05
        world.orbitLine.material.opacity = world.ringOpacity * .22
        const reveal = .82 + world.ringOpacity * .18
        const billboard = world.cardRing.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(camera.quaternion)
        world.cards.forEach((card, index) => {
          const angle = world.ringAngle + index / world.cards.length * Math.PI * 2
          const radius = world.layout.cardOrbit * reveal
          card.mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
          // Billboard: undo the ring tilt so each card squarely faces the camera.
          card.mesh.quaternion.copy(billboard)
          const selected = card.file.id === selectedFileId
          card.mesh.getWorldPosition(cardPosition)
          const behind = cardPosition.distanceTo(camera.position) > world.layout.position.distanceTo(camera.position) + world.layout.radius * .6
          card.mesh.material.opacity = world.ringOpacity * (selected ? 1 : behind ? .55 : .95)
          card.glow.material.opacity = selected ? world.ringOpacity * .9 : 0
          card.mesh.scale.setScalar(world.layout.cardOrbit * .3 * (selected ? 1.28 : 1))
        })
        const dimmed = activeWorld !== null && !active
        const targetDim = world.baseDim * (dimmed ? .38 : 1)
        world.dim.value = reducedMotion ? targetDim : THREE.MathUtils.damp(world.dim.value, targetDim, 4, delta)
        world.tag.classList.toggle('is-active', active)
        world.tag.classList.toggle('is-dimmed', dimmed)
        world.tag.classList.toggle('is-hovered', hovered === world.id)
      }
      if (ready) { renderer.render(scene, camera); labels.render(scene, camera) }
    }

    let framed = false
    const resize = () => {
      const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight)
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); labels.setSize(width, height)
      if (departure) return
      const { target, position } = frameFor(latest.current.selectedCollection, width, height)
      if (!framed) { controls.target.copy(target); camera.position.copy(position); controls.update(); framed = true; lastFocused = latest.current.selectedCollection }
      else if (cameraTransition) { cameraTransition.toTarget.copy(target); cameraTransition.toPosition.copy(position) }
      else if (position.distanceTo(target) > controls.getDistance() * 1.02) { camera.position.copy(controls.target).addScaledVector(camera.position.clone().sub(controls.target).normalize(), position.distanceTo(target)); controls.update() }
    }
    // Compile every shader off the main thread (where supported) before the first frame,
    // so the page shows a calm "calibrating" state instead of a frozen black canvas.
    let ready = false
    renderer.compileAsync(scene, camera).catch(() => {}).then(() => { if (alive) { ready = true; host.dataset.ready = 'true' } })
    const observer = new ResizeObserver(resize); observer.observe(host); resize(); render()

    return () => {
      alive = false; cancelAnimationFrame(frame); observer.disconnect(); controls.removeEventListener('start', cancelCameraTransition); controls.removeEventListener('start', startInteraction); controls.removeEventListener('end', endInteraction); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('keydown', keydown)
      scene.traverse(object => { if (object instanceof CSS2DObject) object.element.remove() })
      disposables.forEach(resource => resource.dispose())
      renderer.dispose(); renderer.domElement.remove(); labels.domElement.remove()
    }
  }, [props.collections])

  return <div ref={hostRef} className="observatory-scene" aria-label="Cosmic Observatory" role="application" tabIndex={0} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#02040a', touchAction: 'none' }} />
}
