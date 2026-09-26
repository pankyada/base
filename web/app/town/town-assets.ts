import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { buildingSpec, TEMPLE_CAMPUS, TEMPLE_SITE, type BuildingForm, type TownBuildingAppearance } from './town-model'
import { LAMP_COLOR, type ArtisanLamp, type ArtisanLook } from './town-artisans'

export type TownTreeKind = 'palmyra' | 'broadleaf'
export type TownAnimalKind = 'cattle' | 'goat' | 'chicken'
export type TownPropKind =
  | 'pot' | 'basket' | 'grain-jar' | 'well' | 'cart' | 'low-wall'
  | 'awning' | 'bench' | 'workstation' | 'tool-rack' | 'queue-board' | 'question-pennant' | 'archive-shelf' | 'archive-crate'
  | 'crop-row' | 'grove' | 'irrigation-channel' | 'pond'

export interface TownAssetLibrary {
  createHouse(form: BuildingForm, seed: number | string, appearance?: TownBuildingAppearance, active?: boolean): THREE.Group
  createPavilion(seed: number | string): THREE.Group
  createTemple(seed: number | string): THREE.Group
  createTempleCampus(seed: number | string): THREE.Group
  createTree(kind: TownTreeKind, seed: number | string): THREE.Group
  createAnimal(kind: TownAnimalKind, seed: number | string): THREE.Group
  createWorker(seed: number | string): THREE.Group
  /** Ambient resident used as non-interactive scenery. */
  createTownsperson(seed: number | string): THREE.Group
  /** Persistent artisan figure (ADR-91) with articulated limbs, craft prop, order leaf and status lamp. */
  createArtisan(look: ArtisanLook): THREE.Group
  /** Detailed, non-agent player avatar for explore-on-foot. */
  createTraveller(): THREE.Group
  artisanLampMaterial(lamp: ArtisanLamp): THREE.Material
  createGuildHall(seed: number | string): THREE.Group
  createStagingMandapam(seed: number | string): THREE.Group
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
  const textures = new Set<THREE.Texture>()
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

  /** Terracotta fish-scale tiling for gopuram crowns, generated as data so it needs no DOM canvas. */
  function scaleRoof(): THREE.MeshStandardMaterial {
    const key = 'campus-scale-tiled-crown'
    const cached = materials.get(key)
    if (cached) return cached as THREE.MeshStandardMaterial
    if (disposed) throw new Error('Town asset library has been disposed')
    const size = 64, cell = 16
    const data = new Uint8Array(size * size * 4)
    const fill = new THREE.Color(0xc9683f), light = new THREE.Color(0xe0905f), rim = new THREE.Color(0x7a3322), texel = new THREE.Color()
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const row = Math.floor(y / cell)
      const cx = ((x + (row % 2) * cell / 2) % cell) - cell / 2, cy = y % cell
      const r = Math.hypot(cx, cy) / (cell * .62)
      if (r > 1) texel.copy(fill).lerp(rim, .35)
      else if (r > .84) texel.copy(rim)
      else texel.copy(light).lerp(fill, r)
      const offset = (y * size + x) * 4
      data[offset] = Math.round(texel.r * 255); data[offset + 1] = Math.round(texel.g * 255); data[offset + 2] = Math.round(texel.b * 255); data[offset + 3] = 255
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(3, 7)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
    textures.add(texture)
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .82 })
    material.name = key
    materials.set(key, material)
    return material
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
      // Part boxes survive the merge so walkers and the follow camera collide with
      // real parts (a gopuram pier, a sanctuary wall) rather than one asset-wide box.
      const pieceBoxes = new Float32Array(pieces.length * 6)
      pieces.forEach((piece, index) => {
        piece.computeBoundingBox()
        const { min, max } = piece.boundingBox!
        pieceBoxes.set([min.x, min.y, min.z, max.x, max.y, max.z], index * 6)
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
      combined.userData.pieceBoxes = pieceBoxes
      if (bucket.material.userData.townAssetRole) combined.userData.assetRole = bucket.material.userData.townAssetRole
      combined.userData.assetMaterialName = bucket.material.name
      group.add(combined)
      for (const item of bucket.items) item.parent?.remove(item)
    }
    if (owned.size) mergedByAsset.set(group, owned)
  }

  /** Batch fixed sibling details only inside each articulation node. */
  function batchAvatarDetails(asset: THREE.Group, joints: Array<THREE.Group | undefined>): void {
    const owned = new Set<THREE.BufferGeometry>()
    const keepNames = new Set(['robeHem', 'collar', 'orderLeaf', 'lampFlame'])
    for (const parent of joints) {
      if (!parent) continue
      const buckets = new Map<string, { material: THREE.Material; castShadow: boolean; receiveShadow: boolean; items: THREE.Mesh[] }>()
      for (const child of [...parent.children]) {
        const item = child as THREE.Mesh
        if (!item.isMesh || keepNames.has(item.name) || Array.isArray(item.material)) continue
        if ((item as THREE.InstancedMesh).isInstancedMesh && (item as THREE.InstancedMesh).instanceColor) continue
        const key = item.material.uuid
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = { material: item.material, castShadow: item.castShadow, receiveShadow: item.receiveShadow, items: [] }
          buckets.set(key, bucket)
        }
        bucket.castShadow ||= item.castShadow
        bucket.receiveShadow ||= item.receiveShadow
        bucket.items.push(item)
      }
      for (const bucket of buckets.values()) {
        if (bucket.items.length < 2) continue
        const pieces = bucket.items.flatMap(item => {
          item.updateMatrix()
          let source = item.geometry.clone()
          if (source.index) {
            const indexed = source
            source = indexed.toNonIndexed()
            indexed.dispose()
          }
          const instances = (item as THREE.InstancedMesh).isInstancedMesh ? item as THREE.InstancedMesh : undefined
          const count = instances?.count ?? 1
          const result: THREE.BufferGeometry[] = []
          const instanceTransform = new THREE.Matrix4()
          for (let index = 0; index < count; index += 1) {
            const transformed = source.clone()
            if (instances) {
              instances.getMatrixAt(index, instanceTransform)
              instanceTransform.premultiply(item.matrix)
              transformed.applyMatrix4(instanceTransform)
            } else transformed.applyMatrix4(item.matrix)
            result.push(transformed)
          }
          source.dispose()
          return result
        })
        const merged = BufferGeometryUtils.mergeGeometries(pieces, false)
        for (const piece of pieces) piece.dispose()
        if (!merged) continue
        mergedGeometries.add(merged)
        owned.add(merged)
        const combined = new THREE.Mesh(merged, bucket.material)
        combined.name = `${parent.name || 'figure'}-${bucket.material.name || 'detail'}-batch`
        combined.castShadow = bucket.castShadow
        combined.receiveShadow = bucket.receiveShadow
        combined.userData.assetBatch = true
        combined.userData.assetMaterialName = bucket.material.name
        parent.add(combined)
        for (const item of bucket.items) item.parent?.remove(item)
      }
    }
    if (owned.size) mergedByAsset.set(asset, owned)
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

  function createHouse(form: BuildingForm, seed: number | string, appearance?: TownBuildingAppearance, active = Boolean(appearance)): THREE.Group {
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
    const setAppearance = (next?: TownBuildingAppearance, active = Boolean(next)): void => {
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
      const variant = ((Math.trunc(next.variant) % 16) + 16) % 16
      if (!crown || crownVariant !== variant) {
        if (crown) group.remove(crown)
        crown = addActiveBuildingCrown(group, form, seed, next, width, depth)
        crownVariant = variant
      }
      if (crown) {
        crown.traverse(object => {
          const item = object as THREE.Mesh
          if (item.isMesh && item.userData.assetRole === 'house-wall') item.material = activeWall
          if (item.isMesh && item.userData.assetRole === 'house-roof') item.material = activeRoof
        })
        crown.visible = true
      }
      group.scale.set(1, boundedHeight, 1)
      group.updateMatrixWorld(true)
      const extent = new THREE.Box3().setFromObject(group)
      group.scale.x = Math.min(1, spec.width / (2 * Math.max(Math.abs(extent.min.x), Math.abs(extent.max.x), .01)))
      group.scale.z = Math.min(1, spec.depth / (2 * Math.max(Math.abs(extent.min.z), Math.abs(extent.max.z), .01)))
      group.updateMatrixWorld(true)
      group.userData.appearance = { ...next, heightScale: boundedHeight }
      group.userData.assetIdentity = { kind: active ? 'active-project' : 'project-house', variant, theme: next.theme }
    }
    group.userData.setAppearance = setAppearance
    if (appearance) setAppearance(appearance, active)
    return group
  }

  function addActiveBuildingCrown(owner: THREE.Group, form: BuildingForm, seed: number | string, appearance: TownBuildingAppearance, width: number, depth: number): THREE.Group {
    const group = new THREE.Group()
    group.name = 'project-house-roof-theme'
    owner.add(group)
    const rng = randomFor(`${seed}:active-roof`)
    const variant = ((Math.trunc(appearance.variant) % 16) + 16) % 16
    const family = variant % 7
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
      if (item.userData.assetRole === 'house-roof') item.userData.assetFeature = 'project-house-theme-roof'
      return item
    }

    const pyramid = (x: number, z: number, w: number, d: number, height: number, y = top) => {
      const body = mesh(cylinderGeometry(.025, 1, 1, 4), roof, group,
        new THREE.Vector3(x, y + height / 2, z), new THREE.Euler(0, Math.PI / 4, 0),
        new THREE.Vector3(w / Math.SQRT2, height, d / Math.SQRT2), true)
      body.userData.assetFeature = 'project-house-theme-roof'
      body.userData.assetRole = 'house-roof'
    }
    const roofSpanX = Math.min(width - .35, span * .82) * jitter
    const roofSpanZ = Math.min(depth - .35, span * .70) * (.96 + rng() * .08)

    if (family === 0) {
      // Long-ridge workshop: a raised ventilated clerestory follows the roof axis.
      const lanternW = Math.max(.78, roofSpanX * (.58 + rng() * .13))
      const lanternD = Math.min(.68, roofSpanZ * .40)
      identityBlock(lanternW, .40, lanternD, (rng() - .5) * width * .08, top + .19, (rng() - .5) * depth * .08, wall)
      identityBlock(lanternW + .20, .10, lanternD + .18, 0, top + .43, 0, trim, 0, false)
      for (const side of [-1, 1]) identityBlock(.07, .23, lanternD + .10, side * lanternW * .35, top + .51, 0, roof, 0, false)
      pyramid(0, 0, lanternW + .3, lanternD + .26, .36, top + .48)
    } else if (family === 1) {
      // Stepped upper hall, with a separate raised storey and a crown roof.
      const hallW = Math.max(.8, roofSpanX * (.52 + rng() * .12))
      const hallD = Math.max(.72, roofSpanZ * (.53 + rng() * .12))
      identityBlock(hallW + .20, .12, hallD + .20, 0, top + .06, 0, trim, 0, false)
      identityBlock(hallW, .48 * jitter, hallD, 0, top + .34 * jitter, 0, wall)
      identityBlock(hallW + .28, .12, hallD + .28, 0, top + .62 * jitter, 0, roof, 0, false)
      pyramid(0, 0, hallW + .18, hallD + .18, .50 * jitter, top + .67 * jitter)
    } else if (family === 2) {
      // Hipped courtyard roof with a broad eave and high, compact peak.
      identityBlock(roofSpanX, .13, roofSpanZ, 0, top + .04, 0, wall, 0, false)
      pyramid((rng() - .5) * .12, (rng() - .5) * .12, roofSpanX * .76, roofSpanZ * .78, .78 * jitter, top + .1)
    } else if (family === 3) {
      // Twin gabled atelier roofs: two unequal ridges make a memorable paired silhouette.
      const gap = roofSpanX * (.20 + rng() * .05)
      const halfW = Math.max(.56, (roofSpanX - gap) * .50)
      for (const [side, scale] of [[-1, .94 + rng() * .08], [1, .94 + rng() * .08]] as const) {
        const x = side * (gap / 2 + halfW / 2)
        identityBlock(halfW * .78, .27, roofSpanZ * .68, x, top + .20, 0, wall)
        identityBlock(halfW + .16, .10, roofSpanZ * .80, x, top + .06, 0, trim, 0, false)
        pyramid(x, (rng() - .5) * .08, halfW, roofSpanZ * .76, .62 * scale, top + .1)
      }
    } else if (family === 4) {
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
    } else if (family === 5) {
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
    } else {
      // Broad open pavilion with four posts and a floating canopy.
      const canopyW = roofSpanX * .86
      const canopyD = roofSpanZ * .88
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
        identityBlock(.12, .72, .12, sideX * canopyW * .38, top + .42, sideZ * canopyD * .37, wall)
      }
      identityBlock(canopyW, .13, canopyD, 0, top + .84, 0, roof)
      pyramid(0, 0, canopyW * .84, canopyD * .84, .38 * jitter, top + .9)
    }
    if (variant >= 7) {
      const x = width * .27
      const z = -depth * .24
      const w = Math.max(.48, width * .18)
      const d = Math.max(.48, depth * .19)
      identityBlock(w, .53, d, x, top + .33, z, wall)
      pyramid(x, z, w + .16, d + .16, .41, top + .6)
    }
    if (variant >= 14) {
      identityBlock(width * .68, .12, .25, 0, top + .12, depth * .35, roof)
      for (const side of [-1, 1]) identityBlock(.12, .50, .12, side * width * .28, top + .32, depth * .35, wall)
    }
    group.userData.houseRoofTheme = { variant, roofVariation: Number(jitter.toFixed(3)) }
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

  /**
   * Meenakshi-inspired walled campus around the main sanctuary (placed separately
   * from createTemple): outer prakaram wall with an inner cloister, four painted
   * gopurams (the south one tallest), corner turrets, a stepped tank, a pillared
   * hall, the flagstaff on the axis and two subsidiary vimana shrines.
   */
  function createTempleCampus(seed: number | string): THREE.Group {
    const group = new THREE.Group()
    group.name = 'Town Temple Campus · Meenakshi-inspired prakaram'
    group.userData.assetKind = 'temple-campus'
    group.userData.seed = String(seed)
    const rng = randomFor(`${seed}:campus`)
    const { minX, maxX, minZ, maxZ, width, depth, sanctuary } = TEMPLE_CAMPUS

    const granite = mat('temple-granite-warm', 0x9b876d, .96)
    const graniteLight = mat('temple-granite-sunlit-edges', 0xb29c7d, .94)
    const graniteMid = mat('temple-granite-course', 0x83715c, .98)
    const carved = mat('temple-carved-stone', 0xc0a985, .95)
    const flagstones = mat('campus-prakaram-flagstones', 0x8e8772, .99)
    const walkway = mat('campus-axial-walk', 0xa89e83, .97)
    const water = mat('campus-tank-water', 0x4d7f88, .22, .06)
    const gilt = mat('campus-gilded-copper', 0xd4ad55, .5, .22)
    const stucco = mat('campus-painted-stucco', 0xffffff, .9)
    const crownPaint = mat('campus-painted-crown', 0xc99a57, .88)

    type Box = { x: number; y: number; z: number; w: number; h: number; d: number; color?: number }
    const unitBox = boxGeometry(1, 1, 1)
    const dummy = new THREE.Object3D()
    const instancedBoxes = (items: Box[], material: THREE.Material, name: string, castShadow = true): void => {
      if (!items.length) return
      const instances = new THREE.InstancedMesh(unitBox, material, items.length)
      instances.name = name
      instances.castShadow = castShadow
      instances.receiveShadow = true
      items.forEach((item, index) => {
        dummy.position.set(item.x, item.y, item.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(item.w, item.h, item.d)
        dummy.updateMatrix(); instances.setMatrixAt(index, dummy.matrix)
        if (item.color !== undefined) instances.setColorAt(index, new THREE.Color(item.color))
      })
      instances.instanceMatrix.needsUpdate = true
      if (instances.instanceColor) instances.instanceColor.needsUpdate = true
      group.add(instances)
    }
    const pillarUnit = cylinderGeometry(.5, .5, 1, 8)
    const instancedPillars = (items: Array<{ x: number; z: number; radius: number; height: number; y?: number }>, material: THREE.Material, name: string): void => {
      if (!items.length) return
      const instances = new THREE.InstancedMesh(pillarUnit, material, items.length)
      instances.name = name
      instances.castShadow = true
      instances.receiveShadow = true
      items.forEach((item, index) => {
        dummy.position.set(item.x, (item.y ?? 0) + item.height / 2, item.z); dummy.rotation.set(0, 0, 0)
        dummy.scale.set(item.radius * 2, item.height, item.radius * 2)
        dummy.updateMatrix(); instances.setMatrixAt(index, dummy.matrix)
      })
      instances.instanceMatrix.needsUpdate = true
      group.add(instances)
    }

    const stuccoBoxes: Box[] = []
    const stoneBoxes: Box[] = []
    const cloisterPillars: Array<{ x: number; z: number; radius: number; height: number; y?: number }> = []
    const hallPillars: Array<{ x: number; z: number; radius: number; height: number; y?: number }> = []

    // One continuous flagstone prakaram, with paved walks from the sanctuary to each gopuram.
    block(group, width - 1, .12, depth - 1, 0, .06, 0, flagstones, 0, false)
    const sanctuaryFront = sanctuary.z + TEMPLE_SITE.maxZ * sanctuary.scale
    block(group, 6.2, .06, maxZ - sanctuaryFront, 0, .15, (maxZ + sanctuaryFront) / 2, walkway, 0, false)
    const sanctuaryHalfX = TEMPLE_SITE.maxX * sanctuary.scale
    const sanctuaryBack = sanctuary.z + TEMPLE_SITE.minZ * sanctuary.scale
    block(group, maxX - sanctuaryHalfX, .06, 4.4, (maxX + sanctuaryHalfX) / 2, .15, 0, walkway, 0, false)
    block(group, maxX - sanctuaryHalfX, .06, 4.4, -(maxX + sanctuaryHalfX) / 2, .15, 0, walkway, 0, false)
    block(group, 4.4, .06, sanctuaryBack - minZ, 0, .15, (sanctuaryBack + minZ) / 2, walkway, 0, false)

    // Gopurams: stone gateway storeys, then receding stucco tiers under a barrel-vault crown.
    const tierGeo = geometry('campus:gopuram-tier', () => new THREE.CylinderGeometry(.9, 1, 1, 4, 1).rotateY(Math.PI / 4))
    const vaultGeo = geometry('campus:gopuram-vault', () => new THREE.CylinderGeometry(1, 1, 1, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2))
    const sphereUnit = sphereGeometry(.5, 8, 6)
    const coneUnit = geometry('campus:kalasha-cone', () => new THREE.ConeGeometry(.5, 1, 6))
    // Upper half-ring in the XY plane: the kudu (horseshoe) arch used for niches, halos and cornices.
    const archUnit = geometry('campus:kudu-arch', () => new THREE.TorusGeometry(1, .16, 5, 14, Math.PI))

    // Tier dressing modelled on painted Madurai gopurams: pale stucco body; colour
    // comes from sculpture — a central column of doorways flanked by deities,
    // coral-roofed pavilions alternating with haloed niche deities, corner kutas,
    // kudu-arch cornices and a frieze of attendants on every face.
    const vivid = [0xd9822b, 0xc0443a, 0x4f8a4b, 0x3f9aa0, 0x3f5fa8, 0xd8b04a, 0xd98a9a, 0x8a5fa0, 0x2f7f6a, 0xe0b23c]
    const deitySkins = [0x4f78b8, 0x5f86c4, 0xd9a55a, 0x4f8a4b, 0xe6d2b0, 0xc98a55, 0x3f9aa0]
    const roofCorals = [0xd9776b, 0xe08a7a, 0xc9605a, 0xd98a9a]
    const nicheTones = [0x2f4f78, 0x2f5a66, 0x7a2f2c, 0x3c3f78]
    const creams = [0xe6d8b8, 0xdccaa4]
    const gold = 0xd8b04a, darkOpening = 0x1d1a17
    type Piece = { x: number; y: number; z: number; w: number; h: number; d: number; color: number; rotY: number }
    type Dressing = { boxes: Piece[]; spheres: Piece[]; vaults: Piece[]; cones: Piece[]; arches: Piece[] }
    const dressing = (): Dressing => ({ boxes: [], spheres: [], vaults: [], cones: [], arches: [] })
    const pieceColor = new THREE.Color()
    const flushDressing = (parent: THREE.Object3D, set: Dressing, name: string): void => {
      const kinds = [[unitBox, set.boxes, 'relief'], [sphereUnit, set.spheres, 'domes-and-heads'], [vaultGeo, set.vaults, 'shala-roofs'], [coneUnit, set.cones, 'crowns-and-finials'], [archUnit, set.arches, 'kudu-arches']] as const
      for (const [geo, items, suffix] of kinds) {
        if (!items.length) continue
        const instances = new THREE.InstancedMesh(geo, stucco, items.length)
        instances.name = `${name}-${suffix}`
        instances.castShadow = false
        instances.receiveShadow = true
        items.forEach((item, index) => {
          dummy.position.set(item.x, item.y, item.z); dummy.rotation.set(0, item.rotY, 0); dummy.scale.set(item.w, item.h, item.d)
          dummy.updateMatrix(); instances.setMatrixAt(index, dummy.matrix)
          instances.setColorAt(index, pieceColor.set(item.color))
        })
        instances.instanceMatrix.needsUpdate = true
        if (instances.instanceColor) instances.instanceColor.needsUpdate = true
        parent.add(instances)
      }
    }
    // Architecture is painted in pastel (colour blended toward the stucco);
    // sculpted figures carry the saturated colour.
    const pastel = (hex: number, amount = .5): number => pieceColor.set(hex).lerp(new THREE.Color(0xeadfc4), amount).getHex()
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!
    type Place = (list: Piece[], along: number, out: number, y: number, pw: number, ph: number, pd: number, color: number) => void
    // A painted deity: garment, torso, arms, crowned head, optionally seated and haloed.
    const deity = (set: Dressing, at: Place, along: number, out: number, base: number, height: number, width: number, seated = false, halo = false): void => {
      const skin = pick(deitySkins), garment = pick(vivid)
      if (halo) at(set.arches, along, out - .03, base + height * .56, width * 1.25, height * .5, .45, gold)
      if (seated) {
        at(set.boxes, along, out, base + height * .12, width * 1.7, height * .24, .22, garment)
        at(set.boxes, along, out + .01, base + height * .4, width * .85, height * .32, .16, skin)
      } else {
        at(set.boxes, along, out, base + height * .22, width * 1.1, height * .44, .18, garment)
        at(set.boxes, along, out + .01, base + height * .54, width * .8, height * .24, .16, skin)
      }
      for (const side of [-1, 1]) at(set.boxes, along + side * width * .56, out + .01, base + height * (seated ? .38 : .5), width * .2, height * .3, .12, skin)
      at(set.boxes, along, out + .02, base + height * (seated ? .54 : .66), width * .95, height * .05, .14, gold)
      at(set.spheres, along, out + .03, base + height * .78, width * .78, width * .86, width * .7, skin)
      at(set.cones, along, out + .03, base + height * .78 + width * .72, width * .6, width * .8, width * .6, gold)
    }
    // One frustum tier spanning y0..y0+h with base w × d, centred at (0, cz), tapering by `taper`.
    const dressTier = (set: Dressing, tier: number, y0: number, h: number, w: number, d: number, cz = 0, taper = .1): void => {
      const k = Math.min(.95, h * .4)
      const midShrink = 1 - taper * .45
      const niche = nicheTones[tier % nicheTones.length]!
      const band = (y: number, height: number, color: number, grow = .1) => {
        const shrink = 1 - taper * ((y - y0) / h)
        set.boxes.push({ x: 0, y, z: cz, w: w * shrink + grow, h: height, d: d * shrink + grow, color, rotY: 0 })
      }
      band(y0 + Math.min(.08, h * .05), Math.min(.14, h * .09), pastel(vivid[(tier + 4) % vivid.length]!, .35), .16)
      band(y0 + h - .32, Math.min(.16, h * .1), vivid[(tier + 1) % vivid.length]!)
      const faces = [
        { nx: 0, nz: 1, tx: 1, tz: 0, length: w, half: d / 2, rotY: 0, doorway: true },
        { nx: 0, nz: -1, tx: -1, tz: 0, length: w, half: d / 2, rotY: Math.PI, doorway: true },
        { nx: 1, nz: 0, tx: 0, tz: -1, length: d, half: w / 2, rotY: Math.PI / 2, doorway: false },
        { nx: -1, nz: 0, tx: 0, tz: 1, length: d, half: w / 2, rotY: -Math.PI / 2, doorway: false },
      ]
      faces.forEach((face, faceIndex) => {
        const half = face.half * midShrink, len = face.length * midShrink
        const at: Place = (list, along, out, y, pw, ph, pd, color) => {
          list.push({ x: face.nx * (half + out) + face.tx * along, y, z: cz + face.nz * (half + out) + face.tz * along, w: pw, h: ph, d: pd, color, rotY: face.rotY })
        }
        const tone = vivid[(tier + 5 + faceIndex) % vivid.length]!
        // Central bay, projecting slightly: a doorway on the long faces, a shala pavilion on the short ones.
        const cw = Math.min(len * .3, h * 1.35)
        at(set.boxes, 0, .12, y0 + h * .46, cw, h * .84, .26, pastel(tone, .55))
        if (face.doorway) {
          at(set.boxes, 0, .26, y0 + h * .4, cw * .26, h * .5, .04, darkOpening)
          for (const side of [-1, 1]) {
            at(set.boxes, side * cw * .17, .28, y0 + h * .4, cw * .05, h * .56, .08, side < 0 ? 0x3f9aa0 : 0xd98a9a)
            at(set.boxes, side * cw * .46, .28, y0 + h * .44, cw * .04, h * .7, .08, pastel(vivid[(tier + 2) % vivid.length]!, .2))
            deity(set, at, side * cw * .31, .3, y0 + h * .1, h * .6, cw * .13, tier % 2 === 1)
          }
          at(set.boxes, 0, .28, y0 + h * .68, cw * .42, h * .05, .1, gold)
          at(set.arches, 0, .3, y0 + h * .72, cw * .2, h * .17, .5, pastel(vivid[(tier + 3) % vivid.length]!, .15))
          at(set.arches, 0, .31, y0 + h * .72, cw * .13, h * .11, .45, gold)
          at(set.spheres, 0, .33, y0 + h * .72 + h * .17, cw * .08, cw * .08, .1, gold)
        } else {
          const sw = cw * .7
          at(set.boxes, 0, .28, y0 + h * .38, sw * .5, h * .5, .04, niche)
          deity(set, at, 0, .3, y0 + h * .14, h * .52, sw * .2, false, true)
          at(set.vaults, 0, .2, y0 + h * .72, sw, h * .16, .3, pick(roofCorals))
          for (const f of [-1, 0, 1]) at(set.spheres, f * sw * .3, .2, y0 + h * .72 + h * .17, h * .06, h * .09, h * .06, gold)
        }
        // Corner kuta pavilions: pastel cell with a niche deity, stepped coloured dome and finial.
        for (const end of [-1, 1]) {
          const along = end * (len / 2 - k * .55)
          const kutaTone = vivid[(tier + faceIndex + (end > 0 ? 3 : 0)) % vivid.length]!
          const cellY = y0 + h * .16
          at(set.boxes, along, k * .18, cellY + k * .5, k, k, k * .7, pastel(kutaTone))
          at(set.boxes, along, k * .18 + k * .35, cellY + k * .5, k * .5, k * .7, .04, niche)
          deity(set, at, along, k * .18 + k * .38, cellY + k * .12, k * .62, k * .17)
          at(set.boxes, along, k * .18, cellY + k * 1.06, k * 1.12, k * .12, k * .82, pastel(kutaTone, .2))
          at(set.spheres, along, k * .18, cellY + k * 1.28, k * .72, k * .5, k * .6, kutaTone)
          at(set.cones, along, k * .18, cellY + k * 1.62, k * .14, k * .3, k * .14, gold)
        }
        // Between centre and corners: coral-roofed pavilions alternate with haloed niche deities.
        const segStart = cw / 2 + .05, segEnd = len / 2 - k * 1.1
        const unit = Math.max(.42, h * .3)
        const slots = Math.max(0, Math.floor((segEnd - segStart) / unit))
        const spread = slots ? (segEnd - segStart) / slots : unit
        for (const side of [-1, 1]) for (let index = 0; index < slots; index += 1) {
          const along = side * (segStart + spread * (index + .5))
          if (index % 3 === 1) {
            at(set.boxes, along, .1, y0 + h * .34, spread * .9, h * .5, .24, pastel(vivid[(tier + index) % vivid.length]!, .5))
            at(set.boxes, along, .23, y0 + h * .32, spread * .4, h * .3, .03, niche)
            deity(set, at, along, .24, y0 + h * .18, h * .28, spread * .17, true)
            at(set.vaults, along, .1, y0 + h * .6, spread * .9, h * .14, .2, pick(roofCorals))
            at(set.arches, along, .24, y0 + h * .47, spread * .22, h * .1, .4, gold)
          } else {
            at(set.boxes, along, .03, y0 + h * .44, spread * .82, h * .6, .06, niche)
            for (const edge of [-1, 1]) at(set.boxes, along + edge * spread * .44, .06, y0 + h * .44, spread * .1, h * .64, .14, edge < 0 ? 0x3f9aa0 : 0x4f8a4b)
            deity(set, at, along, .12, y0 + h * .15, h * .52, spread * .28, false, true)
          }
        }
        // Kudu-arch cornice: a row of small horseshoe arches along the projecting top band.
        const corniceOut = (face.half * 2 * .92 + .3) / 2 - half + .04
        const kuduPitch = Math.max(.45, h * .22)
        const kudus = Math.floor(len * .96 / kuduPitch)
        for (let index = 0; index < kudus; index += 1) {
          const along = (index - (kudus - 1) / 2) * kuduPitch
          at(set.arches, along, corniceOut, y0 + h - .2, kuduPitch * .3, kuduPitch * .34, .5, index % 2 ? gold : pastel(0x4f8a4b, .2))
        }
        // A frieze of small attendant figures along the tier's base.
        const ganaPitch = Math.max(.22, h * .12)
        const ganas = Math.floor(len * .92 / ganaPitch)
        for (let index = 0; index < ganas; index += 1) {
          const along = (index - (ganas - 1) / 2) * ganaPitch
          at(set.boxes, along, .1, y0 + h * .07, ganaPitch * .5, h * .09, .12, vivid[(index + tier) % vivid.length]!)
        }
      })
    }
    const gopurams: Array<{ name: string; x: number; z: number; rotationY: number; baseW: number; baseD: number; tiers: number; tierH: number }> = [
      { name: 'south', x: 0, z: maxZ - 1, rotationY: 0, baseW: 16, baseD: 9, tiers: 9, tierH: 2.35 },
      { name: 'north', x: 0, z: minZ + 1, rotationY: Math.PI, baseW: 13, baseD: 8, tiers: 7, tierH: 2.2 },
      { name: 'east', x: maxX - 1, z: 0, rotationY: Math.PI / 2, baseW: 13, baseD: 8, tiers: 7, tierH: 2.2 },
      { name: 'west', x: minX + 1, z: 0, rotationY: -Math.PI / 2, baseW: 13, baseD: 8, tiers: 7, tierH: 2.2 },
    ]
    for (const spec of gopurams) {
      const tower = new THREE.Group()
      tower.name = `campus-gopuram-${spec.name}`
      tower.position.set(spec.x, 0, spec.z)
      tower.rotation.y = spec.rotationY
      const { baseW, baseD } = spec
      const towerDressing = dressing()
      const passage = 4.4, baseH = 6.2, pierW = (baseW - passage) / 2
      for (const side of [-1, 1]) {
        const px = side * (passage / 2 + pierW / 2)
        block(tower, pierW + .4, .44, baseD + .4, px, .225, 0, graniteMid)
        block(tower, pierW, baseH, baseD, px, baseH / 2, 0, granite)
        block(tower, pierW + .2, .28, baseD + .2, px, 1.6, 0, graniteLight, 0, false)
        block(tower, pierW + .2, .28, baseD + .2, px, baseH - .5, 0, graniteLight, 0, false)
        for (const face of [-1, 1]) {
          const z = face * (baseD / 2 + .05)
          const placeBase: Place = (list, along, out, y, pw, ph, pd, color) => {
            list.push({ x: px + along, y, z: face * (baseD / 2 + out), w: pw, h: ph, d: pd, color, rotY: face > 0 ? 0 : Math.PI })
          }
          // Carved pilasters framing a painted deity in an arched niche on each pier face.
          for (const offset of [-.42, -.3, .3, .42]) block(tower, .22, baseH - 2.4, .16, px + offset * pierW, 3.4, z, carved, 0, false)
          placeBase(towerDressing.boxes, 0, .06, 3.2, 1.3, 2.7, .06, 0x2f4f78)
          placeBase(towerDressing.arches, 0, .1, 4.5, .7, .55, .5, gold)
          deity(towerDressing, placeBase, 0, .12, 1.95, 2.4, .42, false, false)
        }
      }
      block(tower, passage + .2, 1.5, baseD, 0, baseH - .75, 0, granite)
      // Gilded, carved door frame around the gate passage on both faces.
      for (const face of [-1, 1]) {
        const z = face * (baseD / 2 + .12)
        for (const side of [-1, 1]) {
          block(tower, .5, baseH - .9, .3, side * (passage / 2 + .2), (baseH - .9) / 2 + .3, z, gilt, 0, false)
          block(tower, .22, baseH - 1.2, .36, side * (passage / 2 + .52), (baseH - 1.2) / 2 + .3, z, carved, 0, false)
        }
        block(tower, passage + 1.1, .5, .32, 0, baseH - .55, z, gilt, 0, false)
        block(tower, passage + 1.5, .22, .38, 0, baseH - .18, z, carved, 0, false)
      }
      block(tower, baseW + .7, .42, baseD + .7, 0, baseH + .21, 0, graniteLight)

      const tiers = new THREE.InstancedMesh(tierGeo, stucco, spec.tiers)
      tiers.name = 'campus-gopuram-painted-tiers'
      tiers.castShadow = true; tiers.receiveShadow = true
      let tierY = baseH + .42
      let tierW = baseW - .4, tierD = baseD - .5
      const tierColor = new THREE.Color()
      for (let tier = 0; tier < spec.tiers; tier += 1) {
        dummy.position.set(0, tierY + spec.tierH / 2, 0); dummy.rotation.set(0, 0, 0)
        dummy.scale.set(tierW / Math.SQRT2, spec.tierH, tierD / Math.SQRT2)
        dummy.updateMatrix()
        tiers.setMatrixAt(tier, dummy.matrix)
        tiers.setColorAt(tier, tierColor.set(creams[tier % creams.length]!))
        stuccoBoxes.push({ x: 0, y: tierY + spec.tierH - .12, z: 0, w: tierW * .92 + .3, h: .22, d: tierD * .92 + .3, color: 0xeadfc4 })
        dressTier(towerDressing, tier, tierY, spec.tierH, tierW, tierD)
        tierY += spec.tierH
        tierW *= .92; tierD *= .9
      }
      tiers.instanceMatrix.needsUpdate = true
      if (tiers.instanceColor) tiers.instanceColor.needsUpdate = true
      tower.add(tiers)
      for (const item of stuccoBoxes.splice(0)) stoneBoxes.push({ ...item, ...rotateLocal(spec, item) })

      // Crown: scale-tiled barrel vault, a large kirtimukha arch on each long face,
      // curling makara horns at the ends and a row of stacked gilded kalashas.
      const crownLength = tierW * .95, crownRadius = Math.min(1.7, tierD * .55)
      const crownY = tierY + .3, crownTop = crownY + crownRadius * 1.25
      block(tower, crownLength + .3, .3, tierD + .1, 0, tierY + .15, 0, graniteLight)
      mesh(vaultGeo, scaleRoof(), tower, new THREE.Vector3(0, crownY, 0), undefined, new THREE.Vector3(crownLength, crownRadius * 1.25, crownRadius))
      towerDressing.boxes.push({ x: 0, y: crownY + .1, z: 0, w: crownLength + .2, h: .2, d: crownRadius * 2.1, color: gold, rotY: 0 })
      for (const face of [-1, 1]) {
        const placeCrown: Place = (list, along, out, y, pw, ph, pd, color) => {
          list.push({ x: along, y, z: face * (crownRadius + out), w: pw, h: ph, d: pd, color, rotY: face > 0 ? 0 : Math.PI })
        }
        placeCrown(towerDressing.arches, 0, -.1, crownY + .1, crownRadius * 1.05, crownRadius * 1.2, .8, 0x4f8a4b)
        placeCrown(towerDressing.arches, 0, -.05, crownY + .1, crownRadius * .85, crownRadius * .98, .7, gold)
        placeCrown(towerDressing.spheres, 0, -.15, crownY + crownRadius * .45, crownRadius * 1.1, crownRadius * 1.3, .2, 0x2f4f78)
        deity(towerDressing, placeCrown, 0, .02, crownY + .15, crownRadius * .85, crownRadius * .22, true, false)
        placeCrown(towerDressing.spheres, 0, .05, crownY + crownRadius * 1.28, crownRadius * .36, crownRadius * .32, .3, gold)
        for (const side of [-1, 1]) placeCrown(towerDressing.cones, side * crownRadius * .2, .05, crownY + crownRadius * 1.5, .12, .3, .12, gold)
        for (const side of [-1, 1]) {
          placeCrown(towerDressing.arches, side * crownLength * .3, -.05, crownY + .1, crownRadius * .3, crownRadius * .45, .5, gold)
          deity(towerDressing, placeCrown, side * crownLength * .3, 0, crownY + .12, crownRadius * .42, crownRadius * .08, true, false)
        }
      }
      for (const end of [-1, 1]) {
        const x = end * (crownLength / 2)
        towerDressing.boxes.push({ x: x - end * .1, y: crownY + crownRadius * .7, z: 0, w: .26, h: crownRadius * 1.4, d: .5, color: 0x4f8a4b, rotY: 0 })
        towerDressing.arches.push({ x: x + end * crownRadius * .35, y: crownY + crownRadius * 1.3, z: 0, w: crownRadius * .45, h: crownRadius * .5, d: 1.2, color: 0x4f8a4b, rotY: 0 })
        towerDressing.arches.push({ x: x + end * crownRadius * .35, y: crownY + crownRadius * 1.3, z: 0, w: crownRadius * .28, h: crownRadius * .3, d: 1, color: gold, rotY: 0 })
        towerDressing.spheres.push({ x: x + end * crownRadius * .78, y: crownY + crownRadius * 1.3, z: 0, w: .3, h: .3, d: .3, color: 0xc0443a, rotY: 0 })
      }
      const finials = spec.name === 'south' ? 11 : 9
      for (let index = 0; index < finials; index += 1) {
        const x = (index - (finials - 1) / 2) * (crownLength * .82 / (finials - 1))
        towerDressing.boxes.push({ x, y: crownTop + .08, z: 0, w: .34, h: .16, d: .34, color: gold, rotY: 0 })
        towerDressing.spheres.push({ x, y: crownTop + .38, z: 0, w: .44, h: .42, d: .44, color: gold, rotY: 0 })
        towerDressing.spheres.push({ x, y: crownTop + .72, z: 0, w: .28, h: .26, d: .28, color: gold, rotY: 0 })
        towerDressing.cones.push({ x, y: crownTop + 1.05, z: 0, w: .16, h: .42, d: .16, color: gold, rotY: 0 })
      }
      flushDressing(tower, towerDressing, 'campus-gopuram-sculpture')
      tower.userData.height = crownTop + 1.26
      group.add(tower)
    }

    // Outer prakaram wall broken only by the four gopuram passages, with a
    // lean-to cloister of pillars running along its inner face.
    const wallH = 4.4, wallT = 1.4, cloisterDepth = 3.6, cloisterH = 3.5
    const south = gopurams[0]!, side = gopurams[2]!
    const runs: Array<{ axis: 'x' | 'z'; fixed: number; from: number; to: number; inward: number }> = [
      { axis: 'x', fixed: maxZ - wallT / 2, from: minX, to: -south.baseW / 2, inward: -1 },
      { axis: 'x', fixed: maxZ - wallT / 2, from: south.baseW / 2, to: maxX, inward: -1 },
      { axis: 'x', fixed: minZ + wallT / 2, from: minX, to: -gopurams[1]!.baseW / 2, inward: 1 },
      { axis: 'x', fixed: minZ + wallT / 2, from: gopurams[1]!.baseW / 2, to: maxX, inward: 1 },
      { axis: 'z', fixed: maxX - wallT / 2, from: minZ, to: -side.baseW / 2, inward: -1 },
      { axis: 'z', fixed: maxX - wallT / 2, from: side.baseW / 2, to: maxZ, inward: -1 },
      { axis: 'z', fixed: minX + wallT / 2, from: minZ, to: -side.baseW / 2, inward: 1 },
      { axis: 'z', fixed: minX + wallT / 2, from: side.baseW / 2, to: maxZ, inward: 1 },
    ]
    for (const run of runs) {
      const length = run.to - run.from, mid = (run.from + run.to) / 2
      const place = (along: number, across: number): [number, number] => run.axis === 'x' ? [along, run.fixed + across] : [run.fixed + across, along]
      const size = (alongSize: number, acrossSize: number): [number, number] => run.axis === 'x' ? [alongSize, acrossSize] : [acrossSize, alongSize]
      const [wx, wz] = place(mid, 0), [ww, wd] = size(length, wallT)
      stoneBoxes.push({ x: wx, y: wallH / 2, z: wz, w: ww, h: wallH, d: wd, color: 0x9b876d })
      const [cw, cd] = size(length, wallT + .5)
      stoneBoxes.push({ x: wx, y: wallH + .14, z: wz, w: cw, h: .28, d: cd, color: 0xb29c7d })
      const merlons = Math.floor(length / 2.6)
      for (let index = 0; index < merlons; index += 1) {
        const [mx, mz] = place(run.from + (index + .5) * (length / merlons), 0), [mw, md] = size(.7, .9)
        stoneBoxes.push({ x: mx, y: wallH + .6, z: mz, w: mw, h: .64, d: md, color: 0xc0a985 })
      }
      // Cloister: roof slab from the wall to a pillar line, stopping short of the turrets and gopurams.
      const inset = wallT / 2 + cloisterDepth
      const cloisterFrom = run.from + (Math.abs(run.from) > 40 ? inset + 1 : 1.2)
      const cloisterTo = run.to - (Math.abs(run.to) > 40 ? inset + 1 : 1.2)
      const cloisterLength = cloisterTo - cloisterFrom
      if (cloisterLength > 3) {
        const [rx, rz] = place((cloisterFrom + cloisterTo) / 2, run.inward * (wallT / 2 + cloisterDepth / 2))
        const [rw, rd] = size(cloisterLength, cloisterDepth + .4)
        stoneBoxes.push({ x: rx, y: cloisterH + .16, z: rz, w: rw, h: .32, d: rd, color: 0xa99474 })
        const count = Math.max(2, Math.round(cloisterLength / 3.2))
        for (let index = 0; index <= count; index += 1) {
          const [px, pz] = place(cloisterFrom + index * (cloisterLength / count), run.inward * inset)
          cloisterPillars.push({ x: px, z: pz, radius: .26, height: cloisterH })
        }
      }
    }
    // Corner turrets with stepped pyramidal caps.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (maxX - 2.1), z = sz * (maxZ - 2.1)
      block(group, 4.6, 6.4, 4.6, x, 3.2, z, granite)
      block(group, 5.2, .35, 5.2, x, 6.55, z, graniteLight)
      mesh(cylinderGeometry(.35, 3.3, 3.2, 4), crownPaint, group, new THREE.Vector3(x, 8.3, z), new THREE.Euler(0, Math.PI / 4, 0))
      mesh(cylinderGeometry(.06, .18, .6, 8), gilt, group, new THREE.Vector3(x, 10.2, z))
    }

    // Subsidiary vimana shrines on the sanctuary axis, each inside its own low court.
    const shrine = (name: string, cx: number, cz: number, scale: number, tint: number) => {
      const s = new THREE.Group()
      s.name = `campus-shrine-${name}`
      s.position.set(cx, 0, cz); s.scale.setScalar(scale)
      block(s, 16, .3, 19, 0, .27, 0, graniteMid)
      for (const [w, d, x, z] of [[16, .8, 0, -9.1], [.8, 19, -7.6, 0], [.8, 19, 7.6, 0], [5.5, .8, -5.25, 9.1], [5.5, .8, 5.25, 9.1]] as const) block(s, w, 1.7, d, x, 1.15, z, granite)
      for (const layer of [[10, .3, 11, .55], [9.4, .3, 10.4, .85]] as const) block(s, layer[0], layer[1], layer[2], 0, layer[3], -1.2, graniteLight)
      block(s, 6.4, 3.2, 6.4, 0, 2.6, -2.2, granite)
      block(s, 1.3, 2.1, .2, 0, 2.05, 1.05, dark(), 0, false)
      block(s, 7.2, .3, 7.2, 0, 4.35, -2.2, graniteLight)
      const shrineTiers = new THREE.InstancedMesh(tierGeo, stucco, 6)
      shrineTiers.name = 'campus-shrine-tiers'
      shrineTiers.castShadow = true; shrineTiers.receiveShadow = true
      const shrineDressing = dressing()
      let y = 4.5, w = 6.6
      for (let tier = 0; tier < 6; tier += 1) {
        dummy.position.set(0, y + .75, -2.2); dummy.rotation.set(0, 0, 0); dummy.scale.set(w / Math.SQRT2, 1.5, w / Math.SQRT2)
        dummy.updateMatrix(); shrineTiers.setMatrixAt(tier, dummy.matrix)
        shrineTiers.setColorAt(tier, new THREE.Color(creams[tier % creams.length]!))
        block(s, w * .92 + .25, .16, w * .92 + .25, 0, y + 1.48, -2.2, carved, 0, false)
        dressTier(shrineDressing, tier + (tint & 3), y, 1.5, w, w, -2.2)
        y += 1.5; w *= .88
      }
      shrineTiers.instanceMatrix.needsUpdate = true
      if (shrineTiers.instanceColor) shrineTiers.instanceColor.needsUpdate = true
      s.add(shrineTiers)
      flushDressing(s, shrineDressing, 'campus-shrine-sculpture')
      mesh(cylinderGeometry(.9, 1.1, .6, 8), graniteMid, s, new THREE.Vector3(0, y + .3, -2.2))
      mesh(geometry('temple:rounded-octagonal-crown', () => new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), gilt, s, new THREE.Vector3(0, y + .6, -2.2), undefined, new THREE.Vector3(1.1, 1.3, 1.1))
      mesh(cylinderGeometry(.06, .2, .8, 8), gilt, s, new THREE.Vector3(0, y + 2.3, -2.2))
      // Pillared ardha-mandapa in front of the sanctum.
      block(s, 7.4, .35, 5.4, 0, .6, 3.3, graniteLight)
      for (const x of [-2.9, -1, 1, 2.9]) mesh(cylinderGeometry(.22, .26, 2.8, 8), granite, s, new THREE.Vector3(x, 2.15, 5.5))
      block(s, 7.8, .35, 5.8, 0, 3.7, 3.3, graniteMid)
      block(s, 7.2, .25, 5.2, 0, 4.0, 3.3, graniteLight)
      for (let step = 0; step < 3; step += 1) block(s, 3.2, .18, .5, 0, .6 - step * .18, 6.3 + step * .45, graniteLight)
      group.add(s)
    }
    shrine('amman', -33, -14, 1.2, 0x7f9d8d)
    shrine('subsidiary', 33, -34, .95, 0xb8704f)

    // Golden-lotus tank: stepped ghats descending inside a pillared parapet.
    const tank = { x: -30, z: 34, w: 24, d: 18 }
    for (let step = 0; step < 5; step += 1) {
      const inset = step * 1.3, h = 1.0 - step * .18
      const w = tank.w - inset * 2, d = tank.d - inset * 2
      const tone = step % 2 ? 0xb29c7d : 0x9b876d
      stoneBoxes.push(
        { x: tank.x, y: h / 2, z: tank.z - d / 2 + .65, w, h, d: 1.3, color: tone },
        { x: tank.x, y: h / 2, z: tank.z + d / 2 - .65, w, h, d: 1.3, color: tone },
        { x: tank.x - w / 2 + .65, y: h / 2, z: tank.z, w: 1.3, h, d: d - 2.6, color: tone },
        { x: tank.x + w / 2 - .65, y: h / 2, z: tank.z, w: 1.3, h, d: d - 2.6, color: tone },
      )
    }
    block(group, tank.w - 12.4, .1, tank.d - 12.4, tank.x, .2, tank.z, water, 0, false)
    mesh(cylinderGeometry(.35, .45, 1.6, 8), graniteLight, group, new THREE.Vector3(tank.x, 1.0, tank.z))
    mesh(sphereGeometry(.9, 12, 6), gilt, group, new THREE.Vector3(tank.x, 1.9, tank.z), undefined, new THREE.Vector3(1, .45, 1))
    for (let index = 0; index < 12; index += 1) {
      const t = index / 12, perimeter = 2 * (tank.w + tank.d), along = t * perimeter
      const [x, z] = along < tank.w ? [tank.x - tank.w / 2 + along, tank.z - tank.d / 2 - 1.2]
        : along < tank.w + tank.d ? [tank.x + tank.w / 2 + 1.2, tank.z - tank.d / 2 + (along - tank.w)]
        : along < 2 * tank.w + tank.d ? [tank.x + tank.w / 2 - (along - tank.w - tank.d), tank.z + tank.d / 2 + 1.2]
        : [tank.x - tank.w / 2 - 1.2, tank.z + tank.d / 2 - (along - 2 * tank.w - tank.d)]
      cloisterPillars.push({ x, z, radius: .22, height: 2.4 })
    }

    // Pillared hall: a dense grid of columns under a flat stone roof.
    const hall = { x: 31, z: 31, w: 22, d: 20 }
    for (let step = 0; step < 3; step += 1) block(group, hall.w + 1.8 - step * .6, .3, hall.d + 1.8 - step * .6, hall.x, .27 + step * .3, hall.z, step % 2 ? graniteLight : graniteMid)
    for (let col = 0; col < 8; col += 1) for (let row = 0; row < 7; row += 1) {
      hallPillars.push({ x: hall.x - hall.w / 2 + 1.2 + col * ((hall.w - 2.4) / 7), z: hall.z - hall.d / 2 + 1.2 + row * ((hall.d - 2.4) / 6), radius: .3, height: 4.2, y: 1.02 })
    }
    block(group, hall.w + .6, .45, hall.d + .6, hall.x, 5.45, hall.z, graniteMid)
    block(group, hall.w + 1.1, .25, hall.d + 1.1, hall.x, 5.8, hall.z, graniteLight)
    block(group, hall.w - 1, .6, hall.d - 1, hall.x, 6.2, hall.z, granite)

    // Gilded flagstaff and bali-pitha on the axis between the south gopuram and the sanctuary.
    const staffZ = sanctuaryFront + 7
    block(group, 2.4, .7, 2.4, 0, .5, staffZ, graniteLight)
    block(group, 1.6, .6, 1.6, 0, 1.15, staffZ, carved)
    mesh(cylinderGeometry(.16, .26, 11, 10), gilt, group, new THREE.Vector3(0, 6.9, staffZ))
    for (let ring = 0; ring < 3; ring += 1) mesh(torusGeometry(.3, .07, 6, 14), gilt, group, new THREE.Vector3(0, 11.6 + ring * .35, staffZ), new THREE.Euler(Math.PI / 2, 0, 0))
    mesh(cylinderGeometry(.9, 1.1, .9, 8), carved, group, new THREE.Vector3(0, .6, staffZ + 4.2))

    instancedBoxes(stoneBoxes, stucco, 'campus-walls-and-painted-detail')
    instancedPillars(cloisterPillars, granite, 'campus-cloister-pillars')
    instancedPillars(hallPillars, carved, 'campus-hall-pillars')
    batchStaticMeshes(group)
    group.userData.architecture = {
      tradition: 'Meenakshi-inspired walled prakaram around a Chola vimana',
      gopurams: gopurams.map(item => item.name),
      shrines: ['amman', 'subsidiary'],
      entrance: TEMPLE_CAMPUS.entrance,
    }
    return group

    function rotateLocal(spec: { x: number; z: number; rotationY: number }, item: Box): Pick<Box, 'x' | 'z' | 'w' | 'd'> {
      const cos = Math.cos(spec.rotationY), sin = Math.sin(spec.rotationY)
      const quarter = Math.abs(Math.round(sin)) === 1
      return {
        x: spec.x + item.x * cos + item.z * sin,
        z: spec.z - item.x * sin + item.z * cos,
        w: quarter ? item.d : item.w,
        d: quarter ? item.w : item.d,
      }
    }
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
    const robe = [0xb57e46, 0xa9533b, 0x6f7950, 0x485e68][Math.floor(rng() * 4)]!
    const sash = [0x9d4738, 0xd5b85d, 0x3d7772, 0xb7d2c5][Math.floor(rng() * 4)]!
    const look: ArtisanLook = {
      key: `resident-agent-${hashSeed(seed)}`, name: 'Town agent', craft: 'builder', epithet: 'Town resident', form: 'human',
      robe, sash, skin: [0x895b3e, 0x9a6947, 0x764b35, 0x8f6045][Math.floor(rng() * 4)]!,
      headgear: (['headcloth', 'turban', 'topknot', 'bun'] as const)[Math.floor(rng() * 4)]!, prop: 'pouch',
    }
    const body = new THREE.Group()
    body.name = 'workerBody'
    group.add(body)
    createHumanArtisan(look, body, { statusLamp: false, noCraftProp: true, decorativeTextile: true })
    group.userData.body = body
    group.userData.leftArm = body.userData.leftArm
    group.userData.rightArm = body.userData.rightArm
    group.userData.legs = body.userData.legs
    group.userData.arms = body.userData.arms
    group.userData.animationTargets = { leftArm: body.userData.leftArm, rightArm: body.userData.rightArm }
    batchAvatarDetails(group, [body, body.userData.leftArm, body.userData.rightArm, ...(body.userData.legs as THREE.Group[] ?? [])])
    return group
  }

  function createTownsperson(seed: number | string): THREE.Group {
    const rng = randomFor(`townsperson:${seed}`)
    const group = new THREE.Group()
    group.name = 'Townsperson'
    group.userData.assetKind = 'townsperson'
    group.userData.seed = String(seed)
    group.userData.townsperson = true
    const robes = [0x9c493d, 0x476b62, 0xb27c3f, 0x77749a, 0x557b88, 0x9b7049, 0x6d7b49]
    const sashes = [0xe4c66a, 0xd58e62, 0x83b5a9, 0xe1d5b9, 0xb95b4c]
    const skinTones = [0x68432f, 0x80543a, 0x956543, 0xa87551, 0x74503b]
    const gear = ['headcloth', 'turban', 'topknot', 'bun'] as const
    const look: ArtisanLook = {
      key: `townsperson-${hashSeed(seed)}`, name: 'Townsperson', craft: 'builder', epithet: 'A neighbour from town',
      form: 'human', robe: robes[Math.floor(rng() * robes.length)]!, sash: sashes[Math.floor(rng() * sashes.length)]!,
      skin: skinTones[Math.floor(rng() * skinTones.length)]!, headgear: gear[Math.floor(rng() * gear.length)]!, prop: 'pouch',
      beard: rng() > .72,
    }
    const body = new THREE.Group()
    body.name = 'townspersonBody'
    group.add(body)
    createHumanArtisan(look, body, { statusLamp: false, noCraftProp: true, decorativeTextile: true })
    addEverydayCarry(body, seed, rng() > .42)
    group.userData.body = body
    group.userData.leftArm = body.userData.leftArm
    group.userData.rightArm = body.userData.rightArm
    group.userData.legs = body.userData.legs
    group.userData.arms = body.userData.arms
    group.userData.animationTargets = { leftArm: body.userData.leftArm, rightArm: body.userData.rightArm }
    batchAvatarDetails(group, [body, body.userData.leftArm, body.userData.rightArm, ...(body.userData.legs as THREE.Group[] ?? []), body.getObjectByName('satchel') as THREE.Group | undefined])
    return group
  }

  function addEverydayCarry(body: THREE.Group, seed: number | string, basket: boolean): void {
    const rng = randomFor(`carry:${seed}`)
    const leather = mat('town-resident-leather', 0x75482b, .97)
    const reed = mat('town-resident-reed', 0xb18a4e, .98)
    const green = mat('town-resident-greens', 0x69814d, .98)
    const bag = new THREE.Group()
    bag.name = 'satchel'
    bag.position.set(.24, 1.0, -.23)
    bag.rotation.z = -.14
    body.add(bag)
    round(bag, .16, 0, 0, 0, leather, [1, 1.25, .6])
    mesh(torusGeometry(.12, .018, 4, 10), mat('town-resident-bag-stitch', 0xd1b375, .93), bag, new THREE.Vector3(0, .02, .09), undefined, undefined, false)
    if (basket) {
      const holder = body.userData.rightArm as THREE.Group
      const bowl = mesh(cylinderGeometry(.17, .11, .15, 9, true), reed, holder, new THREE.Vector3(.04, -.82, .14), undefined, undefined, false)
      bowl.name = 'marketBasket'
      for (let index = 0; index < 5; index += 1) {
        const angle = index * Math.PI * 2 / 5
        round(holder, .07, .04 + Math.cos(angle) * .09, -.70 + rng() * .035, .14 + Math.sin(angle) * .07,
          index % 2 ? green : mat('town-resident-fruit', 0xd69439, .89), [.9, .75, .9], false)
      }
    }
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
    const footprints: Partial<Record<TownPropKind, [number, number, number]>> = {
      awning: [3.6, 2.1, 2.65], bench: [1.9, .68, 1.2], workstation: [2.1, 1.35, 1.65],
      'tool-rack': [1.1, .55, 1.72], 'queue-board': [1.45, .34, 1.98], 'question-pennant': [.84, .52, 2.45],
      'archive-shelf': [1.6, .62, 1.95], 'archive-crate': [.95, .85, .85],
      'crop-row': [2.8, 1.25, .82], grove: [3.4, 3.4, 3.5],
      'irrigation-channel': [4, 1.05, .5], pond: [2.8, 2.2, .36],
    }
    const footprint = footprints[kind]
    if (footprint) group.userData.assetDimensions = { width: footprint[0], depth: footprint[1], height: footprint[2] }
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
    } else if (kind === 'awning') {
      const wood = timber(Math.floor(rng() * color.wood.length))
      const cloth = [mat('awning-indigo', 0x526b62, .96), mat('awning-madder', 0xa7543b, .96), mat('awning-unbleached-cotton', 0xd6c49c, .98)]
      const width = 3.5, depth = 2.0, eaveY = 2.13
      for (const x of [-1.58, 1.58]) for (const z of [-.82, .82]) {
        block(group, .13, eaveY, .13, x, eaveY / 2, z, wood)
        block(group, .23, .10, .23, x, eaveY + .02, z, timber(1), 0, false)
      }
      block(group, width, .12, .14, 0, eaveY, -.82, wood)
      block(group, width, .12, .14, 0, eaveY, .82, wood)
      // Narrow cloth bands make the shade read as a handwoven market awning.
      for (let index = 0; index < 9; index += 1) {
        const stripeWidth = width / 9 + .008
        const x = (index - 4) * width / 9
        const slope = index % 2 ? -.035 : .035
        block(group, stripeWidth, .075, depth, x, 2.46 + slope, 0, cloth[(index + Math.floor(rng() * cloth.length)) % cloth.length], 0, false)
      }
      block(group, width + .04, .09, .16, 0, 2.38, .98, wood, 0, false)
    } else if (kind === 'bench') {
      const wood = timber(Math.floor(rng() * color.wood.length))
      const seatY = .52 + rng() * .035
      for (const x of [-.76, .76]) {
        block(group, .13, seatY, .13, x, seatY / 2, 0, wood)
        block(group, .10, .54, .10, x, .91, -.20, timber(0))
        block(group, .20, .10, .62, x, .14, 0, timber(1), 0, false)
      }
      for (let index = 0; index < 4; index += 1) block(group, 1.82, .095, .13, 0, seatY, -.22 + index * .145, index % 2 ? wood : timber(1), 0, false)
      block(group, 1.74, .11, .14, 0, .93, -.20, wood, -.08, false)
      for (const x of [-.55, 0, .55]) block(group, .09, .48, .09, x, .71, -.20, timber(1), -.08, false)
    } else if (kind === 'workstation') {
      const wood = timber(Math.floor(rng() * color.wood.length))
      block(group, 1.9, .14, 1.15, 0, .91, 0, wood)
      for (const x of [-.78, .78]) for (const z of [-.42, .42]) block(group, .12, .86, .12, x, .46, z, timber(1))
      block(group, 1.58, .11, .11, 0, .35, -.40, timber(0), 0, false)
      // Work surface carries a small mallet, chisel and a coil of measuring cord.
      block(group, .52, .16, .30, -.46, 1.06, .04, stone(1), .08, false)
      block(group, .34, .055, .08, .42, 1.02, -.12, brass(), .18, false)
      block(group, .10, .33, .10, .56, 1.18, -.12, timber(0), .18, false)
      mesh(torusGeometry(.16, .025, 5, 14), timber(1), group, new THREE.Vector3(.18, 1.04, .30), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      block(group, .42, .08, .22, .52, 1.05, .28, mat('workstation-wood-shavings', 0xc3a46e, .99), -.12, false)
    } else if (kind === 'tool-rack') {
      const wood = timber(0)
      for (const x of [-.43, .43]) block(group, .10, 1.65, .10, x, .825, 0, wood)
      for (const y of [.22, .72, 1.28, 1.64]) block(group, 1.0, .10, .13, 0, y, 0, timber(1))
      const toolMetal = mat('forged-tool-iron', 0x51483a, .7, .16)
      for (let index = 0; index < 4; index += 1) {
        const x = -.30 + index * .20
        block(group, .055, .60 + rng() * .18, .055, x, 1.07, .10, timber(index % 3), (rng() - .5) * .10, false)
        block(group, .32, .07, .065, x + (index % 2 ? .04 : -.04), 1.37, .10, toolMetal, (index % 2 ? 1 : -1) * .20, false)
      }
      block(group, .25, .075, .12, -.20, .29, .02, brass(), 0, false)
      block(group, .19, .06, .10, .19, .29, .02, stone(1), 0, false)
    } else if (kind === 'queue-board') {
      const wood = timber(1), darkBoard = mat('queue-board-writing-surface', 0x3f4235, .98)
      block(group, 1.33, 1.24, .12, 0, 1.15, 0, wood)
      block(group, 1.12, .94, .035, 0, 1.12, .078, darkBoard, 0, false)
      for (const x of [-.59, .59]) {
        block(group, .09, 1.87, .09, x, .94, -.03, timber(0))
        block(group, .17, .11, .22, x, .06, -.03, stone(1), 0, false)
      }
      block(group, 1.42, .20, .20, 0, 1.86, 0, timber(0))
      // Pale chalk strokes suggest numbered turns and open questions without text glyphs.
      for (let index = 0; index < 4; index += 1) {
        const y = .80 + index * .20
        block(group, .50 + rng() * .14, .035, .018, -.22 + rng() * .11, y, .105, mat(`queue-chalk-${index % 2}`, index % 2 ? 0xe2d6b3 : 0xc8a96e, .99), 0, false)
      }
      for (let index = 0; index < 3; index += 1) block(group, .055, .055, .025, .43, .80 + index * .20, .11, brass(), 0, false)
    } else if (kind === 'question-pennant') {
      const flagShape = new THREE.Shape()
      flagShape.moveTo(0, 0); flagShape.lineTo(.49, 0); flagShape.lineTo(.40, -.21); flagShape.lineTo(.49, -.43); flagShape.lineTo(0, -.43); flagShape.closePath()
      const flagGeometry = geometry('question-pennant-cloth', () => new THREE.ShapeGeometry(flagShape))
      block(group, .12, 2.30, .12, -.31, 1.15, 0, timber(0))
      block(group, .20, .12, .20, -.31, .08, 0, stone(1), 0, false)
      block(group, .76, .08, .07, .08, 2.20, 0, timber(1), 0, false)
      const clothMesh = mesh(flagGeometry, mat('question-pennant-cloth', 0xc29343, .96), group, new THREE.Vector3(-.22, 2.13, .045), undefined, undefined, false)
      clothMesh.userData.assetFeature = 'question-pennant'
      mesh(torusGeometry(.068, .028, 5, 12), brass(), group, new THREE.Vector3(.015, 1.98, .09), undefined, undefined, false)
      block(group, .05, .10, .05, .015, 1.85, .09, brass(), 0, false)
      round(group, .03, .015, 1.77, .09, brass(), [1, 1, 1], false)
    } else if (kind === 'archive-shelf') {
      const frame = timber(0), leaf = mat('palm-leaf-manuscript', 0x9d865c, .99)
      for (const x of [-.67, .67]) block(group, .11, 1.78, .38, x, .89, 0, frame)
      for (const y of [.08, .62, 1.18, 1.74]) block(group, 1.48, .10, .52, 0, y, 0, timber(1))
      for (const level of [0, 1, 2]) {
        const count = level === 2 ? 3 : 4
        for (let index = 0; index < count; index += 1) {
          const width = .24 + rng() * .09
          const x = (index - (count - 1) / 2) * .31
          const y = .27 + level * .55
          block(group, width, .31, .34, x, y, .01, leaf, (rng() - .5) * .04, false)
          block(group, width * .70, .035, .018, x, y, .19, mat(`manuscript-tie-${index % 2}`, 0x774538, .94), 0, false)
        }
      }
      block(group, 1.60, .13, .62, 0, 1.84, 0, frame)
    } else if (kind === 'archive-crate') {
      const wood = timber(1)
      block(group, .82, .63, .70, 0, .38, 0, wood)
      for (const z of [-.36, .36]) for (let index = 0; index < 4; index += 1) {
        block(group, .80, .10, .07, 0, .15 + index * .15, z, timber(index % 2), 0, false)
      }
      for (const x of [-.39, .39]) block(group, .07, .68, .73, x, .39, 0, timber(0), 0, false)
      block(group, .88, .10, .76, 0, .76, 0, timber(0), -.06, false)
      block(group, .25, .15, .025, 0, .44, .404, mat('archive-crate-seal', 0xb68a4b, .62, .16), 0, false)
    } else if (kind === 'crop-row') {
      const stalk = mat('young-paddy-stalk', 0x58733f, .98)
      const blade = mat('young-paddy-leaf', 0x76904c, .98)
      const grain = mat('paddy-panicle', 0xc2a454, .98)
      const rows = 4
      for (let row = 0; row < rows; row += 1) {
        const z = (row - (rows - 1) / 2) * .25
        for (let index = 0; index < 8; index += 1) {
          const x = (index - 3.5) * .29 + (rng() - .5) * .06
          const height = .43 + rng() * .24
          block(group, .035, height, .035, x, height / 2, z, stalk, (rng() - .5) * .12, false)
          for (const side of [-1, 1]) {
            const bladeHeight = .38 + rng() * .12
            block(group, .035, bladeHeight, .035, x + side * .10, bladeHeight / 2 + .02, z + side * .035, blade, side * (.34 + rng() * .20), false)
          }
          if (rng() > .25) round(group, .045, x + .025, height + .055, z, grain, [.72, 1.5, .72], false)
        }
      }
    } else if (kind === 'grove') {
      const bark = mat('areca-bark', 0x72583b, .99)
      const leaf = [mat('areca-leaf-deep', 0x4f6e3d, 1), mat('areca-leaf-sunlit', 0x71864a, 1)]
      const positions = [[-.72, -.62], [.58, -.48], [-.10, .60], [.82, .62]] as const
      positions.forEach(([x, z], index) => {
        const height = 2.35 + rng() * .72
        const lean = (rng() - .5) * .18
        cylinderBetween(group, new THREE.Vector3(x, .12, z), new THREE.Vector3(x + lean, height + .12, z), .11, .075, bark, 7, false)
        round(group, .12, x + lean, height + .12, z, mat('areca-crown', 0x9c7c43, .95), [1, .62, 1], false)
        for (let frond = 0; frond < 6; frond += 1) {
          const angle = frond * Math.PI / 3 + index * .4
          const length = .92 + rng() * .18
          const segment = block(group, length, .055, .07, x + lean + Math.cos(angle) * length * .42, height + .06 - length * .27, z + Math.sin(angle) * length * .42, leaf[frond % 2], -angle, false)
          segment.rotation.z = -.48 + rng() * .12
        }
      })
    } else if (kind === 'irrigation-channel') {
      const bank = stone(1), edge = mat('canal-cut-earth', 0x8e7954, .99), water = mat('irrigation-water', 0x628d89, .36, .04)
      block(group, 4.0, .17, .82, 0, .085, 0, edge, 0, false)
      block(group, 4.0, .12, .56, 0, .15, 0, water, 0, false)
      for (const z of [-.38, .38]) {
        block(group, 4.0, .16, .20, 0, .18, z, bank, 0, false)
        for (let index = 0; index < 7; index += 1) {
          const x = (index - 3) * .57
          block(group, .055 + rng() * .05, .20 + rng() * .12, .045, x, .29, z * 1.28, edge, (rng() - .5) * .08, false)
        }
      }
    } else if (kind === 'pond') {
      const water = mat('village-pond-water', 0x648d88, .31, .06)
      const shore = [stone(0), stone(1), mat('pond-shore-earth', 0x8a805d, .99)]
      mesh(cylinderGeometry(1.0, 1.0, .10, 24), water, group, new THREE.Vector3(0, .08, 0), undefined, new THREE.Vector3(1.30, 1, .98), false)
      for (let index = 0; index < 16; index += 1) {
        const angle = index * Math.PI * 2 / 16 + (rng() - .5) * .11
        const radius = .78 + rng() * .12
        const x = Math.cos(angle) * radius * 1.18, z = Math.sin(angle) * radius * .88
        const size = .16 + rng() * .07
        round(group, size, x, .18, z, shore[index % shore.length], [1.35, .48 + rng() * .3, .9], false)
      }
      for (let index = 0; index < 3; index += 1) {
        const x = -.72 + index * .17, z = .17 + index * .24
        round(group, .12, x, .145, z, mat(`pond-lily-${index % 2}`, index % 2 ? 0x6f8245 : 0x87904e, .95), [1.4, .18, 1], false)
        round(group, .045, x, .18, z, mat('pond-lily-flower', 0xe0c47d, .83), [1, .45, 1], false)
      }
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


  function artisanLampMaterial(lamp: ArtisanLamp): THREE.MeshStandardMaterial {
    const hex = LAMP_COLOR[lamp]
    return mat(`artisan-lamp-${lamp}`, hex, .4, 0, { color: hex, intensity: lamp === 'unknown' ? .5 : 2.6 })
  }

  function limb(parent: THREE.Object3D, name: string, x: number, y: number, z: number, swing: number): THREE.Group {
    const joint = new THREE.Group()
    joint.name = name
    joint.position.set(x, y, z)
    joint.userData.swing = swing
    parent.add(joint)
    return joint
  }

  function addStatusLamp(group: THREE.Group, height: number): void {
    const lamp = new THREE.Group()
    lamp.name = 'statusLamp'
    lamp.position.set(0, height, 0)
    const bronze = mat('lamp-bronze', 0x87633b, .48, .58)
    mesh(cylinderGeometry(.16, .07, .09, 10), bronze, lamp, new THREE.Vector3(0, 0, 0), undefined, undefined, false)
    const flame = mesh(sphereGeometry(.11, 8, 6), artisanLampMaterial('idle'), lamp, new THREE.Vector3(0, .15, 0), undefined, new THREE.Vector3(.8, 1.45, .8), false)
    flame.name = 'lampFlame'
    group.add(lamp)
    group.userData.lampFlame = flame
    group.userData.statusLamp = lamp
  }

  function addOrderLeaf(hand: THREE.Object3D, y: number): void {
    const leaf = block(hand, .09, .03, .52, 0, y, .12, mat('palm-leaf-order', 0xd9c27a, .9), 0, false)
    leaf.name = 'orderLeaf'
    leaf.rotation.x = -.35
    leaf.visible = false
  }

  function addCraftProp(hand: THREE.Object3D, look: ArtisanLook, y: number): void {
    const wood = timber(1), metal = mat('artisan-bronze', 0x9a7443, .42, .6)
    const prop = new THREE.Group()
    prop.name = 'craftProp'
    prop.position.set(0, y, .06)
    hand.add(prop)
    switch (look.prop) {
      case 'mallet':
        mesh(cylinderGeometry(.03, .03, .5, 6), wood, prop, new THREE.Vector3(0, -.12, .05), new THREE.Euler(.4, 0, 0))
        block(prop, .26, .16, .16, 0, -.36, .15, timber(2))
        break
      case 'chisel':
        block(prop, .05, .34, .05, 0, -.14, .04, metal)
        break
      case 'ledger':
        block(prop, .26, .06, .34, 0, -.04, .10, mat('ledger-cover', 0x7a3b25, .9))
        break
      case 'plan-scroll':
        mesh(cylinderGeometry(.05, .05, .55, 8), mat('plan-scroll', 0xe7dcc0, .9), prop, new THREE.Vector3(0, -.05, .1), new THREE.Euler(0, 0, Math.PI / 2))
        break
      case 'stylus':
      case 'leaf':
        block(prop, .08, .02, .46, 0, -.04, .16, mat('palm-leaf', 0xcdb46e, .9), 0, false)
        if (look.prop === 'stylus') mesh(cylinderGeometry(.012, .012, .3, 5), metal, prop, new THREE.Vector3(.08, -.02, .12), new THREE.Euler(1.2, 0, 0), undefined, false)
        break
      case 'gnomon':
        for (const [rx, rz] of [[Math.PI / 2, 0], [0, 0], [0, Math.PI / 2]] as const) mesh(torusGeometry(.16, .015, 4, 18), metal, prop, new THREE.Vector3(0, -.02, .16), new THREE.Euler(rx, 0, rz), undefined, false)
        break
      case 'pouch':
        round(prop, .12, 0, -.1, .06, mat('leather-pouch', 0x6a4328, .95), [1, 1.2, .8])
        break
      case 'tusk':
        mesh(cylinderGeometry(.015, .05, .34, 6), mat('ivory', 0xf1ead7, .7), prop, new THREE.Vector3(0, -.08, .1), new THREE.Euler(1.1, 0, 0))
        break
      case 'bell':
        break
    }
  }

  function addHeadgear(group: THREE.Group, look: ArtisanLook, headY: number, radius: number): void {
    const gold = mat('artisan-gold', 0xd6a83c, .38, .7)
    const hair = mat('worker-hair', 0x27221d, .99)
    switch (look.headgear) {
      case 'crown':
        mesh(cylinderGeometry(radius * .62, radius * .92, radius * 1.2, 10), gold, group, new THREE.Vector3(0, headY + radius * 1.05, 0))
        mesh(cylinderGeometry(.015, radius * .45, radius * .7, 8), gold, group, new THREE.Vector3(0, headY + radius * 1.95, 0))
        break
      case 'turban':
        round(group, radius * 1.08, 0, headY + radius * .55, -.01, mat(`turban-${look.sash}`, look.sash, .95), [1, .62, 1])
        break
      case 'topknot':
        round(group, radius * 1.01, 0, headY + radius * .25, -.02, hair, [1, .55, .95], false)
        round(group, radius * .4, 0, headY + radius * 1.0, -.06, hair)
        break
      case 'bun':
        round(group, radius * 1.02, 0, headY + radius * .2, -.02, hair, [1, .6, .96], false)
        round(group, radius * .45, 0, headY + radius * .15, -radius * .95, hair)
        mesh(torusGeometry(radius * .45, .02, 4, 12), gold, group, new THREE.Vector3(0, headY + radius * .15, -radius * .9), undefined, undefined, false)
        break
      case 'tuft':
        mesh(cylinderGeometry(.03, .05, radius * .9, 6), hair, group, new THREE.Vector3(0, headY + radius * 1.2, -radius * .35), new THREE.Euler(-.5, 0, 0), undefined, false)
        break
      case 'headcloth':
        round(group, radius * 1.03, 0, headY + radius * .35, -.01, mat(`headcloth-${look.sash}`, look.sash, .97), [1, .5, 1])
        break
    }
    if (look.beard) round(group, radius * .62, 0, headY - radius * .7, radius * .5, mat('artisan-beard', 0xe7e1d6, .99), [1, 1.2, .7], false)
  }

  interface HumanBuildOptions { statusLamp?: boolean; noCraftProp?: boolean; decorativeTextile?: boolean }

  function createHumanArtisan(look: ArtisanLook, group: THREE.Group, options: HumanBuildOptions = {}): void {
    const skin = mat(`artisan-skin-${look.skin}`, look.skin, .92)
    const robe = mat(`artisan-robe-${look.robe}`, look.robe, .94)
    const sash = mat(`artisan-sash-${look.sash}`, look.sash, .9)
    const hair = mat('worker-hair', 0x27221d, .99)
    const highlight = mat('artisan-cotton-edge', 0xe9d8b5, .92)
    const ganesha = look.form === 'ganesha'
    const girth = ganesha ? 1.28 : 1
    mesh(cylinderGeometry(.24 * girth, .36 * girth, .70, 10), robe, group, new THREE.Vector3(0, 1.08, 0))
    if (ganesha) round(group, .36, 0, 1.0, .08, robe, [1, .9, 1])
    mesh(cylinderGeometry(.30 * girth, .34 * girth, .26, 10), sash, group, new THREE.Vector3(0, .78, 0))
    const hem = mesh(cylinderGeometry(.335 * girth, .35 * girth, .055, 12), highlight, group, new THREE.Vector3(0, .638, 0), undefined, undefined, false)
    hem.name = 'robeHem'
    const collar = mesh(torusGeometry(.145 * girth, .022, 5, 16), highlight, group, new THREE.Vector3(0, 1.42, .055), new THREE.Euler(Math.PI / 2.6, 0, 0), undefined, false)
    collar.name = 'collar'
    // A second fold gives the draped cloth a visible edge at walking-camera range.
    const fold = block(group, .055, .66, .035, -.055, 1.09, .255 * girth, highlight, 0, false)
    fold.name = 'uttariyaEdge'
    fold.rotation.z = -.55
    // Uttariya (upper cloth) across the chest.
    block(group, .08, .78, .05, 0, 1.12, .23 * girth, sash, 0, false).rotation.z = -.55
    const headY = ganesha ? 1.72 : 1.60
    const headRadius = ganesha ? .30 : .22
    round(group, headRadius, 0, headY, 0, skin, ganesha ? [1.05, 1, 1] : [1, 1.05, .92])
    if (ganesha) {
      for (const side of [-1, 1]) {
        const ear = round(group, .24, side * .31, headY + .02, -.02, skin, [.18, 1, .9], false)
        ear.rotation.y = side * .35
      }
      let previous = new THREE.Vector3(0, headY - .06, .25)
      for (const [index, point] of [[0, headY - .32, .34], [.04, headY - .58, .36], [.12, headY - .74, .26]].entries()) {
        const next = new THREE.Vector3(...(point as [number, number, number]))
        cylinderBetween(group, previous, next, .085 - index * .018, .07 - index * .018, skin, 8)
        previous = next
      }
    } else {
      // Hairline, ears and layered eyes give the face a readable profile in the
      // third-person camera without adding a texture or a per-frame cost.
      round(group, headRadius * .96, 0, headY + headRadius * .49, -.045, hair, [1, .52, .9], false)
      for (const side of [-1, 1]) {
        round(group, .039, side * .078, headY + .025, headRadius * .88, mat('artisan-eye-ivory', 0xf3e9d6, .84), [1.15, .78, .4], false)
        const eye = round(group, .020, side * .078, headY + .025, headRadius * 1.01, mat('artisan-eye-dark', 0x29231f, .84), [1.1, .8, .42], false)
        eye.name = side < 0 ? 'leftEye' : 'rightEye'
        const brow = block(group, .075, .018, .026, side * .078, headY + .083, headRadius * .89, hair, 0, false)
        brow.rotation.z = -side * .11
        round(group, .07, side * headRadius * .91, headY - .015, 0, skin, [.33, .66, .72], false)
      }
      for (const side of [-1, 1]) {
        const sideLock = round(group, .09, side * headRadius * .82, headY + .015, -.015, hair, [.5, 1.2, .8], false)
        sideLock.name = side < 0 ? 'leftHairLock' : 'rightHairLock'
      }
      const nose = round(group, .035, 0, headY - .035, headRadius * 1.02, skin, [.68, 1.22, .7], false)
      nose.name = 'nose'
      const bridge = mesh(cylinderGeometry(.018, .027, .10, 6), skin, group, new THREE.Vector3(0, headY + .005, headRadius * 1.02), undefined, undefined, false)
      bridge.name = 'noseBridge'
      for (const side of [-1, 1]) {
        round(group, .063, side * .11, headY - .04, headRadius * .66, skin, [.66, .58, .38], false).name = side < 0 ? 'leftCheek' : 'rightCheek'
        const earRing = mesh(torusGeometry(.034, .009, 4, 8), mat('artisan-earring-gold', 0xb89654, .45, .45), group,
          new THREE.Vector3(side * headRadius * 1.04, headY - .08, .006), undefined, undefined, false)
        earRing.name = side < 0 ? 'leftEarring' : 'rightEarring'
      }
      const mouth = block(group, .075, .013, .012, 0, headY - .11, headRadius * .9, mat('artisan-mouth', 0x673c32, .97), 0, false)
      mouth.name = 'mouth'
      if (look.beard) round(group, .13, 0, headY - .16, .105, hair, [1, .52, .8], false)
    }
    addHeadgear(group, look, headY, headRadius)
    if (!ganesha) {
      const neck = mesh(cylinderGeometry(.085, .105, .19, 8), skin, group, new THREE.Vector3(0, 1.48, 0), undefined, undefined, false)
      neck.name = 'neck'
      const hairStrands = new THREE.InstancedMesh(boxGeometry(.018, .11, .015), hair, 5)
      hairStrands.name = 'hairStrands'
      const strand = new THREE.Object3D()
      for (let index = 0; index < 5; index += 1) {
        strand.position.set((index - 2) * .043, headY + .10 + (index % 2) * .016, headRadius * .78)
        strand.rotation.set(0, 0, (index - 2) * -.12); strand.scale.set(1, 1, 1); strand.updateMatrix(); hairStrands.setMatrixAt(index, strand.matrix)
      }
      hairStrands.instanceMatrix.needsUpdate = true; hairStrands.castShadow = false; group.add(hairStrands)
    }
    if (options.decorativeTextile) {
      // Contrasting collar, crossed shoulder drape, waist wrap and restrained
      // border stitches add cloth structure while keeping each decorative run
      // in one instanced draw per articulated torso.
      const border = mat(`human-textile-border-${look.sash}`, look.sash, .86)
      const thread = mat('human-embroidered-thread', 0xe7d6aa, .9)
      mesh(torusGeometry(.18 * girth, .022, 5, 16), border, group, new THREE.Vector3(0, 1.40, .035), new THREE.Euler(Math.PI / 2.5, 0, 0), undefined, false).name = 'wovenCollar'
      const drape = block(group, .13, .78, .055, -.075, 1.12, .225 * girth, sash, 0, false)
      drape.name = 'drapedShoulderCloth'
      drape.rotation.z = -.52
      block(group, .08, .58, .035, -.10, 1.10, .268 * girth, thread, 0, false).rotation.z = -.52
      const waist = mesh(torusGeometry(.31 * girth, .025, 5, 20), border, group, new THREE.Vector3(0, .78, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      waist.name = 'waistCord'
      const stitchGeo = sphereGeometry(.018, 6, 4)
      const stitches = new THREE.InstancedMesh(stitchGeo, thread, 12)
      stitches.name = 'embroideredSashStitches'
      const stamp = new THREE.Object3D()
      for (let index = 0; index < 12; index += 1) {
        const x = (index - 5.5) * .043
        stamp.position.set(x, 1.145 - (index % 2) * .035, .270 * girth); stamp.rotation.set(0, 0, -.52); stamp.scale.set(1, 1, 1); stamp.updateMatrix()
        stitches.setMatrixAt(index, stamp.matrix)
      }
      stitches.instanceMatrix.needsUpdate = true
      stitches.castShadow = false
      group.add(stitches)
      const pleats = new THREE.InstancedMesh(boxGeometry(.018, .27, .018), thread, 5)
      pleats.name = 'dhotiPleats'
      for (let index = 0; index < 5; index += 1) {
        stamp.position.set((index - 2) * .075, .49, .27 * girth); stamp.rotation.set(0, 0, (index - 2) * .045); stamp.scale.set(1, 1, 1); stamp.updateMatrix()
        pleats.setMatrixAt(index, stamp.matrix)
      }
      pleats.instanceMatrix.needsUpdate = true
      pleats.castShadow = false
      group.add(pleats)
    }
    const leftArm = limb(group, 'leftArm', -.31 * girth, 1.34, 0, -1)
    const rightArm = limb(group, 'rightArm', .31 * girth, 1.34, 0, 1)
    for (const [arm, sign] of [[leftArm, -1], [rightArm, 1]] as const) {
      cylinderBetween(arm, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sign * .08, -.42, .02), .10, .08, robe, 8)
      cylinderBetween(arm, new THREE.Vector3(sign * .08, -.42, .02), new THREE.Vector3(sign * .04, -.76, .08), .075, .055, skin, 7)
      round(arm, .07, sign * .04, -.79, .08, skin, [1, .8, .8], false)
      // Palm, thumb and four tapered fingers. Finger rods share one instanced
      // mesh on each arm so hands remain legible without a draw-call explosion.
      round(arm, .072, sign * .04, -.79, .105, skin, [.9, .7, .48], false).name = 'palm'
      cylinderBetween(arm, new THREE.Vector3(sign * .09, -.78, .10), new THREE.Vector3(sign * .15, -.83, .14), .028, .019, skin, 6, false).name = 'thumb'
      const fingers = new THREE.InstancedMesh(cylinderGeometry(.012, .017, .12, 5), skin, 4)
      fingers.name = sign < 0 ? 'leftFingers' : 'rightFingers'
      const digit = new THREE.Object3D()
      for (let finger = 0; finger < 4; finger += 1) {
        digit.position.set(sign * (.005 + finger * .023), -.84 - Math.abs(1.5 - finger) * .003, .14)
        digit.rotation.set(-.08, 0, 0); digit.scale.set(1, 1, 1); digit.updateMatrix(); fingers.setMatrixAt(finger, digit.matrix)
      }
      fingers.instanceMatrix.needsUpdate = true; fingers.castShadow = false; arm.add(fingers)
      mesh(torusGeometry(.095, .013, 4, 10), sash, arm, new THREE.Vector3(sign * .095, -.405, .02), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      mesh(torusGeometry(.06, .015, 4, 10), mat('artisan-gold', 0xd6a83c, .38, .7), arm, new THREE.Vector3(sign * .05, -.66, .07), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
    }
    if (!options.noCraftProp) addCraftProp(rightArm, look, -.82)
    addOrderLeaf(leftArm, -.82)
    const legs: THREE.Group[] = []
    for (const side of [-1, 1]) {
      const leg = limb(group, side < 0 ? 'leftLeg' : 'rightLeg', side * .13, .62, 0, side)
      mesh(cylinderGeometry(.11, .13, .40, 8), robe, leg, new THREE.Vector3(0, -.18, 0))
      mesh(torusGeometry(.115, .016, 4, 10), sash, leg, new THREE.Vector3(0, -.35, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
      cylinderBetween(leg, new THREE.Vector3(0, -.36, 0), new THREE.Vector3(side * .01, -.56, .02), .075, .06, skin, 7)
      const sandal = block(leg, .18, .055, .29, 0, -.585, .08, timber(0), 0, false)
      sandal.name = side < 0 ? 'leftSandal' : 'rightSandal'
      const strap = block(leg, .16, .025, .035, 0, -.55, .17, mat('leather-sandal-straps', 0x5c3924, .97), -.18, false)
      strap.rotation.x = -.25
      strap.name = side < 0 ? 'leftSandalStrap' : 'rightSandalStrap'
      for (let toe = 0; toe < 3; toe += 1) round(leg, .019, (toe - 1) * .045, -.56, .22, skin, [.75, .7, 1], false)
      legs.push(leg)
    }
    group.userData.legs = legs
    group.userData.arms = [leftArm, rightArm]
    group.userData.leftArm = leftArm
    group.userData.rightArm = rightArm
    if (options.statusLamp !== false) addStatusLamp(group, ganesha ? 2.75 : 2.45)
  }

  function createNandiArtisan(look: ArtisanLook, group: THREE.Group): void {
    const hide = mat(`nandi-hide-${look.robe}`, look.robe, .9)
    const dark = mat('nandi-horn', 0x3b342d, .8)
    const garland = mat('marigold', 0xf0a030, .85, 0, { color: 0x8a4a00, intensity: .15 })
    round(group, .55, 0, 1.0, 0, hide, [.78, .72, 1.45])
    round(group, .28, 0, 1.42, -.22, hide, [.9, .9, 1.1])
    const head = new THREE.Group()
    head.name = 'nandiHead'
    head.position.set(0, 1.28, .82)
    group.add(head)
    round(head, .24, 0, 0, 0, hide, [.9, 1, 1.25])
    round(head, .13, 0, -.12, .25, mat('nandi-muzzle', 0xb8a898, .9), [1, .8, .8])
    for (const side of [-1, 1]) {
      cylinderBetween(head, new THREE.Vector3(side * .12, .16, -.05), new THREE.Vector3(side * .26, .38, -.12), .04, .015, dark, 6)
      round(head, .08, side * .24, .05, -.05, hide, [1.4, .5, .8], false)
    }
    mesh(torusGeometry(.36, .07, 6, 14), garland, group, new THREE.Vector3(0, 1.06, .58), new THREE.Euler(1.1, 0, 0), undefined, false)
    const bell = new THREE.Group(); bell.position.set(0, .82, .74); group.add(bell)
    mesh(cylinderGeometry(.06, .10, .14, 10), brass(), bell, new THREE.Vector3(0, 0, 0))
    mesh(torusGeometry(.33, .025, 4, 14), mat('artisan-sash-red', 0xa8322b, .9), group, new THREE.Vector3(0, 1.05, -.1), new THREE.Euler(0, Math.PI / 2, 0), undefined, false)
    const legs: THREE.Group[] = []
    for (const [index, [x, z]] of ([[-.25, .5], [.25, .5], [-.25, -.5], [.25, -.5]] as const).entries()) {
      const leg = limb(group, `nandiLeg${index}`, x, .78, z, index === 0 || index === 3 ? 1 : -1)
      mesh(cylinderGeometry(.08, .1, .72, 8), hide, leg, new THREE.Vector3(0, -.38, 0))
      mesh(cylinderGeometry(.09, .09, .06, 8), dark, leg, new THREE.Vector3(0, -.75, 0))
      legs.push(leg)
    }
    const tail = cylinderBetween(group, new THREE.Vector3(0, 1.2, -.78), new THREE.Vector3(0, .6, -.9), .03, .02, hide, 5)
    void tail
    const orderHolder = new THREE.Group(); orderHolder.name = 'leftArm'; orderHolder.position.set(0, 1.62, .9); group.add(orderHolder)
    addOrderLeaf(orderHolder, 0)
    group.userData.legs = legs
    group.userData.arms = []
    addStatusLamp(group, 2.3)
  }

  function createArtisan(look: ArtisanLook): THREE.Group {
    const group = new THREE.Group()
    group.name = `${look.name} artisan`
    group.userData.assetKind = 'artisan'
    group.userData.persona = look.key
    group.userData.form = look.form
    const body = new THREE.Group()
    body.name = 'artisanBody'
    group.add(body)
    if (look.form === 'nandi') createNandiArtisan(look, body)
    else createHumanArtisan(look, body, { decorativeTextile: true })
    group.userData.legs = body.userData.legs
    group.userData.arms = body.userData.arms
    group.userData.leftArm = body.userData.leftArm
    group.userData.rightArm = body.userData.rightArm
    group.userData.animationTargets = { leftArm: body.userData.leftArm, rightArm: body.userData.rightArm }
    group.userData.lampFlame = body.userData.lampFlame
    group.userData.statusLamp = body.userData.statusLamp
    group.userData.body = body
    // A soft ground disc keeps small figures readable from the overview.
    const ring = mesh(torusGeometry(.62, .05, 4, 24), mat(`artisan-ring-${look.sash}`, look.sash, .7, 0, { color: look.sash, intensity: .35 }), group, new THREE.Vector3(0, .04, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
    ring.name = 'craftRing'
    batchAvatarDetails(group, [body, body.userData.leftArm, body.userData.rightArm, ...(body.userData.legs as THREE.Group[] ?? [])])
    group.scale.setScalar(1.35)
    return group
  }

  function createTraveller(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'Traveller (fictional player avatar)'
    group.userData.assetKind = 'traveller'
    group.userData.traveller = true
    const look: ArtisanLook = {
      key: 'town-traveller', name: 'Traveller', craft: 'researcher', epithet: 'Visitor on foot', form: 'human',
      robe: 0x28747a, sash: 0xd8bd78, skin: 0x8a5a3c, headgear: 'headcloth', prop: 'pouch',
    }
    const body = new THREE.Group()
    body.name = 'travellerBody'
    group.add(body)
    createHumanArtisan(look, body, { statusLamp: false, noCraftProp: true, decorativeTextile: true })
    addTravellerPack(body)
    addTravellerRegalia(body)
    group.userData.body = body
    group.userData.leftArm = body.userData.leftArm
    group.userData.rightArm = body.userData.rightArm
    group.userData.legs = body.userData.legs
    group.userData.arms = body.userData.arms
    group.userData.animationTargets = { leftArm: body.userData.leftArm, rightArm: body.userData.rightArm }
    batchAvatarDetails(group, [body, body.userData.leftArm, body.userData.rightArm, ...(body.userData.legs as THREE.Group[] ?? []), body.getObjectByName('travellerBackpack') as THREE.Group | undefined, body.getObjectByName('waterFlask') as THREE.Group | undefined])
    group.scale.setScalar(1.35)
    return group
  }

  function addTravellerPack(body: THREE.Group): void {
    const leather = mat('traveller-oiled-leather', 0x68462e, .96)
    const binding = mat('traveller-pack-binding', 0xb89050, .78, .12)
    const ivory = mat('traveller-rolled-blanket', 0xd8ceb2, .96)
    const teal = mat('traveller-pack-teal', 0x315d5c, .94)
    const brass = mat('traveller-antique-brass', 0xa9864d, .48, .5)
    const dark = mat('traveller-flask-leather', 0x583a28, .96)
    // The pack faces away from +z. It is built on the torso itself, so straps,
    // roll and flask all follow the upper body when the walk cycle swings it.
    const pack = new THREE.Group()
    pack.name = 'travellerBackpack'
    pack.position.set(0, 1.16, -.285)
    pack.rotation.x = -.08
    body.add(pack)
    const bodyMesh = round(pack, .205, 0, 0, 0, leather, [1.03, 1.22, .72])
    bodyMesh.name = 'packBody'
    const flap = block(pack, .29, .20, .05, 0, .10, -.135, teal, 0, false)
    flap.name = 'packFlap'
    for (const side of [-1, 1]) {
      const strap = block(pack, .052, .74, .042, side * .15, -.06, -.13, binding, side * -.12, false)
      strap.name = side < 0 ? 'leftBackpackStrap' : 'rightBackpackStrap'
      round(pack, .035, side * .15, -.02, -.10, brass, [1, 1, .48], false).name = side < 0 ? 'leftPackBuckle' : 'rightPackBuckle'
    }
    // Rolled bedding rides above the pack and reads clearly from the rear.
    const roll = mesh(cylinderGeometry(.09, .09, .43, 9), ivory, pack, new THREE.Vector3(0, .32, -.08), new THREE.Euler(0, 0, Math.PI / 2), undefined, true)
    roll.name = 'rolledBlanket'
    for (const x of [-.16, .16]) {
      const tie = block(pack, .035, .24, .12, x, .32, -.075, binding, 0, false)
      tie.name = x < 0 ? 'leftBlanketTie' : 'rightBlanketTie'
    }
    // A small necked copper water flask hangs at the right hip with a visible cap and loop.
    const flask = new THREE.Group()
    flask.name = 'waterFlask'
    flask.position.set(.28, .88, -.015)
    flask.rotation.z = -.16
    body.add(flask)
    mesh(cylinderGeometry(.06, .095, .28, 8), dark, flask, new THREE.Vector3(0, 0, 0))
    mesh(cylinderGeometry(.035, .045, .07, 8), brass, flask, new THREE.Vector3(0, .17, 0))
    mesh(torusGeometry(.064, .012, 4, 10), binding, flask, new THREE.Vector3(0, .06, .01), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
    cylinderBetween(flask, new THREE.Vector3(-.08, .16, -.02), new THREE.Vector3(.08, .16, -.02), .012, .012, binding, 5, false)
    // A cross-body leather strap and keeper clasp add front detail and connect the load visually.
    const shoulderStrap = block(body, .065, .88, .04, .17, 1.07, .225, leather, 0, false)
    shoulderStrap.rotation.z = -.42
    shoulderStrap.name = 'travellerShoulderStrap'
    const keeper = block(body, .11, .095, .045, .25, .84, .225, brass, 0, false)
    keeper.rotation.z = -.42
    keeper.name = 'antiqueGoldStrapKeeper'
    const packSeam = new THREE.InstancedMesh(boxGeometry(.018, .28, .014), binding, 5)
    packSeam.name = 'packPanelSeams'
    const seam = new THREE.Object3D()
    for (let index = 0; index < 5; index += 1) {
      seam.position.set((index - 2) * .047, -.04, -.135); seam.rotation.set(0, 0, (index - 2) * .10); seam.scale.set(1, 1, 1); seam.updateMatrix()
      packSeam.setMatrixAt(index, seam.matrix)
    }
    packSeam.instanceMatrix.needsUpdate = true; packSeam.castShadow = false; pack.add(packSeam)
    const pocket = block(pack, .14, .11, .035, 0, -.11, -.15, teal, 0, false)
    pocket.name = 'packFrontPocket'
    round(pack, .028, 0, -.10, -.177, brass, [1, 1, .5], false).name = 'packPocketButton'
  }

  function addTravellerRegalia(body: THREE.Group): void {
    const teal = mat('traveller-deep-teal-cloth', 0x215f65, .93)
    const lightTeal = mat('traveller-shawl-highlight', 0x3c8584, .9)
    const ivory = mat('traveller-ivory-cloth', 0xe8dfc8, .97)
    const gold = mat('traveller-antique-gold-thread', 0xb69755, .75, .28)
    const shoulderGeo = sphereGeometry(.5, 10, 7)
    for (const side of [-1, 1]) {
      const cap = mesh(shoulderGeo, teal, body, new THREE.Vector3(side * .30, 1.30, .01), undefined, new THREE.Vector3(.18, .22, .20), false)
      cap.name = side < 0 ? 'leftRoundedShoulderCap' : 'rightRoundedShoulderCap'
    }
    // Two fitted XY panels form a broad, curved shawl across the chest and twin
    // tails over the dhoti. They are torso details, so arm and leg pivots stay free.
    const shawlShape = new THREE.Shape()
    shawlShape.moveTo(-.30, 1.45); shawlShape.bezierCurveTo(-.10, 1.50, .03, 1.30, .20, 1.12)
    shawlShape.bezierCurveTo(.29, 1.01, .31, .93, .25, .86); shawlShape.bezierCurveTo(.18, .82, .08, .88, .00, .98)
    shawlShape.bezierCurveTo(-.08, 1.08, -.19, 1.26, -.34, 1.34); shawlShape.closePath()
    const shawlGeo = geometry('traveller:front-shawl', () => new THREE.ShapeGeometry(shawlShape, 3))
    const shawl = mesh(shawlGeo, lightTeal, body, new THREE.Vector3(0, 0, .286), undefined, undefined, false)
    shawl.name = 'layeredShoulderShawl'
    const innerShape = new THREE.Shape()
    innerShape.moveTo(-.25, 1.42); innerShape.bezierCurveTo(-.06, 1.39, .08, 1.20, .20, 1.05)
    innerShape.bezierCurveTo(.24, 1.00, .22, .95, .17, .92); innerShape.bezierCurveTo(.10, 1.00, -.04, 1.18, -.25, 1.34); innerShape.closePath()
    const innerGeo = geometry('traveller:shawl-inlay', () => new THREE.ShapeGeometry(innerShape, 3))
    mesh(innerGeo, ivory, body, new THREE.Vector3(0, 0, .292), undefined, undefined, false).name = 'shawlIvoryInlay'
    const tails = new THREE.Shape()
    tails.moveTo(-.15, .86); tails.lineTo(.02, .84); tails.lineTo(.08, .42); tails.quadraticCurveTo(-.01, .37, -.12, .46); tails.closePath()
    const tailGeo = geometry('traveller:shawl-tail', () => new THREE.ShapeGeometry(tails, 1))
    mesh(tailGeo, lightTeal, body, new THREE.Vector3(0, 0, .245), undefined, undefined, false).name = 'shawlTail'
    const tailFold = block(body, .025, .35, .014, -.035, .65, .253, ivory, 0, false)
    tailFold.name = 'shawlTailFold'
    // Gold geometric embroidery follows the broad diagonal edge in a single draw.
    const motif = new THREE.InstancedMesh(boxGeometry(.033, .024, .013), gold, 8)
    motif.name = 'shawlGeometricEmbroidery'
    const mark = new THREE.Object3D()
    for (let index = 0; index < 8; index += 1) {
      mark.position.set(-.24 + index * .047, 1.39 - index * .052, .302)
      mark.rotation.set(0, 0, -.72); mark.scale.set(1, 1, 1); mark.updateMatrix(); motif.setMatrixAt(index, mark.matrix)
    }
    motif.instanceMatrix.needsUpdate = true; motif.castShadow = false; body.add(motif)
    // Fold ridges on the wrapped lower garment use a shared instanced strip.
    const folds = new THREE.InstancedMesh(boxGeometry(.022, .29, .016), ivory, 7)
    folds.name = 'travellerDhotiFoldRidges'
    for (let index = 0; index < 7; index += 1) {
      mark.position.set(-.18 + index * .06, .48, .248); mark.rotation.set(0, 0, (index - 3) * .04); mark.scale.set(1, 1, 1); mark.updateMatrix(); folds.setMatrixAt(index, mark.matrix)
    }
    folds.instanceMatrix.needsUpdate = true; folds.castShadow = false; body.add(folds)
    const belt = mesh(torusGeometry(.31, .028, 5, 20), gold, body, new THREE.Vector3(0, .79, 0), new THREE.Euler(Math.PI / 2, 0, 0), undefined, false)
    belt.name = 'travellerAntiqueGoldBelt'
    const clasp = mesh(boxGeometry(.11, .12, .035), gold, body, new THREE.Vector3(0, .79, .30), undefined, undefined, false)
    clasp.name = 'travellerBeltClasp'
    round(body, .034, 0, .79, .323, teal, [1, 1, .45], false).name = 'beltClaspInset'
    // A bound headwrap has an ivory cap and three antique-gold fabric bands.
    const headwrap = round(body, .237, 0, 1.85, -.015, ivory, [1.05, .42, .98], false)
    headwrap.name = 'segmentedHeadwrap'
    for (let index = 0; index < 3; index += 1) {
      const band = block(body, .34 - index * .04, .027, .30, 0, 1.78 + index * .055, .028, gold, 0, false)
      band.name = `headwrapBand${index + 1}`
    }
    const knot = round(body, .075, -.20, 1.84, -.06, teal, [1, .8, 1], false)
    knot.name = 'headwrapKnot'
    const tassel = mesh(cylinderGeometry(.02, .01, .18, 6), gold, body, new THREE.Vector3(-.23, 1.72, -.025), new THREE.Euler(0, 0, -.22), undefined, false)
    tassel.name = 'headwrapTassel'
  }

  /** The artisans' home: a long lime-plaster hall with a raised thinnai verandah facing local +z. */
  function createGuildHall(seed: number | string): THREE.Group {
    const rng = randomFor(seed)
    const group = new THREE.Group()
    group.name = 'Artisans Guild Hall'
    group.userData.assetKind = 'guild-hall'
    const width = 10.4, depth = 7.2
    addPlinth(group, width + 1, depth + 3.2, .55)
    const wall = plaster(1)
    block(group, width, 3.1, .3, 0, 2.1, -depth / 2, wall)
    block(group, .3, 3.1, depth, -width / 2, 2.1, 0, wall)
    block(group, .3, 3.1, depth, width / 2, 2.1, 0, wall)
    for (const x of [-width * .3, width * .3]) block(group, width * .28, 3.1, .3, x, 2.1, depth / 2 - .6, wall)
    block(group, 2.2, .6, .32, 0, 3.35, depth / 2 - .6, wall)
    block(group, 2.2, 2.4, .12, 0, 1.75, depth / 2 - .7, timber(2))
    // Thinnai: raised verandah benches either side of the door.
    for (const x of [-width * .3, width * .3]) block(group, width * .34, .45, 1.4, x, .78, depth / 2 + .45, stone(2))
    for (const x of [-width / 2 + .3, -width * .15, width * .15, width / 2 - .3]) pillar(group, x, depth / 2 + 1.2, 3.3, .16, timber(0), stone(1))
    block(group, width + .3, .26, .3, 0, 3.45, depth / 2 + 1.2, timber(0))
    addRoof(group, width + 1.2, depth + 3.0, 3.6, 1.9, Math.floor(rng() * color.tile.length), hashSeed(seed))
    // Guild signboard with the builders' square.
    block(group, 3.4, .8, .12, 0, 4.25, depth / 2 + 1.35, timber(1))
    block(group, 1.1, .1, .14, -.2, 4.3, depth / 2 + 1.42, brass(), 0, false)
    block(group, .1, .6, .14, -.7, 4.2, depth / 2 + 1.42, brass(), 0, false)
    for (const x of [-width * .42, width * .42]) {
      const lamp = createLamp(`${seed}:lamp:${x}`)
      lamp.position.set(x, .95, depth / 2 + 1.7)
      group.add(lamp)
    }
    batchStaticMeshes(group)
    return group
  }

  /** Open pillared mandapam with a flat stone roof; dispatch gates play out here. Front faces local +z. */
  function createStagingMandapam(seed: number | string): THREE.Group {
    const group = new THREE.Group()
    group.name = 'Staging mandapam'
    group.userData.assetKind = 'staging-mandapam'
    const width = 8.4, depth = 11
    block(group, width + 1, .3, depth + 1, 0, .15, 0, stone(0))
    block(group, width + .5, .25, depth + .5, 0, .42, 0, stone(1))
    for (let step = 0; step < 3; step += 1) block(group, 3.4 + step * .3, .15, .34, 0, .1 + step * .14, depth / 2 + .7 + step * .3, stone(step % 3))
    const columns: Array<[number, number]> = []
    for (const x of [-width * .42, 0, width * .42]) for (const z of [-depth * .42, -depth * .14, depth * .14, depth * .42]) if (!(x === 0 && Math.abs(z) < depth * .2)) columns.push([x, z])
    for (const [x, z] of columns) {
      block(group, .42, 3.0, .42, x, 2.05, z, stone(2))
      block(group, .62, .22, .62, x, 3.62, z, stone(1))
      block(group, .7, .16, .7, x, .63, z, stone(1))
    }
    block(group, width + .8, .38, depth + .8, 0, 3.92, 0, stone(0))
    for (const [x, z, w, d] of [[0, depth / 2 + .3, width + .8, .22], [0, -depth / 2 - .3, width + .8, .22], [width / 2 + .3, 0, .22, depth + .8], [-width / 2 - .3, 0, .22, depth + .8]] as const) block(group, w, .4, d, x, 4.3, z, stone(2))
    for (const [x, z] of [[-width / 2 - .3, depth / 2 + .3], [width / 2 + .3, depth / 2 + .3], [-width / 2 - .3, -depth / 2 - .3], [width / 2 + .3, -depth / 2 - .3]] as const) mesh(cylinderGeometry(.08, .22, .6, 8), stone(1), group, new THREE.Vector3(x, 4.7, z))
    const board = createProp('queue-board', `${seed}:board`)
    board.position.set(width * .2, .55, depth / 2 + .2)
    group.add(board)
    batchStaticMeshes(group)
    return group
  }

  return {
    createHouse,
    createPavilion,
    createTemple,
    createTempleCampus,
    createTree,
    createAnimal,
    createWorker,
    createTownsperson,
    createArtisan,
    createTraveller,
    artisanLampMaterial,
    createGuildHall,
    createStagingMandapam,
    createLamp,
    createProp,
    releaseAsset(asset) {
      const owned = mergedByAsset.get(asset)
      if (owned) {
        for (const resource of owned) {
          resource.dispose()
          mergedGeometries.delete(resource)
        }
        mergedByAsset.delete(asset)
      }
      // InstancedMesh owns a per-object instanceMatrix buffer even when its
      // geometry is library-shared. Release those buffers with the retired asset.
      asset.traverse(object => {
        if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const resource of geometries.values()) resource.dispose()
      for (const resource of mergedGeometries) resource.dispose()
      for (const resource of materials.values()) resource.dispose()
      for (const texture of textures) texture.dispose()
      textures.clear()
      geometries.clear()
      mergedGeometries.clear()
      materials.clear()
    },
  }
}
