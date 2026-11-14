/** Live task columns with direct access to each ticket's real DSH worker conversation. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LOCAL_BOARD_COLUMNS, type LocalBoardColumn, type ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Icon, Input } from './controls.tsx'
import { ticketMark } from './marks.ts'
import { useAction, usePanel } from './provider.tsx'
import { ConfirmButton, LoadState, SessionButton, StageMark, When } from './widgets.tsx'
import { shortText } from './text.ts'

const PAGE_SIZE = 20

function TaskCard({ ticket, onChanged }: { ticket: ApiResponse<'GET local/board'>['items'][number]; onChanged: () => void }) {
  const { t, navigate, call } = usePanel()
  const open = useAction(async () => {
    if (ticket.team) { navigate({ page: 'overview', query: { team: ticket.team.id, member: 'coordinator' } }); return }
    const query = await call('GET local/tasks/:id/workbench', { id: ticket.id })
    navigate({ page: 'overview', query })
  })
  const mark = ticketMark(t, ticket)
  const completed = ticket.ended?.outcome === 'completed'
  const note = !ticket.ended && (ticket.note?.text || ticket.summary)
  const attention = ticket.stage === 'person'
  const after = async (request: Promise<unknown>) => { await request; onChanged() }
  return <li className="dt-board-card dt-task-row" data-state={completed ? 'done' : mark.dot}>
    <div className="dt-task-row-main"><button className="dt-open dt-board-card-title" type="button" onClick={() => { if (ticket.team) void open.run(); else navigate({ page: 'execution', id: ticket.id }) }}>
      {ticket.title}
    </button>
    {ticket.team && <span className="dt-hint">{t('teamCompletedCount', { done: ticket.team.completed, total: ticket.team.members })}</span>}
    {note ? <p className="dt-board-note" data-error={ticket.note?.error || undefined}>{shortText(note, 100)}</p>
      : ticket.directory && <span className="dt-board-path" title={ticket.directory}><Icon name="folder" size={13} />
        <span>{ticket.directory.split('/').filter(Boolean).at(-1)}</span></span>}</div>
    <div className="dt-board-card-head">
      <button type="button" className="dt-board-card-status" disabled={open.busy} title={t('teamStatusOpen')}
        onClick={() => { void open.run() }}><StageMark state={completed ? 'done' : mark.dot} icon={completed ? 'decision' : mark.icon} label={mark.label} /></button>
      <When at={ticket.updatedAt} />
    </div>
    <div className="dt-board-card-footer">
      <div className="dt-board-card-actions">
        {attention && <Button variant="outline" size="sm" onClick={() => navigate({ page: 'execution', id: ticket.id })}>
          {t(ticket.action === 'review' ? 'localViewDelivery' : 'localViewReason')}</Button>}
        {ticket.actions.retry && <ConfirmButton variant="outline" icon="refresh" label={t('retry')} title={t('retryTitle')}
          message={t('retryConfirm', { title: ticket.title })} onConfirm={() => after(call('POST tickets/:id/retry', { id: ticket.id }))} />}
        {ticket.sessionId ? <SessionButton variant="outline" sessionId={ticket.sessionId} label={t(attention && ticket.action !== 'review' ? 'localReplyTask' : 'localViewProcess')} />
          : <span className="dt-board-pending" role="img" aria-label={t('localBoardNoSession')} title={t('localBoardNoSession')}><Icon name="clock" /></span>}
        {ticket.actions.stop && <span className="dt-board-card-stop"><ConfirmButton icon="stop" label={t('stop')} title={t('stopConfirmTitle')}
          message={t('stopConfirm', { title: ticket.title })} onConfirm={() => after(ticket.team ? call('POST local/teams/:id/stop', { id: ticket.team.id }) : call('POST tickets/:id/stop', { id: ticket.id }))} /></span>}
      </div>
    </div>
  </li>
}

function BoardColumn({ column, query, filter, onCount, revision, onChanged }: { column: LocalBoardColumn; query: string; filter: 'all' | LocalBoardColumn;
  onCount: (column: LocalBoardColumn, total: number) => void; revision: number; onChanged: () => void }) {
  const { t, call } = usePanel()
  const [offset, setOffset] = useState(0)
  const { data, error } = usePoll(() => call('GET local/board', { query: { column, q: query, offset, limit: PAGE_SIZE } }),
    [call, column, query, offset, revision])
  const label = t(`localBoardColumn.${column}`)
  useEffect(() => { if (data) onCount(column, data.total) }, [column, data?.total, onCount])
  useEffect(() => {
    if (data && offset > 0 && offset >= data.total) setOffset(Math.floor(Math.max(0, data.total - 1) / PAGE_SIZE) * PAGE_SIZE)
  }, [data?.total, offset])
  if (filter !== 'all' && column !== filter || filter === 'all' && data?.total === 0 && !error) return null
  return <section className="dt-board-column" data-column={column} data-lane={column !== 'idle' && column !== 'ended' || undefined} aria-label={label}>
    <header className="dt-board-column-head"><h3><span className="dt-board-column-icon"><Icon name={column === 'queued' ? 'queue' : column === 'running' ? 'running'
      : column === 'attention' ? 'ask' : column === 'idle' ? 'clock' : 'history'} size={16} /></span>{label}</h3><span className="dt-board-count">{data?.total ?? '—'}</span></header>
    <LoadState error={error} loading={!data} />
    {data && (data.items.length ? <ul key={offset} className="dt-board-cards" id={`dt-board-${column}`}>
      {data.items.map(ticket => <TaskCard key={ticket.id} ticket={ticket} onChanged={onChanged} />)}
    </ul> : <p className="dt-board-empty">{t(query ? 'localNoMatches' : `localBoardEmpty.${column}`)}</p>)}
    {data && data.total > PAGE_SIZE && <nav className="dt-board-pagination" aria-label={t('localBoardPages', { column: label })}>
      <Button size="sm" icon={<Icon name="chevron-left" />} disabled={!offset}
        aria-label={t('localBoardPrevious', { column: label })} title={t('localBoardPrevious', { column: label })}
        onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} />
      <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} / {data.total}</span>
      <Button size="sm" icon={<Icon name="chevron-right" />} disabled={data.next_offset == null}
        aria-label={t('localBoardNext', { column: label })} title={t('localBoardNext', { column: label })}
        onClick={() => { if (data.next_offset != null) setOffset(data.next_offset) }} />
    </nav>}
  </section>
}

export function LocalTaskBoard({ tools }: { tools: ReactNode }) {
  const { t } = usePanel()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | LocalBoardColumn>('all')
  const [revision, setRevision] = useState(0)
  const changed = () => setRevision(value => value + 1)
  const [counts, setCounts] = useState<Partial<Record<LocalBoardColumn, number>>>({})
  const count = useCallback((column: LocalBoardColumn, total: number) => {
    setCounts(current => current[column] === total ? current : { ...current, [column]: total })
  }, [])
  useEffect(() => { setCounts({}) }, [query.trim()])
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return <section className="dt-board" aria-labelledby="dt-board-title">
    <header className="dt-board-heading"><h2 id="dt-board-title">{t('localTasks')}<span className="dt-count">{Object.keys(counts).length === LOCAL_BOARD_COLUMNS.length ? total : '—'}</span></h2>
      <div className="dt-actions">{tools}</div></header>
    <div className="dt-board-toolbar">
      <Input type="search" icon={<Icon name="search" />} aria-label={t('localSearch')} placeholder={t('localSearch')}
        maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="dt-board-filters" role="group" aria-label={t('localTaskViews')}>{(['all', ...LOCAL_BOARD_COLUMNS] as const).filter(column => column !== 'idle' || counts.idle || filter === 'idle').map(column =>
        <button type="button" key={column} aria-pressed={filter === column} onClick={() => setFilter(column)}>{t(column === 'all' ? 'localAllTasks' : `localBoardColumn.${column}`)}
          <span>{column === 'all' ? total : counts[column] ?? '—'}</span></button>)}</div>
    </div>
    <div className="dt-board-columns">{LOCAL_BOARD_COLUMNS.map(column => <BoardColumn key={`${column}:${query.trim()}`}
      column={column} query={query.trim()} filter={filter} onCount={count} revision={revision} onChanged={changed} />)}</div>
    {filter === 'all' && Object.keys(counts).length === LOCAL_BOARD_COLUMNS.length && total === 0 && <p className="dt-hint">{t(query.trim() ? 'localNoMatches' : 'localNoTasks')}</p>}
  </section>
}
