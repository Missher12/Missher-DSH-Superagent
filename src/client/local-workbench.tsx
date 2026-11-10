/** Multiple independently closable task views, with native conversations and their real teams. */
import { useEffect, useRef, useState } from 'react'
import type { TeamIndex } from '../teams/contracts.ts'
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { LocalTaskComposer } from './local.tsx'
import { SingleWorkbench } from './local-single-workbench.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { TeamDetails } from './team-details.tsx'
import { TeamCollaboration } from './team-collaboration.tsx'
import { TeamStatus } from './team-ui.tsx'
import { LoadState, When } from './widgets.tsx'

interface WorkspaceView { kind: 'team' | 'session'; id: string; title: string; member?: string }
const STORAGE = 'dsh-superagent/open-workspaces'
const viewKey = (view: Pick<WorkspaceView, 'kind' | 'id'>) => `${view.kind}:${view.id}`
function openViews(): WorkspaceView[] {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem(STORAGE) ?? '[]')
    return Array.isArray(list) ? list.filter((item): item is WorkspaceView => !!item && typeof item === 'object'
      && ['team', 'session'].includes(item.kind) && typeof item.id === 'string' && typeof item.title === 'string') : []
  } catch { return [] }
}
function lastMember(id: string) { try { return sessionStorage.getItem(`dsh-superagent/team-member/${id}`) ?? 'coordinator' } catch { return 'coordinator' } }

function TeamOverview({ teams, select }: { teams: TeamIndex[]; select: (id: string) => void }) {
  const { t } = usePanel()
  return <section className="dt-team-overview" aria-label={t('teamOverview')}><div className="dt-team-overview-grid">{teams.map(team => <button type="button" key={team.id}
    className="dt-team-overview-item" data-active={!!team.activeMembers || undefined} onClick={() => select(team.id)}>
    <span className="dt-team-overview-head"><strong>{team.name}</strong><TeamStatus state={team.state} /></span>
    <p>{team.currentAction || team.summary || team.instructions}</p>
    <span className="dt-team-overview-footer">{t('teamCompletedCount', { done: team.completedMembers, total: team.memberCount })}<When at={team.updatedAt} /></span>
  </button>)}</div>{!teams.length && <p className="dt-hint">{t('teamEmpty')}</p>}</section>
}

export function LocalWorkbench({ sessionId, teamId, memberId = 'coordinator' }: { sessionId?: string; teamId?: string; memberId?: string }) {
  const root = useRef<HTMLElement>(null)
  const { t, call, navigate, openWorkspace } = usePanel(), { state, restarts } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET local/workbench', { query: { team: teamId, session: sessionId } }), [call, restarts, teamId, sessionId], 2000)
  const [views, setViews] = useState(openViews), [detail, setDetail] = useState<'activity' | 'conversation' | 'delivery'>('conversation')
  const current = teamId ? `team:${teamId}` : sessionId ? `session:${sessionId}` : undefined
  const team = data?.team && data.team.id === teamId ? data.team : undefined
  const title = team?.name ?? data?.tasks.find(task => task.sessionId === sessionId || `worker-${task.id}` === sessionId)?.title
    ?? (sessionId === 'all-single' ? t('teamSingle') : teamId ?? sessionId ?? '')
  useEffect(() => {
    if (!current) return
    const incoming: WorkspaceView = teamId ? { kind: 'team', id: teamId, title, member: memberId } : { kind: 'session', id: sessionId!, title }
    setViews(list => {
      const existing = list.find(view => viewKey(view) === current)
      if (existing?.title === incoming.title && existing?.member === incoming.member) return list
      return existing ? list.map(view => viewKey(view) === current ? incoming : view) : [...list, incoming]
    })
    if (teamId) { try { sessionStorage.setItem(`dsh-superagent/team-member/${teamId}`, memberId) } catch { /* Optional view memory. */ } }
  }, [current, teamId, sessionId, title, memberId])
  useEffect(() => { try { sessionStorage.setItem(STORAGE, JSON.stringify(views)) } catch { /* Optional view memory. */ } }, [views])
  const selectView = (view?: WorkspaceView) => {
    setDetail('conversation')
    navigate({ page: 'overview', query: view?.kind === 'team' ? { team: view.id, member: view.member ?? lastMember(view.id) }
      : view ? { session: view.id } : undefined }, true)
  }
  const selectTeam = (id: string) => selectView({ kind: 'team', id, title: data?.teams.find(team => team.id === id)?.name ?? id, member: lastMember(id) })
  const selectMember = (id: string) => {
    if (!team) return
    selectView({ kind: 'team', id: team.id, title: team.name, member: id })
    if ((root.current?.getBoundingClientRect().width ?? 1000) <= 760) requestAnimationFrame(() => {
      const pane = root.current?.querySelector<HTMLElement>('.dt-team-details'); pane?.scrollIntoView({ block: 'start' }); pane?.focus({ preventScroll: true })
    })
  }
  const close = (key: string) => {
    const index = views.findIndex(view => viewKey(view) === key), remaining = views.filter(view => viewKey(view) !== key)
    setViews(remaining)
    if (key === current) selectView(remaining[Math.min(index, remaining.length - 1)])
  }
  const member = team?.members.find(member => member.id === memberId) ?? team?.members[0]
  const open = useAction(async () => { if (data?.workspace) await openWorkspace(data.workspace.id) })
  const singles = data?.tasks.filter(task => !data.teamTicketIds.includes(task.id)) ?? []
  return <section ref={root} className="dt-team-workbench dt-team-focus-workbench" aria-label={t('localWorkbench')}>
    <header className="dt-team-toolbar"><div><h2>{team?.name ?? (current ? title : t('localWorkbench'))}</h2>
      <p title={team?.directory ?? data?.workspace?.directory}>{team?.directory ?? data?.workspace?.directory}</p></div>
      <div className="dt-actions">{team && <TeamStatus state={team.state} />}<Button variant="outline" icon={<Icon name="folder" />} disabled={!data?.workspace || open.busy}
        onClick={() => { void open.run() }}>{t('workbenchOpenWorkspace')}</Button><LocalTaskComposer team paused={state?.paused} /></div></header>
    {state?.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {Object.entries(state?.health ?? {}).filter(([, health]) => health.state === 'error').map(([id, health]) => <p className="dt-error" role="status" key={id}>{health.detail}</p>)}
    <nav className="dt-team-workspace-tabs" aria-label={t('teamWorkspaceTabs')}><div>{views.map(view => <div key={viewKey(view)} className="dt-team-workspace-tab" data-selected={viewKey(view) === current || undefined}>
      <button type="button" aria-pressed={viewKey(view) === current} onClick={() => selectView(view)}>{view.kind === 'team' && data?.teams.find(team => team.id === view.id)?.activeMembers ? <Icon name="running" size={13} /> : <Icon name={view.kind === 'team' ? 'queue' : 'session'} size={13} />}<span>{view.title}</span></button>
      <button type="button" className="dt-team-tab-close" aria-label={t('teamCloseWorkspace', { name: view.title })} title={t('close')} onClick={() => close(viewKey(view))}><Icon name="close" size={13} /></button>
    </div>)}</div><Button size="sm" disabled={!views.length} onClick={() => { setViews([]); selectView() }}>{t('teamCloseAll')}</Button></nav>
    <LoadState loading={!data} error={error} />
    {data && <><label className="dt-team-compact-select"><span>{t('teamSelect')}</span><select className="dt-select" value={teamId ?? ''} onChange={event => event.target.value ? selectTeam(event.target.value) : selectView()}>
      <option value="">{t('teamAll')}</option>{data.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
      <div className={`dt-team-layout dt-team-focus-layout${!current ? ' dt-team-layout-overview' : ''}${sessionId ? ' dt-team-layout-single' : ''}`}>
        <nav className="dt-team-sidebar" aria-label={t('teamList')}><div className="dt-team-list-heading"><strong>{t('teamTasks')}</strong><span className="dt-count">{data.teams.length}</span></div>
          <button type="button" className="dt-team-nav-item" aria-pressed={!current} onClick={() => selectView()}><Icon name="history" /><strong>{t('teamAll')}</strong></button>
          <ul>{data.teams.map(item => <li key={item.id}><button type="button" className="dt-team-nav-item" data-active={!!item.activeMembers || undefined} aria-pressed={teamId === item.id} onClick={() => selectTeam(item.id)} title={item.currentAction || item.name}>
            <span><strong>{item.name}</strong><TeamStatus state={item.state} />{item.currentAction && <small className="dt-team-live-action">{item.currentAction}</small>}</span></button></li>)}</ul>
          <div className="dt-team-singles"><button type="button" className="dt-team-nav-item" onClick={() => selectView({ kind: 'session', id: 'all-single', title: t('teamSingle') })}><Icon name="session" /><strong>{t('teamSingle')}</strong><span className="dt-count">{singles.length}</span></button>
            <ul>{singles.slice(0, 8).map(task => <li key={task.id}><button type="button" className="dt-team-nav-item" onClick={() => selectView({ kind: 'session', id: task.sessionId || `worker-${task.id}`, title: task.title })}>{task.title}</button></li>)}</ul></div>
          <Button size="sm" variant="ghost" icon={<Icon name="queue" />} onClick={() => selectView({ kind: 'session', id: data.members.find(member => member.role === 'orchestrator')?.id ?? 'all-single', title: t('teamDispatcher') })}>{t('teamDispatcher')}</Button>
        </nav>
        {!current ? <section className="dt-team-empty-workspace"><div className="dt-team-open-invitation"><Icon name="folder" size={32} /><h2>{t('teamOpenInvitation')}</h2><p>{t('teamOpenInvitationHint')}</p></div>
          <TeamOverview teams={data.teams} select={selectTeam} /></section>
          : sessionId ? <div className="dt-team-single-space"><SingleWorkbench sessionId={sessionId === 'all-single' ? undefined : sessionId} /></div>
            : team && member ? <><TeamDetails key={`${team.id}:${member.id}`} team={team} member={member} reload={reload} view={detail} onView={setDetail} />
              <TeamCollaboration team={team} selected={member.id} select={selectMember} reload={reload} delivery={() => setDetail('delivery')} /></>
              : <LoadState loading={!error} error={error} />}
      </div></>}
  </section>
}
