/** Team-first workspace: actual goals, persisted assignments, sessions, handoffs, and deliveries. */
import type { TeamIndex, TeamView } from '../teams/contracts.ts'
import { useRef } from 'react'
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { LocalTaskComposer } from './local.tsx'
import { SingleWorkbench } from './local-single-workbench.tsx'
import { OpenWorkspaceButton } from './local-workspaces.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { TeamDelivery } from './team-delivery.tsx'
import { TeamDetails } from './team-details.tsx'
import { TeamGraph } from './team-graph.tsx'
import { TeamStatus, TeamText } from './team-ui.tsx'
import { ConfirmButton, LoadState, When } from './widgets.tsx'

function TeamOverview({ teams, select }: { teams: TeamIndex[]; select: (id: string) => void }) {
  const { t } = usePanel()
  return <section className="dt-team-overview" aria-label={t('teamOverview')}><header><h2>{t('teamOverview')}</h2><span className="dt-hint">{t('teamCount', { count: teams.length })}</span></header>
    {teams.length ? <div className="dt-team-overview-grid">{teams.map(team => <button type="button" className="dt-team-overview-item" key={team.id} onClick={() => select(team.id)}>
      <span className="dt-team-overview-name"><Icon name="user" size={19} /><strong>{team.name}</strong><Icon name="chevron-right" size={15} /></span><TeamStatus state={team.state} />
      <span className="dt-team-overview-goal">{team.instructions}</span><span className="dt-team-overview-progress">{team.summary || team.title}</span>
      <span className="dt-team-overview-footer">{t('teamCompletedCount', { done: team.completedMembers, total: team.memberCount })}<When at={team.updatedAt} /></span>
    </button>)}</div> : <div className="dt-team-empty"><Icon name="user" size={32} /><h3>{t('teamOverview')}</h3><p>{t('teamEmpty')}</p></div>}
  </section>
}
function Collaboration({ team, memberId, select, reload }: { team: TeamView; memberId: string; select: (id: string) => void; reload: () => Promise<void> }) {
  const { t, call } = usePanel()
  const retry = useAction(async () => { await call('POST local/teams/:id/retry', { id: team.id }); await reload() })
  const problems = team.members.filter(member => member.state === 'attention' || member.state === 'failed')
  return <section className="dt-team-center" aria-label={t('teamGraph')}>
    <header className="dt-team-goal-head"><div><h2>{team.name}</h2><TeamStatus state={team.state} /></div><span className="dt-hint">{t('teamCompletedCount', { done: team.completedMembers, total: team.memberCount })}</span></header>
    <div className="dt-team-center-scroll"><section className="dt-team-goal"><h3>{t('teamGoal')}</h3><TeamText text={team.instructions} />
      {team.directory && <div className="dt-team-directory"><span title={team.directory}>{team.directory}</span><OpenWorkspaceButton directory={team.directory} /></div>}</section>
      {team.error && <div className="dt-team-issue" role="alert"><p>{team.error}</p><Button variant="outline" size="sm" disabled={retry.busy} onClick={() => { void retry.run() }}>{t('teamRetry')}</Button></div>}
      {problems.length > 0 && <div className="dt-team-issue" role="status"><h3><Icon name="alert" />{t('teamStateAttention')}</h3>{problems.map(member => <div key={member.id}>
        <strong>{member.name}</strong><p>{member.attention || member.summary}</p><Button variant="outline" size="sm" onClick={() => select(member.id)}>{t('teamDetails')}</Button></div>)}</div>}
      <TeamGraph team={team} selected={memberId} select={select} /><TeamDelivery key={team.id} team={team} compact />
      {team.state !== 'stopped' && team.state !== 'completed' && <div className="dt-danger-zone"><ConfirmButton icon="stop" label={t('teamStop')} title={t('teamStop')} message={t('teamStopHint')}
        onConfirm={async () => { await call('POST local/teams/:id/stop', { id: team.id }); await reload() }} /></div>}
    </div>
  </section>
}

export function LocalWorkbench({ sessionId, teamId, memberId = 'coordinator' }: { sessionId?: string; teamId?: string; memberId?: string }) {
  const root = useRef<HTMLElement>(null)
  const { t, call, navigate, openWorkspace } = usePanel()
  const { state, restarts } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET local/workbench', { query: { team: teamId } }), [call, restarts, teamId], 2000)
  const select = (team?: string, member?: string) => navigate({ page: 'overview', query: team ? { team, member: member ?? 'coordinator' } : undefined }, true)
  const open = useAction(async () => { if (data?.workspace) await openWorkspace(data.workspace.id) })
  if (sessionId) return <><div className="dt-actions"><Button icon={<Icon name="chevron-left" />} onClick={() => select()}>{t('teamAll')}</Button></div><SingleWorkbench sessionId={sessionId === 'all-single' ? undefined : sessionId} /></>
  const team = teamId && data?.team?.id === teamId ? data.team : undefined
  const member = team?.members.find(member => member.id === memberId) ?? team?.members[0]
  const chooseMember = (id: string) => {
    if (!team) return
    select(team.id, id)
    const width = root.current?.getBoundingClientRect().width ?? 0
    if (width > 0 && width <= 760) requestAnimationFrame(() => {
      const details = root.current?.querySelector<HTMLElement>('.dt-team-details')
      details?.scrollIntoView({ block: 'start', behavior: 'auto' }); details?.focus({ preventScroll: true })
    })
  }
  const singles = data?.tasks.filter(task => !data.teamTicketIds.includes(task.id)) ?? []
  return <section ref={root} className="dt-team-workbench" aria-label={t('localWorkbench')}>
    <header className="dt-team-toolbar"><div><h2>{t('workbenchWorkspace')}</h2>{data?.workspace && <p title={data.workspace.directory}>{data.workspace.directory}</p>}</div>
      <div className="dt-actions"><Button variant="outline" icon={<Icon name="folder" />} disabled={!data?.workspace || open.busy} onClick={() => { void open.run() }}>{t('workbenchOpenWorkspace')}</Button><LocalTaskComposer team paused={state?.paused} /></div></header>
    {state?.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {Object.entries(state?.health ?? {}).filter(([, health]) => health.state === 'error').map(([id, health]) => <p className="dt-error" role="status" key={id}>{health.detail}</p>)}
    <LoadState loading={!data} error={error} />
    {data && <><label className="dt-team-compact-select"><span>{t('teamSelect')}</span><select className="dt-select" value={teamId ?? ''} onChange={event => select(event.target.value || undefined)}>
      <option value="">{t('teamAll')}</option>{data.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
      <div className={`dt-team-layout${!teamId ? ' dt-team-layout-overview' : ''}`}><nav className="dt-team-sidebar" aria-label={t('teamList')}>
        <button type="button" className="dt-team-nav-item" aria-pressed={!teamId} onClick={() => select()}><Icon name="history" /><strong>{t('teamAll')}</strong><span className="dt-count">{data.teams.length}</span></button>
        <ul>{data.teams.map(item => <li key={item.id}><button type="button" className="dt-team-nav-item" aria-pressed={teamId === item.id} onClick={() => select(item.id)}>
          <span className="dt-team-avatar"><Icon name="user" /></span><span><strong>{item.name}</strong><TeamStatus state={item.state} /></span></button></li>)}</ul>
        <div className="dt-team-singles"><button type="button" className="dt-team-nav-item" onClick={() => navigate({ page: 'overview', query: { session: 'all-single' } })}><Icon name="session" /><strong>{t('teamSingle')}</strong><span className="dt-count">{singles.length}</span></button>
          <ul>{singles.slice(0, 8).map(task => <li key={task.id}><button type="button" className="dt-team-nav-item" onClick={() => navigate(task.sessionId ? { page: 'overview', query: { session: task.sessionId } } : { page: 'execution', id: task.id })}>{task.title}</button></li>)}</ul></div>
        <Button size="sm" variant="ghost" icon={<Icon name="queue" />} onClick={() => navigate({ page: 'overview', query: { session: data.members.find(member => member.role === 'orchestrator')?.id ?? 'all-single' } })}>{t('teamDispatcher')}</Button>
      </nav>
      {!teamId ? <><TeamOverview teams={data.teams} select={select} /><aside className="dt-team-overview-details"><h3>{t('teamRecentDelivery')}</h3>
        {data.teams.filter(team => team.state === 'completed').slice(0, 5).map(team => <div key={team.id}><button type="button" className="dt-open" onClick={() => select(team.id)}>{team.name}</button><p>{team.summary}</p><When at={team.updatedAt} /></div>)}
        {!data.teams.some(team => team.state === 'completed') && <p className="dt-hint">{t('teamNoProgress')}</p>}</aside></>
        : team && member ? <><Collaboration team={team} memberId={member.id} select={chooseMember} reload={reload} /><TeamDetails key={`${team.id}:${member.id}`} team={team} member={member} reload={reload} /></>
          : <LoadState loading={!error} error={error} />}
    </div></>}
  </section>
}
