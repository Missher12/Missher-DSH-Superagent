export interface Point { x: number; y: number }

/** Bottom output to top input. Reverse and same-row links travel outside both cards. */
export function orthogonalRoute(start: Point, end: Point, outerX: number) {
  if (end.y >= start.y + 12) {
    const y = (start.y + end.y) / 2
    return { path: `M${start.x},${start.y} V${y} H${end.x} V${end.y}`, midpoint: { x: (start.x + end.x) / 2, y } }
  }
  return {
    path: `M${start.x},${start.y} v8 H${outerX} V${end.y - 8} H${end.x} V${end.y}`,
    midpoint: { x: outerX, y: (start.y + end.y) / 2 },
  }
}

/** Keep saved drag coordinates independent of text wrapping and zoom. A card that
 * grows pushes the cards beneath it in the same lane, preserving their original gap. */
export function fitWorkflowCards(layout: Record<string, Point>, heights: Record<string, number>, width: number, baseHeight: number) {
  const placed: Record<string, Point> = {}
  const ordered = Object.entries(layout).sort(([, a], [, b]) => a.y - b.y)
  for (const [id, point] of ordered) {
    let top = point.y
    for (const [above, previous] of Object.entries(placed)) {
      const gap = point.y - layout[above]!.y - baseHeight
      if (gap < 0 || Math.abs(point.x - previous.x) >= width) continue
      top = Math.max(top, previous.y + (heights[above] ?? baseHeight) + gap)
    }
    placed[id] = { x: point.x, y: top }
  }
  return placed
}

/** Restore positioned cards first, then find free space in each new card's suggested row. */
export function restoreWorkflowLayout(defaults: Record<string, Point>, saved: Record<string, Point> | undefined, width: number, height: number) {
  if (!saved) return defaults
  const ids = Object.keys(defaults)
  const positioned: Record<string, Point> = {}
  for (const id of [...ids.filter(id => saved[id]), ...ids.filter(id => !saved[id])]) {
    const { x, y } = saved[id] ?? defaults[id]!
    let left = x
    const row = Object.values(positioned).filter(card => Math.abs(card.y - y) < height + 12).sort((a, b) => a.x - b.x)
    for (const card of row) {
      if (Math.abs(card.x - left) < width + 12) left = card.x + width + 36
    }
    positioned[id] = { x: left, y }
  }
  return positioned
}
