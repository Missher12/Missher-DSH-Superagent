/** Local task detail, with one current result and explicit continue/stop/retry actions. */
import { useEffect, useState } from 'react'
import type { TicketPageView } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { LocalFollowup, prepareLocalTask } from './local.tsx'
import { OpenWorkspaceButton } from './local-workspaces.tsx'
import { ticketMark } from './marks.ts'
import { useAction, usePanel } from './provider.tsx'
import { actorName, reasonLabel, valueLabel } from './text.ts'
import { Assignments } from './ticket-assignments.tsx'
import { ConfirmButton, Hint, KeyValues, LoadState, MarkdownLite, Section, SessionButton, StageMark, When } from './widgets.tsx'

export function LocalTicketPage({ data, error, reload }: { data: TicketPageView; error?: Error | undefined; reload: () => Promise<void> }) {
  const { t, call, navigate, notify } = usePanel()
  const [copied, setCopied] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const status = ticketMark(t, data)
  const reply = data.messages?.filter(message => message.kind === 'reply').at(-1)
  const report = data.assignments.at(-1)?.report
  const result = reply && (!report || reply.at >= report.at) ? reply.text : data.summary || reply?.text || ''
  useEffect(() => { setCopied(false) }, [result])
  const retry = useAction(async () => { await call('POST tickets/:id/retry', { id: data.id }); await reload() })
  const copy = useAction(async () => { await navigator.clipboard.writeText(result); setCopied(true); notify(t('localCopied')) })
  const completed = !!data.ended
  const stopped = data.ended?.by === 'human'
  return <article className="dt-local-ticket">
    <div className="dt-actions dt-local-ticket-nav"><Button variant="ghost" icon={<Icon name="chevron-left" />} onClick={() => navigate({ page: 'execution' })}>{t('localBackToTasks')}</Button></div>
    <div className="dt-local-task-head"><h2>{data.title}</h2><div className="dt-actions">
      {data.directory && <OpenWorkspaceButton directory={data.directory} />}
      {data.sessionId && <SessionButton variant="outline" sessionId={data.sessionId} label={t('localViewProcess')} />}
      {data.actions.retry && <Button variant="outline" disabled={retry.busy} icon={<Icon name="refresh" />}
        onClick={() => { void retry.run() }}>{t('localRetry')}</Button>}
      {data.actions.stop && <ConfirmButton variant="outline" label={t('stop')} title={t('localStopTitle')}
        message={t('localStopHint')} onConfirm={async () => { await call('POST tickets/:id/stop', { id: data.id }); await reload() }} />}
    </div></div>
    <div className="dt-row-meta"><StageMark state={data.ended?.outcome === 'completed' ? 'done' : status.dot}
      icon={data.ended?.outcome === 'completed' ? 'decision' : status.icon} label={status.label} />
      <span className="dt-local-path" title={data.directory}>{data.directory?.split('/').filter(Boolean).at(-1)}</span><When at={data.updatedAt} /></div>
    {error && <LoadState error={error} loading={false} />}
    {data.attention && <div className="dt-banner"><strong>{t('localNeedsAnswer')}</strong><MarkdownLite text={data.attention.question} /></div>}
    {data.deliveryError && <p className="dt-error" role="alert">{data.deliveryError}</p>}
    <Section title={t(completed ? 'localResults' : 'localProgress')} action={result && <Button size="sm" variant="ghost"
      icon={<Icon name="copy" />} disabled={copy.busy} onClick={() => { void copy.run() }}>{t(copied ? 'localCopied' : 'localCopyResult')}</Button>}>
      {result ? <div className="dt-local-result"><MarkdownLite text={result} /></div>
        : <Hint>{t(data.stage === 'working' && data.action === 'queued' ? 'localQueuedHint' : 'localProgressHint')}</Hint>}
    </Section>
    {stopped ? <div className="dt-local-form"><Hint>{t('localStoppedHint')}</Hint><Button variant="outline" onClick={() => {
      prepareLocalTask(data.directory ?? '', data.mandate.scope, data.title); navigate({ page: 'execution' })
    }}>{t('localDispatchAgain')}</Button></div> : <LocalFollowup key={data.id} id={data.id} completed={completed} onSent={reload} />}
    <details className="dt-local-details"><summary>{t('localOriginalRequest')}</summary><div className="dt-local-details-body"><MarkdownLite text={data.mandate.scope} /></div></details>
    <details className="dt-local-details" onToggle={event => setRecordsOpen(event.currentTarget.open)}><summary>{t('localRecords')}</summary>{recordsOpen && <div className="dt-local-details-body">
      {data.directory && <p className="dt-hint">{t('localDirectory')}：{data.directory}</p>}
      <p className="dt-hint">{t('ticketId')}：{data.id}</p>
      <Section title={t('mandateDetails')}><KeyValues rows={[
        [t('ticketActorLabel'), `${valueLabel(t, 'source', data.mandate.actor.source)} · ${actorName(t, data.mandate.actor)}`],
        [t('ticketMandateLabel'), valueLabel(t, 'strength', data.mandate.strength)],
        ...data.decision ? [[t('term.decision'), `${valueLabel(t, 'decision', data.decision.outcome)} · ${reasonLabel(t, data.decision.reason)}`] as [string, string]] : [],
        [t('policyVersion'), <span className="dt-mono">{data.mandate.policyVersion}</span>],
      ]} /></Section>
      {data.assignments.length > 0 && <Section title={t('term.assignment')} count={data.assignments.length}><Assignments ticket={data} /></Section>}
      {data.inputs.slice().reverse().map(input => {
        const text = input.kind === 'trigger' ? input.trigger?.preview : 'text' in input ? input.text : undefined
        return <div key={input.id} className="dt-local-record"><div className="dt-row-meta">
          <span>{valueLabel(t, 'input', input.kind)}</span><span>{t(input.delivered ? 'inputDelivered' : 'inputUndelivered')}</span>
          <When at={input.at} /></div>{text && <MarkdownLite text={text} />}</div>
      })}
      {data.messages?.filter(message => message.kind === 'reply' && message.id !== reply?.id).map(message => <div key={message.id} className="dt-local-record">
        <When at={message.at} /><MarkdownLite text={message.text} /></div>)}
    </div>}</details>
  </article>
}
