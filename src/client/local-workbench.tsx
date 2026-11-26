/** Multiple independently closable task views, with native conversations and their real teams. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamIndex } from '../teams/contracts.ts'
import { Button, Icon, SegmentedTabs } from './controls.tsx'
import { SingleWorkbench } from './local-single-workbench.tsx'
import { usePanel, usePanelData, type MemberChatRequest } from './provider.tsx'
import { WorkbenchSettings } from './local-settings.tsx'
import { TeamRecords } from './team-records.tsx'
import type { WorkbenchTool } from './route.ts'
import { TeamDetails } from './team-details.tsx'
import { TeamEventLog } from './team-room.tsx'
import { TeamProgress } from './team-progress.tsx'
import { TeamCollaboration } from './team-collaboration.tsx'
import { TeamStatus } from './team-ui.tsx'
import { LoadState, When } from './widgets.tsx'
import { healthText } from './text.ts'
import { useStudio } from './studio-layout.tsx'
import { Select } from './select.tsx'
import { teamParticipants } from './team-participants.ts'

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
function lastMember(id: string) { try { return sessionStorage.getItem(`dsh-superagent/team-member/${id}`) ?? '$commander' } catch { return '$commander' } }

function TeamOverview({ teams, select }: { teams: TeamIndex[]; select: (id: string) => void }) {
  const { t } = usePanel()
  return <section className="dt-team-overview" aria-label={t('teamOverview')}><div className="dt-team-overview-grid">{teams.map(team => <button type="button" key={team.id}
    className="dt-team-overview-item" data-active={!!team.activeMembers || undefined} onClick={() => select(team.id)}>
    <span className="dt-team-overview-head"><strong>{team.name}</strong><TeamStatus state={team.state} label={team.deliveredBeforeStop ? t('teamDeliveredStopped') : undefined} /></span>
    <span className="dt-team-overview-footer"><span>{t('teamCompletedCount', { done: team.completedMembers, total: team.memberCount })}</span><When at={team.updatedAt} /><Icon name="chevron-right" size={14} /></span>
  </button>)}</div>{!teams.length && <p className="dt-hint">{t('teamEmpty')}</p>}</section>
}

export function LocalWorkbench({ sessionId, teamId, memberId = '$commander', tool, management }: {
  sessionId?: string; teamId?: string; memberId?: string; tool?: WorkbenchTool
  management?: { id: string; title: string; content: ReactNode; close: () => void }
}) {
  const root = useRef<HTMLElement>(null)
  const { t, navigate } = usePanel(), { state } = usePanelData()
  const { data, error, reload, compactTeam, rightHidden, pane, setPane, setRightHidden } = useStudio()
  const [views, setViews] = useState(openViews), [detail, setDetail] = useState<'activity' | 'conversation' | 'context' | 'delivery'>('conversation')
  const [recordView, setRecordView] = useState<'workflow' | 'events'>('workflow')
  const activeTool = management ? undefined : tool
  const panelId = management?.id ?? activeTool
  const heading = useRef<HTMLHeadingElement>(null)
  const launcher = useRef<HTMLElement | null>(null)
  const previousPanel = useRef<string>()
  const current = teamId ? `team:${teamId}` : sessionId ? `session:${sessionId}` : undefined
  const team = data?.team && data.team.id === teamId ? data.team : undefined
  const [chatRequest, setChatRequest] = useState<MemberChatRequest>()
  const [expandedTeam, setExpandedTeam] = useState<string>()
  const graphExpanded = !!team && expandedTeam === team.id && !panelId && !rightHidden && (!compactTeam || pane === 'team')
  useEffect(() => { setExpandedTeam(undefined) }, [teamId, panelId, pane, rightHidden])
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
  useLayoutEffect(() => {
    if (panelId && team) {
      setPane('conversation')
      setRightHidden(false)
      const frame = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
      previousPanel.current = panelId
      return () => cancelAnimationFrame(frame)
    } else if (previousPanel.current && team) {
      const button = launcher.current
      const target = button?.isConnected && button.getClientRects().length ? button : root.current?.querySelector<HTMLElement>('.dt-team-details')
      target?.focus({ preventScroll: true })
      launcher.current = null
    }
    previousPanel.current = panelId
  }, [panelId, team?.id, setPane, setRightHidden])
  const selectView = (view?: WorkspaceView, nextDetail: typeof detail = 'conversation') => {
    setExpandedTeam(undefined); setDetail(nextDetail); setPane('conversation')
    navigate({ page: 'overview', query: view?.kind === 'team' ? { team: view.id, member: view.member ?? lastMember(view.id) }
      : view ? { session: view.id } : undefined }, true)
  }
  const selectTeam = (id: string) => selectView({ kind: 'team', id, title: data?.teams.find(team => team.id === id)?.name ?? id, member: lastMember(id) })
  const selectMember = (id: string) => {
    if (!team) return
    setChatRequest({ team: team.id, member: id })
    selectView({ kind: 'team', id: team.id, title: team.name, member: id })
    if ((root.current?.getBoundingClientRect().width ?? 1000) <= 640) requestAnimationFrame(() => {
      const pane = root.current?.querySelector<HTMLElement>('.dt-team-details'); pane?.scrollIntoView?.({ block: 'start' }); pane?.focus({ preventScroll: true })
    })
  }
  const close = (key: string) => {
    const index = views.findIndex(view => viewKey(view) === key), remaining = views.filter(view => viewKey(view) !== key)
    setViews(remaining)
    if (key === current) selectView(remaining[Math.min(index, remaining.length - 1)])
  }
  const openTool = (next: WorkbenchTool, view: typeof recordView = 'workflow') => {
    if (!teamId) return
    if (next === 'records') setRecordView(view)
    launcher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRightHidden(false); setPane('conversation')
    navigate({ page: 'overview', query: { team: teamId, member: memberId, tool: next } }, true)
  }
  const closeTool = () => {
    setDetail('conversation')
    if (management) management.close()
    else navigate({ page: 'overview', query: { team: teamId, member: memberId } }, true)
  }
  const toolTitle = management?.title ?? t(activeTool === 'mcp' ? 'mcpTitle' : activeTool === 'execution' ? 'studioExecutorSettings' : 'teamRecords')
  const member = team && (teamParticipants(team, t).find(member => member.id === memberId) ?? team.members[0])
  return <section ref={root} className="dt-team-workbench dt-team-focus-workbench" aria-label={t('localWorkbench')}>
    {state?.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {Object.entries(state?.health ?? {}).filter(([, health]) => health.state === 'error').map(([id, health]) => <p className="dt-error" role="status" key={id}>{healthText(t, health)}</p>)}
    {views.length > 0 && <nav className="dt-team-workspace-tabs" data-project-title={team && views.length === 1 || undefined} aria-label={t('teamWorkspaceTabs')}><div>{views.map(view => <div key={viewKey(view)} className="dt-team-workspace-tab" data-selected={viewKey(view) === current || undefined}>
      <button type="button" aria-pressed={viewKey(view) === current} onClick={() => selectView(view)}>{view.kind === 'team' && data?.teams.find(team => team.id === view.id)?.activeMembers ? <Icon name="running" size={13} /> : <Icon name={view.kind === 'team' ? 'queue' : 'session'} size={13} />}<span>{view.title}</span></button>
      {team && views.length === 1 && viewKey(view) === current && <TeamStatus state={team.state} label={team.deliveredBeforeStop ? t('teamDeliveredStopped') : undefined} />}
      <button type="button" className="dt-team-tab-close" aria-label={t('teamCloseWorkspace', { name: view.title })} title={t('close')} onClick={() => close(viewKey(view))}><Icon name="close" size={13} /></button>
    </div>)}</div>{views.length > 1 && <Button size="sm" onClick={() => { setViews([]); selectView() }}>{t('teamCloseAll')}</Button>}</nav>}
    <LoadState loading={!data} error={error} />
    {data && <><div className="dt-team-compact-bar">{team && <div className="dt-team-mobile-panels"><SegmentedTabs value={pane} onChange={setPane} label={t('teamCompactPane')} items={[
        { value: 'conversation', label: panelId ? toolTitle : t('workbenchConversation'), id: 'dt-compact-conversation', panelId: 'dt-team-workspace-content' },
        { value: 'team', label: t('teamCompactTeam'), id: 'dt-compact-team', panelId: 'dt-team-workspace-content' },
      ]} /></div>}
      <label className="dt-team-compact-select"><span>{t('teamSelect')}</span><Select aria-label={t('teamSelect')} value={teamId ?? ''} onChange={event => event.target.value ? selectTeam(event.target.value) : selectView()}>
        <option value="">{t('teamAll')}</option>{data.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}</Select></label></div>
      <div id="dt-team-workspace-content" data-graph-expanded={graphExpanded || undefined} data-compact-pane={pane} data-compact-team={compactTeam || undefined} data-right-hidden={rightHidden || undefined} data-team-studio={team && member ? true : undefined}
        style={{ gridTemplateColumns: graphExpanded || !team || current === undefined || rightHidden && !compactTeam || compactTeam && pane === 'conversation' ? 'minmax(0,1fr)' : compactTeam ? 'minmax(80px,18%) minmax(0,1fr)' : '15% 45% 40%' }} className={`dt-team-layout dt-team-focus-layout${!current ? ' dt-team-layout-overview' : ''}${sessionId ? ' dt-team-layout-single' : ''}`}>
        {!current ? <section className="dt-team-empty-workspace"><header className="dt-team-open-invitation"><div><h2>{t('teamOpenInvitation')}</h2><p>{t('teamOpenInvitationHint')}</p></div>
            <Button variant="outline" icon={<Icon name="folder" size={15} />} onClick={() => navigate({ page: 'source' })}>{t('localWorkspaces')}</Button></header>
          <TeamOverview teams={data.teams} select={selectTeam} /></section>
          : sessionId ? <div className="dt-team-single-space"><SingleWorkbench sessionId={sessionId === 'all-single' ? undefined : sessionId} /></div>
            : team && member ? <><TeamProgress team={team} tool={activeTool} open={openTool} />
              <TeamCollaboration activity={() => selectView({ kind: 'team', id: team.id, title: team.name, member: member.id }, 'activity')} expanded={graphExpanded} toggleExpanded={() => setExpandedTeam(graphExpanded ? undefined : team.id)} team={team} selected={member.id} select={selectMember} reload={reload} delivery={() => selectView({ kind: 'team', id: team.id, title: team.name, member: member.id }, 'delivery')} />
              <TeamDetails key={`${team.id}:${member.id}`} team={team} member={member} reload={reload} view={detail} onView={setDetail} chatRequest={chatRequest?.team === team.id && chatRequest.member === member.id ? chatRequest : undefined} hidden={!!panelId || graphExpanded} />
              {panelId && <section id="dt-team-right" className="dt-workbench-tool" role="region" aria-labelledby="dt-tool-title">
                <header><h2 id="dt-tool-title" ref={heading} tabIndex={-1}>{toolTitle}</h2>
                  <Button variant="ghost" size="sm" icon={<Icon name="chevron-left" size={14} />} onClick={closeTool}>{t('studioBackToChat')}</Button></header>
                <div className="dt-tool-body" key={panelId}>{management ? management.content : activeTool === 'records'
                  ? <TeamRecords team={team} select={selectMember} view={recordView} onView={setRecordView} /> : activeTool && <WorkbenchSettings tool={activeTool} />}</div>
              </section>}
              <TeamEventLog team={team} records={() => openTool('records', 'events')} /></>
              : management && (error || data && !team) ? <section><Button onClick={management.close}>{t('studioBackToWorkbench')}</Button>{management.content}</section> : <LoadState loading={!error} error={error} />}
      </div></>}
  </section>
}
