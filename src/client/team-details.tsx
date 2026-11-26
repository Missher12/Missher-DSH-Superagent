/** Real member activity, embedded DSH conversation, and delivery review. */
import { useState } from 'react'
import type { TeamView } from '../teams/contracts.ts'
import { Button, Icon } from './controls.tsx'
import { LocalFollowup } from './local.tsx'
import { SessionModelPicker } from './model-picker.tsx'
import { MemberChat, type MemberChatRequest, useAction, usePanel } from './provider.tsx'
import { TeamDelivery } from './team-delivery.tsx'
import { TeamCompletion, TeamAcceptance } from './team-acceptance.tsx'
import { ResumeTeam } from './team-collaboration.tsx'
import { SessionFiles } from './team-file-preview.tsx'
import { TeamStatus } from './team-ui.tsx'
import { SessionButton, When } from './widgets.tsx'
import { workbenchToolLabel } from './text.ts'
import { participantIcon, participantDetail, participantStatus, type TeamParticipant } from './team-participants.ts'

function MemberActivity({ team, member }: { team: TeamView; member: TeamParticipant }) {
  const { t } = usePanel()
  const records = [...member.tools.map(tool => ({ id: tool.id, at: tool.at, kind: 'tool', title: workbenchToolLabel(t, tool.name), text: tool.detail, state: tool.state })),
    ...member.events.map(event => ({ ...event, kind: 'report', title: event.state === 'started' ? t('teamStarted') : t('workbenchEvent.report'), text: event.summary }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  return <div className="dt-team-member-activity">
    <section className="dt-team-activity-summary"><TeamStatus state={member.state} member label={participantStatus(team, member, t)} />
      <p>{member.summary || t('teamNoProgress')}</p></section>
    <section><h3>{t('teamRecords')}</h3>{records.length ? <ol className="dt-team-records">{records.map(record => <li key={record.id}>
      <span className="dt-team-record-icon" data-state={record.state}><Icon name={record.state === 'error' || record.state === 'failed' ? 'alert' : record.kind === 'tool' ? 'session' : 'message'} size={15} /></span>
      <div><div className="dt-team-record-head"><strong>{record.title}</strong><When at={record.at} /></div>
        {record.text && <p>{record.text}</p>}{record.kind === 'tool' && <span className="dt-hint">{t(`workbenchToolState.${record.state as 'running' | 'done' | 'error' | 'interrupted'}`)}</span>}</div>
    </li>)}</ol> : <p className="dt-hint">{t('teamNoRecords')}</p>}</section>
  </div>
}

export function TeamDetails({ team, member, reload, view: selectedView, onView, chatRequest, hidden }: { hidden?: boolean; team: TeamView; member: TeamParticipant; reload: () => Promise<void>;
  chatRequest?: MemberChatRequest;
  view?: 'activity' | 'conversation' | 'context' | 'delivery'; onView?: (view: 'activity' | 'conversation' | 'context' | 'delivery') => void }) {
  const { t, call, renderSession, renderContext, nativeSession, navigate } = usePanel()
  const [ownView, setOwnView] = useState<'activity' | 'conversation' | 'context' | 'delivery'>('conversation')
  const preferredView = selectedView ?? ownView, setView = onView ?? setOwnView
  const view = preferredView === 'context' && (!renderContext || !member.sessionId) ? 'conversation' : preferredView
  const commander = member.role === 'commander', directory = member.directory ?? team.directory
  const sharedCommander = commander && !member.ticketId
  const files = [...team.finalDelivery?.artifacts ?? team.finalDelivery?.record.files ?? [], ...team.deliveries.flatMap(delivery => delivery.record.files)].map(file => file.path)
  const activity = participantDetail(team, member, t)
  const retry = useAction(async () => { if (member.ticketId) { await call('POST tickets/:id/retry', { id: member.ticketId }); await reload() } })
  const affected = new Set([member.id])
  for (let pass = 0; pass < team.members.length; pass++) for (const item of team.members) if (item.dependencies.some(id => affected.has(id))) affected.add(item.id)
  return <aside className="dt-team-details" id={hidden ? undefined : 'dt-team-right'} hidden={hidden} data-native-chat={nativeSession && view === 'conversation' && !!member.sessionId || undefined} data-stopped={!commander && (team.state === 'stopped' || member.state === 'stopped') || undefined} tabIndex={-1} aria-label={t('teamDetails')}>
    {(!nativeSession || view !== 'conversation' || !member.sessionId) && <header className="dt-team-detail-head"><div className="dt-team-member-heading"><span className="dt-team-avatar"><Icon name={participantIcon(member)} size={18} /></span>
      <div><h2 title={member.name}>{member.name}</h2></div></div>
      <div className="dt-actions dt-team-native-controls">
        {(!nativeSession || view !== 'conversation') && <Button variant="ghost" size="sm" aria-label={t('teamOpenSession')} title={t('teamOpenSession')} aria-pressed={view === 'conversation'} aria-controls="dt-member-content" onClick={() => setView('conversation')}>{t('workbenchConversation')}</Button>}
        {renderContext && <Button variant="ghost" size="sm" disabled={!member.sessionId} aria-pressed={view === 'context'} aria-controls="dt-member-content" onClick={() => setView('context')}>{t('sessionContextTitle')}</Button>}
      </div>
    </header>}
    {!commander && team.workflow?.halted && team.state !== 'stopped' && <ResumeTeam key={team.id} team={team} reload={reload} />}
    {team.state === 'draft' && member.sessionId && <p className="dt-hint dt-flow-ready">{t(team.confirmStart ? 'flowDiscussFirst' : 'flowChatReady')}</p>}
    {(member.attention || member.state === 'failed') && <section className="dt-team-issue" role="status"><h3><Icon name="alert" />{t('teamNeedsHelp')}</h3>
      <p>{member.attention || member.summary}</p>{affected.size > 1 && <p>{t('teamImpact')}：{team.members.filter(item => item.id !== member.id && affected.has(item.id)).map(item => item.name).join('、')}</p>}
      {member.retry && <Button variant="outline" size="sm" disabled={retry.busy} onClick={() => { void retry.run() }}>{t('teamRetryMember')}</Button>}</section>}
    {view === 'conversation' && member.sessionId && !nativeSession && <div className="dt-team-model-bar"><SessionModelPicker key={member.sessionId} sessionId={member.sessionId} running={member.state === 'working'} /></div>}
    <div className={`dt-team-detail-content${view === 'conversation' ? ' dt-team-native-session' : view === 'context' ? ' dt-team-native-context' : ''}`} id="dt-member-content" role="region" aria-label={t(view === 'activity' ? 'teamActivity' : view === 'conversation' ? 'workbenchConversation' : view === 'context' ? 'sessionContextTitle' : 'teamDelivery')}>
      {view === 'context' && member.sessionId && renderContext ? renderContext(member.sessionId) : view === 'activity' ? <MemberActivity team={team} member={member} /> : view === 'delivery' ? <><TeamDelivery team={team} /><details className="dt-delivery-review"><summary>{t('teamReviewEvidence')}</summary>
          <TeamCompletion team={team} /><TeamAcceptance team={team} reload={reload} /></details></>
        : member.sessionId && renderSession ? <SessionFiles scope={{ kind: sharedCommander ? 'session' : 'team', id: sharedCommander ? member.sessionId : team.id, directory, sessionId: member.sessionId,
          files: sharedCommander ? [] : files }}><MemberChat.Provider value={{ name: member.name, request: chatRequest }}>{renderSession(member.sessionId)}</MemberChat.Provider></SessionFiles> : <p className="dt-hint">{t('teamNotStarted')}</p>}
    </div>
    {!nativeSession && view === 'conversation' && member.ticketId && team.state !== 'stopped' && member.state !== 'stopped' && <div className="dt-team-followup"><LocalFollowup key={member.ticketId} id={member.ticketId} teamId={team.id} memberId={member.id}
      completed={member.state === 'finished'} onSent={reload} /></div>}
    {!nativeSession && (member.ticketId || commander) && <div className="dt-team-record-link"><div className="dt-team-activity-peek"><Button size="sm" variant="ghost" icon={<Icon name="history" />} aria-pressed={view === 'activity'} aria-controls="dt-member-content" onClick={() => setView('activity')}>{t('teamActivity')}</Button>
      <span>{activity}</span></div>
      {member.ticketId && <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'execution', id: member.ticketId! })}>{t('workbenchViewTask')}</Button>}
      {member.sessionId && <SessionButton external sessionId={member.sessionId} label={t('teamOriginalSession')} />}</div>}
  </aside>
}
