/** Live task columns with direct access to each ticket's real DSH worker conversation. */
import { useEffect, useState, type ReactNode } from 'react'
import { LOCAL_BOARD_COLUMNS, type LocalBoardColumn } from '../app/api.ts'
import { usePoll, type TicketRow } from './api.ts'
import { Button, Icon, Input } from './controls.tsx'
import { ticketMark } from './marks.ts'
import { usePanel } from './provider.tsx'
import { LoadState, SessionButton, StageMark, When } from './widgets.tsx'

const PAGE_SIZE = 20

function TaskCard({ ticket }: { ticket: TicketRow }) {
  const { t, navigate } = usePanel()
  const mark = ticketMark(t, ticket)
  const completed = ticket.ended?.outcome === 'completed'
  const note = !ticket.ended && (ticket.note?.text || ticket.summary)
  return <li className="dt-board-card" data-state={completed ? 'done' : mark.dot}>
    <div className="dt-board-card-head">
      <StageMark state={completed ? 'done' : mark.dot} icon={completed ? 'decision' : mark.icon} label={mark.label} />
      <When at={ticket.updatedAt} />
    </div>
    <button className="dt-open dt-board-card-title" type="button" onClick={() => navigate({ page: 'execution', id: ticket.id })}>
      {ticket.title}
    </button>
    {note && <p className="dt-board-note" data-error={ticket.note?.error || undefined}>{note}</p>}
    <div className="dt-board-card-footer">
      {ticket.directory && <span className="dt-board-path" title={ticket.directory}><Icon name="folder" size={14} />
        <span>{ticket.directory.split('/').filter(Boolean).at(-1)}</span></span>}
      <div className="dt-board-card-actions">
        {ticket.sessionId ? <SessionButton variant="outline" sessionId={ticket.sessionId} label={t('localViewProcess')} />
          : <span className="dt-board-pending" role="img" aria-label={t('localBoardNoSession')} title={t('localBoardNoSession')}><Icon name="clock" /></span>}
      </div>
    </div>
  </li>
}

function BoardColumn({ column, query }: { column: LocalBoardColumn; query: string }) {
  const { t, call } = usePanel()
  const [offset, setOffset] = useState(0)
  const { data, error } = usePoll(() => call('GET local/board', { query: { column, q: query, offset, limit: PAGE_SIZE } }),
    [call, column, query, offset])
  const label = t(`localBoardColumn.${column}`)
  useEffect(() => {
    if (data && offset > 0 && offset >= data.total) setOffset(Math.floor(Math.max(0, data.total - 1) / PAGE_SIZE) * PAGE_SIZE)
  }, [data?.total, offset])
  if (column === 'idle' && !data?.total && !error) return null
  return <section className="dt-board-column" data-column={column} data-lane={column !== 'idle' && column !== 'ended' || undefined} aria-label={label}>
    <header className="dt-board-column-head"><h3><span className="dt-board-column-icon"><Icon name={column === 'queued' ? 'queue' : column === 'running' ? 'running'
      : column === 'attention' ? 'ask' : column === 'idle' ? 'clock' : 'history'} size={16} /></span>{label}</h3><span className="dt-board-count">{data?.total ?? '—'}</span></header>
    <LoadState error={error} loading={!data} />
    {data && (data.items.length ? <ul key={offset} className="dt-board-cards" id={`dt-board-${column}`}>
      {data.items.map(ticket => <TaskCard key={ticket.id} ticket={ticket} />)}
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
  return <section className="dt-board" aria-labelledby="dt-board-title">
    <header className="dt-board-toolbar"><h2 id="dt-board-title" className="dt-sr-only">{t('localTaskBoard')}</h2>
      <Input type="search" icon={<Icon name="search" />} aria-label={t('localSearch')} placeholder={t('localSearch')}
        maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
      {tools}
    </header>
    <div className="dt-board-columns">{LOCAL_BOARD_COLUMNS.map(column => <BoardColumn key={`${column}:${query.trim()}`}
      column={column} query={query.trim()} />)}</div>
  </section>
}
