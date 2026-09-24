import { describe, expect, it } from 'vitest'
import { townCameraDistance, townCameraFarPlane, townCameraMaxDistance } from '../app/town/town-camera-state'

describe('Town camera restore limits', () => {
  it('keeps a restored pose inside OrbitControls limits and visible to the far plane', () => {
    const distance = townCameraDistance([92.41, 689.61, 276.42], [0, 1, 0])
    expect(distance).toBeGreaterThan(747)
    expect(townCameraMaxDistance(300, distance)).toBeGreaterThan(distance)
    expect(townCameraFarPlane(300, 50, distance)).toBeGreaterThan(distance)
  })
})
