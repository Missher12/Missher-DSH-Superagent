/** Everyday local navigation: tasks, settings, and a short usage guide. */
import { useEffect } from 'react'
import type { StateView } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { LocalTaskBoard } from './local-board.tsx'
import { LocalTaskComposer } from './local.tsx'
import { LocalSettings } from './local-settings.tsx'
import { LocalWorkspaces } from './local-workspaces.tsx'
import { LocalWorkbench } from './local-workbench.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { healthText } from './text.ts'
import { settingsRoute, type Route } from './route.ts'
import { ActionMenu } from './select.tsx'
import { TicketPage } from './ticket.tsx'
import { LoadState, MarkdownLite, Section, StageMark } from './widgets.tsx'
import { StudioProvider, StudioShell, StudioHeaderTools } from './studio-layout.tsx'

const TABS = ['overview', 'execution', 'source', 'settings', 'help'] as const

function LocalTasksPage({ state, inline }: { state: StateView; inline?: boolean }) {
  const { t, call } = usePanel()
  const { reload } = usePanelData()
  const pause = useAction(async () => { await call('POST executor/pause', { body: { paused: !state.paused } }); await reload() })
  const problems = Object.entries(state.health).filter(([, item]) => item.state === 'error')
  const problem = problems.length > 0
  return <div className="dt-local-tasks">
    {state.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {problems.map(([name, item]) => <p key={name} className="dt-error" role="status">{healthText(t, item)}</p>)}
    <LocalTaskBoard inline={inline} tools={<>
      <div className="dt-local-status" title={t('localCapacity', { max: state.load.maxWorkers, queued: state.load.queued })}>
        <StageMark state={state.paused ? 'warning' : problem ? 'error' : state.load.running ? 'ongoing' : 'done'}
          icon={state.paused ? 'pause' : problem ? 'alert' : 'decision'}
          label={t(state.paused ? 'localPaused' : problem ? 'localSystemProblem' : state.load.running ? 'localRunning' : 'localReady', { count: state.load.running })} />
        <Button variant="ghost" size="sm" disabled={pause.busy} onClick={() => { void pause.run() }}>{t(state.paused ? 'localResume' : 'localPause')}</Button>
      </div>
    </>} />
  </div>
}

export function LocalHelp() {
  const { t, navigate } = usePanel()
  return <div className="dt-form dt-local-help">
    <Section title={t('localHelpStart')}><ol className="dt-local-steps">
      {([1, 2, 3] as const).map(step => <li key={step}><div><strong>{t(`localHelpStepTitle${step}`)}</strong><p>{t(`localHelpStep${step}`)}</p></div></li>)}
    </ol><div className="dt-actions dt-local-help-actions">
      <Button variant="primary" icon={<Icon name="folder" />} onClick={() => navigate({ page: 'source' })}>{t('localWorkspaces')}</Button>
      <Button variant="outline" onClick={() => navigate({ page: 'execution' })}>{t('localTasks')}</Button>
    </div></Section>
    <Section title={t('localHelpChat')}><MarkdownLite text={t('localChatExample')} /></Section>
    <details className="dt-local-details"><summary>{t('localHelpBoundaries')}</summary>
      <div className="dt-local-details-body"><MarkdownLite text={t('localBoundaries')} /></div>
    </details>
  </div>
}

export function LocalPages({ route, workspace, returnToWorkspace }: { route: Route; workspace: Extract<Route, { page: 'overview' }>; returnToWorkspace: () => void }) {
  const { t, navigate } = usePanel()
  const { state, error } = usePanelData()
  const page = TABS.find(tab => tab === route.page) ?? 'overview'
  useEffect(() => { if (!TABS.some(tab => tab === route.page)) navigate({ page: 'overview' }, true) }, [route.page, navigate])
  const project = !!workspace.query?.team
  const inWorkbench = page === 'overview' || project
  const managementTitle = t(page === 'help' ? 'studioUserGuide' : page === 'settings' ? 'studioPluginSettings'
    : page === 'source' ? 'localWorkspaces' : route.id ? 'term.ticket' : 'localTaskBoard')
  const management = page === 'overview' ? undefined : {
    id: `page-${route.page}-${route.id ?? ''}`, title: managementTitle, close: returnToWorkspace,
    content: page === 'help' ? <LocalHelp /> : page === 'settings' ? <LocalSettings /> : page === 'source' ? <LocalWorkspaces inline={project} />
      : route.page === 'execution' && route.id ? <TicketPage key={route.id} id={route.id} />
        : state ? <LocalTasksPage state={state} inline={project} /> : <LoadState loading />,
  }
  return <StudioProvider route={workspace}><div data-density="comfortable" className={`dt-page dt-local-page dt-studio-page${inWorkbench ? ' dt-workspace-page' : page === 'settings' ? ' dt-settings-page' : ''}`}><div className="dt-column">
    <header className="dt-head"><div className="dt-local-brand"><span className="dt-local-brand-icon"><Icon name="agent" size={19} /></span>
      <h1 className="dt-local-title">{t('title')}</h1></div>
      {!inWorkbench && <Button size="sm" variant="ghost" icon={<Icon name="chevron-left" size={14} />}
        onClick={returnToWorkspace}>{t('studioBackToWorkbench')}</Button>}
      <div className="dt-studio-head-end">{inWorkbench && <StudioHeaderTools workbench />}
        <ActionMenu compact icon="more" label={t('studioMoreOptions')} items={[
          { id: 'settings', label: t('studioPluginSettings') }, { id: 'help', label: t('studioUserGuide') },
        ]} onSelect={id => { if (id !== page) navigate(id === 'settings' ? settingsRoute('source') : { page: 'help' }) }} />
        <LocalTaskComposer team={inWorkbench} paused={state?.paused} />
      </div>
    </header>
    <StudioShell sidebar={inWorkbench}><main id="dt-page" aria-label={t(inWorkbench ? 'localWorkbench' : page === 'execution' ? 'localTasks' : page === 'source' ? 'localWorkspaces' : `tab.${page}`)} className="dt-main">
      {error && <LoadState error={error} loading={false} />}
      {inWorkbench ? <LocalWorkbench sessionId={workspace.query?.session} teamId={workspace.query?.team} memberId={workspace.query?.member}
        tool={workspace.query?.tool} management={management} /> : management?.content}
    </main></StudioShell>
  </div></div></StudioProvider>
}
