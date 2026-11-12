/** Native settings for external applications dispatching tasks over MCP. */
import { useId, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Icon, Input, Modal, Switch } from './controls.tsx'
import { Field, Fields } from './settings-kit.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { ConfirmButton, Hint, Section, When } from './widgets.tsx'
import { Select } from './select.tsx'

type Connection = ApiResponse<'GET mcp'>['clients'][number]
type Credential = ApiResponse<'POST mcp/clients/:id/token'>

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

export function McpSettings() {
  const { call, t } = usePanel()
  const formId = useId()
  const { data, error, reload } = usePoll(() => call('GET mcp'), [call])
  const { data: workspaces, error: workspaceError } = usePoll(() => call('GET local/workspaces'), [call])
  const [editing, setEditing] = useState<{ id?: string; name: string; workspaceIds: string[] }>()
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
    setEditing(client ? { id: client.id, name: client.name, workspaceIds: client.projects.map(project => project.id) }
      : { name: '', workspaceIds: [] })
  }
  const save = async () => {
    if (!editing) return
    const value = editing
    await perform(async () => {
      const body = { name: value.name, workspaceIds: value.workspaceIds }
      if (value.id) await call('PUT mcp/clients/:id', { id: value.id, body })
      else {
        const result = await call('POST mcp/clients', { body })
        setCredential(result)
      }
      setEditing(undefined)
    })
  }
  return <Section title={t('mcpTitle')} hint={t('mcpHint')} action={<Button variant="outline" size="sm" icon={<Icon name="plus" size={14} />}
    disabled={!data || busy} onClick={() => open()}>{t('mcpAdd')}</Button>}>
    {(error || workspaceError || failure) && <p className="dt-error" role="status">{failure ?? error?.message ?? workspaceError?.message}</p>}
    {data && !data.clients.length && <p className="dt-hint dt-mcp-empty">{t('mcpEmpty')}</p>}
    <Fields disabled={busy}>
      {data?.clients.map(client => <div className="dt-mcp-connection" key={client.id}>
        <div className="dt-mcp-description"><strong>{client.name}</strong>
          <span className="dt-mcp-meta">{client.projects.map(project => project.title).join(' · ')}
            {client.lastUsedAt && <small title={t('mcpLastUsed')}> · <When at={client.lastUsedAt} /></small>}</span>
        </div>
        <div className="dt-actions">
          <Button size="sm" onClick={() => open(client)}>{t('mcpConfigure')}</Button>
          <Switch checked={client.enabled} label={t('mcpEnable', { name: client.name })}
            onChange={enabled => { void perform(() => call('POST mcp/clients/:id/enabled', { id: client.id, body: { enabled } })) }} />
        </div>
      </div>)}
    </Fields>
    <Modal className="dt-mcp-dialog" open={!!editing} title={editing?.id ? t('mcpConfigure') : t('mcpAdd')} closeLabel={t('close')}
      onClose={() => { if (!busy) setEditing(undefined) }} footer={<>
        <Button disabled={busy} onClick={() => setEditing(undefined)}>{t('cancel')}</Button>
        <Button type="submit" form={formId} variant="primary" disabled={busy || !editing?.name.trim() || !editing.workspaceIds.length}>{t('save')}</Button>
      </>}>
      {editing && <form id={formId} className="dt-form dt-mcp-form" onSubmit={event => { event.preventDefault(); void save() }}>
        <Fields disabled={busy}>
          <Field label={t('mcpName')}><Input value={editing.name} required maxLength={100}
            onChange={event => setEditing({ ...editing, name: event.target.value })} /></Field>
          <Field label={t('mcpWorkspaces')}><fieldset className="dt-fieldset dt-mcp-workspaces" aria-label={t('mcpWorkspaces')}>
            {workspaces?.map(project => <label key={project.id} title={project.directory}><input type="checkbox"
              checked={editing.workspaceIds.includes(project.id)} onChange={event => setEditing({ ...editing,
                workspaceIds: event.target.checked ? [...editing.workspaceIds, project.id] : editing.workspaceIds.filter(id => id !== project.id) })} />
              <span>{project.title}</span></label>)}
            {!workspaces?.length && <Hint>{t('mcpNoWorkspaces')}</Hint>}
          </fieldset></Field>
          <Hint>{t('mcpGrantHint')}</Hint>
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
