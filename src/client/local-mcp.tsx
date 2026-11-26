/** Native settings for external applications dispatching tasks over MCP. */
import { useId, useMemo, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Icon, Input, Modal, Switch } from './controls.tsx'
import { Field, Fields } from './settings-kit.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { ConfirmButton, Hint, Section, When } from './widgets.tsx'
import { Select } from './select.tsx'
import type { TaskTool } from '../mcp/server.ts'
import type { DshSuperagentKey } from './locales.ts'

type Connection = ApiResponse<'GET mcp'>['clients'][number]
type Credential = ApiResponse<'POST mcp/clients/:id/token'>
const TOOL_LABELS: Record<TaskTool, DshSuperagentKey> = {
  workspace_list: 'mcpTool.workspace_list', task_create: 'mcpTool.task_create', task_get: 'mcpTool.task_get',
  task_list: 'mcpTool.task_list', task_followup: 'mcpTool.task_followup', task_stop: 'mcpTool.task_stop', task_retry: 'mcpTool.task_retry',
}

/** Only matching project names need enough parent folders to distinguish them. Compute
 * against the whole grant list so typing in search never changes a project's label. */
function workspaceLocations(projects: readonly { id: string; title: string; directory: string }[]) {
  const groups = Map.groupBy(projects, project => project.title.trim().toLocaleLowerCase())
  const labels = new Map<string, string>()
  for (const group of groups.values()) {
    const paths = group.map(project => project.directory.replaceAll('\\', '/').split('/').filter(Boolean))
    group.forEach((project, index) => {
      const parts = paths[index]!
      let count = 1
      while (count < parts.length && paths.some((other, i) => i !== index && other.slice(-count).join('/') === parts.slice(-count).join('/'))) count++
      const suffix = parts.slice(-count).join('/')
      labels.set(project.id, group.length === 1 && suffix === project.title ? '' : suffix || project.directory)
    })
  }
  return labels
}

function CredentialDialog({ credential, onClose }: { credential: Credential; onClose: () => void }) {
  const { call, t, notify } = usePanel()
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [checking, setChecking] = useState(false), [checked, setChecked] = useState<ApiResponse<'POST mcp/clients/:id/test'>>()
  const [failure, setFailure] = useState<string>()
  const configuration = JSON.stringify(credential.configuration[transport], null, 2)
  const check = async () => {
    if (checking) return
    const id = /^dshsa_([a-f0-9-]{36})_/.exec(credential.token)?.[1]
    if (!id) return
    setChecking(true); setChecked(undefined); setFailure(undefined)
    try { setChecked(await call('POST mcp/clients/:id/test', { id, body: { token: credential.token, transport } })) }
    catch (error) { setFailure(errorText(error)) }
    finally { setChecking(false) }
  }
  return <Modal className="dt-mcp-dialog" open title={t('mcpConnectionConfig')} closeLabel={t('close')} onClose={onClose}
    description={t('mcpConfigHint')} footer={<>
      <Button disabled={checking} onClick={() => { void check() }}>{t(checking ? 'mcpChecking' : 'mcpTest')}</Button>
      <Button onClick={onClose}>{t('close')}</Button>
      <Button variant="primary" icon={<Icon name="copy" size={14} />} onClick={() => {
        void navigator.clipboard.writeText(configuration).then(() => notify(t('localCopied')), error => setFailure(errorText(error)))
      }}>{t('localCopyResult')}</Button>
    </>}>
    <div className="dt-form"><Field label={t('mcpTransport')}><Select value={transport}
      disabled={checking} onChange={event => { setTransport(event.target.value as 'stdio' | 'http'); setChecked(undefined); setFailure(undefined) }}>
      <option value="stdio">{t('mcpStdio')}</option><option value="http">HTTP</option>
    </Select></Field>
      <Hint>{t(transport === 'stdio' ? 'mcpStdioHint' : 'mcpHttpHint')}</Hint>
      <pre className="dt-mcp-config" tabIndex={0}>{configuration}</pre>
      {checked && <p className="dt-hint" role="status">{t('mcpChecked', { tools: checked.tools, workspaces: checked.workspaces })}</p>}
      {failure && <p className="dt-error" role="status">{failure}</p>}
    </div>
  </Modal>
}

export function McpSettings({ permissions = false }: { permissions?: boolean }) {
  const { call, t } = usePanel()
  const formId = useId()
  const { data, error, reload } = usePoll(() => call('GET mcp'), [call])
  const { data: workspaces, error: workspaceError } = usePoll(() => call('GET local/workspaces'), [call])
  const [editing, setEditing] = useState<{ id?: string; name: string; workspaceIds: string[] }>()
  const [query, setQuery] = useState(''), [fullPaths, setFullPaths] = useState(false)
  const locations = useMemo(() => workspaceLocations(workspaces ?? []), [workspaces])
  const searchable = (workspaces?.length ?? 0) > 5 || !!query
  const search = query.trim().toLocaleLowerCase()
  const matches = workspaces?.filter(project => `${project.title}\n${project.directory}`.toLocaleLowerCase().includes(search))
  const [credential, setCredential] = useState<Credential>()
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string>()
  const perform = async (run: () => Promise<unknown>) => {
    setBusy(true); setFailure(undefined)
    try { await run(); await reload(); return true }
    catch (error) { setFailure(errorText(error)); return false }
    finally { setBusy(false) }
  }
  const open = (client?: Connection) => {
    setFailure(undefined)
    setQuery(''); setFullPaths(false)
    setEditing(client ? { id: client.id, name: client.name, workspaceIds: client.projects.map(project => project.id) }
      : { name: '', workspaceIds: [] })
  }
  const save = async () => {
    if (busy || !editing?.name.trim() || !editing.workspaceIds.length) return
    const value = editing
    await perform(async () => {
      const body = { name: value.name.trim(), workspaceIds: value.workspaceIds }
      if (value.id) await call('PUT mcp/clients/:id', { id: value.id, body })
      else {
        const result = await call('POST mcp/clients', { body })
        setCredential(result)
      }
      setEditing(undefined)
    })
  }
  return <Section title={t(permissions ? 'mcpDispatchPermissions' : 'mcpAppConnections')} hint={t(permissions ? 'mcpDispatchPermissionsHint' : 'mcpHint')} action={<Button variant="outline" size="sm" icon={<Icon name="plus" size={14} />}
    disabled={!data || busy} onClick={() => open()}>{t('mcpAdd')}</Button>}>
    {!permissions && <div className="dt-mcp-capabilities"><span>{t('mcpToolsTitle')}</span><ul className="dt-mcp-tools">
      {Object.entries(TOOL_LABELS).map(([tool, label]) => <li key={tool} title={tool}>{t(label)}</li>)}
    </ul></div>}
    {(error || workspaceError || failure) && <p className="dt-error" role="status">{failure ?? error?.message ?? workspaceError?.message}</p>}
    {data && !data.clients.length && <p className="dt-hint dt-mcp-empty">{t('mcpEmpty')}</p>}
    <Fields disabled={busy}>
      {data?.clients.map(client => <div className="dt-mcp-connection" key={client.id}>
        <div className="dt-mcp-description"><strong title={client.name}>{client.name}</strong>
          <span className="dt-mcp-meta" title={client.projects.map(project => project.title).join(' · ')}>{client.projects[0]?.title}{client.projects.length > 1 && ` +${client.projects.length - 1}`}
            {client.lastUsedAt && <small title={t('mcpLastUsed')}> · <When at={client.lastUsedAt} /></small>}</span>
        </div>
        <div className="dt-actions">
          <Button size="sm" onClick={() => open(client)}>{t('mcpConfigure')}</Button>
          <Switch checked={client.enabled} label={t('mcpEnable', { name: client.name })}
            onChange={enabled => { void perform(() => call('POST mcp/clients/:id/enabled', { id: client.id, body: { enabled } })) }} />
        </div>
      </div>)}
    </Fields>
    <Modal className="dt-mcp-dialog" open={!!editing} title={editing?.id ? t('mcpEditApplication', { name: data?.clients.find(client => client.id === editing.id)?.name ?? '' }) : t('mcpAdd')} closeLabel={t('close')}
      onClose={() => { if (!busy) setEditing(undefined) }} footer={<>
        <Button disabled={busy} onClick={() => setEditing(undefined)}>{t('cancel')}</Button>
        <Button type="submit" form={formId} variant="primary" disabled={busy || !editing?.name.trim() || !editing.workspaceIds.length}>{t('save')}</Button>
      </>}>
      {editing && <form id={formId} className="dt-form dt-mcp-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void save() }}>
        <Fields disabled={busy}>
          <Field label={t('mcpName')}><Input placeholder={t('mcpNameExample')} value={editing.name} required maxLength={100}
            onChange={event => setEditing({ ...editing, name: event.target.value })} /></Field>
          <fieldset className="dt-mcp-grants" aria-describedby={`${formId}-permission`}>
            <legend>{t('mcpWorkspaces')}</legend>
            <div className="dt-mcp-selection"><Button size="sm" aria-pressed={fullPaths} onClick={() => setFullPaths(value => !value)}>{t('mcpFullPaths')}</Button><span role="status">{t('mcpSelection', { count: editing.workspaceIds.length })}</span>
              {searchable && <Input type="search" icon={<Icon name="search" size={14} />}
                aria-label={t('localSearchWorkspaces')} placeholder={t('localSearchWorkspaces')} value={query} onChange={event => setQuery(event.target.value)} />}</div>
            <div className="dt-mcp-workspaces" data-searchable={searchable || undefined} data-full-paths={fullPaths || undefined}>
              {matches?.map(project => {
                const path = fullPaths ? project.directory : locations.get(project.id)
                return <label key={project.id} title={project.directory}><input type="checkbox"
                  aria-label={path ? `${project.title} ${path}` : project.title}
                  checked={editing.workspaceIds.includes(project.id)} onChange={event => setEditing({ ...editing,
                    workspaceIds: event.target.checked ? [...editing.workspaceIds, project.id] : editing.workspaceIds.filter(id => id !== project.id) })} />
                  <span><strong>{project.title}</strong>{path && <small><bdi>{path}</bdi></small>}</span></label>
              })}
              {!matches?.length && <p className={workspaceError ? 'dt-error' : 'dt-hint'} role="status">{workspaceError?.message ??
                t(!workspaces ? 'loading' : workspaces.length ? 'localNoWorkspaceMatches' : 'mcpNoWorkspaces')}</p>}
            </div>
            <p className="dt-hint" id={`${formId}-permission`}>{t('mcpGrantHint')}</p>
          </fieldset>
          {failure && <p className="dt-error" role="status">{failure}</p>}
          {editing.id && <div className="dt-mcp-credentials">
            <ConfirmButton label={t('mcpResetToken')} title={t('mcpResetToken')} message={t('mcpResetHint')}
              onConfirm={() => perform(async () => {
                const result = await call('POST mcp/clients/:id/token', { id: editing.id! })
                setEditing(undefined); setCredential(result)
              })} />
          </div>}
          {editing.id && <div className="dt-danger-zone"><span>{t('mcpRevokeHint')}</span>
            <ConfirmButton label={t('mcpRevoke')} title={t('mcpRevoke')} message={t('mcpRevokeConfirm')}
              icon="trash" onConfirm={() => perform(async () => {
                await call('DELETE mcp/clients/:id', { id: editing.id! }); setEditing(undefined)
              })} /></div>}
        </Fields>
      </form>}
    </Modal>
    {credential && <CredentialDialog key={credential.token} credential={credential} onClose={() => setCredential(undefined)} />}
  </Section>
}
