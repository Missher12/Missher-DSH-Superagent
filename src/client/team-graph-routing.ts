import type { Point } from './workflow-routing.ts'

export interface GraphBox { left: number; right: number; top: number; bottom: number; column: number; single: boolean }

/** Adjacent stages share a perpendicular branch. Longer and reverse transfers use the outer rails.
 * Multi-member columns enter the rail through the gutter so a line never crosses a sibling card. */
export function horizontalTransfer(from: GraphBox, to: GraphBox, railY: number) {
  const centerX = (b: GraphBox) => (b.left + b.right) / 2
  const centerY = (b: GraphBox) => (b.top + b.bottom) / 2
  const point = (x: number, y: number): Point => ({ x, y })
  let points: Point[], tally: Point
  if (to.column === from.column + 1) {
    const middle = (from.right + to.left) / 2, start = point(from.right, centerY(from)), end = point(to.left, centerY(to))
    points = [start, point(middle, start.y), point(middle, end.y), end]
    tally = point(middle, start.y - 11)
  } else {
    const above = railY < from.top
    const exit = (b: GraphBox, right: boolean) => {
      if (b.single) {
        const x = centerX(b)
        return [point(x, above ? b.top : b.bottom), point(x, railY)]
      }
      const x = right ? b.right : b.left, gutter = x + (right ? 6 : -6)
      return [point(x, centerY(b)), point(gutter, centerY(b)), point(gutter, railY)]
    }
    const forward = to.column > from.column
    const a = exit(from, forward), b = exit(to, !forward)
    points = [...a, ...b.toReversed()]
    tally = point((a.at(-1)!.x + b.at(-1)!.x) / 2, railY - 4)
  }
  const start = points[0]!, end = points.at(-1)!
  let path = `M${start.x},${start.y}`, length = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!, next = points[i]!
    if (prev.x !== next.x) path += ` H${next.x}`
    if (prev.y !== next.y) path += ` V${next.y}`
    length += Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y)
  }
  return { path, start, end, tally, length }
}
