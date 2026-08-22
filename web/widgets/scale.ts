export function linearScale(value: number, domain: [number, number], range: [number, number]): number {
  const span = domain[1] - domain[0]
  return span === 0 ? (range[0] + range[1]) / 2 : range[0] + ((value - domain[0]) / span) * (range[1] - range[0])
}

export function timeScale(value: string | number, domain: [string | number, string | number], range: [number, number]): number {
  return linearScale(new Date(value).getTime(), [new Date(domain[0]).getTime(), new Date(domain[1]).getTime()], range)
}

export function categoryScale(value: string, categories: string[], range: [number, number]): number {
  const index = Math.max(0, categories.indexOf(value))
  return categories.length <= 1 ? (range[0] + range[1]) / 2 : range[0] + (index / (categories.length - 1)) * (range[1] - range[0])
}

export function ticks(min: number, max: number, count = 5): number[] {
  if (count <= 1 || min === max) return [min]
  return Array.from({ length: count }, (_, index) => min + (index / (count - 1)) * (max - min))
}
