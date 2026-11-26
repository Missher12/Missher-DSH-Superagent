/** A task's real collaboration, explicit member plans, and completion evidence. */
import { useEffect, useId, useState } from 'react'
import type { TeamMember, TeamView } from '../teams/contracts.ts'
import { Button, Icon, Input } from './controls.tsx'
import { ComposerField as Field, ComposerForm, ComposerModal, WritingArea } from './composer.tsx'
import { ModelSelect, ReasoningSelect } from './model-picker.tsx'
import { TeamGraph } from './team-graph.tsx'
import { participantWork, teamFeedback, teamParticipants, teamProductCount, type TeamParticipant } from './team-participants.ts'
import { TeamText } from './team-ui.tsx'
import { useAction, usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { SessionButton } from './widgets.tsx'
import { TeamRoom } from './team-room.tsx'
import { OpenWorkspaceButton } from './local-workspaces.tsx'
import { MemberPlacementFields } from './team-members-editor.tsx'
import { EditTeamWorkflow } from './workflow-editor.tsx'
import { TeamSourceDelivery, TeamFilesButton } from './team-delivery.tsx'

function AddTeamMember({ team, reload, select, source }: { team: TeamView; reload: () => Promise<void>; select: (id: string) => void; source: TeamParticipant }) {
  const { t, call } = usePanel(), form = useId()
  const parentId = source.id
  const hint = t(team.phase === 'draft' ? 'teamDraftAddHint' : 'teamAddMemberHint')
  const blank = (count = team.memberCount + 1): TeamMember => ({ id: `member-${crypto.randomUUID().slice(0, 12)}`, name: t('teamMemberNumber', { count }), instructions: '', dependencies: source.role === 'member' && source.responsibility !== 'manager' ? [source.id] : [], parentId, responsibility: 'implementer' })
  const [draft, setDraft] = useState(blank), [open, setOpen] = useState(false), [error, setError] = useState<string>()
  const submit = useAction(async () => {
    setError(undefined)
    try {
      const updated = await call('POST local/teams/:id/members', { id: team.id, body: draft })
      setOpen(false); await reload(); select(draft.id); setDraft(blank(updated.memberCount + 1))
    } catch (failure) { setError(errorText(failure)); throw failure }
  })
  return <><Button size="sm" variant="ghost" icon={<Icon name="plus" />} disabled={team.state === 'stopped' || !!team.workflow?.halted || team.memberCount >= 12}
    aria-label={`${t('teamAddMember')} · ${source.name}`}
    title={team.memberCount >= 12 ? t('teamMaxMembers') : hint} onClick={() => setOpen(true)} />
    <ComposerModal open={open} title={t('teamAddMember')} kind="member" busy={submit.busy} close={() => setOpen(false)}
      form={form} action={t(team.phase === 'draft' ? 'localAdd' : 'teamAddAndRun')} note={hint}>
      <ComposerForm id={form} disabled={submit.busy} failure={error} onSubmit={() => { void submit.run() }}>
        <section className="dt-composer-brief" aria-label={t('teamAddMember')}>
          <Field label={t('teamMemberName')} required><Input required className="dt-composer-name" maxLength={60} value={draft.name}
            placeholder={t('teamMemberNumber', { count: team.memberCount + 1 })} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
          <MemberPlacementFields parents={teamParticipants(team, t)}
            value={{ parentId: draft.parentId ?? parentId, responsibility: draft.responsibility ?? 'implementer' }}
            onChange={placement => setDraft({ ...draft, ...placement })} />
          <Field label={t('teamMemberWork')} required><WritingArea required maxLength={4000} value={draft.instructions}
            placeholder={t('studioMemberPlaceholder')} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></Field>
        </section>
        <section className="dt-composer-properties dt-composer-grid" aria-label={t('studioExecutionSettings')}>
          <h3>{t('studioExecutionSettings')}</h3>
          <Field label={t('localTaskModel')}><ModelSelect inherited={team.model} defaultLabel={t('teamModelInherit')} value={draft.model} onChange={model => setDraft({ ...draft, model })} /></Field>
          <Field label={t('modelEffort')}><ReasoningSelect inherited={team.model} value={draft.model} onChange={model => setDraft({ ...draft, model })} /></Field>
          <div className="dt-composer-full"><Field label={t('teamDependencies')}><fieldset className="dt-fieldset dt-team-dependencies" aria-label={t('teamDependencies')}>
            {team.members.filter(member => member.role === 'member').map(member => <label key={member.id}><input type="checkbox" checked={draft.dependencies.includes(member.id)}
              onChange={event => setDraft({ ...draft, dependencies: event.target.checked ? [...draft.dependencies, member.id] : draft.dependencies.filter(id => id !== member.id) })} />{member.name}</label>)}
          </fieldset></Field></div>
        </section>
      </ComposerForm>
    </ComposerModal></>

}

export function ResumeTeam({ team, reload }: { team: TeamView; reload: () => Promise<void> }) {
  const { t, call } = usePanel(), form = useId()
  const [open, setOpen] = useState(false), [failure, setFailure] = useState<string>()
  const storageKey = `dsh-superagent/team-resume/${team.id}`
  const [draft, setDraft] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
      if (typeof saved?.text === 'string' && typeof saved?.requestId === 'string') return { text: saved.text, requestId: saved.requestId }
    } catch { /* Optional draft storage. */ }
    return { text: '', requestId: crypto.randomUUID() }
  })
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(draft)) } catch { /* Optional draft storage. */ } }, [storageKey, draft])
  const send = useAction(async () => {
    setFailure(undefined)
    try {
      await call('POST local/teams/:id/followup', { id: team.id, body: { memberId: 'coordinator', requestId: draft.requestId, text: draft.text.trim() } })
      const next = { text: '', requestId: crypto.randomUUID() }
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* The pause banner may already have unmounted. */ }
      setOpen(false); setDraft(next); await reload()
    } catch (error) { setFailure(errorText(error)); throw error }
  })
  if (team.state === 'stopped' || !team.workflow?.halted) return null
  return <section className="dt-team-issue" role="status"><p>{team.workflow.halted.split(/[；。]/)[0]}</p>
    <Button size="sm" onClick={() => setOpen(true)}>{t('teamResume')}</Button>
    <ComposerModal open={open} title={t('teamResume')} kind="followup" busy={send.busy} close={() => setOpen(false)} form={form}
      action={t('teamResumeRound')} note={t('teamResumeHint')}>
      <ComposerForm id={form} disabled={send.busy} failure={failure} onSubmit={() => { void send.run() }}>
        <section className="dt-composer-brief"><Field label={t('teamFollowup')} required><WritingArea required maxLength={64000}
          value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></Field></section>
      </ComposerForm>
    </ComposerModal>
  </section>
}

export function TeamCollaboration({ team, selected, select, reload, delivery, activity, expanded, toggleExpanded }: {
  expanded: boolean; toggleExpanded: () => void; activity?: () => void
  team: TeamView; selected: string; select: (id: string) => void; reload: () => Promise<void>; delivery: () => void
}) {
  const { t, call, nativeSession, navigate } = usePanel()
  const retry = useAction(async () => { await call('POST local/teams/:id/retry', { id: team.id }); await reload() })
  const coordinator = team.members[0]
  const review = team.state !== 'stopped' && !!team.completion && ((team.completion.finalReview && !!team.completion.issues.length)
    || (team.completion.members && !team.completion.finalReview && coordinator?.state === 'waiting' && !coordinator.running))
  const participants = teamParticipants(team, t), active = participants.find(member => member.id === selected) ?? team.members[0]!
  const failed = participants.some(member => member.state === 'failed' && member.retry)
  const processing = participants.filter(member => member.running && !member.quotaWait).length
  const feedback = teamFeedback(team), memberName = (id: string) => participants.find(member => member.id === id)?.name ?? id
  const directory = active.directory ?? team.directory
  return <aside className="dt-team-collaboration" aria-label={t('teamCollaboration')} onKeyDown={event => {
    if (!expanded || event.key !== 'Escape' || event.defaultPrevented || (event.target as HTMLElement).closest('[role=dialog]')) return
    event.preventDefault(); toggleExpanded()
    event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus()
  }}>
    <header><div className="dt-team-collaboration-title"><div><h2>{t('teamCollaboration')}</h2><small>{t('teamConversationCount', { count: participants.filter(member => member.sessionId).length })}</small></div><Button size="sm" variant="ghost" icon={<Icon name={expanded ? 'close' : 'expand'} size={15} />} aria-expanded={expanded} aria-label={t(expanded ? 'graphCollapse' : 'graphExpand')} title={t(expanded ? 'graphCollapse' : 'graphExpand')} onClick={toggleExpanded} /><EditTeamWorkflow key={team.id} team={team} reload={reload} select={select} /></div>
    </header>
    <div className="dt-team-collaboration-body" data-view="graph">
      <TeamSourceDelivery team={team} reload={reload} />
      {!team.workflow?.halted && (team.error || review || failed) && <div className="dt-team-issue" role="alert"><p>{team.error ?? (failed ? t('teamFailedMember') : team.completion!.issues.join('\n') || t('teamReviewPending'))}</p>
        {team.state !== 'stopped' && <Button size="sm" disabled={retry.busy} onClick={() => { void retry.run() }}>{t(failed ? 'teamRetryFailed' : team.error ? 'teamRetry' : 'teamReviewContinue')}</Button>}</div>}
      <div className="dt-team-count-line"><span title={team.workflow ? t('teamRound', { round: team.workflow.round, version: team.workflow.planVersion }) : undefined}>{team.workflow ? t('teamRoundShort', { round: team.workflow.round }) : t('studioTaskFlow')}{processing > 0 && ` · ${t('teamProcessingCount', { count: processing })}`}</span><span>{t('teamDeliveredShort', { done: team.completedMembers, total: team.memberCount })}</span></div>
        {feedback && <button type="button" className="dt-team-feedback" onClick={() => select(feedback.revising ? feedback.to[0] ?? 'coordinator' : feedback.from)} title={feedback.reason}>
          <Icon name="history" size={15} /><span><strong>{feedback.revising ? t('teamRework') : t('teamReviewReturn', { from: memberName(feedback.from), to: memberName('coordinator') })}</strong>
            <small>{feedback.revising ? t('teamReviewFix', { names: feedback.to.map(memberName).join('、') }) : feedback.reason}</small></span><Icon name="chevron-right" size={13} />
        </button>}
        <div className="dt-live-canvas"><TeamGraph key={team.id} team={team} selected={selected} select={select} addMember={member => <AddTeamMember key={member.id} team={team} source={member} reload={reload} select={select} />} /></div>
        <TeamRoom key={team.id} team={team} />
        <details className="dt-team-selected-plan"><summary><span>{t('studioCurrentAssignment')}</span><span>{active.name}</span><Icon name="chevron-right" size={14} /></summary>
          <TeamText key={active.id} text={active.instructions || participantWork(active, t)} />
          <small>{[active.model?.model ?? t('teamModelInherit'), active.model?.reasoningEffort].filter(Boolean).join(' · ')}</small>{active.role === 'commander' && <p className="dt-hint">{t('teamCommanderShared')}</p>}{active.role === 'coordinator' && active.state === 'waiting' && <p className="dt-hint">{t(team.completion?.members ? 'teamReviewPending' : 'teamPlanningRound')}</p>}
          <Button size="sm" icon={<Icon name="message" size={14} />} onClick={() => select(active.id)}>{t('teamOpenSession')}</Button>
          {nativeSession && (active.ticketId || active.role === 'commander') && <div className="dt-assignment-actions">
            {activity && <Button size="sm" variant="ghost" onClick={activity}>{t('teamActivity')}</Button>}
            {active.ticketId && <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'execution', id: active.ticketId! })}>{t('workbenchViewTask')}</Button>}
            {active.sessionId && <SessionButton external sessionId={active.sessionId} label={t('teamOriginalSession')} />}
          </div>}</details>
        <details className="dt-team-goal-disclosure"><summary>{t('teamGoal')}</summary><TeamText text={team.instructions} /></details>
    </div><footer>
      {directory ? <OpenWorkspaceButton directory={directory} compact /> : <Button variant="ghost" size="sm" disabled icon={<Icon name="folder" />} aria-label={t('localOpenWorkspace')} />}
      <TeamFilesButton team={team} />
      <Button size="sm" aria-label={t('teamDelivery')} icon={<Icon name="folder" />} onClick={delivery}>{t('teamDelivery')}<span className="dt-count">{teamProductCount(team)}</span></Button></footer>
  </aside>
}
