/** Real member activity, embedded DSH conversation, and delivery review. */
import { useState } from 'react'
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import { Button, Icon } from './controls.tsx'
import { LocalFollowup } from './local.tsx'
import { SessionModelPicker } from './model-picker.tsx'
import { useAction, usePanel } from './provider.tsx'
import { TeamDelivery, TeamFilesButton } from './team-delivery.tsx'
import { OpenWorkspaceButton } from './local-workspaces.tsx'
import { TeamStatus } from './team-ui.tsx'
import { SessionButton, When } from './widgets.tsx'
import { shortText, workbenchToolLabel } from './text.ts'

function MemberActivity({ member }: { member: TeamMemberView }) {
  const { t } = usePanel()
  const records = [...member.tools.map(tool => ({ id: tool.id, at: tool.at, kind: 'tool', title: workbenchToolLabel(t, tool.name), text: tool.detail, state: tool.state })),
    ...member.events.map(event => ({ ...event, kind: 'report', title: event.state === 'started' ? t('teamStarted') : t('workbenchEvent.report'), text: event.summary }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  return <div className="dt-team-member-activity">
    <section className="dt-team-activity-summary"><TeamStatus state={member.state} member />
      <p>{shortText(member.summary || t('teamNoProgress'), 100)}</p></section>
    <section><h3>{t('teamRecords')}</h3>{records.length ? <ol className="dt-team-records">{records.map(record => <li key={record.id}>
      <span className="dt-team-record-icon" data-state={record.state}><Icon name={record.state === 'error' || record.state === 'failed' ? 'alert' : record.kind === 'tool' ? 'session' : 'message'} size={15} /></span>
      <div><div className="dt-team-record-head"><strong>{record.title}</strong><When at={record.at} /></div>
        {record.text && <p>{shortText(record.text, 80)}</p>}{record.kind === 'tool' && <span className="dt-hint">{t(`workbenchToolState.${record.state as 'running' | 'done' | 'error' | 'interrupted'}`)}</span>}</div>
    </li>)}</ol> : <p className="dt-hint">{t('teamNoRecords')}</p>}</section>
  </div>
}

export function TeamDetails({ team, member, reload, view: selectedView, onView }: { team: TeamView; member: TeamMemberView; reload: () => Promise<void>;
  view?: 'activity' | 'conversation' | 'context' | 'delivery'; onView?: (view: 'activity' | 'conversation' | 'context' | 'delivery') => void }) {
  const { t, call, renderSession, renderContext, nativeSession, navigate } = usePanel()
  const [ownView, setOwnView] = useState<'activity' | 'conversation' | 'context' | 'delivery'>('conversation')
  const view = selectedView ?? ownView, setView = onView ?? setOwnView
  const currentTool = member.tools.findLast(tool => tool.state === 'running')
  const activity = currentTool ? `${workbenchToolLabel(t, currentTool.name)}${currentTool.detail ? ` · ${currentTool.detail}` : ''}`
    : member.running ? t('teamMemberWorking') : member.summary || t('teamNoProgress')
  const retry = useAction(async () => { if (member.ticketId) { await call('POST tickets/:id/retry', { id: member.ticketId }); await reload() } })
  const affected = new Set([member.id])
  for (let pass = 0; pass < team.members.length; pass++) for (const item of team.members) if (item.dependencies.some(id => affected.has(id))) affected.add(item.id)
  return <aside className="dt-team-details" data-stopped={team.state === 'stopped' || member.state === 'stopped' || undefined} tabIndex={-1} aria-label={t('teamDetails')}>
    <header className="dt-team-detail-head"><div className="dt-team-member-heading"><span className="dt-team-avatar"><Icon name={member.role === 'coordinator' ? 'queue' : 'user'} size={18} /></span>
      <div><h2>{t('teamMemberSession', { name: member.name })}</h2><p className="dt-team-session-caption">{member.role === 'coordinator' ? t('teamCoordinatorWork') : shortText(member.instructions, 45)}</p></div></div>
      <div className="dt-actions dt-team-native-controls">
        {member.sessionId && renderContext && <Button variant="ghost" size="sm" aria-pressed={view === 'context'} onClick={() => setView('context')}>{t('sessionContextTitle')}</Button>}
        {team.directory && <OpenWorkspaceButton directory={team.directory} compact />}
        <TeamFilesButton team={team} />
        {view !== 'conversation' && <Button variant="ghost" size="sm" aria-label={t('teamOpenSession')} title={t('teamOpenSession')} disabled={!member.sessionId} icon={<Icon name="session" />} onClick={() => setView('conversation')} />}
      </div>
    </header>
    <div className="dt-team-session-context"><TeamStatus state={member.state} member /><span>{team.name}</span></div>
    {(member.attention || member.state === 'failed') && <section className="dt-team-issue" role="status"><h3><Icon name="alert" />{t('teamNeedsHelp')}</h3>
      <p>{member.attention || member.summary}</p>{affected.size > 1 && <p>{t('teamImpact')}：{team.members.filter(item => item.id !== member.id && affected.has(item.id)).map(item => item.name).join('、')}</p>}
      {member.retry && <Button variant="outline" size="sm" disabled={retry.busy} onClick={() => { void retry.run() }}>{t('teamRetryMember')}</Button>}</section>}
    {view !== 'conversation' && <div className="dt-team-detail-tabs"><Button variant="ghost" size="sm" icon={<Icon name="session" />} onClick={() => setView('conversation')}>{t('teamReturnSession')}</Button>
      <span>{t(view === 'activity' ? 'teamActivity' : view === 'context' ? 'sessionContextTitle' : 'teamDelivery')}</span></div>}
    {view === 'conversation' && member.sessionId && !nativeSession && <div className="dt-team-model-bar"><SessionModelPicker key={member.sessionId} sessionId={member.sessionId} running={member.state === 'working'} /></div>}
    <div className={`dt-team-detail-content${view === 'conversation' ? ' dt-team-native-session' : view === 'context' ? ' dt-team-native-context' : ''}`} id="dt-member-content" role="region" aria-label={t(view === 'activity' ? 'teamActivity' : view === 'conversation' ? 'workbenchConversation' : view === 'context' ? 'sessionContextTitle' : 'teamDelivery')}>
      {view === 'context' && member.sessionId && renderContext ? renderContext(member.sessionId) : view === 'activity' ? <MemberActivity member={member} /> : view === 'delivery' ? <TeamDelivery team={team} />
        : member.sessionId && renderSession ? renderSession(member.sessionId) : <p className="dt-hint">{t('teamNotStarted')}</p>}
    </div>
    {!nativeSession && view === 'conversation' && member.ticketId && team.state !== 'stopped' && member.state !== 'stopped' && <div className="dt-team-followup"><LocalFollowup key={member.ticketId} id={member.ticketId} teamId={team.id} memberId={member.id}
      completed={member.state === 'finished'} onSent={reload} /></div>}
    {member.ticketId && <div className="dt-team-record-link"><div className="dt-team-activity-peek"><Button size="sm" variant="ghost" icon={<Icon name="history" />} onClick={() => setView('activity')}>{t('teamActivity')}</Button>
      <span>{shortText(activity, 40)}</span></div>
      <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'execution', id: member.ticketId! })}>{t('workbenchViewTask')}</Button>
      {member.sessionId && <SessionButton external sessionId={member.sessionId} label={t('teamOriginalSession')} />}</div>}
  </aside>
}
