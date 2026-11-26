import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { T } from './text.ts'

export function occupancy(value: unknown) {
  const pressure = value as { projectedTokens?: number; pressureTokens?: number; contextWindow?: number } | undefined
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const limit = pressure?.contextWindow
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return
  return { used, limit, percent: Math.min(100, Math.round(100 * used / limit)) }
}

const compactTokens = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function MemberPressure({ sessions, id, active, t }: { sessions: ISessions; id: string; active?: boolean; t: T }) {
  const key = id as SessionId
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const read = useCallback(() => {
    const values = sessions.list.getSnapshot().projectionsBySession?.[key]?.values as Record<string, unknown> | undefined
    return values?.contextPressure
  }, [sessions, key])
  const pressure = occupancy(useSyncExternalStore(subscribe, read))
  useEffect(() => {
    if (active === undefined) return // Detail popovers read the projection already refreshed by the node.
    const refresh = () => { void sessions.refreshProjections?.(key).catch(() => {}) }
    refresh()
    if (active) { const timer = setInterval(refresh, 10000); return () => clearInterval(timer) }
  }, [sessions, key, active])
  return <span className="dt-member-pressure" title={pressure ? `${pressure.used.toLocaleString()} / ${pressure.limit.toLocaleString()} tokens` : undefined}>
    <span>{t('sessionContextTitle')}</span>{pressure ? <><meter min={0} max={100} value={pressure.percent} aria-label={t('sessionContextTitle')} /><span className="dt-pressure-count">{compactTokens.format(pressure.used)} / {compactTokens.format(pressure.limit)}</span><b>{pressure.percent}%</b></> : <small>{t('studioNoPressure')}</small>}
  </span>
}
