import * as THREE from 'three'
import type { ExploreBox } from './town-explore'

/**
 * World-space boxes of every solid part under `roots`: one per instance of an
 * instanced mesh, one per original part of a batched (merged) asset mesh, else
 * one per mesh. The box passed to `visit` is reused between calls.
 */
export function forEachExploreBox(roots: readonly THREE.Object3D[], visit: (box: ExploreBox) => void): void {
  const box = new THREE.Box3(), instance = new THREE.Matrix4()
  for (const root of roots) root.updateWorldMatrix(true, true)
  for (const root of roots) root.traverse(child => {
    const item = child as THREE.Mesh
    if (!item.isMesh || !item.visible) return
    const pieces = item.userData.pieceBoxes as Float32Array | undefined
    if (pieces) {
      for (let index = 0; index < pieces.length; index += 6) {
        box.min.set(pieces[index]!, pieces[index + 1]!, pieces[index + 2]!)
        box.max.set(pieces[index + 3]!, pieces[index + 4]!, pieces[index + 5]!)
        visit(box.applyMatrix4(item.matrixWorld))
      }
      return
    }
    if (!item.geometry.boundingBox) item.geometry.computeBoundingBox()
    const local = item.geometry.boundingBox!
    const instanced = item as unknown as THREE.InstancedMesh
    if (instanced.isInstancedMesh) {
      for (let index = 0; index < instanced.count; index++) {
        instanced.getMatrixAt(index, instance)
        visit(box.copy(local).applyMatrix4(instance).applyMatrix4(instanced.matrixWorld))
      }
    } else visit(box.copy(local).applyMatrix4(item.matrixWorld))
  })
}
