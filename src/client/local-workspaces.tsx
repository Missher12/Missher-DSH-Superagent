/** Real DSH projects, their directories, and entry points into task execution. */
import { useId, useState } from 'react'
import { usePoll } from './api.ts'
import { Button, Icon, Input, Modal } from './controls.tsx'
import { selectLocalWorkspace } from './local.tsx'
import { useAction, usePanel } from './provider.tsx'
import { ConfirmButton, LoadState } from './widgets.tsx'
import { ComposerField, ComposerForm, ComposerModal } from './composer.tsx'
import { errorText } from './text.ts'

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
  const { t, call, navigate, openWorkspace, pickDirectory, notify } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET local/workspaces'), [call])
  const [query, setQuery] = useState('')
  const search = query.trim().toLocaleLowerCase()
  const workspaces = data?.filter(workspace => `${workspace.title}\n${workspace.directory}`.toLocaleLowerCase().includes(search))
  const open = useAction(async (id: string) => { await openWorkspace(id) })
  const form = useId(), [adding, setAdding] = useState(false), [draft, setDraft] = useState({ title: '', directory: '' }), [failure, setFailure] = useState<string>()
  const [renaming, setRenaming] = useState(false), [path, setPath] = useState<string>()
  const copy = useAction(async () => { if (path) { await navigator.clipboard.writeText(path); notify(t('localCopied')) } })
  const add = useAction(async () => {
    setFailure(undefined)
    try {
      await call('POST local/workspaces', { body: { directory: draft.directory.trim(), ...(draft.title.trim() ? { title: draft.title.trim() } : {}) } })
      setAdding(false); setDraft({ title: '', directory: '' }); await reload()
    } catch (error) { setFailure(errorText(error)); throw error }
  })
  const pick = useAction(async () => {
    setFailure(undefined)
    try { const directory = await pickDirectory(); if (directory) setDraft(current => ({ ...current, directory })) }
    catch (error) { setFailure(errorText(error)); throw error }
  })
  return <section className="dt-local-workspaces" aria-label={t('localWorkspaces')}>
    <div className="dt-local-workspace-tools"><h2>{t('localWorkspaces')}{data && <span className="dt-count">{data.length}</span>}</h2><Button variant="primary" icon={<Icon name="plus" />}
      disabled={add.busy} onClick={() => { if (renaming) setDraft({ title: '', directory: '' }); setRenaming(false); setFailure(undefined); setAdding(true) }}>{t('localAddWorkspace')}</Button></div>
    <Input type="search" icon={<Icon name="search" />} aria-label={t('localSearchWorkspaces')} placeholder={t('localSearchWorkspaces')}
      maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
    <LoadState error={error} loading={!data} />
    {workspaces && <ul className="dt-local-workspace-list">{workspaces.map(workspace => <li key={workspace.id} className="dt-local-workspace-row">
      <div className="dt-local-workspace-info"><button type="button" className="dt-local-workspace-icon" disabled={open.busy}
        aria-label={`${t('localOpenWorkspace')} · ${workspace.title}`} title={workspace.directory}
        onClick={() => { void open.run(workspace.id) }}><Icon name="folder" size={25} /></button>
        <div><h3 title={workspace.title}>{workspace.title}</h3><button type="button" className="dt-workspace-path" title={workspace.directory}
          aria-label={`${t('workspacePath')} · ${workspace.title}`} onClick={() => setPath(workspace.directory)}>{workspace.directory}</button></div></div>
      <div className="dt-actions"><Button variant="ghost" icon={<Icon name="external" size={14} />} disabled={open.busy}
        aria-label={t('localOpenWorkspace')} onClick={() => { void open.run(workspace.id) }}>{t('localWorkspaceOpenShort')}</Button>
        <Button variant="ghost" icon={<Icon name="plus" size={14} />} aria-label={t('localWorkspaceTask')}
          onClick={() => { selectLocalWorkspace(workspace.directory); navigate({ page: 'execution' }) }}>{t('localWorkspaceTask')}</Button>
        <Button variant="ghost" onClick={() => { setDraft({ title: workspace.title, directory: workspace.directory }); setFailure(undefined); setRenaming(true); setAdding(true) }}>{t('workspaceRename')}</Button></div>
      <div className="dt-workspace-remove"><ConfirmButton variant="ghost" icon="trash" label={t('localRemoveWorkspace')}
        title={t('localRemoveWorkspaceTitle', { name: workspace.title })} message={t('localRemoveWorkspaceConfirm')}
        confirmLabel={t('localRemoveWorkspace')} disabled={workspace.protected || workspace.activeTasks > 0}
        disabledReason={workspace.protected ? t('localWorkspaceProtected') : workspace.activeTasks ? t('localWorkspaceBusy') : undefined} onConfirm={async () => {
          await call('DELETE local/workspaces/:id', { id: workspace.id }); await reload()
        }} /></div>
    </li>)}</ul>}
    {data?.length === 0 && <p className="dt-hint">{t('localNoWorkspaces')}</p>}
    {!!data?.length && !workspaces?.length && <p className="dt-hint" role="status">{t('localNoWorkspaceMatches')}</p>}
    <ComposerModal open={adding} title={t(renaming ? 'workspaceRename' : 'localAddWorkspace')} kind="workspace" form={form} action={t(renaming ? 'save' : 'localAddWorkspace')} busy={add.busy || pick.busy}
      close={() => setAdding(false)} note={renaming ? undefined : t('studioWorkspaceNote')}>
      <ComposerForm id={form} disabled={add.busy || pick.busy} failure={failure} onSubmit={() => { void add.run() }}>
        <section className="dt-composer-brief"><ComposerField label={t('studioWorkspaceName')}><Input className="dt-composer-name" maxLength={80}
          placeholder={t('studioWorkspaceNamePlaceholder')} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></ComposerField></section>
        <section className="dt-composer-properties"><ComposerField label={t('studioProjectDirectory')} required><Input required readOnly={renaming} value={draft.directory}
          placeholder="/Users/.../project" onChange={event => setDraft({ ...draft, directory: event.target.value })} /></ComposerField>
          {!renaming && <Button variant="ghost" size="sm" icon={<Icon name="folder" />} disabled={add.busy || pick.busy}
            onClick={() => { void pick.run() }}>{t('studioPickDirectory')}</Button>}</section>
      </ComposerForm>
    </ComposerModal>
    <Modal open={!!path} title={t('workspacePath')} closeLabel={t('close')} onClose={() => setPath(undefined)}
      footer={<Button icon={<Icon name="copy" />} disabled={copy.busy} onClick={() => { void copy.run() }}>{t('teamCopyPath')}</Button>}>
      <p className="dt-workspace-full-path">{path}</p>
    </Modal>
  </section>
}
