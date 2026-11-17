/** Real workflow and lifecycle records; long causes stay behind an explicit disclosure. */
import { usePanel } from './provider.tsx'
import type { TeamView } from '../teams/contracts.ts'
import { Button, Icon } from './controls.tsx'
import { When } from './widgets.tsx'
export function TeamRecords({ team, select }: { team: TeamView; select: (id: string) => void }) {
  const { t } = usePanel(), names = (ids: string[]) => ids.map(id => id === '$commander' ? t('teamCommander') : team.members.find(member => member.id === id)?.name ?? team.retiredMembers?.find(member => member.id === id)?.name ?? id).join('、')
  const rows = [...team.timeline ?? []].reverse()
  return <section className="dt-team-records"><h3>{t('teamRecords')}</h3>{rows.length ? <ol>{rows.map(event => {
    const label = event.kind === 'phase' ? t(`teamPhase.${event.detail as NonNullable<TeamView['phase']>}`) : event.kind === 'review' ? t(`teamDecision.${event.decision ?? 'pass'}`) : t(`teamRecord.${event.kind}`)
    const detail = event.kind === 'phase' ? '' : event.detail
    return <li key={event.id} data-kind={event.kind}><Icon name={event.kind === 'interrupted' || event.kind === 'blocked' ? 'alert' : event.kind === 'review' ? 'shield' : 'history'} size={14} />
      <div><div className="dt-team-record-title"><strong>{label}</strong><When at={event.at} /></div>
        <div className="dt-team-record-meta">{event.round && <span>{t('teamRoundShort', { round: event.round })}</span>}{event.memberId && <Button size="sm" onClick={() => select(event.memberId!)}>{names([event.memberId])}</Button>}{!!event.targets?.length && <span>→ {names(event.targets)}</span>}</div>
        {detail && <details><summary title={detail}>{detail}</summary><p>{detail}</p></details>}
      </div></li>
  })}</ol> : <p className="dt-hint">{t('teamNoRecords')}</p>}</section>
}
