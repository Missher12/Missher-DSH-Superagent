/** Everyday local navigation: tasks, settings, and a short usage guide. */
import { useEffect, useRef, useState } from 'react'
import type { StateView } from './api.ts'
import { Button, Icon, SegmentedTabs } from './controls.tsx'
import { LocalTaskBoard } from './local-board.tsx'
import { LocalTaskComposer } from './local.tsx'
import { LocalSettings } from './local-settings.tsx'
import { LocalWorkspaces } from './local-workspaces.tsx'
import { LocalWorkbench } from './local-workbench.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { healthText } from './text.ts'
import type { Route, Tab } from './route.ts'
import { TicketPage } from './ticket.tsx'
import { LoadState, MarkdownLite, Section, StageMark } from './widgets.tsx'
import { StudioProvider, StudioShell, StudioHeaderTools } from './studio-layout.tsx'

const TABS = ['overview', 'execution', 'source', 'settings', 'help'] as const

function LocalTasksPage({ state }: { state: StateView }) {
  const { t, call } = usePanel()
  const { reload } = usePanelData()
  const pause = useAction(async () => { await call('POST executor/pause', { body: { paused: !state.paused } }); await reload() })
  const problems = Object.entries(state.health).filter(([, item]) => item.state === 'error')
  const problem = problems.length > 0
  return <div className="dt-local-tasks">
    {state.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {problems.map(([name, item]) => <p key={name} className="dt-error" role="status">{healthText(t, item)}</p>)}
    <LocalTaskBoard tools={<>
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

export function LocalPages({ route, openTab }: { route: Route; openTab: (tab: Tab) => void }) {
  const { t, navigate } = usePanel()
  const { state, error } = usePanelData()
  const page = TABS.find(tab => tab === route.page) ?? 'overview'
  const workspace = useRef<Extract<Route, { page: 'overview' }>>({ page: 'overview' })
  useEffect(() => { if (route.page === 'overview') workspace.current = route }, [route])
  useEffect(() => { if (!TABS.some(tab => tab === route.page)) navigate({ page: 'overview' }, true) }, [route.page, navigate])
  return <StudioProvider route={route.page === 'overview' ? route : workspace.current}><div data-density="comfortable" className={`dt-page dt-local-page dt-studio-page${page === 'overview' ? ' dt-workspace-page' : page === 'settings' ? ' dt-settings-page' : ''}`}><div className="dt-column">
    <header className="dt-head"><div className="dt-local-brand"><span className="dt-local-brand-icon"><Icon name="agent" size={19} /></span>
      <h1 className="dt-local-title">{t('title')}</h1></div>
      <SegmentedTabs className="dt-tabs" label={t('pagesLabel')} value={page} onChange={tab => {
        if (tab === 'overview') navigate(workspace.current, true)
        else openTab(tab)
      }}
        items={TABS.map(value => ({ value, label: t(value === 'overview' ? 'localWorkbench' : value === 'execution' ? 'localTasks' : value === 'source' ? 'localWorkspaces' : `tab.${value}`),
          id: `dt-tab-${value}`, panelId: 'dt-page' }))} />
      <div className="dt-studio-head-end">{page !== 'settings' && <StudioHeaderTools workbench={page === 'overview'} />}<LocalTaskComposer team={page === 'overview'} paused={state?.paused} /></div>
    </header>
    <StudioShell sidebar={page !== 'settings'}><main id="dt-page" role="tabpanel" aria-labelledby={`dt-tab-${page}`} className="dt-main">
      {error && <LoadState error={error} loading={false} />}
      {page === 'overview' ? <LocalWorkbench {...route.page === 'overview' ? { sessionId: route.query?.session, teamId: route.query?.team, memberId: route.query?.member } : {}} /> : page === 'help' ? <LocalHelp /> : page === 'settings' ? <LocalSettings /> : page === 'source' ? <LocalWorkspaces />
        : route.page === 'execution' && route.id ? <TicketPage key={route.id} id={route.id} />
          : state ? <LocalTasksPage state={state} /> : <LoadState loading />}
    </main></StudioShell>
  </div></div></StudioProvider>
}
