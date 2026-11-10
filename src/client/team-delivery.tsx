/** Reported files and checks remain attributable to their actual task/session. */
import { useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { TeamView } from '../teams/contracts.ts'
import { Button, Icon, Modal } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { LoadState, MarkdownLite, SessionButton, When } from './widgets.tsx'

export function TeamDelivery({ team, compact = false }: { team: TeamView; compact?: boolean }) {
  const { t, call, notify } = usePanel()
  const [path, setPath] = useState<string>(), [file, setFile] = useState<ApiResponse<'GET local/teams/:id/file'>>()
  const [failure, setFailure] = useState<Error>()
  const preview = useAction(async (next: string) => {
    setPath(next); setFile(undefined); setFailure(undefined)
    try { setFile(await call('GET local/teams/:id/file', { id: team.id, query: { path: next } })) }
    catch (error) { setFailure(error instanceof Error ? error : new Error(String(error))) }
  })
  const deliveries = team.deliveries
  const files = [...new Map(deliveries.flatMap(delivery => delivery.record.files.map(file => [file.path, { ...file, name: delivery.name }] as const))).values()]
  const checks = deliveries.flatMap(delivery => delivery.record.checks.map((check, index) => ({ ...check, name: delivery.name, sessionId: delivery.record.sessionId, id: `${delivery.record.assignmentId}:${index}` })))
  // A coordinator's final review supersedes stage-specific caveats such as “tests not run by the implementer”.
  const finalReview = team.state === 'completed' ? deliveries.find(delivery => delivery.memberId === 'coordinator') : undefined
  const unverified = (finalReview ? [finalReview] : deliveries).flatMap(delivery => delivery.record.unverified.map(text => ({ text, name: delivery.name })))
  return <div className="dt-team-delivery">
    {!compact && <details className="dt-team-result-summary"><summary>{t('teamProgress')}</summary><MarkdownLite text={team.summary || t('teamNoProgress')} /></details>}
    <section><h3>{t(compact ? 'teamSharedFiles' : 'teamFiles')}<span className="dt-count">{files.length}</span></h3>
      {files.length ? <ul className="dt-team-files">{files.map(file => <li key={file.path}>
        <Icon name="folder" size={16} /><div><button className="dt-open" type="button" disabled={!file.exists || preview.busy} title={file.path}
          onClick={() => { void preview.run(file.path) }}>{file.path.replace(`${team.directory}/`, '')}</button>
          <span>{t('teamReportedBy', { name: file.name })}{!file.exists ? ` · ${t('teamFileMissing')}` : ''}</span>
          {!compact && file.summary && <p>{file.summary}</p>}</div>
      </li>)}</ul> : <p className="dt-hint">{t('teamNoFiles')}</p>}</section>
    {!compact && <><section><h3>{t('teamChecks')}</h3>{checks.length ? <ul className="dt-team-checks">{checks.map(check => <li key={check.id}>
      <span className="dt-team-status" data-state={check.outcome === 'failed' ? 'failed' : check.outcome === 'passed' ? 'completed' : 'waiting'}><Icon name={check.outcome === 'passed' ? 'decision' : check.outcome === 'failed' ? 'alert' : 'clock'} size={15} />
        {t(check.outcome === 'passed' ? 'teamCheckPassed' : check.outcome === 'failed' ? 'teamCheckFailed' : 'teamCheckNotRun')}</span>
      <code>{check.command}</code>{check.details && <p>{check.details}</p>}<span className="dt-hint">{check.name}{check.toolCallId ? ` · ${t('teamCheckEvidence')}` : ''}</span>
      <SessionButton sessionId={check.sessionId} external label={t('teamOriginalSession')} /></li>)}</ul> : <p className="dt-hint">{t('teamNoChecks')}</p>}</section>
      <section><h3>{t('teamUnverified')}</h3>{unverified.length ? <ul className="dt-team-unverified">{unverified.map((item, index) => <li key={index}>{item.text}<span>{item.name}</span></li>)}</ul>
        : <p className="dt-hint">{t('teamNoUnverified')}</p>}</section>
      {deliveries.length > 0 && <div className="dt-team-attribution">{deliveries.map(delivery => <span key={delivery.memberId}>{delivery.name} <When at={delivery.record.at} /></span>)}</div>}</>}
    <Modal open={!!path} onClose={() => setPath(undefined)} title={path?.split('/').at(-1) ?? t('teamFiles')} closeLabel={t('close')} className="dt-team-file-modal"
      footer={<Button variant="outline" icon={<Icon name="copy" />} onClick={() => { if (path) void navigator.clipboard.writeText(path).then(() => notify(t('teamCopyPath')), error => notify(String(error))) }}>{t('teamCopyPath')}</Button>}>
      <LoadState loading={!file} error={failure} />{file && (file.binary ? <p className="dt-hint">{t('teamBinaryFile')}</p> : <><pre className="dt-team-file-preview">{file.text}</pre>{file.truncated && <p className="dt-hint">{t('teamFileTruncated')}</p>}</>)}
    </Modal>
  </div>
}
