/** Real DSH projects, their directories, and entry points into task execution. */
import { useState } from 'react'
import { usePoll } from './api.ts'
import { Button, Icon, Input } from './controls.tsx'
import { selectLocalWorkspace } from './local.tsx'
import { useAction, usePanel } from './provider.tsx'
import { ConfirmButton, LoadState } from './widgets.tsx'

export function OpenWorkspaceButton({ directory, compact = false }: { directory: string; compact?: boolean }) {
  const { t, call, openWorkspace } = usePanel()
  const open = useAction(async () => {
    const workspace = await call('POST local/workspaces', { body: { directory } })
    await openWorkspace(workspace.id)
  })
  return <Button variant={compact ? 'ghost' : 'outline'} size="sm" icon={<Icon name="folder" />} disabled={open.busy}
    aria-label={t('localOpenWorkspace')} title={directory} onClick={() => { void open.run() }}>{compact ? null : t('localOpenWorkspace')}</Button>
}

export function LocalWorkspaces() {
  const { t, call, navigate, openWorkspace, pickDirectory } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET local/workspaces'), [call])
  const [query, setQuery] = useState('')
  const search = query.trim().toLocaleLowerCase()
  const workspaces = data?.filter(workspace => `${workspace.title}\n${workspace.directory}`.toLocaleLowerCase().includes(search))
  const open = useAction(async (id: string) => { await openWorkspace(id) })
  const add = useAction(async () => {
    const directory = await pickDirectory()
    if (!directory) return
    await call('POST local/workspaces', { body: { directory } })
    await reload()
  })
  return <section className="dt-local-workspaces" aria-label={t('localWorkspaces')}>
    <div className="dt-local-workspace-tools"><h2>{t('localWorkspaces')}{data && <span className="dt-count">{data.length}</span>}</h2><Button variant="primary" icon={<Icon name="plus" />}
      disabled={add.busy} onClick={() => { void add.run() }}>{t('localAddWorkspace')}</Button></div>
    <Input type="search" icon={<Icon name="search" />} aria-label={t('localSearchWorkspaces')} placeholder={t('localSearchWorkspaces')}
      maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
    <LoadState error={error} loading={!data} />
    {workspaces && <ul className="dt-local-workspace-list">{workspaces.map(workspace => <li key={workspace.id} className="dt-local-workspace-row">
      <div className="dt-local-workspace-info"><button type="button" className="dt-local-workspace-icon" disabled={open.busy}
        aria-label={`${t('localOpenWorkspace')} · ${workspace.title}`} title={workspace.directory}
        onClick={() => { void open.run(workspace.id) }}><Icon name="folder" size={25} /></button>
        <div><h3 title={workspace.title}>{workspace.title}</h3><p title={workspace.directory}>{workspace.directory}</p></div></div>
      <div className="dt-actions"><Button variant="ghost" icon={<Icon name="external" size={14} />} disabled={open.busy}
        aria-label={t('localOpenWorkspace')} onClick={() => { void open.run(workspace.id) }}>{t('localWorkspaceOpenShort')}</Button>
        <Button variant="ghost" icon={<Icon name="plus" size={14} />} aria-label={t('localWorkspaceTask')}
          onClick={() => { selectLocalWorkspace(workspace.directory); navigate({ page: 'execution' }) }}>{t('localWorkspaceTask')}</Button></div>
      <div className="dt-workspace-remove"><ConfirmButton variant="ghost" icon="trash" label={t('localRemoveWorkspace')}
        title={t('localRemoveWorkspaceTitle', { name: workspace.title })} message={t('localRemoveWorkspaceConfirm')}
        confirmLabel={t('localRemoveWorkspace')} disabled={workspace.protected || workspace.activeTasks > 0}
        disabledReason={workspace.protected ? t('localWorkspaceProtected') : workspace.activeTasks ? t('localWorkspaceBusy') : undefined} onConfirm={async () => {
          await call('DELETE local/workspaces/:id', { id: workspace.id }); await reload()
        }} /></div>
    </li>)}</ul>}
    {data?.length === 0 && <p className="dt-hint">{t('localNoWorkspaces')}</p>}
    {!!data?.length && !workspaces?.length && <p className="dt-hint" role="status">{t('localNoWorkspaceMatches')}</p>}
  </section>
}
