/** Dedicated Superagent workspace with actual session identities, current work, and live activity. */
import { useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Dot, Icon, SegmentedTabs } from './controls.tsx'
import { LocalFollowup, LocalTaskComposer } from './local.tsx'
import { SessionModelPicker } from './model-picker.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { actorName, valueLabel, type T } from './text.ts'
import { LoadState, SessionButton, StageMark, When } from './widgets.tsx'

type View = ApiResponse<'GET local/workbench'>
type Member = View['members'][number]
const dot = { running: 'ongoing', idle: 'idle', attention: 'warning', finished: 'idle' } as const
const toolNames: Record<string, 'read' | 'write' | 'edit' | 'search' | 'shell' | 'job' | 'report' | 'reply' | 'dispatch'> = {
  read: 'read', read_image: 'read', write: 'write', edit: 'edit', glob: 'search', grep: 'search', bash: 'shell', pwsh: 'shell',
  job_output: 'job', job_list: 'job', orchestrator_report: 'report', orchestrator_reply: 'reply', orchestrator_decide: 'dispatch',
}
const toolLabel = (t: T, name: string) => t(`workbenchTool.${toolNames[name] ?? 'other'}`, { name })
const memberName = (t: T, member: Member) => member.role === 'orchestrator' ? t('workbenchCoordinator') : member.title

function CurrentTasks({ data, member }: { data: View; member: Member | undefined }) {
  const { t, navigate } = usePanel()
  const tasks = member?.taskId ? data.tasks.filter(task => task.id === member.taskId) : data.tasks.filter(task => task.stage !== 'ended')
  return <section className="dt-workbench-current" aria-label={t('workbenchCurrentTasks')}>
    <div className="dt-workbench-section-head"><h3>{t(member?.taskId ? 'workbenchRelatedTask' : 'workbenchCurrentTasks')}</h3>
      <Button variant="ghost" size="sm" onClick={() => navigate({ page: 'execution' })}>{t('workbenchViewAll')}</Button></div>
    {tasks.length ? <ul className="dt-workbench-tasks">{tasks.map(task => <li key={task.id}>
      <span className="dt-workbench-task-icon"><Icon name={task.stage === 'working' ? 'running' : 'session'} size={18} /></span>
      <div><strong>{task.title}</strong><span className="dt-hint" title={task.directory}>{task.directory?.split('/').filter(Boolean).at(-1)}</span></div>
      <Button variant="outline" size="sm" onClick={() => navigate({ page: 'execution', id: task.id })}>{t('workbenchViewTask')}</Button>
    </li>)}</ul> : <p className="dt-workbench-empty">{t('workbenchNoRunning')}</p>}
  </section>
}

function ActivityFeed({ data, member }: { data: View; member: Member | undefined }) {
  const { t, navigate } = usePanel()
  const activity = member ? data.activity.filter(item => item.memberId === member.id) : data.activity
  return <section className="dt-workbench-activity" aria-label={t('workbenchActivity')}>
    <div className="dt-workbench-section-head"><h3>{t('workbenchActivity')}</h3><span className="dt-workbench-live"><Dot state="ongoing" />{t('workbenchLive')}</span></div>
    {activity.length ? <ol className="dt-workbench-feed">{activity.map(item => {
      const who = data.members.find(member => member.id === item.memberId)
      return <li key={item.id}>
        <span className="dt-workbench-event-icon" data-state={item.state === 'error' || item.state === 'failed' ? 'error' : undefined}>
          <Icon name={item.kind === 'received' ? 'queue' : item.kind === 'assigned' || item.kind === 'tool' ? 'running' : item.kind === 'ended' ? 'decision' : 'session'} size={15} /></span>
        <div className="dt-workbench-event-content"><div className="dt-workbench-event-head">
          <strong>{who ? who.role === 'orchestrator' ? t('workbenchCoordinator') : t('workbenchWorker') : t('workbenchWorker')}</strong>
          <span>{item.kind === 'tool' && item.tool ? toolLabel(t, item.tool) : t(`workbenchEvent.${item.kind}`)}</span><When at={item.at} />
        </div>
        {item.title && <button type="button" className="dt-open dt-workbench-event-title" disabled={!item.ticketId}
          onClick={() => { if (item.ticketId) navigate({ page: 'execution', id: item.ticketId }) }}>{item.title}</button>}
        {item.actor && <span className="dt-workbench-origin">{actorName(t, item.actor)}</span>}
        {item.summary && <p className="dt-workbench-event-summary">{item.summary}</p>}
        {item.kind === 'tool' && item.state && <span className="dt-hint">{t(`workbenchToolState.${item.state as 'running' | 'done' | 'error' | 'interrupted'}`)}</span>}
        </div>
      </li>
    })}</ol> : <p className="dt-workbench-empty">{t('workbenchNoActivity')}</p>}
  </section>
}

export function SingleWorkbench({ sessionId }: { sessionId?: string }) {
  const { t, call, openWorkspace, renderSession, nativeSession, navigate } = usePanel()
  const { state, restarts } = usePanelData()
  const { data, error, reload } = usePoll(async () => {
    const value = await call('GET local/workbench', { query: { session: sessionId } })
    const teamTasks = new Set(value.teamTicketIds)
    return { ...value, members: value.members.filter(member => !member.taskId || !teamTasks.has(member.taskId)),
      tasks: value.tasks.filter(task => !teamTasks.has(task.id)), activity: value.activity.filter(item => !item.ticketId || !teamTasks.has(item.ticketId)) }
  }, [call, restarts, sessionId], 2000)
  const [view, setView] = useState<'conversation' | 'activity'>('conversation')
  const select = (id?: string) => { setView('conversation'); navigate({ page: 'overview', ...(id ? { query: { session: id } } : {}) }, true) }
  const member = data?.members.find(member => member.id === sessionId)
  const stopped = !!member?.taskId && data?.tasks.find(task => task.id === member.taskId)?.ended?.by === 'human'
  const open = useAction(async () => { if (data?.workspace) await openWorkspace(data.workspace.id) })
  const problems = Object.entries(state?.health ?? {}).filter(([, health]) => health.state === 'error')
  return <section className="dt-workbench" aria-label={t('localWorkbench')}>
    <header className="dt-workbench-toolbar"><div className="dt-workbench-workspace">
      <span className="dt-workbench-workspace-icon"><Icon name="folder" size={22} /></span><div><h2>{t('workbenchWorkspace')}</h2>
        {data?.workspace && <p title={data.workspace.directory}>{data.workspace.directory}</p>}</div></div>
      <div className="dt-actions"><Button variant="outline" icon={<Icon name="folder" />} disabled={!data?.workspace || open.busy}
        onClick={() => { void open.run() }}>{t('workbenchOpenWorkspace')}</Button><LocalTaskComposer paused={state?.paused ?? false} /></div>
    </header>
    {state?.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {problems.map(([name, health]) => <p className="dt-error" role="status" key={name}>{health.detail}</p>)}
    <LoadState loading={!data} error={error} />
    {data && <div className="dt-workbench-layout"><aside className="dt-workbench-members" aria-label={t('workbenchMembers')}>
      <div className="dt-workbench-section-head"><h3>{t('workbenchMembers')}</h3><span className="dt-count">{data.members.length}</span></div>
      <button className="dt-workbench-member dt-workbench-all" type="button" aria-pressed={!member} onClick={() => select()}>
        <Icon name="history" size={18} /><strong>{t('workbenchAll')}</strong></button>
      <ul>{data.members.map(item => <li key={item.id}><button className="dt-workbench-member" type="button" aria-pressed={member?.id === item.id}
        aria-label={item.role === 'orchestrator' ? t('workbenchCoordinator') : t('workbenchWorkerSelect', { title: item.title })} onClick={() => select(item.id)}>
        <span className="dt-workbench-member-icon"><Icon name={item.role === 'orchestrator' ? 'queue' : 'session'} size={18} /><Dot state={dot[item.state]} /></span>
        <span className="dt-workbench-member-copy"><strong>{memberName(t, item)}</strong><span>{item.role === 'orchestrator' ? t(item.state === 'idle' ? 'workbenchWaiting' : 'workbenchCoordinatorHint')
          : t(`workbenchState.${item.state}`)}</span></span>
      </button></li>)}</ul>
      <div className="dt-workbench-sources"><h3>{t('workbenchSources')}</h3>{data.sources.map(source => <div key={source.id}>
        <Dot state={source.enabled ? 'done' : 'idle'} /><span>{typeof source.title === 'string' ? source.title : source.title[t('lang').startsWith('zh') ? 'zh' : 'en']}</span>
        <span className="dt-hint">{t(source.enabled ? 'workbenchSourceEnabled' : 'workbenchSourceDisabled')}</span></div>)}</div>
    </aside><div className="dt-workbench-main">
      {member && <header className="dt-workbench-focus"><div><h2>{memberName(t, member)}</h2><div className="dt-workbench-focus-meta">
        <StageMark state={dot[member.state]} icon={member.state === 'running' ? 'running' : member.state === 'attention' ? 'ask' : 'decision'} label={t(`workbenchState.${member.state}`)} />
        {member.actor && <span>{valueLabel(t, 'source', member.actor.source)} · {actorName(t, member.actor)}</span>}
        </div>{member.directory && <p className="dt-hint dt-workbench-directory" title={member.directory}>{member.directory}</p>}</div>
        <div className="dt-actions">{member.taskId && <Button variant="ghost" size="sm" onClick={() => navigate({ page: 'execution', id: member.taskId! })}>{t('workbenchViewTask')}</Button>}
          <SessionButton sessionId={member.id} label={t('workbenchExternalSession')} variant="outline" external /></div></header>}
      {member?.tools.some(tool => tool.state === 'running') && <div className="dt-workbench-now" role="status"><Dot state="ongoing" />
        {member.tools.filter(tool => tool.state === 'running').map(tool => toolLabel(t, tool.name)).join('、')}</div>}
      {member?.role === 'orchestrator' && <p className="dt-hint">{t('teamDispatcherHint')}</p>}
      {member && renderSession ? <>
        <div className="dt-workbench-session-bar">
          <SegmentedTabs className="dt-session-tabs" label={t('workbenchConversation')} value={view} onChange={setView}
            items={(['conversation', 'activity'] as const).map(value => ({ value, label: t(value === 'conversation' ? 'workbenchConversation' : 'workbenchActivity'), id: `dt-session-${value}`, panelId: 'dt-session-content' }))} />
          {!nativeSession && <SessionModelPicker key={member.id} sessionId={member.id} running={member.state === 'running'} />}
        </div>
        {view === 'conversation' ? <><div id="dt-session-content" role="tabpanel" aria-labelledby="dt-session-conversation" className="dt-workbench-conversation" data-stopped={stopped || undefined}>{renderSession(member.id)}</div>
          {!nativeSession && !stopped && member.taskId && <div className="dt-workbench-followup"><LocalFollowup key={member.taskId} id={member.taskId} completed={member.state === 'finished'} onSent={reload} /></div>}</>
          : <div id="dt-session-content" role="tabpanel" aria-labelledby="dt-session-activity" className="dt-workbench-history"><ActivityFeed data={data} member={member} /></div>}
      </> : <><CurrentTasks data={data} member={member} /><ActivityFeed data={data} member={member} /></>}
    </div></div>}
  </section>
}
