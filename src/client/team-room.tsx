import { useId, useState } from 'react'
import type { TeamView } from '../teams/contracts.ts'
import { usePanel } from './provider.tsx'
import { fullTime, type T } from './text.ts'
import { Icon } from './controls.tsx'
import { MarkdownLite, When } from './widgets.tsx'

/** Only this team's durable, public reports and handoffs enter its room. Native conversations stay session-scoped. */
export function roomRows(team: TeamView, t: T): { key: string; at: string; who: string; text: string; final?: boolean }[] {
  const name = (id: string) => team.members.find(member => member.id === id)?.name
    ?? team.retiredMembers?.find(member => member.id === id)?.name ?? (id === '$commander' ? t('teamCommander') : id)
  const rows = [
    ...[...team.members, ...team.retiredMembers ?? []].flatMap(member => (member.events ?? []).filter(event => event.summary.trim()).map(event => ({
      key: `report/${member.id}/${event.id}`, at: event.at, who: member.name, text: event.summary,
    }))),
    ...team.handoffs.map(event => ({ key: `handoff/${event.id}`, at: event.at, who: name(event.from), text: `${t('studioHandoff')} → ${name(event.to)}` })),
    ...(team.timeline ?? []).filter(event => event.kind === 'review' || event.kind === 'blocked').map(event => ({
      key: `record/${event.id}`, at: event.at, who: event.memberId ? name(event.memberId) : t('studioReview'),
      text: [event.decision && t(`teamDecision.${event.decision}`), event.detail].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))
  const report = team.commander?.summary?.trim()
  if ((team.state !== 'completed' && !team.deliveredBeforeStop) || !team.completion?.commander || !team.finalDelivery || !report) return rows
  const ended = team.timeline?.findLast(event => event.kind === 'phase' && event.detail === 'completed')
  return [{ key: `final/${team.finalDelivery.version}`, at: ended?.at ?? team.updatedAt,
    who: t('teamCommander'), text: report, final: true }, ...rows]
}
const logClock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function TeamEventLog({ team, records }: { team: TeamView; records: () => void }) {
  const { t } = usePanel(), rows = roomRows(team, t).slice(0, 3)
  return <section className="dt-studio-event-log"><header><strong>{t('studioEvents')}</strong><button type="button" onClick={records}>{t('teamRecords')} ↗</button></header>
    {rows.length ? rows.map(row => <div key={row.key}><time dateTime={row.at} title={fullTime(row.at, t('lang'))}>{Number.isFinite(Date.parse(row.at)) ? logClock.format(Date.parse(row.at)) : '—'}</time><b title={row.who}>{row.who}</b>
      <span className="dt-log-text">{row.text.trim().split(/\r?\n/, 1)[0]}</span></div>) : <small>{t('teamNoRecords')}</small>}
  </section>
}
export function RoomEntry({ row, t }: { row: ReturnType<typeof roomRows>[number]; t: T }) {
  return <article className={row.final ? 'dt-room-final' : undefined}><strong>{row.who}{row.final && ` · ${t('teamReported')}`}</strong><When at={row.at} />
    {row.final ? <MarkdownLite text={row.text} /> : <p>{row.text}</p>}
  </article>
}
export function TeamRoom({ team }: { team: TeamView }) {
  const { t } = usePanel(), rows = roomRows(team, t)
  const [expanded, setExpanded] = useState(false), logId = useId()
  return <section className="dt-team-room" aria-label={t('studioRoom')}>
    <button type="button" aria-expanded={expanded} aria-controls={logId} onClick={() => setExpanded(value => !value)}><Icon name="message" size={16} /><strong>{t('studioRoom')}</strong><span>{t('studioPublic')} · {rows.length}</span><Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} /></button>
    <div id={logId} hidden={!expanded} className="dt-room-events" role="log" aria-live="off">
      {expanded && rows.map(row => <RoomEntry key={row.key} row={row} t={t} />)}
      {expanded && !rows.length && <small>{t('teamNoRecords')}</small>}
    </div>
  </section>
}
