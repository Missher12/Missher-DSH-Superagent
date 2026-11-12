/** Multiple independently closable task views, with native conversations and their real teams. */
import { useEffect, useRef, useState } from 'react'
import type { TeamIndex } from '../teams/contracts.ts'
import { Button, Icon, SegmentedTabs } from './controls.tsx'
import { SingleWorkbench } from './local-single-workbench.tsx'
import { usePanel, usePanelData } from './provider.tsx'
import { TeamDetails } from './team-details.tsx'
import { TeamCollaboration } from './team-collaboration.tsx'
import { TeamStatus } from './team-ui.tsx'
import { LoadState, When } from './widgets.tsx'
import { healthText, shortText } from './text.ts'
import { PaneDivider, usePaneWidth, useStudio } from './studio-layout.tsx'
import { Select } from './select.tsx'

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
    <p>{shortText(team.currentAction || team.summary || team.instructions)}</p>
    <span className="dt-team-overview-footer">{t('teamCompletedCount', { done: team.completedMembers, total: team.memberCount })}<When at={team.updatedAt} /></span>
  </button>)}</div>{!teams.length && <p className="dt-hint">{t('teamEmpty')}</p>}</section>
}

export function LocalWorkbench({ sessionId, teamId, memberId = 'coordinator' }: { sessionId?: string; teamId?: string; memberId?: string }) {
  const root = useRef<HTMLElement>(null)
  const { t, navigate } = usePanel(), { state } = usePanelData()
  const { data, error, reload, contentWidth, compactTeam, rightHidden, pane, setPane } = useStudio()
  const right = usePaneWidth('right', contentWidth - 340)
  const [views, setViews] = useState(openViews), [detail, setDetail] = useState<'activity' | 'conversation' | 'context' | 'delivery'>('conversation')
  const current = teamId ? `team:${teamId}` : sessionId ? `session:${sessionId}` : undefined
  const team = data?.team && data.team.id === teamId ? data.team : undefined
  const title = team?.name ?? data?.tasks.find(task => task.sessionId === sessionId || `worker-${task.id}` === sessionId)?.title
    ?? views.find(view => viewKey(view) === current)?.title
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
  const selectView = (view?: WorkspaceView, nextDetail: 'conversation' | 'context' = 'conversation') => {
    setDetail(nextDetail); setPane('conversation')
    navigate({ page: 'overview', query: view?.kind === 'team' ? { team: view.id, member: view.member ?? lastMember(view.id) }
      : view ? { session: view.id } : undefined }, true)
  }
  const selectTeam = (id: string) => selectView({ kind: 'team', id, title: data?.teams.find(team => team.id === id)?.name ?? id, member: lastMember(id) })
  const selectMember = (id: string) => {
    if (!team) return
    selectView({ kind: 'team', id: team.id, title: team.name, member: id }, detail === 'context' ? 'context' : 'conversation')
    if ((root.current?.getBoundingClientRect().width ?? 1000) <= 640) requestAnimationFrame(() => {
      const pane = root.current?.querySelector<HTMLElement>('.dt-team-details'); pane?.scrollIntoView({ block: 'start' }); pane?.focus({ preventScroll: true })
    })
  }
  const close = (key: string) => {
    const index = views.findIndex(view => viewKey(view) === key), remaining = views.filter(view => viewKey(view) !== key)
    setViews(remaining)
    if (key === current) selectView(remaining[Math.min(index, remaining.length - 1)])
  }
  const member = team?.members.find(member => member.id === memberId) ?? team?.members[0]
  return <section ref={root} className="dt-team-workbench dt-team-focus-workbench" aria-label={t('localWorkbench')}>
    {state?.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {Object.entries(state?.health ?? {}).filter(([, health]) => health.state === 'error').map(([id, health]) => <p className="dt-error" role="status" key={id}>{healthText(t, health)}</p>)}
    <nav className="dt-team-workspace-tabs" aria-label={t('teamWorkspaceTabs')}><div>{views.map(view => <div key={viewKey(view)} className="dt-team-workspace-tab" data-selected={viewKey(view) === current || undefined}>
      <button type="button" aria-pressed={viewKey(view) === current} onClick={() => selectView(view)}>{view.kind === 'team' && data?.teams.find(team => team.id === view.id)?.activeMembers ? <Icon name="running" size={13} /> : <Icon name={view.kind === 'team' ? 'queue' : 'session'} size={13} />}<span>{view.title}</span></button>
      <button type="button" className="dt-team-tab-close" aria-label={t('teamCloseWorkspace', { name: view.title })} title={t('close')} onClick={() => close(viewKey(view))}><Icon name="close" size={13} /></button>
    </div>)}</div><Button size="sm" disabled={!views.length} onClick={() => { setViews([]); selectView() }}>{t('teamCloseAll')}</Button></nav>
    <LoadState loading={!data} error={error} />
    {data && <><div className="dt-team-compact-bar">{team && <div className="dt-team-mobile-panels"><SegmentedTabs value={pane} onChange={setPane} label={t('teamCompactPane')} items={[
        { value: 'conversation', label: t('workbenchConversation'), id: 'dt-compact-conversation', panelId: 'dt-team-workspace-content' },
        { value: 'team', label: t('teamCompactTeam'), id: 'dt-compact-team', panelId: 'dt-team-workspace-content' },
      ]} /></div>}
      <label className="dt-team-compact-select"><span>{t('teamSelect')}</span><Select aria-label={t('teamSelect')} value={teamId ?? ''} onChange={event => event.target.value ? selectTeam(event.target.value) : selectView()}>
        <option value="">{t('teamAll')}</option>{data.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label></div>
      <div id="dt-team-workspace-content" data-compact-pane={pane} data-compact-team={compactTeam || undefined} data-right-hidden={rightHidden || undefined}
        style={{ gridTemplateColumns: !team || current === undefined || compactTeam || rightHidden ? 'minmax(0,1fr)' : `minmax(0,1fr) 6px ${right.width}px` }} className={`dt-team-layout dt-team-focus-layout${!current ? ' dt-team-layout-overview' : ''}${sessionId ? ' dt-team-layout-single' : ''}`}>
        {!current ? <section className="dt-team-empty-workspace"><div className="dt-team-open-invitation"><Icon name="folder" size={32} /><h2>{t('teamOpenInvitation')}</h2><p>{t('teamOpenInvitationHint')}</p></div>
          <TeamOverview teams={data.teams} select={selectTeam} /></section>
          : sessionId ? <div className="dt-team-single-space"><SingleWorkbench sessionId={sessionId === 'all-single' ? undefined : sessionId} /></div>
            : team && member ? <><TeamDetails key={`${team.id}:${member.id}`} team={team} member={member} reload={reload} view={detail} onView={setDetail} onMember={selectMember} />
              <PaneDivider pane={right} /><TeamCollaboration team={team} selected={member.id} select={selectMember} reload={reload} delivery={() => setDetail('delivery')} /></>
              : <LoadState loading={!error} error={error} />}
      </div></>}
  </section>
}
