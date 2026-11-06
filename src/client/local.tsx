/** Local task drafts and follow-ups. Drafts stay in this browser session until dispatched or cleared. */
import { useEffect, useState } from 'react'
import { Button, Icon, Input } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Field, Fields } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint } from './widgets.tsx'

const DRAFT = 'dsh-superagent/local-draft'
interface TaskDraft { requestId: string; title: string; directory: string; instructions: string; open: boolean }
const blank = (): TaskDraft => ({ requestId: crypto.randomUUID(), title: '', directory: '', instructions: '', open: false })
function readDraft() {
  const fallback = blank()
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null') as Record<string, unknown> | null
    if (!value) return fallback
    return { requestId: typeof value.requestId === 'string' && value.requestId ? value.requestId : fallback.requestId,
      title: typeof value.title === 'string' ? value.title : '', directory: typeof value.directory === 'string' ? value.directory : '',
      instructions: typeof value.instructions === 'string' ? value.instructions : '', open: value.open === true }
  } catch { return fallback }
}
const rememberDraft = (draft: ReturnType<typeof blank>) => {
  try { sessionStorage.setItem(DRAFT, JSON.stringify(draft)) } catch { /* Draft storage is a convenience. */ }
}
/** Prepare a fresh request without dispatching it, for an explicitly stopped task. */
export function prepareLocalTask(directory: string, instructions: string, title: string) {
  rememberDraft({ ...blank(), directory, instructions, title, open: true })
}
/** Select a project while keeping an unfinished task's instructions and title. */
export function selectLocalWorkspace(directory: string) {
  rememberDraft({ ...readDraft(), directory, open: true })
}

export function LocalTaskComposer({ paused = false }: { paused?: boolean }) {
  const { t, call, navigate } = usePanel()
  const [draft, setDraft] = useState(readDraft)
  const [failure, setFailure] = useState<string>()
  const [workspaces, setWorkspaces] = useState<{ title: string; directory: string }[]>([])
  useEffect(() => { rememberDraft(draft) }, [draft])
  useEffect(() => {
    let active = true
    call('GET local/workspaces').then(items => { if (active) setWorkspaces(items) }, () => {})
    return () => { active = false }
  }, [call])
  const edit = (patch: Partial<typeof draft>) => { setFailure(undefined); setDraft(current => ({ ...current, ...patch })) }
  const submit = useAction(async () => {
    setFailure(undefined)
    try {
      const title = draft.title.trim() || draft.instructions.trim().split('\n')[0]!.slice(0, 80)
      const task = await call('POST local/tasks', { body: { requestId: draft.requestId, title,
        directory: draft.directory.trim(), instructions: draft.instructions.trim() } })
      const next = { ...blank(), directory: draft.directory }
      rememberDraft(next); setDraft(next)
      navigate({ page: 'execution', id: task.ticketId })
    } catch (error) { setFailure(errorText(error)); throw error }
  })
  return <div className="dt-local-composer">
    <div className="dt-actions dt-local-composer-head">
      {draft.open && <h2 className="dt-local-compose-title">{t('localNewTask')}</h2>}
      <Button variant={draft.open ? 'ghost' : 'primary'} icon={<Icon name={draft.open ? 'close' : 'plus'} />}
        disabled={submit.busy || paused} onClick={() => edit({ open: !draft.open })}>{t(draft.open ? 'cancel' : 'localNewTask')}</Button>
    </div>
    {draft.open && <form className="dt-form dt-local-form" onSubmit={event => { event.preventDefault(); void submit.run() }}>
      <Fields disabled={submit.busy || paused}>
        <div className="dt-local-request">
          <Field label={t('localInstructions')}><textarea required className="dt-textarea" rows={5}
            value={draft.instructions} maxLength={64000} placeholder={t('localInstructionsPlaceholder')}
            onChange={event => edit({ instructions: event.target.value })} /></Field>
          <div className="dt-actions dt-local-examples">{(['research', 'diagnose', 'develop'] as const).map(kind => <Button key={kind} size="sm"
            onClick={() => edit({ instructions: t(`localExample.${kind}`) })}>{t(`localExampleLabel.${kind}`)}</Button>)}</div>
        </div>
        <div className="dt-local-project">
          <Field label={t('localDirectory')} note={t('localDirectoryHint')}><Input required pattern="/.*" value={draft.directory}
            placeholder="/Users/.../project" onChange={event => edit({ directory: event.target.value })} /></Field>
          {workspaces.length > 0 && <Field label={t('localChooseWorkspace')}><select className="dt-select" value=""
            onChange={event => { if (event.target.value) edit({ directory: event.target.value }) }}>
            <option value="">{t('localChooseWorkspacePlaceholder')}</option>
            {workspaces.map(workspace => <option key={workspace.directory} value={workspace.directory}>{workspace.title} — {workspace.directory}</option>)}
          </select></Field>}
        </div>
        <Field label={t('localTaskTitle')}><Input maxLength={160} value={draft.title}
          placeholder={t('localTitlePlaceholder')} onChange={event => edit({ title: event.target.value })} /></Field>
        <div className="dt-local-form-footer">
          <Hint>{t('localDispatchHint')}</Hint>
          {failure && <p className="dt-error" role="alert">{failure}</p>}
          <div className="dt-actions">
            <Button variant="ghost" onClick={() => { setFailure(undefined); setDraft({ ...blank(), directory: draft.directory, open: true }) }}>{t('localClearDraft')}</Button>
            <Button type="submit" variant="primary" disabled={!draft.instructions.trim() || !draft.directory.trim()}>{t(submit.busy ? 'localSubmitting' : 'localDispatch')}</Button>
          </div>
        </div>
      </Fields>
    </form>}
  </div>
}

export function LocalFollowup({ id, completed = false, onSent }: { id: string; completed?: boolean; onSent: () => Promise<void> }) {
  const { t, call, notify } = usePanel()
  const [text, setText] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [failure, setFailure] = useState<string>()
  const send = useAction(async () => {
    setFailure(undefined)
    try {
      await call('POST local/tasks/:id/followup', { id, body: { requestId, text: text.trim() } })
      setText(''); setRequestId(crypto.randomUUID()); await onSent(); notify(t('localFollowupSent'))
    } catch (error) { setFailure(errorText(error)); throw error }
  })
  return <form className="dt-form dt-local-form" onSubmit={event => { event.preventDefault(); void send.run() }}>
    <Fields disabled={send.busy}>
      <Field label={t(completed ? 'localContinue' : 'localFollowup')}>
        <textarea required className="dt-textarea" rows={2} maxLength={64000} value={text}
          placeholder={t(completed ? 'localContinuePlaceholder' : 'localFollowupPlaceholder')}
          onChange={event => { setFailure(undefined); setText(event.target.value) }} /></Field>
      {failure && <p className="dt-error" role="alert">{failure}</p>}
      <div className="dt-actions"><Button type="submit" variant="primary" disabled={!text.trim()}>{t(send.busy ? 'localSubmitting'
        : completed ? 'localContinueAction' : 'localSendFollowup')}</Button></div>
    </Fields>
  </form>
}
