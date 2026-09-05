export const floorLabels = [
  'thinking', 'reading', 'building', 'looking things up',
  'needs your OK', 'asking you', 'waiting', 'finished',
] as const

export type FloorLabel = typeof floorLabels[number]
