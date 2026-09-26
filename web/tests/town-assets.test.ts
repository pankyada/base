import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createTownAssetLibrary } from '../app/town/town-assets'
import { buildingSpec, TEMPLE_CAMPUS, TEMPLE_SITE, TOWN_HOUSE_THEMES, type TownBuildingAppearance } from '../app/town/town-model'
import { ARTISAN_LOOKS } from '../app/town/town-artisans'

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
  variant, theme: TOWN_HOUSE_THEMES[variant % TOWN_HOUSE_THEMES.length]!, wallColor, roofColor, heightScale,
})

describe('town asset library', () => {
  it('keeps named human artisans articulated with their craft and status assets within a bounded draw budget', () => {
    const library = createTownAssetLibrary()
    for (const look of ARTISAN_LOOKS.filter(item => item.form === 'human')) {
      const figure = library.createArtisan(look)
      const body = figure.getObjectByName('artisanBody') as THREE.Group
      expect(body, look.key).toBeTruthy()
      expect(figure.userData.leftArm).toBe(body.getObjectByName('leftArm'))
      expect(figure.userData.rightArm).toBe(body.getObjectByName('rightArm'))
      expect(figure.userData.animationTargets.leftArm).toBe(figure.userData.leftArm)
      expect(figure.userData.animationTargets.rightArm).toBe(figure.userData.rightArm)
      expect(body.getObjectByName('leftLeg')).toBeTruthy()
      expect(body.getObjectByName('rightLeg')).toBeTruthy()
      expect(body.getObjectByName('craftProp')).toBeTruthy()
      expect(body.getObjectByName('orderLeaf')).toBeTruthy()
      expect(body.getObjectByName('statusLamp')).toBeTruthy()
      const bounds = localBounds(body)
      expect(bounds.getSize(new THREE.Vector3()).x, look.key).toBeLessThan(1.6)
      expect(bounds.getSize(new THREE.Vector3()).z, look.key).toBeLessThan(1.6)
      expect(meshes(figure).length, look.key).toBeLessThan(45)
    }
    library.dispose()
  })

  it('keeps scenery, legacy agent and traveller figures articulated and within bounded asset budgets', () => {
    const library = createTownAssetLibrary()
    const figures = [
      library.createTownsperson('market-west'),
      library.createTownsperson('market-east'),
      library.createWorker('legacy-agent'),
      library.createTraveller(),
      library.createArtisan(ARTISAN_LOOKS.find(item => item.key === 'ganesha')!),
      library.createArtisan(ARTISAN_LOOKS.find(item => item.key === 'nandi')!),
    ]
    for (const figure of figures) {
      const body = figure.userData.body as THREE.Group
      const leftArm = figure.userData.leftArm as THREE.Group
      const rightArm = figure.userData.rightArm as THREE.Group
      expect(body).toBeInstanceOf(THREE.Group)
      if (figure.userData.form !== 'nandi') {
        expect(leftArm).toBeInstanceOf(THREE.Group)
        expect(rightArm).toBeInstanceOf(THREE.Group)
        expect(body.getObjectByName('leftLeg')).toBeTruthy()
        expect(body.getObjectByName('rightLeg')).toBeTruthy()
        expect(figure.userData.animationTargets.leftArm).toBe(leftArm)
        expect(figure.userData.animationTargets.rightArm).toBe(rightArm)
      } else {
        expect(figure.userData.legs).toHaveLength(4)
      }
      const bounds = localBounds(figure)
      const footprintLimit = figure.userData.form === 'nandi' ? 3.5 : 2.2
      expect(bounds.getSize(new THREE.Vector3()).x).toBeLessThan(footprintLimit)
      expect(bounds.getSize(new THREE.Vector3()).z).toBeLessThan(footprintLimit)
      const drawBudget = figure.userData.assetKind === 'townsperson' ? 40
        : figure.userData.assetKind === 'worker' ? 35
          : figure.userData.assetKind === 'traveller' ? 50
            : figure.userData.form === 'nandi' ? 25 : 45
      expect(meshes(figure).length).toBeLessThan(drawBudget)
    }
    for (const figure of figures.slice(0, 4)) {
      expect(figure.getObjectByName('statusLamp')).toBeUndefined()
      expect(figure.getObjectByName('craftRing')).toBeUndefined()
    }
    expect(figures[0]!.userData.townsperson).toBe(true)
    expect(figures[3]!.userData.traveller).toBe(true)
    expect(figures[4]!.getObjectByName('statusLamp')).toBeTruthy()
    expect(figures[5]!.getObjectByName('nandiHead')).toBeTruthy()
    library.dispose()
    expect(() => library.createTraveller()).toThrow('Town asset library has been disposed')
  })

  it('releases avatar-local merged buffers without disposing sibling or cached geometry', () => {
    const library = createTownAssetLibrary()
    const removed = library.createTownsperson('retired-resident')
    const sibling = library.createTownsperson('remaining-resident')
    const localBatches = meshes(removed).filter(item => item.userData.assetBatch).map(item => item.geometry)
    const siblingBatches = meshes(sibling).filter(item => item.userData.assetBatch).map(item => item.geometry)
    const shared = meshes(removed).find(item => !item.userData.assetBatch)!.geometry
    const disposed = new Set<THREE.BufferGeometry>()
    for (const geometry of [...localBatches, ...siblingBatches, shared]) geometry.addEventListener('dispose', () => disposed.add(geometry))

    library.releaseAsset(removed)
    expect(localBatches.length).toBeGreaterThan(0)
    expect(localBatches.every(geometry => disposed.has(geometry))).toBe(true)
    expect(siblingBatches.every(geometry => !disposed.has(geometry))).toBe(true)
    expect(disposed.has(shared)).toBe(false)
    library.dispose()
  })

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

  it('encloses the sanctuary in one walled campus with four gopurams inside the reserved footprint', () => {
    const library = createTownAssetLibrary()
    const campus = library.createTempleCampus('campus-check')
    const bounds = localBounds(campus)
    const { clearance } = TEMPLE_CAMPUS
    expect(campus.userData.assetKind).toBe('temple-campus')
    expect(bounds.min.x).toBeGreaterThanOrEqual(TEMPLE_CAMPUS.minX - clearance)
    expect(bounds.max.x).toBeLessThanOrEqual(TEMPLE_CAMPUS.maxX + clearance)
    expect(bounds.min.z).toBeGreaterThanOrEqual(TEMPLE_CAMPUS.minZ - clearance)
    expect(bounds.max.z).toBeLessThanOrEqual(TEMPLE_CAMPUS.entrance.z)
    expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6)
    expect(bounds.max.y).toBeLessThanOrEqual(TEMPLE_CAMPUS.maxHeight)

    const towers = ['south', 'north', 'east', 'west'].map(name => campus.getObjectByName(`campus-gopuram-${name}`)!)
    expect(towers.every(Boolean)).toBe(true)
    const heights = towers.map(tower => tower.userData.height as number)
    expect(heights[0]).toBe(Math.max(...heights))
    expect(heights[0]).toBeLessThan(TEMPLE_SITE.maxHeight * TEMPLE_CAMPUS.sanctuary.scale)
    expect(campus.getObjectByName('campus-shrine-amman')).toBeTruthy()
    expect(campus.getObjectByName('campus-shrine-subsidiary')).toBeTruthy()
    expect(campus.userData.architecture.entrance).toEqual(TEMPLE_CAMPUS.entrance)
    library.dispose()
  })

  it('gives offices seven different architectural roof families, stable colors and bounded measured footprints', () => {
    const library = createTownAssetLibrary()
    const form = 'tamil-workshop'
    const spec = buildingSpec(form)
    const variants = Array.from({ length: 7 }, (_, variant) => library.createHouse(
      form,
      `active-office-${variant}`,
      appearance(variant, .96 + variant * .06, [0xc77952, 0xd8a65c, 0x9d5945, 0xb9653e, 0xe0bd7e, 0x98644e, 0xc58a61][variant], [0x66483b, 0x824738, 0x635444, 0x514b43, 0x96543b, 0x695747, 0x774e42][variant]),
    ))
    const silhouettes = variants.map(group => {
      const roofs = featureBounds(group, 'project-house-theme-roof')
      return {
        maxY: localBounds(group).max.y,
        roofCount: roofs.length,
        roofSizes: roofs.map(box => [box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z].map(value => value.toFixed(2)).join(':')).sort().join('|'),
      }
    })
    expect(variants.map(group => group.userData.assetIdentity.variant)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(new Set(silhouettes.map(item => `${item.roofCount}/${item.roofSizes}`)).size).toBeGreaterThanOrEqual(6)
    expect(new Set(silhouettes.map(item => item.maxY.toFixed(2))).size).toBeGreaterThanOrEqual(6)
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

    const inactive = library.createHouse(form, 'active-office-0', appearance(0), false)
    expect(inactive.userData.appearance.theme).toBe('Lantern workshop')
    expect(inactive.userData.assetIdentity.kind).toBe('project-house')
    expect(featureBounds(inactive, 'project-house-theme-roof').length).toBeGreaterThan(0)
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

  it('builds the added workshop, civic and field props deterministically inside their declared footprints', () => {
    const kinds = [
      'awning', 'bench', 'workstation', 'tool-rack', 'queue-board', 'archive-shelf', 'archive-crate',
      'crop-row', 'grove', 'irrigation-channel', 'pond',
    ] as const
    const firstLibrary = createTownAssetLibrary()
    const secondLibrary = createTownAssetLibrary()
    for (const kind of kinds) {
      const first = firstLibrary.createProp(kind, `deterministic-${kind}`)
      const second = secondLibrary.createProp(kind, `deterministic-${kind}`)
      const bounds = localBounds(first)
      const declared = first.userData.assetDimensions as { width: number; depth: number; height: number }
      const size = bounds.getSize(new THREE.Vector3())
      expect(first.userData.propKind).toBe(kind)
      expect(bounds.min.y, `${kind} ground clearance`).toBeGreaterThanOrEqual(-.001)
      expect(size.x, `${kind} width`).toBeLessThanOrEqual(declared.width + .02)
      expect(size.z, `${kind} depth`).toBeLessThanOrEqual(declared.depth + .02)
      expect(size.y, `${kind} height`).toBeLessThanOrEqual(declared.height + .02)
      expect(size.x).toBeGreaterThan(.1)
      expect(size.z).toBeGreaterThan(.1)
      const signature = (group: THREE.Group) => meshes(group).map(item => {
        item.geometry.computeBoundingBox()
        const box = item.geometry.boundingBox!
        const material = Array.isArray(item.material) ? item.material[0] : item.material
        return [
          item.position.toArray().map(value => value.toFixed(4)).join(','),
          [item.rotation.x, item.rotation.y, item.rotation.z].map(value => value.toFixed(4)).join(','),
          item.scale.toArray().map(value => value.toFixed(4)).join(','),
          box.getSize(new THREE.Vector3()).toArray().map(value => value.toFixed(4)).join(','),
          Array.from(item.geometry.attributes.position.array).map(value => Number(value.toFixed(4))).join(','),
          material.name,
          (material as THREE.MeshStandardMaterial).color?.getHexString(),
        ].join('|')
      })
      expect(signature(first)).toEqual(signature(second))
    }
    firstLibrary.dispose()
    secondLibrary.dispose()
  })

  it('varies seeded field detail and releases its merged mesh buffers', () => {
    const library = createTownAssetLibrary()
    const first = library.createProp('crop-row', 'field-a')
    const second = library.createProp('crop-row', 'field-b')
    const vertexData = (group: THREE.Group) => meshes(group).map(item => Array.from(item.geometry.attributes.position.array).map(value => Number(value.toFixed(3))))
    expect(vertexData(first)).not.toEqual(vertexData(second))
    const merged = meshes(first).filter(item => item.userData.assetBatch).map(item => item.geometry)
    expect(merged.length).toBeGreaterThan(0)
    const disposed = new Set<THREE.BufferGeometry>()
    for (const geometry of merged) geometry.addEventListener('dispose', () => disposed.add(geometry))
    library.releaseAsset(first)
    expect(disposed.size).toBe(merged.length)
    library.dispose()
  })
})
