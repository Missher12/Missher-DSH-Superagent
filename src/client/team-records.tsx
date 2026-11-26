/** Real workflow and lifecycle records; long causes stay behind an explicit disclosure. */
import { usePanel } from './provider.tsx'
import type { TeamView } from '../teams/contracts.ts'
import { roomRows, RoomEntry } from './team-room.tsx'
import { Button, Icon, SegmentedControl } from './controls.tsx'
import { usePoll } from './api.ts'
import { LoadState, When } from './widgets.tsx'
function EventHistory({ team }: { team: TeamView }) {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET local/teams/:id', { id: team.id, query: { history: 'all' } }), [call, team.id])
  const events = roomRows(data ?? team, t)
  return <div className="dt-room-events dt-record-events"><LoadState loading={!data && !events.length} error={error} />
    {events.map(row => <RoomEntry key={row.key} row={row} t={t} />)}{data && !events.length && <p className="dt-hint">{t('teamNoRecords')}</p>}
  </div>
}

export function TeamRecords({ team, select, view, onView }: { team: TeamView; select: (id: string) => void; view: 'workflow' | 'events'; onView: (view: 'workflow' | 'events') => void }) {
  const { t } = usePanel(), names = (ids: string[]) => ids.map(id => id === '$commander' ? t('teamCommander') : team.members.find(member => member.id === id)?.name ?? team.retiredMembers?.find(member => member.id === id)?.name ?? id).join('、')
  const rows = [...team.timeline ?? []].reverse()
  return <section className="dt-team-records"><SegmentedControl label={t('teamRecords')} value={view} onChange={onView} options={[
    { value: 'workflow', label: t('flowDelivery') }, { value: 'events', label: t('studioEvents') },
  ]} />
    {view === 'events' ? <EventHistory key={team.id} team={team} /> : rows.length ? <ol>{rows.map(event => {
    const label = event.kind === 'phase' ? t(`teamPhase.${event.detail as NonNullable<TeamView['phase']>}`) : event.kind === 'review' ? t(`teamDecision.${event.decision ?? 'pass'}`) : t(`teamRecord.${event.kind}`)
    const detail = event.kind === 'phase' ? '' : event.detail
    return <li key={event.id} data-kind={event.kind}><Icon name={event.kind === 'interrupted' || event.kind === 'blocked' ? 'alert' : event.kind === 'review' ? 'shield' : 'history'} size={14} />
      <div><div className="dt-team-record-title"><strong>{label}</strong><When at={event.at} /></div>
        <div className="dt-team-record-meta">{event.round && <span>{t('teamRoundShort', { round: event.round })}</span>}{event.memberId && <Button size="sm" onClick={() => select(event.memberId!)}>{names([event.memberId])}</Button>}{!!event.targets?.length && <span>→ {names(event.targets)}</span>}</div>
        {detail && <details><summary>{t('teamRecordDetails')}</summary><p>{detail}</p></details>}
      </div></li>
  })}</ol> : <p className="dt-hint">{t('teamNoRecords')}</p>}</section>
}
