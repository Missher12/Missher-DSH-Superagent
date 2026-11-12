/** Shared project navigation and adjustable panes. Width preferences never change task data. */
import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction, type ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { FilePreview, type FileScope } from './team-file-preview.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import type { Route } from './route.ts'
import { TeamStatus } from './team-ui.tsx'
import { shortText } from './text.ts'

const WIDTHS = 'dsh-superagent/studio-widths'
function readWidth(side: 'left' | 'right', fallback: number) {
  try { const value = JSON.parse(localStorage.getItem(WIDTHS) ?? '{}')[side]; return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
  catch { return fallback }
}
export function usePaneWidth(side: 'left' | 'right', maximum: number) {
  const fallback = side === 'left' ? 216 : 340, minimum = side === 'left' ? 168 : 264
  const max = Math.max(minimum, Math.min(side === 'left' ? 320 : 440, maximum))
  const [preferred, setPreferred] = useState(() => readWidth(side, fallback))
  const width = Math.round(Math.max(minimum, Math.min(max, preferred)))
  const set = (next: number) => {
    const value = Math.round(Math.max(minimum, Math.min(max, next))); setPreferred(value)
    try { localStorage.setItem(WIDTHS, JSON.stringify({ ...JSON.parse(localStorage.getItem(WIDTHS) ?? '{}'), [side]: value })) } catch { /* Optional UI preference. */ }
  }
  return { side, width, minimum, maximum: max, set, reset: () => set(fallback) }
}
export function PaneDivider({ pane }: { pane: ReturnType<typeof usePaneWidth> }) {
  const { t } = usePanel(), start = useRef<{ x: number; width: number }>(), [dragging, setDragging] = useState(false)
  return <div className="dt-pane-divider" data-side={pane.side} data-dragging={dragging || undefined} role="separator" tabIndex={0}
    aria-label={t(pane.side === 'left' ? 'studioResizeLeft' : 'studioResizeRight')} aria-orientation="vertical"
    aria-valuemin={pane.minimum} aria-valuemax={pane.maximum} aria-valuenow={pane.width} title={t('studioResizeHint')}
    onDoubleClick={pane.reset} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') pane.reset()
      else if (event.key === 'End') pane.set(pane.maximum)
      else pane.set(pane.width + (event.key === 'ArrowRight' ? 16 : -16) * (pane.side === 'left' ? 1 : -1))
    }} onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault(); start.current = { x: event.clientX, width: pane.width }; setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      if (start.current) pane.set(start.current.width + (event.clientX - start.current.x) * (pane.side === 'left' ? 1 : -1))
    }} onPointerUp={event => { start.current = undefined; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { start.current = undefined; setDragging(false) }} onLostPointerCapture={() => { start.current = undefined; setDragging(false) }} />
}

interface StudioState {
  data: ApiResponse<'GET local/workbench'> | undefined; error: Error | undefined; reload: () => Promise<void>
  route: Extract<Route, { page: 'overview' }>; root: RefObject<HTMLDivElement>; left: ReturnType<typeof usePaneWidth>
  compact: boolean; contentWidth: number; compactTeam: boolean; hidden: boolean; drawer: boolean; rightHidden: boolean
  pane: 'conversation' | 'team'; setPane: Dispatch<SetStateAction<'conversation' | 'team'>>; setRightHidden: Dispatch<SetStateAction<boolean>>
  closeDrawer: () => void; toggleLeft: () => void; toggleRight: () => void
}
function useStudioState(route: Extract<Route, { page: 'overview' }>): StudioState {
  const { call } = usePanel(), { restarts } = usePanelData()
  const snapshot = usePoll(() => call('GET local/workbench', { query: { team: route.query?.team, session: route.query?.session } }),
    [call, restarts, route.query?.team, route.query?.session], 2000)
  const root = useRef<HTMLDivElement>(null), [width, setWidth] = useState(1200)
  const [hidden, setHidden] = useState(false), [drawer, setDrawer] = useState(false), [rightHidden, setRightHidden] = useState(false)
  const [pane, setPane] = useState<'conversation' | 'team'>('conversation')
  useLayoutEffect(() => {
    const element = root.current; if (!element) return
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth) }
    measure(); if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect()
  }, [])
  const left = usePaneWidth('left', width - 640), compact = width < 800
  const contentWidth = width - (!compact && !hidden ? left.width + 6 : 0), compactTeam = contentWidth < 680
  return { ...snapshot, route, root, left, compact, contentWidth, compactTeam, hidden, drawer, rightHidden, pane, setPane, setRightHidden,
    closeDrawer: () => setDrawer(false), toggleLeft: () => compact ? setDrawer(value => !value) : setHidden(value => !value),
    toggleRight: () => compactTeam ? setPane(value => value === 'conversation' ? 'team' : 'conversation') : setRightHidden(value => !value) }
}
const Studio = createContext<StudioState | undefined>(undefined)
export function useStudio() { const value = useContext(Studio); if (!value) throw new Error('Studio is not mounted'); return value }
export function StudioProvider({ route, children }: { route: Extract<Route, { page: 'overview' }>; children: ReactNode }) {
  return <Studio.Provider value={useStudioState(route)}>{children}</Studio.Provider>
}
export function StudioHeaderTools({ workbench }: { workbench: boolean }) {
  const { t } = usePanel(), studio = useStudio()
  return <div className="dt-studio-header-tools"><Button variant="ghost" size="sm" icon={<Icon name="sidebar-left" />} aria-label={t('studioToggleLeft')}
    title={t('studioToggleLeft')} aria-pressed={studio.compact ? studio.drawer : !studio.hidden} onClick={studio.toggleLeft} />
    {workbench && studio.data?.team && <Button variant="ghost" size="sm" icon={<Icon name="sidebar-right" />} aria-label={t('studioToggleRight')}
      title={t('studioToggleRight')} aria-pressed={studio.compactTeam ? studio.pane === 'team' : !studio.rightHidden} onClick={studio.toggleRight} />}</div>
}
function lastMember(id: string) { try { return sessionStorage.getItem(`dsh-superagent/team-member/${id}`) ?? 'coordinator' } catch { return 'coordinator' } }

function StudioSidebar() {
  const { t, call, navigate, openWorkspace } = usePanel(), { data, route, closeDrawer, setPane } = useStudio()
  const [file, setFile] = useState<string>()
  const team = data?.team, session = data?.members.find(member => member.id === route.query?.session)
  const directory = team?.directory ?? session?.directory, files = [...new Map((team ? team.deliveries.flatMap(delivery => delivery.record.files) : session?.files ?? []).map(file => [file.path, file])).values()]
  const scope: FileScope = { kind: team ? 'team' : session?.taskId ? 'task' : 'session', id: team?.id ?? session?.taskId ?? session?.id ?? '',
    directory, sessionId: team?.members.find(member => member.role === 'coordinator')?.sessionId ?? session?.id, files: files.map(file => file.path) }
  const groups = Map.groupBy(files, file => file.path.replace(`${directory}/`, '').split('/').slice(0, -1).join('/'))
  const go = (route: Route) => { closeDrawer(); setFile(undefined); setPane('conversation'); navigate(route, true) }
  const selectTeam = (id: string) => go({ page: 'overview', query: { team: id, member: lastMember(id) } })
  const single = data?.tasks.filter(task => !data.teamTicketIds.includes(task.id)) ?? []
  const open = useAction(async () => {
    if (directory) { const workspace = await call('POST local/workspaces', { body: { directory } }); await openWorkspace(workspace.id) }
    else if (data?.workspace) await openWorkspace(data.workspace.id)
  })
  const fileButton = (file: typeof files[number]) => <li key={file.path}><button type="button" disabled={!file.exists} title={file.path}
    onClick={() => setFile(file.path)}><Icon name="file" size={14} /><span>{file.path.split('/').at(-1)}</span></button></li>
  return <nav className="dt-team-sidebar dt-studio-sidebar" aria-label={t('teamList')}>
    <div className="dt-studio-project"><span className="dt-studio-project-icon"><Icon name="folder" size={20} /></span><div>
      <strong title={directory}>{directory?.split('/').filter(Boolean).at(-1) ?? t('studioWorkspace')}</strong><span>{team?.name ?? t('studioIndependentDispatch')}</span></div>
      <Button variant="ghost" size="sm" icon={<Icon name="folder" />} aria-label={t(directory ? 'localOpenWorkspace' : 'workbenchOpenWorkspace')} title={directory ?? data?.workspace?.directory}
        disabled={!directory && !data?.workspace || open.busy} onClick={() => { void open.run() }} /></div>
    <div className="dt-studio-sidebar-scroll">
      {directory && <section className="dt-studio-file-section"><div className="dt-studio-section-title"><strong>{t('teamWorkingFiles')}</strong><span>{files.length}</span></div>
        {files.length ? [...groups].map(([folder, list]) => folder ? <details className="dt-studio-file-folder" key={folder} open><summary><Icon name="chevron-right" size={12} /><Icon name="folder" size={14} /><span>{folder}</span></summary>
          <ul className="dt-studio-files">{list.map(fileButton)}</ul></details> : <ul key="root" className="dt-studio-files">{list.map(fileButton)}</ul>) : <p className="dt-hint dt-studio-no-files">{t('teamNoFiles')}</p>}</section>}
      <section><div className="dt-studio-section-title"><strong>{t('teamTasks')}</strong><span>{data?.teams.length ?? 0}</span></div>
        <button type="button" className="dt-team-nav-item dt-studio-all" aria-pressed={!route.query?.team && !route.query?.session}
          onClick={() => go({ page: 'overview' })}><Icon name="history" size={14} />{t('teamAll')}</button>
        <ul>{data?.teams.map(item => <li key={item.id}><button type="button" className="dt-team-nav-item" data-active={!!item.activeMembers || undefined}
          aria-pressed={route.query?.team === item.id} title={item.currentAction || item.name} onClick={() => selectTeam(item.id)}>
          <Icon name={item.state === 'completed' ? 'decision' : item.state === 'stopped' ? 'stop' : item.state === 'failed' ? 'alert' : item.state === 'attention' ? 'message' : item.activeMembers ? 'running' : 'clock'} size={14} />
          <span><strong>{item.name}</strong><TeamStatus state={item.state} /><small className="dt-team-live-action">{shortText(item.currentAction || item.summary || item.instructions, 60)}</small></span>
        </button></li>)}</ul></section>
      <section className="dt-team-singles"><button type="button" className="dt-team-nav-item" onClick={() => go({ page: 'overview', query: { session: 'all-single' } })}>
        <Icon name="session" size={14} /><strong>{t('teamSingle')}</strong><span className="dt-count">{single.length}</span></button>
        <ul>{single.slice(0, 8).map(task => <li key={task.id}><button type="button" className="dt-team-nav-item" title={task.title}
          onClick={() => go({ page: 'overview', query: { session: task.sessionId || `worker-${task.id}` } })}>{task.title}</button></li>)}</ul>
        <Button size="sm" variant="ghost" icon={<Icon name="queue" />} onClick={() => go({ page: 'overview', query: { session: data?.members.find(member => member.role === 'orchestrator')?.id ?? 'all-single' } })}>{t('teamDispatcher')}</Button>
      </section>
    </div><Button className="dt-studio-sidebar-footer" variant="ghost" icon={<Icon name="folder" />} onClick={() => go({ page: 'source' })}>{t('studioAllWorkspaces')}<Icon name="chevron-right" size={13} /></Button>
    {file && <FilePreview key={`${scope.id}:${file}`} scope={scope} paths={[file]} onClose={() => setFile(undefined)} />}
  </nav>
}
export function StudioShell({ children, sidebar = true }: { children: ReactNode; sidebar?: boolean }) {
  const studio = useStudio(), { t } = usePanel()
  return <div ref={studio.root} className="dt-studio-shell" data-compact={studio.compact || undefined} data-left-hidden={!sidebar || studio.hidden || undefined}
    data-drawer={sidebar && studio.drawer || undefined} style={{ '--dt-left-width': `${studio.left.width}px` } as CSSProperties}>
    {sidebar && <><StudioSidebar /><PaneDivider pane={studio.left} /></>}<div className="dt-studio-center">{children}</div>
    {sidebar && studio.compact && studio.drawer && <button type="button" className="dt-studio-drawer-mask" aria-label={t('studioCloseSidebar')} onClick={studio.closeDrawer} />}
  </div>
}
