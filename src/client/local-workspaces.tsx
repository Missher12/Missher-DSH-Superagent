/** Real DSH projects, their directories, and entry points into task execution. */
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { selectLocalWorkspace } from './local.tsx'
import { useAction, usePanel } from './provider.tsx'
import { LoadState } from './widgets.tsx'

export function OpenWorkspaceButton({ directory }: { directory: string }) {
  const { t, call, openWorkspace } = usePanel()
  const open = useAction(async () => {
    const workspace = await call('POST local/workspaces', { body: { directory } })
    await openWorkspace(workspace.id)
  })
  return <Button variant="outline" size="sm" icon={<Icon name="folder" />} disabled={open.busy}
    title={directory} onClick={() => { void open.run() }}>{t('localOpenWorkspace')}</Button>
}

export function LocalWorkspaces() {
  const { t, call, navigate, openWorkspace, pickDirectory } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET local/workspaces'), [call])
  const open = useAction(async (id: string) => { await openWorkspace(id) })
  const add = useAction(async () => {
    const directory = await pickDirectory()
    if (!directory) return
    await call('POST local/workspaces', { body: { directory } })
    await reload()
  })
  return <section className="dt-local-workspaces" aria-label={t('localWorkspaces')}>
    <div className="dt-local-workspace-tools"><h2>{t('localWorkspaces')}</h2><Button variant="primary" icon={<Icon name="plus" />}
      disabled={add.busy} onClick={() => { void add.run() }}>{t('localAddWorkspace')}</Button></div>
    <LoadState error={error} loading={!data} />
    {data && <ul className="dt-local-workspace-list">{data.map(workspace => <li key={workspace.id} className="dt-local-workspace-row">
      <div className="dt-local-workspace-info"><button type="button" className="dt-local-workspace-icon" disabled={open.busy}
        aria-label={`${t('localOpenWorkspace')} · ${workspace.title}`} title={workspace.directory}
        onClick={() => { void open.run(workspace.id) }}><Icon name="folder" size={25} /></button>
        <div><h3>{workspace.title}</h3><p title={workspace.directory}>{workspace.directory}</p></div></div>
      <div className="dt-actions"><Button variant="ghost" icon={<Icon name="external" size={14} />} disabled={open.busy}
        onClick={() => { void open.run(workspace.id) }}>{t('localOpenWorkspace')}</Button>
        <Button variant="outline" icon={<Icon name="plus" size={14} />} onClick={() => { selectLocalWorkspace(workspace.directory); navigate({ page: 'execution' }) }}>{t('localWorkspaceTask')}</Button></div>
    </li>)}</ul>}
    {data?.length === 0 && <p className="dt-hint">{t('localNoWorkspaces')}</p>}
  </section>
}
