import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createTownAssetLibrary } from '../app/town/town-assets'
import { createExploreColliderGrid, exploreBlocked, exploreColliderFromBox, resolveExploreMove, type ExploreCollider } from '../app/town/town-explore'
import { forEachExploreBox } from '../app/town/town-explore-scene'
import { TEMPLE_CAMPUS } from '../app/town/town-model'

function collidersOf(...roots: THREE.Object3D[]) {
  const colliders: ExploreCollider[] = []
  forEachExploreBox(roots, box => { const collider = exploreColliderFromBox(box); if (collider) colliders.push(collider) })
  return createExploreColliderGrid(colliders)
}

describe('explore colliders from real Town assets', () => {
  const library = createTownAssetLibrary()

  it('keeps part boxes on batched meshes', () => {
    const campus = library.createTempleCampus('explore-test')
    const batched: THREE.Mesh[] = []
    campus.traverse(child => { if ((child as THREE.Mesh).isMesh && child.userData.assetBatch) batched.push(child as THREE.Mesh) })
    expect(batched.length).toBeGreaterThan(0)
    for (const mesh of batched) expect((mesh.userData.pieceBoxes as Float32Array).length % 6).toBe(0)
  })

  it('lets a traveller through the south gopuram passage but not through its piers or the wall', () => {
    const campus = library.createTempleCampus('explore-test')
    const grid = collidersOf(campus)
    const gateZ = TEMPLE_CAMPUS.maxZ - 1
    expect(exploreBlocked({ x: 0, z: gateZ }, .42, grid)).toBe(false)
    expect(exploreBlocked({ x: 5, z: gateZ }, .42, grid)).toBe(true)
    expect(exploreBlocked({ x: -30, z: TEMPLE_CAMPUS.maxZ - .7 }, .42, grid)).toBe(true)
    let at = { x: 0, z: TEMPLE_CAMPUS.maxZ + 8 }
    for (let frame = 0; frame < 200; frame++) at = resolveExploreMove(at, { x: 0, z: -.3 }, grid, 400)
    expect(at.z).toBeLessThan(TEMPLE_CAMPUS.maxZ - 12)
  })

  it('makes the sanctuary solid even though its detail is merged', () => {
    const hall = library.createTemple('explore-test')
    hall.position.set(TEMPLE_CAMPUS.sanctuary.x, 0, TEMPLE_CAMPUS.sanctuary.z); hall.scale.setScalar(TEMPLE_CAMPUS.sanctuary.scale)
    const grid = collidersOf(hall)
    expect(exploreBlocked({ x: TEMPLE_CAMPUS.sanctuary.x, z: TEMPLE_CAMPUS.sanctuary.z }, .42, grid)).toBe(true)
  })
})
