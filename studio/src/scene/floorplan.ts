export const FLOOR_CAPACITY = 8

export type RoomId = 'desk' | 'library' | 'workshop' | 'mailroom' | 'gate'

export const rooms: Record<RoomId, { label: string; x: number; y: number; width: number; height: number }> = {
  desk: { label: 'Bullpen', x: 20, y: 250, width: 960, height: 210 },
  library: { label: 'Library', x: 20, y: 505, width: 290, height: 150 },
  workshop: { label: 'Workshop', x: 350, y: 505, width: 290, height: 150 },
  mailroom: { label: 'Mailroom', x: 680, y: 505, width: 300, height: 150 },
  gate: { label: 'Security gate', x: 20, y: 690, width: 960, height: 74 },
}

export const desks = Array.from({ length: FLOOR_CAPACITY }, (_, index) => ({ x: 92 + index * 115, y: 343 }))
