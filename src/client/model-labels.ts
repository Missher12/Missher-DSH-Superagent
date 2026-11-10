import type { T } from './text.ts'

const EFFORTS = { none: 'effortName.none', off: 'effortName.none', minimal: 'effortName.minimal', low: 'effortName.low', medium: 'effortName.medium',
  high: 'effortName.high', xhigh: 'effortName.xhigh', max: 'effortName.max' } as const
/** Translate standard effort identifiers while retaining a provider's own descriptive names. */
export function effortLabel(id: string, name: string, t: T) {
  const key = EFFORTS[id.toLowerCase() as keyof typeof EFFORTS]
  return key && EFFORTS[name.toLowerCase() as keyof typeof EFFORTS] === key ? t(key) : name
}
