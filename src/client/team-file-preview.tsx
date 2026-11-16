/** Reported artifacts open in their own task, without the main Conversation sidebar. */
import { useEffect, useState, type ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { Button, Icon, Modal } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { LoadState, SessionButton } from './widgets.tsx'

export interface FileScope {
  kind: 'team' | 'task' | 'session'
  id: string; directory?: string; sessionId?: string; files: string[]
}

async function artifactBlob(scope: FileScope, path: string) {
  if (!scope.files.includes(path) || scope.kind === 'session') throw new Error('文件不在当前交付清单内')
  const result = await fetch(`/orchestrator/api/local/${scope.kind === 'team' ? 'teams' : 'tasks'}/${encodeURIComponent(scope.id)}/download?path=${encodeURIComponent(path)}`,
    { headers: { 'x-orchestrator-request': '1' } })
  if (!result.ok) throw new Error((await result.json().catch(() => ({}))).error ?? '下载失败')
  return result.blob()
}
export function ArtifactDownload({ scope, path }: { scope: FileScope; path: string }) {
  const { t, notify } = usePanel()
  const action = useAction(async () => {
    try {
      const url = URL.createObjectURL(await artifactBlob(scope, path)), link = document.createElement('a')
      link.href = url; link.download = path.split(/[\\/]/).at(-1) ?? 'download'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
  })
  return <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => { void action.run() }}>{t('artifactDownload')}</Button>
}
function ArtifactImage({ scope, path }: { scope: FileScope; path: string }) {
  const [url, setUrl] = useState<string>(), [error, setError] = useState<Error>()
  useEffect(() => {
    let active = true, created: string | undefined
    void artifactBlob(scope, path).then(blob => {
      if (active) { created = URL.createObjectURL(blob); setUrl(created) }
    }, failure => { if (active) setError(failure instanceof Error ? failure : new Error(String(failure))) })
    return () => { active = false; if (created) URL.revokeObjectURL(created) }
  }, [scope.id, scope.kind, path])
  return <><LoadState loading={!url} error={error} />{url && <img src={url} alt={path.split(/[\\/]/).at(-1)} style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />}</>
}

function FileContents({ scope, path }: { scope: FileScope; path: string }) {
  const { t, call } = usePanel()
  const [file, setFile] = useState<ApiResponse<'GET local/teams/:id/file'>>()
  const [error, setError] = useState<Error>()
  const reported = scope.files.includes(path)
  useEffect(() => {
    if (!reported || scope.kind === 'session') return
    let active = true
    const request = scope.kind === 'team' ? call('GET local/teams/:id/file', { id: scope.id, query: { path } })
      : call('GET local/tasks/:id/file', { id: scope.id, query: { path } })
    void request.then(value => { if (active) setFile(value) },
      failure => { if (active) setError(failure instanceof Error ? failure : new Error(String(failure))) })
    return () => { active = false }
  }, [call, scope.id, scope.kind, path, reported])
  const original = scope.sessionId && <SessionButton sessionId={scope.sessionId} external label={t('teamOriginalSession')} />
  if (!reported || scope.kind === 'session') return <><p className="dt-hint">{t('fileNotReported')}</p>{original}</>
  return <><LoadState loading={!file} error={error} />{error && original}{file && (file.binary ? /\.(png|jpe?g|gif|webp|avif)$/i.test(path)
    ? <ArtifactImage scope={scope} path={path} /> : <p className="dt-hint">{t('teamBinaryFile')}</p>
    : <><pre className="dt-team-file-preview">{file.text}</pre>{file.truncated && <p className="dt-hint">{t('teamFileTruncated')}</p>}</>)}</>
}

export function FilePreview({ scope, paths, changes = false, onClose }: { scope: FileScope; paths: string[]; changes?: boolean; onClose: () => void }) {
  const { t, notify } = usePanel(), [path, setPath] = useState(paths.length === 1 ? paths[0] : undefined)
  return <Modal open onClose={onClose} title={path?.split(/[\\/]/).at(-1) ?? t('teamWorkingFiles')} closeLabel={t('close')} className="dt-team-file-modal"
    footer={path && <div className="dt-actions">{scope.files.includes(path) && scope.kind !== 'session' && <ArtifactDownload scope={scope} path={path} />}{changes && scope.files.includes(path) && scope.sessionId && <SessionButton sessionId={scope.sessionId} external label={t('teamOriginalSession')} />}<Button variant="outline" icon={<Icon name="copy" />} onClick={() => {
      void navigator.clipboard.writeText(path).then(() => notify(t('teamCopyPath')), error => notify(String(error)))
    }}>{t('teamCopyPath')}</Button></div>}>
    {path && changes && scope.files.includes(path) && <p className="dt-hint">{t('fileCurrentContents')}</p>}
    {!paths.length || path ? <FileContents key={`${scope.kind}:${scope.id}:${path}`} scope={scope} path={path ?? ''} /> : <ul className="dt-team-files">{paths.map(path => <li key={path}>
      <Icon name="folder" size={16} /><button className="dt-open" type="button" onClick={() => setPath(path)}>{path.replace(`${scope.directory}/`, '')}</button>
    </li>)}</ul>}
  </Modal>
}

export function TaskFilesButton({ scope }: { scope: FileScope }) {
  const { t } = usePanel(), [open, setOpen] = useState(false)
  return <><Button variant="ghost" size="sm" icon={<Icon name="queue" />} aria-label={t('teamWorkingFiles')}
    title={t(scope.files.length ? 'teamWorkingFiles' : 'teamNoFiles')} disabled={!scope.files.length} onClick={() => setOpen(true)} />
    {open && <FilePreview scope={scope} paths={scope.files} onClose={() => setOpen(false)} />}</>
}

/** Native file controls expose their path as a title or label; hashed CSS prefixes are not used. */
export function SessionFiles({ scope, children }: { scope: FileScope; children: ReactNode }) {
  const [selection, setSelection] = useState<{ paths: string[]; changes: boolean }>()
  const files = [...new Set(scope.files)]
  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '')
  const linkPath = (value: string) => value.trim().replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/, '')
  const matches = (label: string) => files.filter(path => [path, normalize(path).replace(`${normalize(scope.directory ?? '')}/`, ''), path.split(/[\\/]/).at(-1)!]
    .some(alias => normalize(alias) === normalize(label)))
  return <div style={{ display: 'contents' }} onClickCapture={event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button || !event.currentTarget.contains(button) || button.disabled || button.hasAttribute('aria-haspopup')) return
    const aria = button.getAttribute('aria-label') ?? ''
    const bulk = aria === '在侧边栏查看本轮改动' || /^View (?:this turn['’]s changes|changes from this turn) in (?:the )?sidebar$/.test(aria)
    const change = /^(?:查看 (.+) 的改动|View changes to (.+))$/.exec(aria)
    const title = linkPath(button.title), label = linkPath(change?.[1] ?? change?.[2] ?? button.textContent ?? '')
    const titled = matches(title), selected = bulk ? files : titled.length ? titled : matches(label)
    // The installed host uses fileLink/fileMention on native file actions; unknown artifacts get a scoped explanation.
    if (!selected.length && (change || /(?:^|_)file(?:Link|Mention)(?:_|$)/.test(button.className))) {
      const path = title || label
      if (path && path.length <= 4096) selected.push(path)
    }
    if (!selected.length && !bulk) return
    event.preventDefault(); event.stopPropagation(); setSelection({ paths: selected, changes: bulk || !!change })
  }}>{children}{selection && <FilePreview scope={scope} paths={selection.paths} changes={selection.changes} onClose={() => setSelection(undefined)} />}</div>
}
