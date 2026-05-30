export function convWidth(totalCols: number, split: boolean) {
  return split ? Math.floor(totalCols * 0.42) : Math.min(totalCols, 80)
}
export function workWidth(totalCols: number, convW: number) {
  return totalCols - convW - 2 // 2 for gap
}
