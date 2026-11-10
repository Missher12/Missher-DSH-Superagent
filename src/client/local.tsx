/** Local task drafts and follow-ups. Drafts stay in this browser session until dispatched or cleared. */
import { useEffect, useId, useState } from 'react'
import { Button, Icon, Input, Modal } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Field, Fields } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint } from './widgets.tsx'
import { ModelSelect, ReasoningSelect } from './model-picker.tsx'
import type { RoleModel } from '../policy.ts'
import type { TeamMember } from '../teams/contracts.ts'
import { defaultMembers, TeamMembersEditor } from './team-members-editor.tsx'

const DRAFT = 'dsh-superagent/local-draft'
interface TaskDraft { requestId: string; title: string; directory: string; instructions: string; open: boolean; existing: boolean; model?: RoleModel; mode: 'single' | 'team'; teamName: string; members?: TeamMember[] }
const blank = (): TaskDraft => ({ requestId: crypto.randomUUID(), title: '', directory: '', instructions: '', open: false, existing: false, mode: 'single', teamName: '' })
function readDraft() {
  const fallback = blank()
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null') as Record<string, unknown> | null
    if (!value) return fallback
    return { requestId: typeof value.requestId === 'string' && value.requestId ? value.requestId : fallback.requestId,
      title: typeof value.title === 'string' ? value.title : '', directory: typeof value.directory === 'string' ? value.directory : '',
      instructions: typeof value.instructions === 'string' ? value.instructions : '', open: value.open === true,
      existing: typeof value.existing === 'boolean' ? value.existing : !!value.directory,
      mode: value.mode === 'team' ? 'team' as const : 'single' as const, teamName: typeof value.teamName === 'string' ? value.teamName : '',
      members: Array.isArray(value.members) && value.members.length >= 2 && value.members.length <= 6 && value.members.every(member => member
        && typeof member.id === 'string' && typeof member.name === 'string' && typeof member.instructions === 'string'
        && Array.isArray(member.dependencies) && member.dependencies.every((id: unknown) => typeof id === 'string')) ? value.members as TeamMember[] : undefined,
      model: value.model && typeof value.model === 'object' && 'provider' in value.model && 'model' in value.model
        && typeof value.model.provider === 'string' && typeof value.model.model === 'string'
        ? { provider: value.model.provider, model: value.model.model,
          ...(typeof (value.model as Record<string, unknown>).reasoningEffort === 'string' && (value.model as Record<string, unknown>).reasoningEffort
            ? { reasoningEffort: (value.model as Record<string, unknown>).reasoningEffort as string } : {}) } : undefined }
  } catch { return fallback }
}
const rememberDraft = (draft: ReturnType<typeof blank>) => {
  try { sessionStorage.setItem(DRAFT, JSON.stringify(draft)) } catch { /* Draft storage is a convenience. */ }
}
/** Prepare a fresh request without dispatching it, for an explicitly stopped task. */
export function prepareLocalTask(directory: string, instructions: string, title: string) {
  rememberDraft({ ...blank(), directory, instructions, title, open: true, existing: true })
}
/** Select a project while keeping an unfinished task's instructions and title. */
export function selectLocalWorkspace(directory: string) {
  rememberDraft({ ...readDraft(), directory, open: true, existing: true })
}

export function LocalTaskComposer({ paused = false, team = false }: { paused?: boolean; team?: boolean }) {
  const { t, call, navigate, renderSession } = usePanel()
  const formId = useId()
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
      const body = { requestId: draft.requestId, title, ...(draft.existing ? { directory: draft.directory.trim() } : {}),
        ...(draft.model ? { model: draft.model } : {}), instructions: draft.instructions.trim() }
      const task = draft.mode === 'team' ? await call('POST local/teams', { body: { ...body, coordinatorName: t('teamCoordinator'),
        ...(draft.teamName.trim() ? { name: draft.teamName.trim() } : {}), members: draft.members ?? defaultMembers(t) } })
        : await call('POST local/tasks', { body })
      const next = { ...blank(), directory: draft.directory, existing: draft.existing }
      rememberDraft(next); setDraft(next)
      navigate('members' in task ? { page: 'overview', query: { team: task.id, member: 'coordinator' } }
        : renderSession ? { page: 'overview', query: { session: task.sessionId } } : { page: 'execution', id: task.ticketId })
    } catch (error) { setFailure(errorText(error)); throw error }
  })
  return <div className="dt-local-composer">
    <div className="dt-actions dt-local-composer-head">
      <Button variant="primary" icon={<Icon name="plus" />}
        disabled={submit.busy || paused} onClick={() => edit({ open: true, ...!draft.instructions.trim() && team ? { mode: 'team' } : {} })}>{t('localNewTask')}</Button>
    </div>
    <Modal className="dt-local-task-modal" open={draft.open} title={t('localNewTask')} closeLabel={t('close')}
      onClose={() => { if (!submit.busy) edit({ open: false }) }} footer={<div className="dt-local-form-footer">
        <Hint>{t(draft.mode === 'team' ? 'teamCreateHint' : 'localDispatchHint')}</Hint>
        {failure && <p className="dt-error" role="alert">{failure}</p>}
        <div className="dt-actions">
          <Button variant="ghost" disabled={submit.busy} onClick={() => edit({ open: false })}>{t('cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" disabled={submit.busy || paused}>{t(submit.busy ? 'localSubmitting' : 'localDispatch')}</Button>
        </div>
      </div>}>
    <form id={formId} className="dt-form dt-local-form" onSubmit={event => { event.preventDefault(); void submit.run() }} onInvalidCapture={event => {
      const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true
      setFailure(t('teamFormIncomplete'))
    }}>
      <Fields disabled={submit.busy || paused}>
        <Field label={t('teamMode')}><select className="dt-select" value={draft.mode} onChange={event => edit({ mode: event.target.value as TaskDraft['mode'] })}>
          <option value="single">{t('teamModeSingle')}</option><option value="team">{t('teamModeTeam')}</option>
        </select></Field>
        <div className="dt-local-request">
          <Field label={t('localInstructions')}><textarea required className="dt-textarea" rows={5}
            value={draft.instructions} maxLength={draft.mode === 'team' ? 24000 : 64000} placeholder={t('localInstructionsPlaceholder')}
            onChange={event => edit({ instructions: event.target.value })} /></Field>
          <div className="dt-actions dt-local-examples">{(['research', 'diagnose', 'develop'] as const).map(kind => <Button key={kind} size="sm"
            onClick={() => edit({ instructions: t(`localExample.${kind}`) })}>{t(`localExampleLabel.${kind}`)}</Button>)}</div>
        </div>
        <Field label={t('localWorkspaceMode')} note={draft.existing ? undefined : t('localIndependentHint')}>
          <select className="dt-select" value={draft.existing ? 'existing' : 'independent'} onChange={event => edit({ existing: event.target.value === 'existing' })}>
            <option value="independent">{t('localIndependent')}</option><option value="existing">{t('localExistingProject')}</option>
          </select></Field>
        {draft.existing && <>
        <div className="dt-local-project">
          <Field label={t('localDirectory')} note={t('localDirectoryHint')}><Input required value={draft.directory}
            placeholder="/Users/.../project" onChange={event => edit({ directory: event.target.value })} /></Field>
          {workspaces.length > 0 && <Field label={t('localChooseWorkspace')}><select className="dt-select" value=""
            onChange={event => { if (event.target.value) edit({ directory: event.target.value }) }}>
            <option value="">{t('localChooseWorkspacePlaceholder')}</option>
            {workspaces.map(workspace => <option key={workspace.directory} value={workspace.directory}>{workspace.title} — {workspace.directory}</option>)}
          </select></Field>}
        </div>
        </>}
        <Field label={t('localTaskTitle')}><Input maxLength={160} value={draft.title}
          placeholder={t('localTitlePlaceholder')} onChange={event => edit({ title: event.target.value })} /></Field>
        <Field label={t('localTaskModel')}><ModelSelect value={draft.model} onChange={model => edit({ model })} /></Field>
        <Field label={t('modelEffort')}><ReasoningSelect value={draft.model} onChange={model => edit({ model })} /></Field>
        {draft.mode === 'team' && <><Field label={t('teamName')}><Input maxLength={80} value={draft.teamName} placeholder={t('teamNamePlaceholder')}
          onChange={event => edit({ teamName: event.target.value })} /></Field>
          <section className="dt-team-plan"><h3>{t('teamMembers')}</h3><TeamMembersEditor model={draft.model} members={draft.members ?? defaultMembers(t)}
            onChange={members => edit({ members })} disabled={submit.busy || paused} /></section></>}
      </Fields>
      <div className="dt-danger-zone"><Button variant="ghost" disabled={submit.busy || paused} onClick={() => {
        setFailure(undefined); setDraft({ ...blank(), directory: draft.directory, existing: draft.existing, open: true, mode: draft.mode })
      }}>{t('localClearDraft')}</Button></div>
    </form></Modal>
  </div>
}

export function LocalFollowup({ id, completed = false, onSent, teamId, memberId }: { id: string; completed?: boolean; onSent: () => Promise<void>; teamId?: string; memberId?: string }) {
  const { t, call, notify } = usePanel()
  const [draft, setDraft] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`dsh-superagent/followup/${id}`) ?? 'null') as { text?: string; requestId?: string } | null
      return { text: typeof saved?.text === 'string' ? saved.text : '', requestId: saved?.requestId || crypto.randomUUID() }
    } catch { return { text: '', requestId: crypto.randomUUID() } }
  })
  const { text, requestId } = draft
  useEffect(() => { try { sessionStorage.setItem(`dsh-superagent/followup/${id}`, JSON.stringify(draft)) } catch { /* Optional draft storage. */ } }, [id, draft])
  const [failure, setFailure] = useState<string>()
  const send = useAction(async () => {
    setFailure(undefined)
    try {
      if (teamId && memberId) await call('POST local/teams/:id/followup', { id: teamId, body: { memberId, requestId, text: text.trim() } })
      else await call('POST local/tasks/:id/followup', { id, body: { requestId, text: text.trim() } })
      setDraft({ text: '', requestId: crypto.randomUUID() }); await onSent(); notify(t('localFollowupSent'))
    } catch (error) { setFailure(errorText(error)); throw error }
  })
  return <form className="dt-form dt-local-form" onSubmit={event => { event.preventDefault(); void send.run() }}>
    <Fields disabled={send.busy}>
      <Field label={t(completed ? 'localContinue' : 'localFollowup')}>
        <textarea required className="dt-textarea" rows={2} maxLength={64000} value={text}
          placeholder={t(completed ? 'localContinuePlaceholder' : 'localFollowupPlaceholder')}
          onChange={event => { setFailure(undefined); setDraft(current => ({ ...current, text: event.target.value })) }} /></Field>
      {failure && <p className="dt-error" role="alert">{failure}</p>}
      <div className="dt-actions"><Button type="submit" variant="primary" disabled={!text.trim()}>{t(send.busy ? 'localSubmitting'
        : completed ? 'localContinueAction' : 'localSendFollowup')}</Button></div>
    </Fields>
  </form>
}
