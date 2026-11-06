/** Everyday local navigation: tasks, settings, and a short usage guide. */
import { useEffect, useState } from 'react'
import { usePoll, type StateView, type TicketRow } from './api.ts'
import { Button, Icon, Input, Pill, SegmentedTabs } from './controls.tsx'
import { LocalTaskComposer } from './local.tsx'
import { LocalSettings } from './local-settings.tsx'
import { ticketMark } from './marks.ts'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import type { Route, Tab } from './route.ts'
import { TicketPage } from './ticket.tsx'
import { Hint, LoadMore, LoadState, MarkdownLite, Section, SessionButton, StageMark, When } from './widgets.tsx'

const TABS = ['execution', 'settings', 'help'] as const

function TaskRow({ ticket }: { ticket: TicketRow }) {
  const { t, navigate } = usePanel()
  const mark = ticketMark(t, ticket)
  return <li className="dt-row dt-link dt-ticket">
    <div className="dt-ticket-stage"><StageMark state={ticket.ended?.outcome === 'completed' ? 'done' : mark.dot}
      icon={ticket.ended?.outcome === 'completed' ? 'decision' : mark.icon} label={mark.label} /></div>
    <div className="dt-ticket-body">
      <div className="dt-row-title"><button className="dt-open" type="button"
        onClick={() => navigate({ page: 'execution', id: ticket.id })}>{ticket.title}</button></div>
      <div className="dt-row-meta"><span className="dt-local-path" title={ticket.directory}>{ticket.directory}</span><When at={ticket.updatedAt} /></div>
      {ticket.note?.text && <p className="dt-row-quote">{ticket.note.text}</p>}
    </div>
    {ticket.sessionId && <div className="dt-row-actions"><SessionButton sessionId={ticket.sessionId} label={t('localViewProcess')} /></div>}
  </li>
}

function LocalTasksPage({ state, filter }: { state: StateView; filter?: string }) {
  const { t, call, navigate } = usePanel()
  const { reload } = usePanelData()
  const current = filter === 'person' || filter === 'ended' ? filter : 'open'
  const [limit, setLimit] = useState(20), [query, setQuery] = useState('')
  const { data, error } = usePoll(() => call('GET tickets', { query: { state: current, limit } }), [call, current, limit])
  const pause = useAction(async () => { await call('POST executor/pause', { body: { paused: !state.paused } }); await reload() })
  const items = data?.items.filter(task => `${task.title}\n${task.directory ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const problem = Object.values(state.health).find(item => item.state === 'error')
  return <>
    <p className="dt-local-intro">{t('localIntro')}</p>
    <div className="dt-local-status">
      <StageMark state={state.paused ? 'warning' : problem ? 'error' : state.load.running ? 'ongoing' : 'done'}
        icon={state.paused ? 'pause' : problem ? 'alert' : 'decision'}
        label={t(state.paused ? 'localPaused' : state.load.running ? 'localRunning' : 'localReady', { count: state.load.running })} />
      <span className="dt-hint">{t('localCapacity', { max: state.load.maxWorkers, queued: state.load.queued })}</span>
      <Button variant="ghost" size="sm" disabled={pause.busy} onClick={() => { void pause.run() }}>{t(state.paused ? 'localResume' : 'localPause')}</Button>
    </div>
    {state.paused && <p className="dt-banner">{t('localPauseHint')}</p>}
    {problem && <p className="dt-error" role="status">{problem.detail}</p>}
    <LocalTaskComposer paused={state.paused} />
    <Section title={t('localTaskList')}>
      <div className="dt-filters">
        {(['open', 'person', 'ended'] as const).map(value => <Pill key={value} active={value === current}
          onClick={() => { setLimit(20); setQuery(''); navigate({ page: 'execution', query: { filter: value } }, true) }}>{t(`localFilter.${value}`)}</Pill>)}
        <Input type="search" icon={<Icon name="search" />} aria-label={t('localSearch')} placeholder={t('localSearch')}
          value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <LoadState error={error} loading={!data} />
      {items && (items.length ? <ul className="dt-list">{items.map(task => <TaskRow key={task.id} ticket={task} />)}</ul>
        : <div className="dt-local-empty"><p>{t(query ? 'localNoMatches' : current === 'open' ? 'localNoTasks' : 'localNoFilteredTasks')}</p>
          {!query && current === 'open' && <Hint>{t('localChatHint')}</Hint>}</div>)}
      {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 20)} />}
    </Section>
  </>
}

export function LocalHelp() {
  const { t } = usePanel()
  return <div className="dt-form">
    <Section title={t('localHelpStart')}><ol className="dt-local-steps">
      <li>{t('localHelpStep1')}</li><li>{t('localHelpStep2')}</li><li>{t('localHelpStep3')}</li>
    </ol></Section>
    <Section title={t('localHelpChat')}><div className="dt-local-form"><MarkdownLite text={t('localChatExample')} /></div></Section>
    <Section title={t('localHelpExamples')}>
      {(['research', 'diagnose', 'develop'] as const).map(kind => <div key={kind} className="dt-local-example">
        <strong>{t(`localExampleLabel.${kind}`)}</strong><MarkdownLite text={t(`localExample.${kind}`)} />
      </div>)}
    </Section>
    <Section title={t('localHelpBoundaries')}><MarkdownLite text={t('localBoundaries')} /></Section>
  </div>
}

export function LocalPages({ route, openTab }: { route: Route; openTab: (tab: Tab) => void }) {
  const { t, navigate } = usePanel()
  const { state, error } = usePanelData()
  const page = TABS.find(tab => tab === route.page) ?? 'execution'
  useEffect(() => { if (!TABS.some(tab => tab === route.page)) navigate({ page: 'execution' }, true) }, [route.page, navigate])
  return <div className="dt-page dt-local-page"><div className="dt-column">
    <header className="dt-head"><div><h1 className="dt-local-title">{t('title')}</h1><p className="dt-hint">{t('localTagline')}</p></div></header>
    <SegmentedTabs className="dt-tabs" label={t('pagesLabel')} value={page} onChange={openTab}
      items={TABS.map(value => ({ value, label: t(value === 'execution' ? 'localTasks' : `tab.${value}`),
        id: `dt-tab-${value}`, panelId: 'dt-page' }))} />
    <main id="dt-page" role="tabpanel" aria-labelledby={`dt-tab-${page}`} className="dt-main">
      {error && <LoadState error={error} loading={false} />}
      {page === 'help' ? <LocalHelp /> : page === 'settings' ? <LocalSettings />
        : route.page === 'execution' && route.id ? <TicketPage key={route.id} id={route.id} />
          : state ? <LocalTasksPage state={state} filter={route.page === 'execution' ? route.query?.filter : undefined} /> : <LoadState loading />}
    </main>
  </div></div>
}
