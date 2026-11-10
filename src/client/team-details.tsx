/** Real member activity, embedded DSH conversation, and delivery review. */
import { useState } from 'react'
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import { Button, Icon, SegmentedTabs } from './controls.tsx'
import { LocalFollowup } from './local.tsx'
import { SessionModelPicker } from './model-picker.tsx'
import { useAction, usePanel } from './provider.tsx'
import { TeamDelivery } from './team-delivery.tsx'
import { TeamStatus, TeamText } from './team-ui.tsx'
import { MarkdownLite, SessionButton, When } from './widgets.tsx'

function MemberActivity({ member, team }: { member: TeamMemberView; team: TeamView }) {
  const { t } = usePanel()
  const records = [...member.tools.map(tool => ({ id: tool.id, at: tool.at, kind: 'tool', title: tool.name, text: tool.detail, state: tool.state })),
    ...member.events.map(event => ({ ...event, kind: 'report', title: event.state === 'started' ? t('teamStarted') : t('workbenchEvent.report'), text: event.summary }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 28)
  return <div className="dt-team-member-activity">
    <section><h3>{t('teamMemberWork')}</h3><TeamText text={member.instructions} />
      {member.dependencies.length > 0 && <p className="dt-hint">{t('teamPrerequisite', { names: member.dependencies.map(id => team.members.find(item => item.id === id)?.name ?? id).join('、') })}</p>}
      {member.role === 'coordinator' && member.state === 'waiting' && <p className="dt-hint">{t('teamPlanningRound')}</p>}</section>
    <section><h3>{t('teamProgress')}</h3>{member.summary ? <MarkdownLite text={member.summary} /> : <p className="dt-hint">{t('teamNoProgress')}</p>}</section>
    <section><h3>{t('teamRecords')}</h3>{records.length ? <ol className="dt-team-records">{records.map(record => <li key={record.id}>
      <span className="dt-team-record-icon" data-state={record.state}><Icon name={record.state === 'error' || record.state === 'failed' ? 'alert' : record.kind === 'tool' ? 'session' : 'message'} size={15} /></span>
      <div><div className="dt-team-record-head"><strong>{record.title}</strong><When at={record.at} /></div>
        {record.text && <p>{record.text}</p>}{record.kind === 'tool' && <span className="dt-hint">{t(`workbenchToolState.${record.state as 'running' | 'done' | 'error' | 'interrupted'}`)}</span>}</div>
    </li>)}</ol> : <p className="dt-hint">{t('teamNoRecords')}</p>}</section>
  </div>
}

export function TeamDetails({ team, member, reload }: { team: TeamView; member: TeamMemberView; reload: () => Promise<void> }) {
  const { t, call, renderSession, navigate } = usePanel()
  const [view, setView] = useState<'activity' | 'conversation' | 'delivery'>('activity')
  const retry = useAction(async () => { if (member.ticketId) { await call('POST tickets/:id/retry', { id: member.ticketId }); await reload() } })
  const affected = new Set([member.id])
  for (let pass = 0; pass < team.members.length; pass++) for (const item of team.members) if (item.dependencies.some(id => affected.has(id))) affected.add(item.id)
  return <aside className="dt-team-details" tabIndex={-1} aria-label={t('teamDetails')}>
    <header className="dt-team-detail-head"><div className="dt-team-member-heading"><span className="dt-team-avatar"><Icon name={member.role === 'coordinator' ? 'queue' : 'user'} size={18} /></span>
      <div><h2>{member.name}</h2><TeamStatus state={member.state} member /></div></div>
      <div className="dt-actions"><Button variant="outline" size="sm" disabled={!member.sessionId} icon={<Icon name="session" />} onClick={() => setView('conversation')}>{t('teamOpenSession')}</Button>
        {member.sessionId && <SessionButton external sessionId={member.sessionId} label={t('teamOriginalSession')} />}</div>
    </header>
    {(member.attention || member.state === 'failed') && <section className="dt-team-issue" role="status"><h3><Icon name="alert" />{t('teamNeedsHelp')}</h3>
      <p>{member.attention || member.summary}</p>{affected.size > 1 && <p>{t('teamImpact')}：{team.members.filter(item => item.id !== member.id && affected.has(item.id)).map(item => item.name).join('、')}</p>}
      {member.retry && <Button variant="outline" size="sm" disabled={retry.busy} onClick={() => { void retry.run() }}>{t('teamRetryMember')}</Button>}</section>}
    <div className="dt-team-detail-tabs"><SegmentedTabs value={view} onChange={setView} label={t('teamDetails')}
      items={(['activity', 'conversation', 'delivery'] as const).map(value => ({ value, label: t(value === 'activity' ? 'teamActivity' : value === 'conversation' ? 'workbenchConversation' : 'teamDelivery'), id: `dt-member-${value}`, panelId: 'dt-member-content' }))} /></div>
    {view === 'conversation' && member.sessionId && <div className="dt-team-model-bar"><SessionModelPicker key={member.sessionId} sessionId={member.sessionId} running={member.state === 'working'} /></div>}
    <div className={`dt-team-detail-content${view === 'conversation' ? ' dt-team-native-session' : ''}`} id="dt-member-content" role="tabpanel" aria-labelledby={`dt-member-${view}`}>
      {view === 'activity' ? <MemberActivity member={member} team={team} /> : view === 'delivery' ? <TeamDelivery team={team} />
        : member.sessionId && renderSession ? renderSession(member.sessionId) : <p className="dt-hint">{t('teamNotStarted')}</p>}
    </div>
    {member.ticketId && team.state !== 'stopped' && member.state !== 'stopped' && <div className="dt-team-followup"><LocalFollowup key={member.ticketId} id={member.ticketId} teamId={team.id} memberId={member.id}
      completed={member.state === 'finished'} onSent={reload} /></div>}
    {member.ticketId && <div className="dt-team-record-link"><Button size="sm" variant="ghost" onClick={() => navigate({ page: 'execution', id: member.ticketId! })}>{t('workbenchViewTask')}</Button></div>}
  </aside>
}
