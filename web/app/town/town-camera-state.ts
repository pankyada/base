export type TownCameraVector = readonly [number, number, number]

export function townCameraDistance(position: TownCameraVector, target: TownCameraVector): number {
  return Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2])
}

export function townCameraMaxDistance(overviewDistance: number, retainedDistance = 0): number {
  return Math.max(380, overviewDistance * 1.3, retainedDistance * 1.1)
}

export function townCameraFarPlane(overviewDistance: number, mapRadius: number, retainedDistance = 0): number {
  return Math.max(2200, overviewDistance + mapRadius * 4, retainedDistance + mapRadius * 4)
}

export function townCameraRestoreLimits(currentMaxDistance: number, currentFarPlane: number, restoredDistance: number): { maxDistance: number; farPlane: number } {
  return {
    maxDistance: Math.max(currentMaxDistance, restoredDistance * 1.1),
    farPlane: Math.max(currentFarPlane, restoredDistance + 1_000),
  }
}
