import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { buildingSpec, TEMPLE_SITE, type BuildingForm, type TownBuildingAppearance } from './town-model'

export type TownTreeKind = 'palmyra' | 'broadleaf'
export type TownAnimalKind = 'cattle' | 'goat' | 'chicken'
export type TownPropKind = 'pot' | 'basket' | 'grain-jar' | 'well' | 'cart' | 'low-wall'

export interface TownAssetLibrary {
  createHouse(form: BuildingForm, seed: number | string, appearance?: TownBuildingAppearance): THREE.Group
  createPavilion(seed: number | string): THREE.Group
  createTemple(seed: number | string): THREE.Group
  createTree(kind: TownTreeKind, seed: number | string): THREE.Group
  createAnimal(kind: TownAnimalKind, seed: number | string): THREE.Group
  createWorker(seed: number | string): THREE.Group
  createLamp(seed: number | string): THREE.Group
  createProp(kind: TownPropKind, seed: number | string): THREE.Group
  /** Release unique merged buffers before detaching a whole asset during relayout. */
  releaseAsset(asset: THREE.Group): void
  dispose(): void
}

const color = {
  plaster: [0xd0bd99, 0xc5ad86, 0xd9c8a6, 0xbca17b],
  wood: [0x67452e, 0x80583a, 0x593a29],
  tile: [0xa85238, 0xb96343, 0x944630],
  stone: [0x807866, 0x958975, 0x716e62],
  leaf: [0x536d3e, 0x667846, 0x7b874e, 0x49633d],
  grass: [0x647c47, 0x788c4c, 0x52693e],
  brass: 0xb18a48,
  ink: 0x29231b,
} as const

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return (seed >>> 0) || 0x9e3779b9
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) value = Math.imul(value ^ seed.charCodeAt(index), 16777619)
  return value >>> 0 || 0x9e3779b9
}

function randomFor(seed: number | string): () => number {
  let state = hashSeed(seed)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const fmt = (value: number) => Number(value.toFixed(3))

/**
 * Procedural Chola-era inspired scenery. Geometry and materials are owned by
 * this library and shared for its lifetime; returned groups own only transforms.
 */
export function createTownAssetLibrary(): TownAssetLibrary {
  const geometries = new Map<string, THREE.BufferGeometry>()
  const mergedGeometries = new Set<THREE.BufferGeometry>()
  const mergedByAsset = new WeakMap<THREE.Group, Set<THREE.BufferGeometry>>()
  const materials = new Map<string, THREE.Material>()
  let disposed = false

  function geometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    if (disposed) throw new Error('Town asset library has been disposed')
    let result = geometries.get(key)
    if (!result) {
      result = make()
      geometries.set(key, result)
    }
    return result as T
  }

  function boxGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
    const w = Math.max(.015, width), h = Math.max(.015, height), d = Math.max(.015, depth)
    return geometry(`box:${fmt(w)}:${fmt(h)}:${fmt(d)}`, () => new THREE.BoxGeometry(w, h, d))
  }

  function cylinderGeometry(top: number, bottom: number, height: number, radial = 10, open = false): THREE.CylinderGeometry {
    const a = Math.max(.008, top), b = Math.max(.008, bottom), h = Math.max(.015, height)
    return geometry(`cylinder:${fmt(a)}:${fmt(b)}:${fmt(h)}:${radial}:${open}`, () => new THREE.CylinderGeometry(a, b, h, radial, 1, open))
  }

  function sphereGeometry(radius = .5, width = 12, height = 8): THREE.SphereGeometry {
    return geometry(`sphere:${fmt(radius)}:${width}:${height}`, () => new THREE.SphereGeometry(radius, width, height))
  }

  function torusGeometry(radius: number, tube: number, radial = 6, tubular = 18): THREE.TorusGeometry {
    return geometry(`torus:${fmt(radius)}:${fmt(tube)}:${radial}:${tubular}`, () => new THREE.TorusGeometry(radius, tube, radial, tubular))
  }

  function mat(name: string, hex: number, roughness = .88, metalness = 0, emissive?: { color: number; intensity: number }): THREE.MeshStandardMaterial {
    const key = `${name}:${hex}:${roughness}:${metalness}:${emissive?.color ?? 0}:${emissive?.intensity ?? 0}`
    let result = materials.get(key)
    if (!result) {
      result = new THREE.MeshStandardMaterial({
        color: hex, roughness, metalness,
        ...(emissive ? { emissive: emissive.color, emissiveIntensity: emissive.intensity } : {}),
      })
      result.name = name
      materials.set(key, result)
    }
    return result as THREE.MeshStandardMaterial
  }

  const plaster = (index: number) => mat(`lime-plaster-${index}`, color.plaster[index % color.plaster.length])
  const timber = (index = 0) => mat(`hardwood-${index}`, color.wood[index % color.wood.length], .83)
  const tileMat = (index = 0) => mat(`terracotta-${index}`, color.tile[index % color.tile.length], .94)
  const stone = (index = 0) => mat(`laterite-stone-${index}`, color.stone[index % color.stone.length], .96)
  const dark = () => mat('door-recess', 0x30271f, .98)
  const brass = () => mat('aged-brass', color.brass, .44, .58)

  function mesh(geo: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, position?: THREE.Vector3, rotation?: THREE.Euler, scale?: THREE.Vector3, castShadow = true): THREE.Mesh {
    const result = new THREE.Mesh(geo, material)
    if (position) result.position.copy(position)
    if (rotation) result.rotation.copy(rotation)
    if (scale) result.scale.copy(scale)
    result.castShadow = castShadow
    result.receiveShadow = true
    parent.add(result)
    return result
  }

  function block(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, rotationY = 0, castShadow = true): THREE.Mesh {
    return mesh(boxGeometry(w, h, d), material, parent, new THREE.Vector3(x, y, z), new THREE.Euler(0, rotationY, 0), undefined, castShadow)
  }

  function round(parent: THREE.Object3D, radius: number, x: number, y: number, z: number, material: THREE.Material, scale: [number, number, number] = [1, 1, 1], castShadow = true): THREE.Mesh {
    return mesh(sphereGeometry(radius), material, parent, new THREE.Vector3(x, y, z), undefined, new THREE.Vector3(...scale), castShadow)
  }

  /** Collapse static detail by shared material; leave tile instances and articulated worker parts intact. */
  function batchStaticMeshes(group: THREE.Group): void {
    group.updateMatrixWorld(true)
    const buckets = new Map<string, { material: THREE.Material; castShadow: boolean; receiveShadow: boolean; items: THREE.Mesh[] }>()
    const owned = new Set<THREE.BufferGeometry>()
    group.traverse(object => {
      if (!(object as THREE.Mesh).isMesh || (object as THREE.InstancedMesh).isInstancedMesh) return
      const item = object as THREE.Mesh
      if (Array.isArray(item.material)) return
      const material = item.material
      const key = `${material.uuid}:${item.castShadow}:${item.receiveShadow}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { material, castShadow: item.castShadow, receiveShadow: item.receiveShadow, items: [] }
        buckets.set(key, bucket)
      }
      bucket.items.push(item)
    })

    for (const bucket of buckets.values()) {
      if (bucket.items.length < 2) continue
      const pieces = bucket.items.map(item => {
        const transformed = item.geometry.clone()
        let result = transformed
        if (transformed.index) {
          result = transformed.toNonIndexed()
          transformed.dispose()
        }
        result.applyMatrix4(item.matrixWorld)
        return result
      })
      const merged = BufferGeometryUtils.mergeGeometries(pieces, false)
      for (const piece of pieces) piece.dispose()
      if (!merged) continue
      mergedGeometries.add(merged)
      owned.add(merged)
      const combined = new THREE.Mesh(merged, bucket.material)
      combined.castShadow = bucket.castShadow
      combined.receiveShadow = bucket.receiveShadow
      combined.userData.assetBatch = true
      if (bucket.material.userData.townAssetRole) combined.userData.assetRole = bucket.material.userData.townAssetRole
      combined.userData.assetMaterialName = bucket.material.name
      group.add(combined)
      for (const item of bucket.items) item.parent?.remove(item)
    }
    if (owned.size) mergedByAsset.set(group, owned)
  }

  function pillar(parent: THREE.Object3D, x: number, z: number, height: number, radius: number, wood: THREE.Material, baseMaterial?: THREE.Material): void {
    if (baseMaterial) mesh(cylinderGeometry(radius * 1.36, radius * 1.48, .14, 8), baseMaterial, parent, new THREE.Vector3(x, .10, z))
    mesh(cylinderGeometry(radius * .82, radius, height - .24, 8), wood, parent, new THREE.Vector3(x, .17 + (height - .24) / 2, z))
    mesh(cylinderGeometry(radius * 1.35, radius * 1.15, .15, 8), wood, parent, new THREE.Vector3(x, height - .08, z))
    mesh(torusGeometry(radius * 1.05, .025, 4, 8), brass(), parent, new THREE.Vector3(x, height - .20, z), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
  }

  function addPlinth(parent: THREE.Object3D, width: number, depth: number, height = .45): void {
    block(parent, width + .45, .16, depth + .45, 0, .08, 0, stone(0))
    block(parent, width + .26, .13, depth + .26, 0, .225, 0, stone(1))
    block(parent, width + .12, .12, depth + .12, 0, height - .06, 0, stone(2))
    block(parent, width + .42, .08, .09, 0, height - .07, depth / 2 + .22, stone(1), 0, false)
  }

  function addRoof(parent: THREE.Object3D, width: number, depth: number, eavesY: number, rise: number, tileIndex: number, seed: number, appearance?: TownBuildingAppearance): void {
    const rng = randomFor(seed)
    const half = depth / 2
    const slopeLength = Math.hypot(half, rise)
    const angle = Math.atan2(rise, half)
    const roofWidth = width
    const deck = mat(`roof-underlay-${tileIndex}`, 0x653e30, .98)
    const baseTile = appearance
      ? mat(`identity-roof-${appearance.roofColor.toString(16)}`, appearance.roofColor, .94)
      : tileMat(tileIndex)
    baseTile.userData.townAssetRole = 'house-roof'
    for (const side of [-1, 1]) {
      const pitch = side > 0 ? angle : -angle
      const centerZ = side * half / 2
      mesh(boxGeometry(roofWidth, .14, slopeLength + .06), deck, parent,
        new THREE.Vector3(0, eavesY + rise / 2, centerZ), new THREE.Euler(pitch, 0, 0))

      const tileWidth = .43
      const tileDepth = .31
      const columns = Math.max(4, Math.ceil(roofWidth / .47))
      const rows = Math.max(3, Math.ceil(slopeLength / .34))
      const tiles = new THREE.InstancedMesh(boxGeometry(tileWidth, .055, tileDepth), baseTile, columns * rows)
      tiles.castShadow = true
      tiles.receiveShadow = true
      tiles.userData.assetRole = baseTile.userData.townAssetRole
      const dummy = new THREE.Object3D()
      const tint = new THREE.Color()
      let index = 0
      for (let row = 0; row < rows; row += 1) {
        const distance = Math.min(slopeLength - .13, .17 + row * .34)
        for (let column = 0; column < columns; column += 1) {
          const x = (column - (columns - 1) / 2) * .46 + (row % 2 ? .03 : 0)
          const y = eavesY + rise - distance * Math.sin(angle) + .105
          const z = side * distance * Math.cos(angle)
          dummy.position.set(x, y, z)
          dummy.rotation.set(pitch, 0, 0)
          dummy.updateMatrix()
          tiles.setMatrixAt(index, dummy.matrix)
          const shade = .88 + rng() * .22
          tint.setRGB(shade, shade * (.94 + rng() * .05), shade * (.9 + rng() * .08))
          tiles.setColorAt(index, tint)
          index += 1
        }
      }
      tiles.instanceMatrix.needsUpdate = true
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true
      parent.add(tiles)
      block(parent, roofWidth + .12, .12, .15, 0, eavesY + .02, side * half, timber(tileIndex), 0, false)
    }
    block(parent, width + .63, .20, .18, 0, eavesY + rise + .055, 0, tileMat((tileIndex + 1) % color.tile.length), 0, false)
    block(parent, width + .62, .12, .18, 0, eavesY + rise * .13, depth / 2 + .12, timber(0), -.12, false)
  }

  function addMasonryDetails(parent: THREE.Object3D, width: number, depth: number, y: number, variation: number): void {
    const segment = Math.max(.42, Math.min(.72, width / 8))
    const count = Math.max(3, Math.ceil(width / segment))
    const segmentWidth = width / count
    for (let side = 0; side < 4; side += 1) {
      const run = side % 2 === 0 ? width : depth
      const number = Math.max(3, Math.ceil(run / segment))
      const size = run / number
      for (let index = 0; index < number; index += 1) {
        const offset = (index - (number - 1) / 2) * size
        const x = side === 0 ? offset : side === 1 ? width / 2 + .12 : side === 2 ? offset : -width / 2 - .12
        const z = side === 0 ? depth / 2 + .12 : side === 1 ? offset : side === 2 ? -depth / 2 - .12 : offset
        const length = size - .045
        block(parent, side % 2 === 0 ? length : .19, .15, side % 2 === 0 ? .19 : length, x, y, z, stone((index + side + variation) % color.stone.length), 0, false)
      }
    }
    void segmentWidth
  }

  function addWing(group: THREE.Group, centerX: number, centerZ: number, width: number, depth: number, height: number, rng: () => number, rotationY = 0, roofDepth = depth, appearance?: TownBuildingAppearance): void {
    const module = new THREE.Group()
    module.position.set(centerX, 0, centerZ)
    module.rotation.y = rotationY
    group.add(module)

    const wallIndex = Math.floor(rng() * color.plaster.length)
    const woodIndex = Math.floor(rng() * color.wood.length)
    const tileIndex = Math.floor(rng() * color.tile.length)
    const wall = appearance
      ? mat(`identity-wall-${appearance.wallColor.toString(16)}`, appearance.wallColor, .9)
      : plaster(wallIndex)
    wall.userData.townAssetRole = 'house-wall'
    const wood = timber(woodIndex), stonework = stone(Math.floor(rng() * color.stone.length))
    const plinth = .42
    block(module, width + .1, .22, depth + .12, 0, plinth - .08, 0, stone(0))
    block(module, width, height, depth, 0, plinth + height / 2, 0, wall)
    addMasonryDetails(module, width, depth, plinth - .055, wallIndex)

    const front = depth / 2 + .06
    const doorW = Math.min(1.02, width * .25)
    const doorH = Math.min(1.72, height * .73)
    block(module, doorW + .12, doorH + .10, .08, 0, plinth + doorH / 2, front, dark())
    block(module, doorW, doorH, .09, 0, plinth + doorH / 2, front + .045, wood)
    block(module, doorW * .4, doorH * .72, .025, 0, plinth + doorH * .51, front + .10, timber((woodIndex + 1) % color.wood.length), 0, false)
    for (const side of [-1, 1]) {
      block(module, .11, doorH + .27, .16, side * (doorW / 2 + .10), plinth + doorH / 2, front + .02, wood)
      block(module, .17, .11, .19, side * (doorW / 2 + .10), plinth + doorH + .10, front + .02, brass(), 0, false)
      block(module, .10, doorH + .08, .10, side * (doorW / 2 + .30), plinth + doorH / 2, front - .02, stonework, 0, false)
    }
    block(module, doorW + .50, .14, .20, 0, plinth + doorH + .17, front, wood)
    block(module, doorW + .18, .08, .30, 0, plinth + .04, front + .18, stone(1), 0, false)
    const latch = mesh(sphereGeometry(.055, 8, 6), brass(), module, new THREE.Vector3(doorW * .30, plinth + doorH * .53, front + .11), undefined, undefined, false)

    const windowWidth = Math.min(.60, width * .19)
    const windowHeight = Math.min(.66, height * .28)
    for (const side of [-1, 1]) {
      const wx = side * Math.min(width * .33, width / 2 - windowWidth / 2 - .24)
      const wy = plinth + height * .62
      block(module, windowWidth + .16, windowHeight + .16, .09, wx, wy, front, stone(1), 0, false)
      block(module, windowWidth, windowHeight, .08, wx, wy, front + .055, dark(), 0, false)
      block(module, windowWidth + .24, .08, .16, wx, wy + windowHeight / 2 + .10, front + .02, wood, 0, false)
      block(module, windowWidth + .22, .08, .18, wx, wy - windowHeight / 2 - .10, front + .04, timber((woodIndex + 1) % color.wood.length), 0, false)
      for (const bar of [-1, 1]) block(module, .055, windowHeight, .05, wx + bar * windowWidth * .27, wy, front + .10, wood, 0, false)
      block(module, .045, windowHeight, .05, wx, wy, front + .10, wood, 0, false)
    }

    for (const side of [-1, 1]) {
      block(module, .10, height + .02, .12, side * (width / 2 - .07), plinth + height / 2, front + .01, wood, 0, false)
      block(module, .10, height + .02, .12, side * (width / 2 - .07), plinth + height / 2, -depth / 2 - .01, wood, 0, false)
    }
    block(module, width + .30, .15, .18, 0, plinth + height - .12, front + .025, wood, 0, false)
    block(module, width + .30, .13, .18, 0, plinth + height - .12, -depth / 2 - .025, wood, 0, false)
    addRoof(module, width + .55, roofDepth, plinth + height + .12, Math.min(1.00, roofDepth * .22), tileIndex, Math.floor(rng() * 0xffffffff), appearance)
    void latch
  }

  function createHouse(form: BuildingForm, seed: number | string, appearance?: TownBuildingAppearance): THREE.Group {
    const rng = randomFor(seed)
    const spec = buildingSpec(form)
    const width = spec.width, depth = spec.depth
    const group = new THREE.Group()
    group.name = `Tamil ${spec.label.toLowerCase()}`
    group.userData.assetKind = 'house'
    group.userData.form = form
    group.userData.seed = String(seed)
    group.userData.front = '+z'

    const stonework = stone(Math.floor(rng() * color.stone.length))
    const wood = timber(Math.floor(rng() * color.wood.length))
    const patio = new THREE.Group()
    group.add(patio)
    addPlinth(patio, width, depth, .40)

    if (form === 'courtyard-house' || form === 'courtyard-compound') {
      const compound = form === 'courtyard-compound'
      const wallH = compound ? 3.05 : 2.75
      const wingDepth = compound ? 2.30 : 1.88
      const sideDepth = depth - wingDepth - .25
      const sideWidth = compound ? 2.25 : 1.72
      const courtyardWidth = width - sideWidth * 2 - .28
      const courtDepth = depth - wingDepth - .55
      block(group, courtyardWidth + .25, .10, courtDepth + .28, 0, .48, .10, stone(1), 0, false)
      addWing(group, 0, -depth / 2 + wingDepth / 2 + .06, width - .12, wingDepth, wallH, rng, 0, wingDepth + .32)
      addWing(group, -width / 2 + sideWidth / 2 + .02, .17, sideWidth, sideDepth, wallH * .94, rng, Math.PI / 2, sideDepth + .24)
      addWing(group, width / 2 - sideWidth / 2 - .02, .17, sideWidth, sideDepth, wallH * .94, rng, -Math.PI / 2, sideDepth + .24)
      if (compound) {
        addWing(group, 0, depth / 2 - .88, width - sideWidth * 2 - .18, 1.50, 2.75, rng, Math.PI, 1.78)
        block(group, 1.0, 1.1, .78, 0, .93, depth / 2 - .28, timber(0))
        block(group, 1.40, .10, .84, 0, 1.52, depth / 2 - .28, stone(1))
      } else {
        for (const side of [-1, 1]) {
          block(group, .75, .34, .48, side * (courtyardWidth * .24), .73, depth / 2 - .34, timber((side + 1) % 2), 0, false)
        }
      }
      block(group, .36, .23, .36, 0, .66, .1, brass(), 0, false)
      for (const side of [-1, 1]) {
        block(group, .20, .9, .20, side * (width / 2 - .25), .88, depth / 2 - .24, stone(2), 0, false)
        mesh(torusGeometry(.16, .035, 5, 10), stone(1), group, new THREE.Vector3(side * (width / 2 - .25), 1.38, depth / 2 - .24), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      }
      // Low street-facing compound wall with a wide central entry.
      for (const side of [-1, 1]) {
        block(group, width * .31, .56, .24, side * width * .34, .69, depth / 2 - .14, stone(1))
        block(group, width * .31 + .12, .09, .31, side * width * .34, 1.02, depth / 2 - .14, stone(0), 0, false)
      }
    } else {
      const workshop = form === 'tamil-workshop' || form === 'neutral-workshop'
      const porch = workshop ? .78 : .92
      const bodyDepth = depth - porch
      const bodyWidth = workshop ? width - .62 : width - .76
      addWing(group, 0, -porch / 2, bodyWidth, bodyDepth, workshop ? 2.72 : 2.48, rng, 0, depth + .12)
      // Raised open timber veranda under the continuous tiled roof.
      block(group, width - .08, .16, porch + .26, 0, .47, depth / 2 - porch / 2 + .05, stone(1))
      const cols = workshop ? [-.40, .40] : [-.39, 0, .39]
      for (const side of [-1, 1]) {
        for (const fraction of cols) {
          const x = fraction * width
          const z = depth / 2 - .18
          pillar(group, x, z, 2.32, workshop ? .11 : .085, timber((Math.floor(rng() * 3))), stone(1))
        }
        // Carved brackets and a continuous fascia make the verandah read in close views.
        block(group, width * .48, .14, .18, 0, 2.46, depth / 2 - .18, wood, 0, false)
        block(group, .24, .10, .30, side * (width * .39), 2.30, depth / 2 - .18, brass(), side * .3, false)
      }
      if (workshop) {
        // Work-yard lean-to, grain chest and raised lintel vents.
        block(group, .72, .60, .62, width * .30, .78, -depth * .22, timber(1))
        block(group, .78, .08, .66, width * .30, 1.12, -depth * .22, stone(1), 0, false)
        for (const vx of [-.36, .36]) block(group, .12, .10, .08, vx, 2.74, -depth / 2 - .08, dark(), 0, false)
      }
    }

    // Small household vessels sit clear of doors; deterministic asymmetry avoids a copied row.
    const pottery = createPotGeometry(false)
    const frontZ = depth / 2 - .58
    for (const side of [-1, 1]) {
      const px = side * (width * (.31 + rng() * .05))
      mesh(pottery, mat(`pottery-${Math.floor(rng() * 3)}`, [0x956044, 0xaa714c, 0x76513d][Math.floor(rng() * 3)], .95), group,
        new THREE.Vector3(px, .38, frontZ), undefined, new THREE.Vector3(.34 + rng() * .13, .42 + rng() * .17, .34 + rng() * .13), false)
      if (rng() > .45) {
        mesh(cylinderGeometry(.20, .28, .24, 9, true), mat('woven-palm-basket', 0xa27d4b, .98), group,
          new THREE.Vector3(-px * .82, .31, frontZ + .10), undefined, undefined, false)
      }
    }
    group.userData.footprint = { width, depth }
    void stonework
    batchStaticMeshes(group)
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    group.traverse(object => {
      const item = object as THREE.Mesh
      if (item.isMesh && (item.userData.assetRole === 'house-wall' || item.userData.assetRole === 'house-roof')) originalMaterials.set(item, item.material)
    })
    let crown: THREE.Group | undefined
    let crownVariant: number | undefined
    const setAppearance = (next?: TownBuildingAppearance): void => {
      if (!next) {
        for (const [item, material] of originalMaterials) item.material = material
        if (crown) crown.visible = false
        group.scale.set(1, 1, 1)
        delete group.userData.appearance
        delete group.userData.assetIdentity
        return
      }
      const boundedHeight = Math.max(.9, Math.min(1.35, next.heightScale))
      const activeWall = mat(`identity-wall-${next.wallColor.toString(16)}`, next.wallColor, .9)
      const activeRoof = mat(`identity-roof-${next.roofColor.toString(16)}`, next.roofColor, .94)
      activeWall.userData.townAssetRole = 'house-wall'
      activeRoof.userData.townAssetRole = 'house-roof'
      for (const item of originalMaterials.keys()) item.material = item.userData.assetRole === 'house-wall' ? activeWall : activeRoof
      const variant = ((Math.trunc(next.variant) % 6) + 6) % 6
      if (!crown || crownVariant !== variant) {
        if (crown) group.remove(crown)
        crown = addActiveBuildingCrown(group, form, seed, next, width, depth)
        crownVariant = variant
      }
      crown.traverse(object => {
        const item = object as THREE.Mesh
        if (item.isMesh && item.userData.assetRole === 'house-wall') item.material = activeWall
        if (item.isMesh && item.userData.assetRole === 'house-roof') item.material = activeRoof
      })
      crown.visible = true
      group.scale.set(1, boundedHeight, 1)
      group.updateMatrixWorld(true)
      const extent = new THREE.Box3().setFromObject(group)
      group.scale.x = Math.min(1, spec.width / (2 * Math.max(Math.abs(extent.min.x), Math.abs(extent.max.x), .01)))
      group.scale.z = Math.min(1, spec.depth / (2 * Math.max(Math.abs(extent.min.z), Math.abs(extent.max.z), .01)))
      group.updateMatrixWorld(true)
      group.userData.appearance = { ...next, heightScale: boundedHeight }
      group.userData.assetIdentity = { kind: 'active-project', variant }
    }
    group.userData.setAppearance = setAppearance
    if (appearance) setAppearance(appearance)
    return group
  }

  function addActiveBuildingCrown(owner: THREE.Group, form: BuildingForm, seed: number | string, appearance: TownBuildingAppearance, width: number, depth: number): THREE.Group {
    const group = new THREE.Group()
    group.name = 'active-project-roof-identity'
    owner.add(group)
    const rng = randomFor(`${seed}:active-roof`)
    const variant = ((Math.trunc(appearance.variant) % 6) + 6) % 6
    const span = Math.min(width, depth)
    const top = form === 'courtyard-compound' ? 4.42 : form === 'courtyard-house' ? 4.32 : 4.22
    const jitter = .88 + rng() * .24
    const wall = mat(`identity-wall-${appearance.wallColor.toString(16)}`, appearance.wallColor, .9)
    const roof = mat(`identity-roof-${appearance.roofColor.toString(16)}`, appearance.roofColor, .94)
    wall.userData.townAssetRole = 'house-wall'
    roof.userData.townAssetRole = 'house-roof'
    const trim = stone(1)
    const identityBlock = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, rotationY = 0, castShadow = true) => {
      const item = mesh(boxGeometry(1, 1, 1), material, group, new THREE.Vector3(x, y, z), new THREE.Euler(0, rotationY, 0), new THREE.Vector3(w, h, d), castShadow)
      item.userData.assetRole = material.userData.townAssetRole
      if (item.userData.assetRole === 'house-roof') item.userData.assetFeature = 'active-office-roof'
      return item
    }

    const pyramid = (x: number, z: number, w: number, d: number, height: number, y = top) => {
      const body = mesh(cylinderGeometry(.025, 1, 1, 4), roof, group,
        new THREE.Vector3(x, y + height / 2, z), new THREE.Euler(0, Math.PI / 4, 0),
        new THREE.Vector3(w / Math.SQRT2, height, d / Math.SQRT2), true)
      body.userData.assetFeature = 'active-office-roof'
      body.userData.assetRole = 'house-roof'
    }
    const roofSpanX = Math.min(width - .35, span * .82) * jitter
    const roofSpanZ = Math.min(depth - .35, span * .70) * (.96 + rng() * .08)

    if (variant === 0) {
      // Long-ridge workshop: a raised ventilated clerestory follows the roof axis.
      const lanternW = Math.max(.78, roofSpanX * (.58 + rng() * .13))
      const lanternD = Math.min(.68, roofSpanZ * .40)
      identityBlock(lanternW, .40, lanternD, (rng() - .5) * width * .08, top + .19, (rng() - .5) * depth * .08, wall)
      identityBlock(lanternW + .20, .10, lanternD + .18, 0, top + .43, 0, trim, 0, false)
      for (const side of [-1, 1]) identityBlock(.07, .23, lanternD + .10, side * lanternW * .35, top + .51, 0, roof, 0, false)
      pyramid(0, 0, lanternW + .3, lanternD + .26, .36, top + .48)
    } else if (variant === 1) {
      // Stepped upper hall, with a separate raised storey and a crown roof.
      const hallW = Math.max(.8, roofSpanX * (.52 + rng() * .12))
      const hallD = Math.max(.72, roofSpanZ * (.53 + rng() * .12))
      identityBlock(hallW + .20, .12, hallD + .20, 0, top + .06, 0, trim, 0, false)
      identityBlock(hallW, .48 * jitter, hallD, 0, top + .34 * jitter, 0, wall)
      identityBlock(hallW + .28, .12, hallD + .28, 0, top + .62 * jitter, 0, roof, 0, false)
      pyramid(0, 0, hallW + .18, hallD + .18, .50 * jitter, top + .67 * jitter)
    } else if (variant === 2) {
      // Hipped courtyard roof with a broad eave and high, compact peak.
      identityBlock(roofSpanX, .13, roofSpanZ, 0, top + .04, 0, wall, 0, false)
      pyramid((rng() - .5) * .12, (rng() - .5) * .12, roofSpanX * .76, roofSpanZ * .78, .78 * jitter, top + .1)
    } else if (variant === 3) {
      // Twin gabled atelier roofs: two unequal ridges make a memorable paired silhouette.
      const gap = roofSpanX * (.20 + rng() * .05)
      const halfW = Math.max(.56, (roofSpanX - gap) * .50)
      for (const [side, scale] of [[-1, .94 + rng() * .08], [1, .94 + rng() * .08]] as const) {
        const x = side * (gap / 2 + halfW / 2)
        identityBlock(halfW * .78, .27, roofSpanZ * .68, x, top + .20, 0, wall)
        identityBlock(halfW + .16, .10, roofSpanZ * .80, x, top + .06, 0, trim, 0, false)
        pyramid(x, (rng() - .5) * .08, halfW, roofSpanZ * .76, .62 * scale, top + .1)
      }
    } else if (variant === 4) {
      // Raised lantern roof with open-looking light slots and a four-sided cap.
      const lanternW = Math.max(.76, roofSpanX * (.48 + rng() * .1))
      const lanternD = Math.max(.65, roofSpanZ * (.48 + rng() * .08))
      identityBlock(lanternW + .15, .12, lanternD + .15, 0, top + .06, 0, trim, 0, false)
      identityBlock(lanternW, .62 * jitter, lanternD, 0, top + .40 * jitter, 0, wall)
      for (const side of [-1, 1]) {
        identityBlock(lanternW * .26, .25, .035, side * lanternW * .22, top + .39 * jitter, lanternD / 2 + .02, dark(), 0, false)
        identityBlock(lanternW * .26, .25, .035, side * lanternW * .22, top + .39 * jitter, -lanternD / 2 - .02, dark(), 0, false)
      }
      pyramid(0, 0, lanternW + .24, lanternD + .24, .44 * jitter, top + .72 * jitter)
    } else {
      // Compact corner tower; its seeded position and proportions vary per identity.
      const sideX = rng() > .5 ? 1 : -1
      const sideZ = rng() > .5 ? 1 : -1
      const towerW = Math.max(.68, span * (.27 + rng() * .08))
      const towerD = Math.max(.68, span * (.26 + rng() * .08))
      const x = sideX * Math.min(width * .27, width / 2 - towerW / 2 - .12)
      const z = sideZ * Math.min(depth * .25, depth / 2 - towerD / 2 - .12)
      identityBlock(towerW + .14, .11, towerD + .14, x, top + .05, z, trim, 0, false)
      identityBlock(towerW, .65 * jitter, towerD, x, top + .38 * jitter, z, wall)
      pyramid(x, z, towerW + .20, towerD + .20, .60 * jitter, top + .70 * jitter)
    }
    group.userData.activeRoofIdentity = { variant, roofVariation: Number(jitter.toFixed(3)) }
    return group
  }

  function createPotGeometry(tall: boolean): THREE.LatheGeometry {
    const profile = tall
      ? [[.02, 0], [.28, .04], [.38, .18], [.44, .44], [.34, .80], [.22, 1.05], [.27, 1.10], [.20, 1.17], [.13, 1.09], [.16, .98], [.26, .79], [.34, .44], [.29, .19], [.02, .13]]
      : [[.02, 0], [.20, .04], [.34, .17], [.42, .40], [.38, .66], [.28, .82], [.32, .88], [.24, .94], [.17, .85], [.20, .67], [.31, .40], [.25, .19], [.02, .13]]
    const key = tall ? 'lathe:grainjar' : 'lathe:pot'
    return geometry(key, () => new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 16)) as THREE.LatheGeometry
  }

  function createPavilion(seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = 'Tamil assembly pavilion'
    group.userData.assetKind = 'pavilion'
    group.userData.seed = String(seed)
    const width = 10.2, depth = 7.4
    block(group, width + .9, .32, depth + .9, 0, .18, 0, stone(0))
    block(group, width + .58, .22, depth + .58, 0, .43, 0, stone(1))
    block(group, width + .30, .20, depth + .30, 0, .64, 0, stone(2))
    block(group, width, .16, depth, 0, .81, 0, stone(1))
    // Broad front steps keep the assembly entrance legible from the town overview.
    for (let step = 0; step < 4; step += 1) block(group, 4.2 + step * .34, .17, .38, 0, .12 + step * .16, depth / 2 + .55 + step * .33, stone(step % 3))
    const columnPositions: Array<[number, number]> = []
    for (const z of [-depth * .42, 0, depth * .42]) {
      columnPositions.push([-width * .43, z], [width * .43, z])
    }
    for (const x of [-width * .22, width * .22]) columnPositions.push([x, -depth * .42], [x, depth * .42])
    for (const [x, z] of columnPositions) {
      pillar(group, x, z, 3.15, .18, timber(Math.floor(rng() * color.wood.length)), stone(1))
      mesh(torusGeometry(.26, .055, 6, 12), stone(0), group, new THREE.Vector3(x, 1.0, z), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      block(group, .48, .20, .48, x, 3.20, z, timber(1))
      block(group, .40, .12, .40, x, 3.36, z, brass(), 0, false)
    }
    block(group, width + .42, .30, .36, 0, 3.45, depth * .42, timber(0))
    block(group, width + .42, .30, .36, 0, 3.45, -depth * .42, timber(0))
    block(group, .36, .30, depth + .4, width * .43, 3.45, 0, timber(0))
    block(group, .36, .30, depth + .4, -width * .43, 3.45, 0, timber(0))
    addRoof(group, width + .55, depth + .25, 3.72, 1.55, Math.floor(rng() * color.tile.length), hashSeed(seed))

    // The retained bell identity hangs under the open ridge; it does not project a UI control.
    block(group, .14, .70, .14, 0, 3.13, -.55, timber(1), 0, false)
    mesh(cylinderGeometry(.15, .20, .28, 12), brass(), group, new THREE.Vector3(0, 2.82, -.55))
    round(group, .17, 0, 2.64, -.55, brass(), [1, .68, 1])
    block(group, .12, .17, .12, 0, 2.43, -.55, timber(0), 0, false)
    batchStaticMeshes(group)
    return group
  }

  function createTemple(seed: number | string): THREE.Group {
    const group = new THREE.Group()
    group.name = 'Town Temple · Brihadeeswarar-inspired vimana'
    group.userData.assetKind = 'temple'
    group.userData.seed = String(seed)
    group.userData.front = '+z'
    group.userData.site = { width: TEMPLE_SITE.width, depth: TEMPLE_SITE.depth, minX: TEMPLE_SITE.minX, maxX: TEMPLE_SITE.maxX, minZ: TEMPLE_SITE.minZ, maxZ: TEMPLE_SITE.maxZ }

    const granite = mat('temple-granite-warm', 0x9b876d, .96)
    const graniteLight = mat('temple-granite-sunlit-edges', 0xb29c7d, .94)
    const graniteMid = mat('temple-granite-course', 0x83715c, .98)
    const graniteDark = mat('temple-recessed-relief', 0x584b3d, .99)
    const carved = mat('temple-carved-stone', 0xc0a985, .95)
    const pavement = mat('temple-courtyard-granite', 0x777260, .99)
    const roofstone = mat('temple-roof-stone', 0x756653, .96)
    const nandiStone = mat('temple-nandi-polished-stone', 0x766754, .91)

    type BoxInstance = { x: number; y: number; z: number; w: number; h: number; d: number; rotationY?: number }
    const dummy = new THREE.Object3D()
    const boxUnit = boxGeometry(1, 1, 1)
    const makeBoxes = (items: BoxInstance[], material: THREE.Material, feature: string): void => {
      if (!items.length) return
      const instances = new THREE.InstancedMesh(boxUnit, material, items.length)
      instances.name = `temple-${feature}`
      instances.castShadow = false
      instances.receiveShadow = true
      instances.userData.assetFeature = feature
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        dummy.position.set(item.x, item.y, item.z)
        dummy.rotation.set(0, item.rotationY ?? 0, 0)
        dummy.scale.set(item.w, item.h, item.d)
        dummy.updateMatrix()
        instances.setMatrixAt(index, dummy.matrix)
      }
      instances.instanceMatrix.needsUpdate = true
      group.add(instances)
    }

    // The single raised courtyard and its continuous axial paving stay inside TEMPLE_SITE.
    block(group, TEMPLE_SITE.width - .30, .16, TEMPLE_SITE.depth - .30, 0, .08, 0, pavement, 0, false)
    block(group, 2.75, .12, 12.85, 0, .17, 9.05, graniteLight, 0, false)
    for (let z = 3.2; z <= 14.4; z += 1.15) {
      block(group, 2.78, .025, .045, 0, .242, z, graniteMid, 0, false)
    }
    for (const side of [-1, 1]) {
      for (let z = -13.6; z <= 13.6; z += 2.25) {
        block(group, .80, .025, .055, side * 6.2, .171, z, graniteMid, 0, false)
      }
    }

    // Four receding stone courses raise the vimana over the surrounding village.
    const sanctumZ = -5.1
    const plinthLayers = [
      { width: 10.95, depth: 10.65, y: .22, height: .28, material: graniteMid },
      { width: 10.48, depth: 10.20, y: .48, height: .25, material: granite },
      { width: 10.02, depth: 9.74, y: .72, height: .24, material: graniteLight },
      { width: 9.58, depth: 9.30, y: .96, height: .24, material: graniteMid },
    ]
    for (const layer of plinthLayers) block(group, layer.width, layer.height, layer.depth, 0, layer.y, sanctumZ, layer.material)
    // Four broad stair treads descend from the mandapa edge into the axial walk.
    for (let step = 0; step < 5; step += 1) {
      block(group, 4.30 + step * .24, .18, .36, 0, 1.11 - step * .18, 0.20 + step * .37, step % 2 ? granite : graniteLight)
    }
    for (const side of [-1, 1]) {
      block(group, .19, .75, .19, side * 2.42, .91, -.07, carved, 0, false)
      block(group, .37, .12, .35, side * 2.42, 1.31, -.07, graniteLight, 0, false)
      for (let step = 0; step < 3; step += 1) block(group, .30 - step * .035, .08, .28 - step * .025, side * 2.42, 1.42 + step * .08, -.07, graniteMid, 0, false)
    }

    // Square garbhagriha: deep entry recess, carved jambs and a low sanctuary roof.
    const sanctumWidth = 7.65, sanctumDepth = 8.15, sanctumBase = 1.34, sanctumHeight = 2.55
    block(group, sanctumWidth, sanctumHeight, sanctumDepth, 0, sanctumBase + sanctumHeight / 2, sanctumZ, granite)
    const sanctumFront = sanctumZ + sanctumDepth / 2
    block(group, 1.36, 1.92, .12, 0, 2.26, sanctumFront + .08, graniteDark, 0, false)
    block(group, .96, 1.60, .13, 0, 2.08, sanctumFront + .16, dark(), 0, false)
    for (const side of [-1, 1]) {
      block(group, .22, 2.15, .29, side * .79, 2.48, sanctumFront + .16, carved, 0, false)
      block(group, .32, .15, .39, side * .79, 3.55, sanctumFront + .17, graniteLight, 0, false)
      block(group, .12, 1.62, .08, side * .48, 2.33, sanctumFront + .25, graniteMid, 0, false)
      block(group, 1.90, .18, .45, side * 1.26, 3.78, sanctumFront + .10, graniteLight, 0, false)
      block(group, .38, .72, .13, side * 1.88, 2.65, sanctumFront + .10, graniteDark, 0, false)
    }
    block(group, 2.13, .22, .52, 0, 3.81, sanctumFront + .09, carved, 0, false)
    block(group, sanctumWidth + .70, .18, sanctumDepth + .72, 0, 4.03, sanctumZ, graniteLight)
    block(group, sanctumWidth + .30, .18, sanctumDepth + .28, 0, 4.22, sanctumZ, graniteMid)

    // Twelve individually scaled tapering tiers share one frustum geometry and repeat relief by instancing.
    const tierCount = 12
    const tierHeight = 1.22
    let tierWidth = 9.08
    let tierY = 4.30
    const vimanaCenterZ = sanctumZ
    const tierGeo = geometry('temple:vimana-tier-frustum', () => new THREE.CylinderGeometry(.93, 1, 1, 4, 1, false))
    const tierMesh = new THREE.InstancedMesh(tierGeo, granite, tierCount)
    tierMesh.name = 'temple-vimana-articulated-tiers'
    tierMesh.castShadow = true
    tierMesh.receiveShadow = true
    tierMesh.userData.assetFeature = 'vimana-tier-masses'
    const orientSquare = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)
    const tierCornices: BoxInstance[] = []
    const pilasters: BoxInstance[] = []
    const nicheRecesses: BoxInstance[] = []
    const nicheEdges: BoxInstance[] = []
    const cornerRooflets: Array<{ x: number; y: number; z: number; scale: number }> = []
    for (let tier = 0; tier < tierCount; tier += 1) {
      const width = tierWidth
      const centerY = tierY + tierHeight / 2
      dummy.position.set(0, centerY, vimanaCenterZ)
      dummy.quaternion.copy(orientSquare)
      dummy.scale.set(width / Math.SQRT2, tierHeight, width / Math.SQRT2)
      dummy.updateMatrix()
      tierMesh.setMatrixAt(tier, dummy.matrix)

      const nextWidth = width * .91
      for (const [edgeY, span] of [[tierY + .07, width + .23], [tierY + tierHeight - .08, width * .93 + .23]] as const) {
        const rail = .17
        tierCornices.push(
          { x: 0, y: edgeY, z: vimanaCenterZ + span / 2 - rail / 2, w: span, h: .14, d: rail },
          { x: 0, y: edgeY, z: vimanaCenterZ - span / 2 + rail / 2, w: span, h: .14, d: rail },
          { x: span / 2 - rail / 2, y: edgeY, z: vimanaCenterZ, w: rail, h: .14, d: span },
          { x: -span / 2 + rail / 2, y: edgeY, z: vimanaCenterZ, w: rail, h: .14, d: span },
        )
      }

      const reliefY = tierY + tierHeight * .49
      const pilasterCount = Math.max(2, Math.min(6, Math.floor(width / 1.28)))
      const nicheCount = Math.max(1, Math.min(5, Math.floor(width / 1.75)))
      for (let face = 0; face < 4; face += 1) {
        const spacing = width * .82 / (pilasterCount - 1)
        for (let index = 0; index < pilasterCount; index += 1) {
          const along = -width * .41 + spacing * index
          const frontFace = face === 0, backFace = face === 1, eastFace = face === 2
          const rotationY = eastFace || face === 3 ? Math.PI / 2 : 0
          const faceX = eastFace ? width / 2 + .045 : face === 3 ? -width / 2 - .045 : along
          const faceZ = frontFace ? vimanaCenterZ + width / 2 + .045 : backFace ? vimanaCenterZ - width / 2 - .045 : vimanaCenterZ + along
          pilasters.push({ x: faceX, y: reliefY, z: faceZ, w: .095, h: tierHeight * .60, d: .12, rotationY })
          pilasters.push({ x: faceX, y: tierY + .20, z: faceZ, w: .17, h: .10, d: .16, rotationY })
          pilasters.push({ x: faceX, y: tierY + tierHeight - .18, z: faceZ, w: .17, h: .11, d: .16, rotationY })
        }
        const nicheSpacing = width * .76 / nicheCount
        for (let index = 0; index < nicheCount; index += 1) {
          const along = (index - (nicheCount - 1) / 2) * nicheSpacing
          const frontFace = face === 0, backFace = face === 1, eastFace = face === 2
          const rotationY = eastFace || face === 3 ? Math.PI / 2 : 0
          const faceX = eastFace ? width / 2 + .072 : face === 3 ? -width / 2 - .072 : along
          const faceZ = frontFace ? vimanaCenterZ + width / 2 + .072 : backFace ? vimanaCenterZ - width / 2 - .072 : vimanaCenterZ + along
          nicheRecesses.push({ x: faceX, y: reliefY, z: faceZ, w: .31, h: .48, d: .045, rotationY })
          nicheEdges.push(
            { x: faceX - .185, y: reliefY, z: faceZ + (frontFace ? .027 : backFace ? -.027 : 0), w: .055, h: .59, d: .065, rotationY },
            { x: faceX + .185, y: reliefY, z: faceZ + (frontFace ? .027 : backFace ? -.027 : 0), w: .055, h: .59, d: .065, rotationY },
            { x: faceX, y: reliefY + .29, z: faceZ + (frontFace ? .027 : backFace ? -.027 : 0), w: .43, h: .065, d: .07, rotationY },
            { x: faceX, y: reliefY - .29, z: faceZ + (frontFace ? .027 : backFace ? -.027 : 0), w: .43, h: .065, d: .07, rotationY },
          )
        }
      }

      // Tiny stepped rooflets sit at the four corners on each receding storey.
      const roofletScale = Math.max(.16, Math.min(.36, width * .038))
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        cornerRooflets.push({
          x: sx * (width / 2 - roofletScale * .54),
          y: tierY + .31,
          z: vimanaCenterZ + sz * (width / 2 - roofletScale * .54),
          scale: roofletScale,
        })
      }
      tierY += tierHeight
      tierWidth = nextWidth
    }
    tierMesh.instanceMatrix.needsUpdate = true
    group.add(tierMesh)
    makeBoxes(tierCornices, graniteLight, 'vimana-projecting-cornices')
    makeBoxes(pilasters, carved, 'vimana-pilasters')
    makeBoxes(nicheRecesses, graniteDark, 'vimana-recessed-niches')
    makeBoxes(nicheEdges, graniteMid, 'vimana-niche-frames')
    const roofletGeo = geometry('temple:corner-rooflet-frustum', () => new THREE.CylinderGeometry(.025, 1, 1, 4, 1, false))
    const rooflets = new THREE.InstancedMesh(roofletGeo, graniteLight, cornerRooflets.length)
    rooflets.name = 'temple-vimana-corner-rooflets'
    rooflets.castShadow = true
    rooflets.receiveShadow = true
    rooflets.userData.assetFeature = 'tiered-corner-rooflets'
    for (let index = 0; index < cornerRooflets.length; index += 1) {
      const item = cornerRooflets[index]
      dummy.position.set(item.x, item.y + item.scale * .30, item.z)
      dummy.rotation.copy(new THREE.Euler(0, Math.PI / 4, 0))
      dummy.scale.set(item.scale / Math.SQRT2, item.scale * .58, item.scale / Math.SQRT2)
      dummy.updateMatrix()
      rooflets.setMatrixAt(index, dummy.matrix)
    }
    rooflets.instanceMatrix.needsUpdate = true
    group.add(rooflets)

    // Octagonal neck, broad amalaka ring, rounded crown and restrained kalasha finial.
    const neckY = tierY + .02
    mesh(cylinderGeometry(1.18, 1.42, .76, 8), graniteMid, group, new THREE.Vector3(0, neckY + .38, vimanaCenterZ))
    mesh(cylinderGeometry(1.42, 1.50, .20, 12), graniteLight, group, new THREE.Vector3(0, neckY + .83, vimanaCenterZ))
    mesh(torusGeometry(1.22, .16, 8, 16), carved, group, new THREE.Vector3(0, neckY + .91, vimanaCenterZ), new THREE.Euler(Math.PI / 2, 0, 0))
    const dome = geometry('temple:rounded-octagonal-crown', () => new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2))
    mesh(dome, granite, group, new THREE.Vector3(0, neckY + 1.00, vimanaCenterZ), undefined, new THREE.Vector3(1.22, 1.46, 1.22))
    mesh(cylinderGeometry(.25, .43, .43, 8), graniteLight, group, new THREE.Vector3(0, neckY + 2.48, vimanaCenterZ))
    mesh(cylinderGeometry(.10, .24, .48, 8), carved, group, new THREE.Vector3(0, neckY + 2.91, vimanaCenterZ))
    round(group, .14, 0, neckY + 3.23, vimanaCenterZ, graniteLight, [1, 1.35, 1])
    mesh(cylinderGeometry(.018, .075, .30, 7), roofstone, group, new THREE.Vector3(0, neckY + 3.48, vimanaCenterZ))

    // Axial mandapa: a deep pillared hall with a dark inner doorway and layered stone roof.
    const mandapaZ = 2.15, mandapaWidth = 10.0, mandapaDepth = 6.35
    block(group, mandapaWidth + .88, .28, mandapaDepth + .76, 0, .42, mandapaZ, graniteMid)
    block(group, mandapaWidth + .54, .20, mandapaDepth + .48, 0, .66, mandapaZ, graniteLight)
    block(group, mandapaWidth + .18, .16, mandapaDepth + .17, 0, .84, mandapaZ, granite)
    block(group, mandapaWidth - .48, .11, mandapaDepth - .35, 0, .99, mandapaZ, graniteLight)
    const mandapaFront = mandapaZ + mandapaDepth / 2
    block(group, 2.55, 2.45, .13, 0, 2.25, mandapaFront + .10, graniteDark, 0, false)
    block(group, 1.87, 2.17, .14, 0, 2.12, mandapaFront + .19, dark(), 0, false)
    block(group, 1.58, .16, .37, 0, 3.30, mandapaFront + .20, carved, 0, false)
    for (const side of [-1, 1]) {
      block(group, .20, 2.62, .32, side * 1.22, 2.26, mandapaFront + .18, carved, 0, false)
      block(group, .34, .17, .39, side * 1.22, 3.60, mandapaFront + .19, graniteLight, 0, false)
      block(group, .20, 1.42, .10, side * .91, 2.17, mandapaFront + .27, graniteMid, 0, false)
    }
    const columnXs = [-4.05, -2.82, 2.82, 4.05]
    const columnZs = [-.25, 1.82, 3.89, 5.74]
    for (const x of columnXs) for (const z of columnZs) {
      if (Math.abs(x) < 2.5) continue
      const baseY = 1.02, shaftHeight = 3.28
      block(group, .76, .20, .76, x, baseY + .10, z, graniteMid)
      block(group, .61, .16, .61, x, baseY + .28, z, graniteLight)
      mesh(cylinderGeometry(.25, .31, shaftHeight - .34, 8), granite, group, new THREE.Vector3(x, baseY + .27 + (shaftHeight - .34) / 2, z))
      mesh(torusGeometry(.31, .06, 6, 12), carved, group, new THREE.Vector3(x, baseY + .57, z), new THREE.Euler(Math.PI / 2, 0, 0))
      mesh(torusGeometry(.30, .055, 6, 12), graniteLight, group, new THREE.Vector3(x, baseY + shaftHeight - .30, z), new THREE.Euler(Math.PI / 2, 0, 0))
      block(group, .78, .20, .78, x, baseY + shaftHeight - .10, z, graniteMid)
      block(group, .60, .12, .60, x, baseY + shaftHeight + .07, z, carved, 0, false)
    }
    block(group, mandapaWidth + .72, .20, mandapaDepth + .63, 0, 4.45, mandapaZ, graniteMid)
    block(group, mandapaWidth + 1.00, .22, mandapaDepth + .92, 0, 4.66, mandapaZ, graniteLight)
    block(group, mandapaWidth + .46, .20, mandapaDepth + .42, 0, 4.88, mandapaZ, granite)
    block(group, mandapaWidth + .22, .12, mandapaDepth + .20, 0, 5.06, mandapaZ, graniteLight)
    for (const side of [-1, 1]) {
      block(group, mandapaWidth + .12, .09, .16, 0, 5.22, mandapaZ + side * (mandapaDepth / 2 + .38), carved, 0, false)
    }
    // Four shallow treads join the mandapa entrance to the Nandi court.
    for (let step = 0; step < 4; step += 1) block(group, 4.20 + step * .20, .16, .35, 0, .77 - step * .16, mandapaFront + .37 + step * .34, graniteLight)

    // Low courtyard walls leave the gate open; the entry tower stays far below the vimana.
    const wallY = .86, wallH = 1.38, wallZ = TEMPLE_SITE.maxZ - 1.10
    block(group, .48, wallH, TEMPLE_SITE.depth - 2.05, TEMPLE_SITE.maxX - .48, wallY, -.52, graniteMid)
    block(group, .48, wallH, TEMPLE_SITE.depth - 2.05, TEMPLE_SITE.minX + .48, wallY, -.52, graniteMid)
    block(group, TEMPLE_SITE.width - .95, wallH, .48, 0, wallY, TEMPLE_SITE.minZ + .48, graniteMid)
    for (const side of [-1, 1]) block(group, 4.15, wallH, .48, side * 8.78, wallY, wallZ, graniteMid)
    for (const side of [-1, 1]) {
      const x = side * 3.25
      block(group, .74, 2.45, .88, x, 1.78, wallZ, granite)
      block(group, 1.18, .20, 1.18, x, 3.02, wallZ, graniteLight)
      block(group, 1.02, .15, 1.02, x, 3.20, wallZ, graniteMid)
      mesh(cylinderGeometry(.05, .68, .64, 4), roofstone, group, new THREE.Vector3(x, 3.59, wallZ), new THREE.Euler(0, Math.PI / 4, 0), undefined, true)
      block(group, .90, .10, .90, x, 3.95, wallZ, carved, 0, false)
      block(group, .22, .18, .75, x, 1.38, wallZ - .12, graniteLight, 0, false)
    }
    block(group, 5.85, .26, .82, 0, 1.60, wallZ, graniteLight)
    block(group, 4.95, .24, .78, 0, 3.00, wallZ, graniteMid)
    block(group, 4.20, .17, .75, 0, 3.22, wallZ, graniteLight)
    mesh(cylinderGeometry(.02, 2.12, .70, 4), roofstone, group, new THREE.Vector3(0, 3.66, 14.90), new THREE.Euler(0, Math.PI / 4, 0), new THREE.Vector3(.70, 1, .70))
    block(group, 1.15, .14, .72, 0, 4.05, wallZ, carved, 0, false)
    for (const side of [-1, 1]) {
      block(group, .65, .18, .62, side * 5.28, 1.58, wallZ, graniteLight, 0, false)
      block(group, .20, .13, .62, side * 5.28, 2.32, wallZ, carved, 0, false)
    }
    for (const side of [-1, 1]) {
      block(group, .82, 2.08, .78, side * 12.15, 1.50, wallZ, graniteMid)
      block(group, 1.10, .15, 1.08, side * 12.15, 2.58, wallZ, graniteLight)
      mesh(cylinderGeometry(.035, .48, .46, 4), roofstone, group, new THREE.Vector3(side * 12.15, 2.87, wallZ), new THREE.Euler(0, Math.PI / 4, 0), undefined, false)
    }
    // Gate stairs remain within the outer limit and align exactly on the entry axis.
    for (let step = 0; step < 4; step += 1) block(group, 3.70 + step * .27, .14, .38, 0, .13 + step * .14, 15.45 - step * .40, graniteLight)

    // Small columned Nandi pavilion; Nandi faces toward the sanctum along -Z.
    const pavilionZ = 9.15, pavilionWidth = 5.45, pavilionDepth = 4.55
    block(group, pavilionWidth + .70, .27, pavilionDepth + .66, 0, .28, pavilionZ, graniteMid)
    block(group, pavilionWidth + .42, .18, pavilionDepth + .40, 0, .50, pavilionZ, graniteLight)
    block(group, pavilionWidth + .10, .16, pavilionDepth + .09, 0, .68, pavilionZ, granite)
    for (const x of [-2.20, 2.20]) for (const z of [7.48, 8.78, 10.10]) {
      block(group, .34, .14, .34, x, .82, z, graniteLight)
      mesh(cylinderGeometry(.13, .18, 2.05, 8), granite, group, new THREE.Vector3(x, 1.91, z))
      mesh(torusGeometry(.19, .035, 5, 10), carved, group, new THREE.Vector3(x, 2.68, z), new THREE.Euler(Math.PI / 2, 0, 0))
      block(group, .42, .16, .42, x, 2.99, z, graniteMid)
    }
    block(group, pavilionWidth + .50, .22, pavilionDepth + .52, 0, 3.14, pavilionZ, graniteLight)
    block(group, pavilionWidth + .18, .20, pavilionDepth + .22, 0, 3.36, pavilionZ, graniteMid)
    mesh(cylinderGeometry(.35, 3.28, .76, 4), roofstone, group, new THREE.Vector3(0, 3.82, pavilionZ), new THREE.Euler(0, Math.PI / 4, 0))
    block(group, .80, .13, .80, 0, 4.20, pavilionZ, graniteLight, 0, false)

    // Seated stone Nandi: shoulder hump, lowered body, attentive head, horns and folded forelegs.
    round(group, .66, 0, 1.48, pavilionZ + .03, nandiStone, [1.08, 1.02, 1.58])
    round(group, .43, 0, 1.86, pavilionZ - .60, graniteLight, [1.02, 1.28, 1.08])
    round(group, .30, 0, 1.98, pavilionZ - 1.16, nandiStone, [1.0, .88, .88])
    for (const side of [-1, 1]) {
      round(group, .21, side * .32, 2.05, pavilionZ - 1.22, granite, [1.5, .46, .74], false)
      cylinderBetween(group, new THREE.Vector3(side * .19, 2.20, pavilionZ - 1.22), new THREE.Vector3(side * .24, 2.57, pavilionZ - 1.28), .095, .018, carved, 7, false)
      round(group, .075, side * .29, 1.99, pavilionZ - 1.46, graniteDark, [.65, .65, .28], false)
      round(group, .27, side * .53, 1.10, pavilionZ - .70, granite, [.84, .92, .70])
      block(group, .28, .45, .78, side * .42, .80, pavilionZ - .05, nandiStone, side * .10)
      block(group, .13, .31, .66, side * .47, .63, pavilionZ + .39, granite, -side * .20, false)
    }
    // A simple carved collar sits below the hump; metal colours are avoided in the moonlit stone court.
    mesh(torusGeometry(.48, .07, 7, 16), carved, group, new THREE.Vector3(0, 1.63, pavilionZ - .33), new THREE.Euler(Math.PI / 2, 0, 0))
    round(group, .055, -.12, 2.04, pavilionZ - 1.88, graniteDark, [1, .65, .38], false)
    round(group, .055, .12, 2.04, pavilionZ - 1.88, graniteDark, [1, .65, .38], false)

    batchStaticMeshes(group)
    group.userData.architecture = {
      tradition: 'original Brihadeeswarar-inspired Chola vimana',
      tierCount,
      pilasterInstances: pilasters.length,
      nicheInstances: nicheRecesses.length,
      cornerRoofletInstances: cornerRooflets.length,
      templeMass: 'rear sanctuary vimana above lower axial mandapa',
      entrance: TEMPLE_SITE.entrance,
      nandiFaces: '-z',
    }
    group.userData.templeDrawables = group.children.filter(child => (child as THREE.Mesh).isMesh).length
    return group
  }

  function cylinderBetween(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radiusBottom: number, radiusTop: number, material: THREE.Material, radial = 8, castShadow = true): THREE.Mesh {
    const direction = to.clone().sub(from)
    const result = mesh(cylinderGeometry(radiusTop, radiusBottom, direction.length(), radial), material, parent,
      from.clone().add(to).multiplyScalar(.5), undefined, undefined, castShadow)
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    return result
  }

  function createTree(kind: TownTreeKind, seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = kind === 'palmyra' ? 'Palmyra palm' : 'Broadleaf shade tree'
    group.userData.assetKind = 'tree'
    group.userData.species = kind
    group.userData.seed = String(seed)
    const bark = mat('tree-bark', 0x67533a, .99)
    const foliage = color.leaf.map((hex, index) => mat(`foliage-${index}`, hex, 1))
    if (kind === 'palmyra') {
      const height = 6.8 + rng() * 2.0
      const points = [0, .27, .50, .72, .91, 1].map((fraction, index, all) => new THREE.Vector3(
        Math.sin(fraction * 1.5 + rng() * .12) * .20,
        fraction * height,
        Math.cos(fraction * 1.7) * .12,
      ))
      for (let index = 0; index < points.length - 1; index += 1) {
        cylinderBetween(group, points[index], points[index + 1], .30 - index * .035, .265 - index * .034, bark, 8)
      }
      const crown = points[points.length - 1]
      round(group, .24, crown.x, crown.y, crown.z, bark, [1, .65, 1], false)
      // Shared, lobed palmate frond mesh is fanned around the small crown.
      const fan = geometry('palmyra:fan', () => {
        const shape = new THREE.Shape()
        shape.moveTo(0, -.10)
        shape.lineTo(.67, -.32)
        shape.lineTo(.88, -.72)
        shape.lineTo(1.04, -.47)
        shape.lineTo(1.25, -1.12)
        shape.lineTo(1.36, -.50)
        shape.lineTo(1.62, -1.06)
        shape.lineTo(1.62, -.35)
        shape.lineTo(1.93, -.69)
        shape.lineTo(1.76, -.05)
        shape.lineTo(2.02, .02)
        shape.lineTo(1.74, .20)
        shape.lineTo(1.96, .67)
        shape.lineTo(1.58, .40)
        shape.lineTo(1.59, 1.02)
        shape.lineTo(1.28, .50)
        shape.lineTo(1.13, 1.06)
        shape.lineTo(.93, .47)
        shape.lineTo(.73, .71)
        shape.lineTo(.58, .28)
        shape.closePath()
        const result = new THREE.ShapeGeometry(shape, 2)
        result.computeVertexNormals()
        return result
      })
      const leafMat = mat('palmyra-frond', 0x506b3e, .98, 0, { color: 0x1a2811, intensity: .025 })
      for (let index = 0; index < 9; index += 1) {
        const frond = mesh(fan, leafMat, group, new THREE.Vector3(crown.x, crown.y + (rng() - .5) * .15, crown.z),
          new THREE.Euler((rng() - .5) * .45, index * Math.PI * 2 / 9, (rng() - .5) * .12),
          new THREE.Vector3(.92 + rng() * .16, .92 + rng() * .16, .35), false)
        frond.userData.ambientScenery = true
      }
      // Fine petioles radiate from the crown in the same fan planes.
      const petioleGeometry = boxGeometry(1.15, .035, .045)
      for (let index = 0; index < 9; index += 1) {
        const angle = index * Math.PI * 2 / 9
        mesh(petioleGeometry, timber(1), group, new THREE.Vector3(crown.x + Math.cos(angle) * .48, crown.y, crown.z + Math.sin(angle) * .48),
          new THREE.Euler((rng() - .5) * .2, -angle, .16), undefined, false)
      }
    } else {
      const trunkHeight = 3.4 + rng() * .7
      const trunkTop = new THREE.Vector3((rng() - .5) * .45, trunkHeight, (rng() - .5) * .30)
      cylinderBetween(group, new THREE.Vector3(0, 0, 0), trunkTop, .46, .28, bark, 10)
      const branches: Array<[THREE.Vector3, THREE.Vector3]> = []
      for (let index = 0; index < 7; index += 1) {
        const angle = index * Math.PI * 2 / 7 + rng() * .35
        const start = trunkTop.clone().lerp(new THREE.Vector3(0, .8, 0), rng() * .30)
        const end = new THREE.Vector3(Math.cos(angle) * (1.6 + rng() * .9), trunkHeight + .6 + rng() * 1.5, Math.sin(angle) * (1.6 + rng() * .9))
        branches.push([start, end])
        cylinderBetween(group, start, end, .20, .075, bark, 7)
      }
      // A layered canopy leaves gaps for light and gives the tree a broad village shade silhouette.
      const canopy = new THREE.Group()
      group.add(canopy)
      for (let index = 0; index < 15; index += 1) {
        const angle = rng() * Math.PI * 2
        const radius = .2 + rng() * 2.0
        const y = trunkHeight + .45 + rng() * 1.55
        const size = .60 + rng() * .55
        round(canopy, .62, Math.cos(angle) * radius, y, Math.sin(angle) * radius,
          foliage[Math.floor(rng() * foliage.length)], [size, .70 + rng() * .45, size], false)
      }
      // Banyan-like hanging roots keep the silhouette regional without a dense polygon canopy.
      for (let index = 0; index < 4; index += 1) {
        const angle = index * Math.PI / 2 + rng() * .35
        const x = Math.cos(angle) * (1.65 + rng() * .5)
        const z = Math.sin(angle) * (1.65 + rng() * .5)
        cylinderBetween(group, new THREE.Vector3(x, trunkHeight + .6, z), new THREE.Vector3(x * 1.08, .12, z * 1.08), .035, .025, bark, 5, false)
      }
      void branches
    }
    batchStaticMeshes(group)
    return group
  }

  function createWorker(seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = 'Town agent figure'
    group.userData.assetKind = 'worker'
    group.userData.seed = String(seed)
    group.userData.pose = 'waiting'
    const skin = mat('worker-skin', [0x895b3e, 0x9a6947, 0x764b35][Math.floor(rng() * 3)], .95)
    const cloth = mat('worker-cotton', [0xb57e46, 0xa9533b, 0x6f7950][Math.floor(rng() * 3)], .94)
    const wrap = mat('worker-dhoti', [0xd2c19e, 0xbca77f, 0xc8b284][Math.floor(rng() * 3)], .97)
    const hair = mat('worker-hair', 0x27221d, .99)
    const torso = mesh(cylinderGeometry(.23, .36, .68, 9), cloth, group, new THREE.Vector3(0, 1.06, 0))
    torso.rotation.z = (rng() - .5) * .06
    mesh(cylinderGeometry(.26, .30, .46, 9), wrap, group, new THREE.Vector3(0, .47, 0))
    block(group, .16, .09, .38, 0, .46, 0, wrap, -.18, false)
    round(group, .22, 0, 1.55, 0, skin, [1, 1.05, .90])
    round(group, .23, 0, 1.63, -.02, hair, [1, .56, .92], false)
    block(group, .27, .08, .26, 0, 1.79, 0, cloth, 0, false)
    round(group, .045, -.08, 1.56, .196, hair, [.55, .55, .55], false)
    round(group, .045, .08, 1.56, .196, hair, [.55, .55, .55], false)
    const leftArm = new THREE.Group()
    leftArm.name = 'leftArm'
    leftArm.position.set(-.29, 1.31, 0)
    group.add(leftArm)
    const rightArm = new THREE.Group()
    rightArm.name = 'rightArm'
    rightArm.position.set(.29, 1.31, 0)
    group.add(rightArm)
    const sleeve = mat('worker-sleeve', [0x8e5e38, 0xa64f39, 0x596c45][Math.floor(rng() * 3)], .96)
    for (const [arm, sign] of [[leftArm, -1], [rightArm, 1]] as const) {
      cylinderBetween(arm, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sign * .10, -.43, .02), .105, .085, sleeve, 8)
      cylinderBetween(arm, new THREE.Vector3(sign * .10, -.43, .02), new THREE.Vector3(sign * .04, -.77, .08), .078, .055, skin, 7)
      round(arm, .075, sign * .04, -.79, .08, skin, [1, .75, .75], false)
    }
    for (const side of [-1, 1]) {
      const footX = side * .13
      cylinderBetween(group, new THREE.Vector3(footX, .34, 0), new THREE.Vector3(footX + side * .015, .08, .03), .095, .065, skin, 7)
      block(group, .20, .09, .32, footX, .05, .11, timber(0), 0, false)
    }
    const sash = block(group, .56, .09, .04, 0, 1.08, .20, mat('worker-sash', 0x9d4738, .97), -.20, false)
    group.userData.leftArm = leftArm
    group.userData.rightArm = rightArm
    group.userData.animationTargets = { leftArm, rightArm }
    void sash
    return group
  }

  function createAnimal(kind: TownAnimalKind, seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = `${kind} ambient animal`
    group.userData.assetKind = 'animal'
    group.userData.species = kind
    group.userData.seed = String(seed)
    const skin = mat(`animal-${kind}-coat-${Math.floor(rng() * 3)}`, kind === 'cattle'
      ? [0x8a674b, 0xeee1c5, 0x684a37][Math.floor(rng() * 3)]
      : kind === 'goat' ? [0xd8cfb9, 0x886746, 0xb5a083][Math.floor(rng() * 3)] : [0xc8a36c, 0xe2d0a5, 0x9c714a][Math.floor(rng() * 3)], .97)
    const pale = mat(`animal-${kind}-markings`, kind === 'cattle' ? 0xeadfc6 : kind === 'goat' ? 0xddd4c1 : 0xe9d9b9, .98)
    const darkCoat = mat('animal-dark-markings', 0x463629, .99)
    const horn = mat('animal-horn', 0xd1c8a8, .87)
    const hoof = mat('animal-hoof', 0x44372c, .99)
    if (kind === 'chicken') {
      round(group, .30, 0, .43, 0, skin, [1.28, .9, .94])
      round(group, .13, .20, .68, .04, skin, [.78, 1.05, .82])
      round(group, .16, .24, .87, .03, skin, [1, 1, .88])
      mesh(cylinderGeometry(.01, .12, .18, 6), mat('chicken-beak', 0xb87932, .84), group, new THREE.Vector3(.24, .82, .20), new THREE.Euler(Math.PI / 2, 0, -.25), undefined, false)
      block(group, .12, .08, .08, .26, .76, .18, mat('chicken-wattle', 0x9e3e32, .93), 0, false)
      for (const side of [-1, 1]) {
        round(group, .12, side * .23, .44, -.03, pale, [1, .72, .35], false)
        cylinderBetween(group, new THREE.Vector3(side * .12, .30, .04), new THREE.Vector3(side * .13, .08, .06), .025, .020, hoof, 5, false)
        cylinderBetween(group, new THREE.Vector3(side * .13, .08, .06), new THREE.Vector3(side * .13 + .07, .06, .14), .017, .010, hoof, 5, false)
      }
      for (let feather = 0; feather < 3; feather += 1) round(group, .10, -.32, .55 + feather * .06, -.02, pale, [.55, .75, .6], false)
    } else {
      const isCow = kind === 'cattle'
      const bodyLength = isCow ? 1.18 : .79
      round(group, isCow ? .44 : .33, 0, isCow ? .82 : .58, 0, skin, [bodyLength / .44, .86, .78])
      if (isCow) {
        round(group, .25, -.48, .69, -.01, pale, [.67, .67, .79], false)
        round(group, .22, .43, 1.05, 0, skin, [.72, 1.65, .72])
        round(group, .20, .51, 1.38, .01, skin, [1, .87, .83])
        round(group, .13, .62, 1.30, .04, pale, [1.0, .7, .75], false)
        for (const side of [-1, 1]) {
          round(group, .11, .36, 1.45, side * .20, skin, [1.25, .48, .55], false)
          cylinderBetween(group, new THREE.Vector3(.40, 1.48, side * .14), new THREE.Vector3(.31, 1.71, side * .17), .06, .012, horn, 6, false)
        }
      } else {
        round(group, .22, .33, .99, 0, skin, [.65, 1.35, .68])
        round(group, .17, .45, 1.27, 0, skin, [1, .85, .72])
        round(group, .14, .59, 1.17, .02, pale, [1, .65, .65], false)
        for (const side of [-1, 1]) {
          round(group, .11, .39, 1.35, side * .14, skin, [1.7, .42, .55], false)
          cylinderBetween(group, new THREE.Vector3(.40, 1.36, side * .10), new THREE.Vector3(.31, 1.61, side * .14), .048, .009, horn, 6, false)
        }
      }
      for (const x of [-.34, .38]) {
        for (const z of [-.23, .23]) {
          const legHeight = isCow ? .63 : .48
          cylinderBetween(group, new THREE.Vector3(x, isCow ? .67 : .49, z), new THREE.Vector3(x + (rng() - .5) * .06, .12, z), isCow ? .105 : .065, .055, skin, 7)
          block(group, isCow ? .17 : .12, .12, isCow ? .17 : .12, x, .08, z, hoof, 0, false)
          void legHeight
        }
      }
      const tailStart = new THREE.Vector3(-bodyLength * .42, .83, 0)
      const tailMiddle = new THREE.Vector3(-bodyLength * .60, .49, -.02)
      const tailEnd = new THREE.Vector3(-bodyLength * .66, .36, -.03)
      cylinderBetween(group, tailStart, tailMiddle, .045, .03, skin, 5, false)
      cylinderBetween(group, tailMiddle, tailEnd, .033, .022, skin, 5, false)
      round(group, .07, tailEnd.x, tailEnd.y - .06, tailEnd.z, darkCoat, [.6, 1.4, .6], false)
      if (isCow) {
        mesh(cylinderGeometry(.11, .16, .19, 8, true), mat('cow-bell', 0xb28c49, .54, .35), group,
          new THREE.Vector3(.18, .85, .23), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      }
    }
    batchStaticMeshes(group)
    return group
  }

  function createLamp(seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = 'Oil lamp'
    group.userData.assetKind = 'lamp'
    group.userData.seed = String(seed)
    const bronze = mat('lamp-bronze', 0x87633b, .48, .58)
    const flame = mat('oil-flame', 0xffd18a, .4, .02, { color: 0xff7a26, intensity: 2.8 })
    const footRadius = .14 + rng() * .03
    mesh(cylinderGeometry(footRadius * .68, footRadius, .13, 9), bronze, group, new THREE.Vector3(0, .075, 0))
    mesh(cylinderGeometry(.045, .09, .50, 8), bronze, group, new THREE.Vector3(0, .37, 0))
    mesh(cylinderGeometry(.11, .045, .09, 9), bronze, group, new THREE.Vector3(0, .66, 0))
    mesh(cylinderGeometry(.16, .09, .09, 12), bronze, group, new THREE.Vector3(0, .72, 0))
    mesh(sphereGeometry(.105, 8, 6), flame, group, new THREE.Vector3(0, .83, 0), undefined, new THREE.Vector3(.80, 1.35, .80), false)
    group.userData.lampEmitter = new THREE.Vector3(0, .82, 0)
    batchStaticMeshes(group)
    return group
  }

  function createProp(kind: TownPropKind, seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = kind.replace('-', ' ')
    group.userData.assetKind = 'prop'
    group.userData.propKind = kind
    group.userData.seed = String(seed)
    if (kind === 'pot' || kind === 'grain-jar') {
      const jar = kind === 'grain-jar'
      const material = mat(`vessel-${jar ? 'jar' : 'pot'}-${Math.floor(rng() * 3)}`, [0x9c6747, 0xb1784d, 0x80553e][Math.floor(rng() * 3)], .97)
      const size = jar ? 1.15 : .90
      mesh(createPotGeometry(jar), material, group, new THREE.Vector3(0, .05, 0), undefined, new THREE.Vector3(size, size, size))
      mesh(torusGeometry(jar ? .23 : .22, .025, 5, 14), mat('vessel-lip', 0x704a36, .94), group,
        new THREE.Vector3(0, jar ? 1.20 : .91, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      block(group, .08, .012, .025, .10, .68, .39, mat('vessel-painted-mark', 0xd0a578, .92), .15, false)
    } else if (kind === 'basket') {
      const wicker = mat('basket-wicker', 0x9b794b, .99)
      const rim = mat('basket-rim', 0x715b3d, .96)
      mesh(cylinderGeometry(.39, .27, .48, 12, true), wicker, group, new THREE.Vector3(0, .25, 0), undefined, undefined, false)
      mesh(cylinderGeometry(.40, .40, .065, 12), rim, group, new THREE.Vector3(0, .51, 0), undefined, undefined, false)
      for (const y of [.14, .29, .44]) mesh(torusGeometry(.32 + y * .12, .025, 4, 14), rim, group, new THREE.Vector3(0, y, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      for (let index = 0; index < 10; index += 1) {
        const angle = index * Math.PI * 2 / 10
        const x = Math.cos(angle) * .32, z = Math.sin(angle) * .32
        block(group, .035, .44, .035, x, .26, z, wicker, -angle, false)
      }
    } else if (kind === 'well') {
      mesh(cylinderGeometry(.88, .80, .88, 16, true), stone(0), group, new THREE.Vector3(0, .48, 0), undefined, undefined, true)
      mesh(torusGeometry(.82, .11, 8, 20), stone(1), group, new THREE.Vector3(0, .91, 0), new THREE.Euler(Math.PI / 2, 0, 0))
      mesh(cylinderGeometry(.65, .65, .06, 16), mat('well-water', 0x566d6b, .42, .05), group, new THREE.Vector3(0, .47, 0), undefined, undefined, false)
      for (const side of [-1, 1]) {
        block(group, .14, 1.15, .14, side * .95, 1.28, 0, timber(0))
        mesh(cylinderGeometry(.045, .045, 2.0, 7), timber(1), group, new THREE.Vector3(0, 1.82, 0), new THREE.Euler(0, 0, Math.PI / 2), undefined, false)
      }
      block(group, .10, .78, .10, 0, 1.38, 0, timber(1), 0, false)
      mesh(torusGeometry(.16, .025, 5, 10), timber(0), group, new THREE.Vector3(0, 1.0, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      cylinderBetween(group, new THREE.Vector3(.22, 1.03, 0), new THREE.Vector3(.22, .18, 0), .018, .018, timber(1), 5, false)
    } else if (kind === 'cart') {
      const wood = timber(1)
      block(group, 1.45, .17, .96, 0, .70, 0, wood)
      for (const x of [-.62, .62]) for (const z of [-.37, .37]) block(group, .10, .48, .10, x, .93, z, timber(0))
      for (const side of [-1, 1]) {
        block(group, 1.40, .32, .08, 0, .93, side * .46, timber(0))
        const wheel = mesh(torusGeometry(.42, .055, 7, 18), wood, group, new THREE.Vector3(side * .80, .45, 0), new THREE.Euler(0, Math.PI / 2, 0))
        wheel.userData.cartWheel = true
      }
      block(group, 1.95, .10, .09, 0, .48, 0, timber(0), 0, false)
      for (const side of [-1, 1]) block(group, .08, .11, 1.55, side * .48, .80, 0, timber(1), 0, false)
      for (const side of [-1, 1]) block(group, .09, .09, 1.70, side * .30, .25, .90, timber(0), -.04 * side, false)
      block(group, .10, .11, 1.70, 0, .25, .90, timber(0), .02, false)
      void rng
    } else {
      const length = 2.4 + rng() * .35
      for (let index = 0; index < 4; index += 1) {
        const x = (index - 1.5) * .55
        block(group, .52, .46, .54, x, .23, 0, stone(index % 3))
      }
      block(group, length, .10, .68, 0, .51, 0, stone(1), 0, false)
      block(group, length, .12, .72, 0, .77, 0, stone(0), 0, false)
    }
    batchStaticMeshes(group)
    return group
  }

  return {
    createHouse,
    createPavilion,
    createTemple,
    createTree,
    createAnimal,
    createWorker,
    createLamp,
    createProp,
    releaseAsset(asset) {
      const owned = mergedByAsset.get(asset)
      if (!owned) return
      for (const resource of owned) {
        resource.dispose()
        mergedGeometries.delete(resource)
      }
      mergedByAsset.delete(asset)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const resource of geometries.values()) resource.dispose()
      for (const resource of mergedGeometries) resource.dispose()
      for (const resource of materials.values()) resource.dispose()
      geometries.clear()
      mergedGeometries.clear()
      materials.clear()
    },
  }
}
