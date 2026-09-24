import * as THREE from 'three'
import type { TownCluster } from './town-model'
import type { TownBillboardSlide } from './town-world-model'

export interface TownBillboard {
  group: THREE.Group
  update(slide: TownBillboardSlide): void
}

/** Shared geometry and enamel materials keep the detailed roadside signs bounded. */
export function createTownBillboardLibrary() {
  const geometries = new Map<string, THREE.BufferGeometry>()
  const materials = new Map<string, THREE.Material>()
  const textures: THREE.CanvasTexture[] = []
  const geometry = (w: number, h: number, d: number) => {
    const key = `${w}:${h}:${d}`
    let result = geometries.get(key)
    if (!result) { result = new THREE.BoxGeometry(w, h, d); geometries.set(key, result) }
    return result
  }
  const enamel = (key: string, color: number, metalness = .05) => {
    let result = materials.get(key)
    if (!result) { result = new THREE.MeshStandardMaterial({ color, roughness: .54, metalness }); materials.set(key, result) }
    return result
  }
  const box = (parent: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry(w, h, d), material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true; mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const round = (parent: THREE.Group, radius: number, x: number, y: number, z: number, material: THREE.Material) => {
    const key = `round:${radius}`
    let shape = geometries.get(key)
    if (!shape) { shape = new THREE.CylinderGeometry(radius, radius, .08, 12); geometries.set(key, shape) }
    const mesh = new THREE.Mesh(shape, material)
    mesh.rotation.x = Math.PI / 2; mesh.position.set(x, y, z)
    parent.add(mesh)
  }

  function create(cluster: TownCluster): TownBillboard {
    const group = new THREE.Group()
    group.name = `Town signal ${cluster}`
    group.userData.billboardCluster = cluster
    group.userData.ambientScenery = true
    const rust = enamel('oxidized-steel', 0x423044, .4)
    const cream = enamel('sun-faded-enamel', 0xffd36b)
    const orange = enamel('signal-orange', 0xff593b)
    const brass = enamel('brass-trim', 0xf9a83a, .63)
    const dark = enamel('charcoal-inset', 0x1f2622)
    const glass = enamel('smoked-glass', 0x123f43, .18)
    // Concrete feet, inset steel uprights, deep cabinet, bevel and hood.
    for (const side of [-1, 1]) {
      box(group, 1.3, .42, 2.4, side * 6.25, .21, 0, cream)
      box(group, .34, 7.6, .36, side * 6.25, 3.95, 0, rust)
      box(group, .46, .18, .46, side * 6.25, 7.72, 0, brass)
    }
    box(group, 17.6, 7.1, 1.15, 0, 8.65, 0, rust)
    for (const face of [-1, 1]) {
      box(group, 17.1, 6.65, .18, 0, 8.65, face * .65, orange)
      box(group, 15.9, 5.7, .16, 0, 8.65, face * .76, cream)
      box(group, 15.1, 5.1, .15, 0, 8.65, face * .85, dark)
      box(group, 14.8, 4.77, .08, 0, 8.65, face * .88, glass)
      box(group, 16.6, .16, .35, 0, 5.32, face * .69, brass)
    }
    box(group, 17.9, .32, 1.45, 0, 12.36, .12, cream)
    box(group, 17.4, .14, 1.55, 0, 12.55, .20, brass)
    // A lit phosphor screen is set back behind glass. Static rails and rivets
    // remain visible even when the content changes.
    const canvas = document.createElement('canvas')
    canvas.width = 1024; canvas.height = 512
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    textures.push(texture)
    const screenMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    materials.set(`screen:${cluster}`, screenMaterial)
    const screenGeometry = new THREE.PlaneGeometry(14.55, 4.57)
    geometries.set(`screen:${cluster}`, screenGeometry)
    for (const face of [-1, 1]) {
      const screen = new THREE.Mesh(screenGeometry, screenMaterial)
      screen.position.set(0, 8.65, face * .94)
      if (face < 0) screen.rotation.y = Math.PI
      screen.userData.billboardScreen = cluster
      group.add(screen)
      for (const side of [-1, 1]) for (const y of [5.5, 11.8]) round(group, .13, side * 8.27, y, face * .87, brass)
    }
    // Lower corner speaker grille, tuning wheel and incandescent pilot lamp.
    for (const face of [-1, 1]) {
      for (let index = 0; index < 5; index++) box(group, .67, .055, .04, face * -7.55, 6.53 + index * .18, face * 1.02, dark)
      round(group, .32, face * 7.48, 6.82, face * 1.03, brass)
      round(group, .12, face * 7.48, 6.82, face * 1.1, rust)
      round(group, .10, face * 7.37, 10.74, face * 1.01, enamel('pilot-lamp', 0xffe55c))
    }
    let signature = ''
    const update = (slide: TownBillboardSlide) => {
      const next = `${slide.kind}|${slide.title}|${slide.lines.join('|')}`
      if (next === signature) return
      signature = next
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const background = ctx.createLinearGradient(0, 0, 0, 512)
      background.addColorStop(0, '#082b39'); background.addColorStop(1, '#12383b')
      ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 512)
      ctx.fillStyle = '#1b6973'
      for (let y = 3; y < 512; y += 6) ctx.fillRect(0, y, 1024, 1)
      ctx.strokeStyle = '#ff6d49'; ctx.lineWidth = 5; ctx.strokeRect(24, 22, 976, 468)
      ctx.fillStyle = '#ffba52'; ctx.font = 'bold 26px monospace'
      ctx.fillText('TOWN SIGNAL  /  78', 45, 62)
      ctx.textAlign = 'right'; ctx.fillText(slide.kind.toUpperCase(), 976, 62); ctx.textAlign = 'left'
      const title = slide.title.length > 25 ? 51 : slide.title.length > 18 ? 62 : 78
      ctx.font = `bold ${title}px monospace`
      ctx.shadowColor = '#ffb64b'; ctx.shadowBlur = 18; ctx.fillStyle = '#ffe266'
      const words = slide.title.split(' ')
      const rows: string[] = []
      let row = ''
      for (const word of words) {
        const candidate = row ? `${row} ${word}` : word
        if (ctx.measureText(candidate).width > 920 && row) { rows.push(row); row = word } else row = candidate
      }
      if (row) rows.push(row)
      rows.slice(0, 2).forEach((line, index) => ctx.fillText(line, 45, 157 + index * 72))
      ctx.shadowBlur = 0
      ctx.fillStyle = '#75f0da'; ctx.font = 'bold 37px monospace'
      const lineStart = rows.length > 1 ? 316 : 269
      slide.lines.slice(0, 3).forEach((line, index) => {
        let shown = line
        while (ctx.measureText(shown).width > 900 && shown.length > 4) shown = `${shown.slice(0, -2)}…`
        ctx.fillText(shown, 54, lineStart + index * 58)
      })
      ctx.fillStyle = '#ff674b'; ctx.fillRect(45, 462, 140, 7)
      ctx.fillStyle = '#ffe266'; ctx.fillRect(45, 462, 46, 7)
      texture.needsUpdate = true
      group.userData.billboardSlide = slide.kind
      group.userData.billboardText = [slide.title, ...slide.lines].join(' | ')
    }
    return { group, update }
  }

  return {
    create,
    dispose() {
      for (const texture of textures) texture.dispose()
      for (const material of materials.values()) material.dispose()
      for (const shape of geometries.values()) shape.dispose()
    },
  }
}
