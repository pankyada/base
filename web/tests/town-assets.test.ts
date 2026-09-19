import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createTownAssetLibrary } from '../app/town/town-assets'
import { buildingSpec, TEMPLE_SITE, type TownBuildingAppearance } from '../app/town/town-model'

function localBounds(group: THREE.Group): THREE.Box3 {
  group.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(group)
}

function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = []
  group.traverse(object => {
    if ((object as THREE.Mesh).isMesh) result.push(object as THREE.Mesh)
  })
  return result
}

function featureBounds(group: THREE.Group, feature: string): THREE.Box3[] {
  return meshes(group)
    .filter(item => item.userData.assetFeature === feature)
    .map(item => {
      item.updateWorldMatrix(true, false)
      return new THREE.Box3().setFromObject(item)
    })
}

const appearance = (variant: number, heightScale = 1, wallColor = 0xc77952, roofColor = 0x66483b): TownBuildingAppearance => ({
  variant, wallColor, roofColor, heightScale,
})

describe('town asset library', () => {
  it('builds the Town Temple as a detailed, raycastable landmark inside the shared site envelope', () => {
    const library = createTownAssetLibrary()
    const temple = library.createTemple('town-temple-check')
    const architecture = temple.userData.architecture
    const bounds = localBounds(temple)

    expect(temple.userData.assetKind).toBe('temple')
    expect(temple.userData.front).toBe('+z')
    expect(architecture.tierCount).toBeGreaterThanOrEqual(11)
    expect(architecture.tierCount).toBeLessThanOrEqual(13)
    expect(architecture.pilasterInstances).toBeGreaterThan(180)
    expect(architecture.nicheInstances).toBeGreaterThan(120)
    expect(architecture.cornerRoofletInstances).toBe(architecture.tierCount * 4)
    expect(temple.getObjectByName('temple-vimana-articulated-tiers')).toMatchObject({ count: architecture.tierCount })
    expect(temple.getObjectByName('temple-vimana-corner-rooflets')).toMatchObject({ count: architecture.cornerRoofletInstances })
    expect(featureBounds(temple, 'vimana-tier-masses')).toHaveLength(1)
    expect(featureBounds(temple, 'vimana-pilasters')).toHaveLength(1)
    expect(featureBounds(temple, 'vimana-recessed-niches')).toHaveLength(1)
    expect(meshes(temple).length).toBeLessThan(40)
    expect(meshes(temple).every(mesh => typeof mesh.raycast === 'function')).toBe(true)

    expect(bounds.min.x).toBeGreaterThanOrEqual(TEMPLE_SITE.minX)
    expect(bounds.max.x).toBeLessThanOrEqual(TEMPLE_SITE.maxX)
    expect(bounds.min.z).toBeGreaterThanOrEqual(TEMPLE_SITE.minZ)
    expect(bounds.max.z).toBeLessThanOrEqual(TEMPLE_SITE.maxZ)
    expect(bounds.min.y).toBeGreaterThanOrEqual(0)
    expect(bounds.max.y).toBeLessThanOrEqual(TEMPLE_SITE.maxHeight)
    expect(bounds.max.y).toBeGreaterThan(20)
    expect(architecture.templeMass).toContain('rear sanctuary vimana')
    library.dispose()
  })

  it('gives active offices six different roof families, stable colors and bounded measured footprints', () => {
    const library = createTownAssetLibrary()
    const form = 'tamil-workshop'
    const spec = buildingSpec(form)
    const variants = Array.from({ length: 6 }, (_, variant) => library.createHouse(
      form,
      `active-office-${variant}`,
      appearance(variant, .96 + variant * .07, [0xc77952, 0xd8a65c, 0x9d5945, 0xb9653e, 0xe0bd7e, 0x98644e][variant], [0x66483b, 0x824738, 0x635444, 0x514b43, 0x96543b, 0x695747][variant]),
    ))
    const silhouettes = variants.map(group => {
      const roofs = featureBounds(group, 'active-office-roof')
      return {
        maxY: localBounds(group).max.y,
        roofCount: roofs.length,
        roofSizes: roofs.map(box => [box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z].map(value => value.toFixed(2)).join(':')).sort().join('|'),
      }
    })
    expect(variants.map(group => group.userData.assetIdentity.variant)).toEqual([0, 1, 2, 3, 4, 5])
    expect(new Set(silhouettes.map(item => `${item.roofCount}/${item.roofSizes}`)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(silhouettes.map(item => item.maxY.toFixed(2))).size).toBe(6)
    for (const group of variants) {
      const box = localBounds(group)
      expect(box.getSize(new THREE.Vector3()).x).toBeLessThanOrEqual(spec.width + .02)
      expect(box.getSize(new THREE.Vector3()).z).toBeLessThanOrEqual(spec.depth + .02)
      expect(group.scale.y).toBe(group.userData.appearance.heightScale)
      const materialColors = meshes(group).flatMap(item => Array.isArray(item.material) ? item.material : [item.material]).map(material => {
        const candidate = material as THREE.MeshStandardMaterial
        return candidate.color?.getHex()
      })
      expect(materialColors).toContain(group.userData.appearance.wallColor)
      expect(materialColors).toContain(group.userData.appearance.roofColor)
    }

    const inactive = library.createHouse(form, 'active-office-0')
    expect(inactive.userData.appearance).toBeUndefined()
    expect(inactive.userData.assetIdentity).toBeUndefined()
    expect(inactive.scale.y).toBe(1)
    library.dispose()
  })

  it('reuses the same geometry and finite identity materials while making many active houses', () => {
    const library = createTownAssetLibrary()
    const groups = Array.from({ length: 48 }, (_, index) => library.createHouse(
      'tamil-workshop',
      `repo-${index}`,
      appearance(index % 6, .9 + (index % 10) * .05, [0xc77952, 0xd8a65c, 0x9d5945, 0xb9653e, 0xe0bd7e, 0x98644e][index % 6], [0x66483b, 0x824738, 0x635444, 0x514b43, 0x96543b, 0x695747][index % 6]),
    ))
    const sharedGeometries = new Set<THREE.BufferGeometry>()
    const sharedMaterials = new Set<THREE.Material>()
    for (const group of groups) for (const item of meshes(group)) {
      if (!item.userData.assetBatch) sharedGeometries.add(item.geometry)
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) sharedMaterials.add(material)
    }
    expect(sharedGeometries.size).toBeLessThan(35)
    expect(sharedMaterials.size).toBeLessThan(50)
    const changing = groups[0]
    const merged = meshes(changing).filter(item => item.userData.assetBatch).map(item => item.geometry)
    const disposed = new Set<THREE.BufferGeometry>()
    for (const geometry of merged) geometry.addEventListener('dispose', () => disposed.add(geometry))
    const childCount = changing.children.length
    const setAppearance = changing.userData.setAppearance as (next?: TownBuildingAppearance) => void
    for (let iteration = 0; iteration < 12; iteration += 1) {
      setAppearance(undefined)
      setAppearance(appearance(iteration % 6, 1, 0xc77952, 0x66483b))
    }
    expect(changing.children.length).toBe(childCount)
    library.releaseAsset(changing)
    expect(disposed.size).toBe(merged.length)
    library.dispose()
  })

  it('disposes every shared temple resource and rejects asset creation after library teardown', () => {
    const library = createTownAssetLibrary()
    const temple = library.createTemple('resource-check')
    const owned = new Set<THREE.BufferGeometry | THREE.Material>()
    for (const item of meshes(temple)) {
      owned.add(item.geometry)
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) owned.add(material)
    }
    const disposed = new Set<THREE.BufferGeometry | THREE.Material>()
    for (const resource of owned) resource.addEventListener('dispose', () => disposed.add(resource))
    library.dispose()
    expect(disposed).toEqual(owned)
    expect(() => library.createTemple('after-dispose')).toThrow('Town asset library has been disposed')
  })
})
