export function convWidth(totalCols: number, split: boolean) {
  return split ? Math.floor(totalCols * 0.42) : totalCols
}
export function workWidth(totalCols: number, convW: number) {
  return totalCols - convW - 2 // 2 for gap
}
