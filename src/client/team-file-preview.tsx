/** Reported artifacts open in the team that owns them, without the main Conversation sidebar. */
import { useEffect, useState, type ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { TeamView } from '../teams/contracts.ts'
import { Button, Icon, Modal } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { LoadState } from './widgets.tsx'

function FileContents({ teamId, path }: { teamId: string; path: string }) {
  const { t, call } = usePanel()
  const [file, setFile] = useState<ApiResponse<'GET local/teams/:id/file'>>()
  const [error, setError] = useState<Error>()
  useEffect(() => {
    let active = true
    void call('GET local/teams/:id/file', { id: teamId, query: { path } }).then(value => { if (active) setFile(value) },
      failure => { if (active) setError(failure instanceof Error ? failure : new Error(String(failure))) })
    return () => { active = false }
  }, [call, teamId, path])
  return <><LoadState loading={!file} error={error} />{file && (file.binary ? <p className="dt-hint">{t('teamBinaryFile')}</p>
    : <><pre className="dt-team-file-preview">{file.text}</pre>{file.truncated && <p className="dt-hint">{t('teamFileTruncated')}</p>}</>)}</>
}

export function TeamFilePreview({ team, paths, onClose }: { team: TeamView; paths: string[]; onClose: () => void }) {
  const { t, notify } = usePanel(), [path, setPath] = useState(paths.length === 1 ? paths[0] : undefined)
  return <Modal open onClose={onClose} title={path?.split(/[\\/]/).at(-1) ?? t('teamWorkingFiles')} closeLabel={t('close')} className="dt-team-file-modal"
    footer={path && <Button variant="outline" icon={<Icon name="copy" />} onClick={() => {
      void navigator.clipboard.writeText(path).then(() => notify(t('teamCopyPath')), error => notify(String(error)))
    }}>{t('teamCopyPath')}</Button>}>
    {path ? <FileContents key={`${team.id}:${path}`} teamId={team.id} path={path} /> : <ul className="dt-team-files">{paths.map(path => <li key={path}>
      <Icon name="folder" size={16} /><button className="dt-open" type="button" onClick={() => setPath(path)}>{path.replace(`${team.directory}/`, '')}</button>
    </li>)}</ul>}
  </Modal>
}

/** Native links expose their path as a title or label. Match only this team's actual reported artifacts. */
export function TeamSessionFiles({ team, children }: { team: TeamView; children: ReactNode }) {
  const [paths, setPaths] = useState<string[]>([])
  const files = [...new Set(team.deliveries.flatMap(delivery => delivery.record.files.map(file => file.path)))]
  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '')
  const matches = (label: string) => files.filter(path => [path, path.replace(`${team.directory}/`, ''), path.split(/[\\/]/).at(-1)!]
    .some(alias => normalize(alias) === normalize(label)))
  return <div style={{ display: 'contents' }} onClickCapture={event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button || !event.currentTarget.contains(button) || button.disabled || button.hasAttribute('aria-haspopup')) return
    const titled = matches(button.title.trim()), selected = titled.length ? titled : matches(button.textContent?.trim() ?? '')
    if (!selected.length) return
    event.preventDefault(); event.stopPropagation(); setPaths(selected)
  }}>{children}{paths.length > 0 && <TeamFilePreview team={team} paths={paths} onClose={() => setPaths([])} />}</div>
}
