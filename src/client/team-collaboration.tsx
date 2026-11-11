/** A task's real collaboration, explicit member plans, and completion evidence. */
import { useId, useState } from 'react'
import type { TeamMember, TeamView } from '../teams/contracts.ts'
import { Button, Icon, Input, SegmentedTabs } from './controls.tsx'
import { ComposerField as Field, ComposerForm, ComposerModal, WritingArea } from './composer.tsx'
import { ModelSelect, ReasoningSelect } from './model-picker.tsx'
import { TeamGraph } from './team-graph.tsx'
import { TeamStatus, TeamText } from './team-ui.tsx'
import { useAction, usePanel } from './provider.tsx'
import { errorText, shortText } from './text.ts'
import { When } from './widgets.tsx'

function AddTeamMember({ team, reload, select }: { team: TeamView; reload: () => Promise<void>; select: (id: string) => void }) {
  const { t, call } = usePanel(), form = useId()
  const blank = (): TeamMember => ({ id: `member-${crypto.randomUUID().slice(0, 12)}`, name: '', instructions: '', dependencies: [] })
  const [draft, setDraft] = useState(blank), [open, setOpen] = useState(false), [error, setError] = useState<string>()
  const submit = useAction(async () => {
    setError(undefined)
    try {
      await call('POST local/teams/:id/members', { id: team.id, body: draft })
      setOpen(false); await reload(); select(draft.id); setDraft(blank())
    } catch (failure) { setError(errorText(failure)); throw failure }
  })
  return <><Button size="sm" variant="outline" icon={<Icon name="plus" />} disabled={team.state === 'stopped' || team.memberCount >= 6}
    title={team.memberCount >= 6 ? t('teamMaxMembers') : undefined} onClick={() => setOpen(true)}>{t('teamAddMember')}</Button>
    <ComposerModal open={open} title={t('teamAddMember')} kind="member" busy={submit.busy} close={() => setOpen(false)}
      form={form} action={t('teamAddMember')} note={t('studioTeamDispatch')}>
      <ComposerForm id={form} disabled={submit.busy} failure={error} onSubmit={() => { void submit.run() }}>
        <section className="dt-composer-brief" aria-label={t('teamAddMember')}>
          <Field label={t('teamMemberName')} required><Input required className="dt-composer-name" maxLength={60} value={draft.name}
            placeholder={t('teamMemberNumber', { count: team.members.length + 1 })} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
          <Field label={t('teamMemberWork')} required><WritingArea required maxLength={4000} value={draft.instructions}
            placeholder={t('studioMemberPlaceholder')} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></Field>
        </section>
        <section className="dt-composer-properties dt-composer-grid" aria-label={t('studioExecutionSettings')}>
          <Field label={t('localTaskModel')}><ModelSelect defaultLabel={t('teamModelInherit')} value={draft.model} onChange={model => setDraft({ ...draft, model })} /></Field>
          <Field label={t('modelEffort')}><ReasoningSelect inherited={team.model} value={draft.model} onChange={model => setDraft({ ...draft, model })} /></Field>
          <div className="dt-composer-full"><Field label={t('teamDependencies')}><fieldset className="dt-fieldset dt-team-dependencies" aria-label={t('teamDependencies')}>
            {team.members.filter(member => member.role === 'member').map(member => <label key={member.id}><input type="checkbox" checked={draft.dependencies.includes(member.id)}
              onChange={event => setDraft({ ...draft, dependencies: event.target.checked ? [...draft.dependencies, member.id] : draft.dependencies.filter(id => id !== member.id) })} />{member.name}</label>)}
          </fieldset></Field></div>
        </section>
      </ComposerForm>
    </ComposerModal></>

}

export function TeamCompletion({ team }: { team: TeamView }) {
  const { t } = usePanel(), facts = team.completion
  return <section className="dt-team-completion"><h3>{t('teamCompletionTitle')}</h3><ol>
    {([['teamCompletionMembers', facts?.members], ['teamCompletionReview', facts?.finalReview], ['teamCompletionEvidence', facts?.evidence]] as const)
      .map(([label, done]) => <li key={label} data-done={done || undefined}><Icon name={done ? 'decision' : 'clock'} /><span>{t(label)}</span></li>)}
  </ol>{!facts && <p className="dt-hint">{t('teamCompletionLegacy')}</p>}
    {facts?.issues.map(issue => <p className="dt-error" key={issue}>{issue}</p>)}
    {facts && <div className="dt-team-check-totals"><span>{t('teamCompletionPassed', { count: facts.checks.passed })}</span>
      <span>{t('teamCompletionFailed', { count: facts.checks.failed })}</span><span>{t('teamCompletionNotRun', { count: facts.checks.notRun })}</span></div>}
    {!!facts?.unverified.length && <section><h3>{t('teamUnverified')}</h3><ul>{facts.unverified.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    <p className="dt-hint">{t('teamCompletionHint')}</p>
  </section>
}

export function TeamCollaboration({ team, selected, select, reload, delivery }: {
  team: TeamView; selected: string; select: (id: string) => void; reload: () => Promise<void>; delivery: () => void
}) {
  const { t, call } = usePanel(), [tab, setTab] = useState<'graph' | 'members' | 'completion'>('graph')
  const retry = useAction(async () => { await call('POST local/teams/:id/retry', { id: team.id }); await reload() })
  const active = team.members.find(member => member.id === selected) ?? team.members[0]!
  const recent = team.members.flatMap(member => member.events.filter(event => event.summary?.trim()).map(event => ({ ...event, member: member.name })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3)
  return <aside className="dt-team-collaboration" aria-label={t('teamCollaboration')}>
    <header><div className="dt-team-collaboration-title"><div><h2>{t('teamCollaboration')}</h2><small>{t('studioMemberCount', { count: team.members.length })}</small></div><AddTeamMember key={team.id} team={team} reload={reload} select={select} /></div>
      <SegmentedTabs value={tab} onChange={setTab} label={t('teamCollaboration')} items={[
        { value: 'graph', label: t('teamRelations'), id: 'dt-team-relations', panelId: 'dt-team-collaboration-content' },
        { value: 'members', label: t('teamMembers'), id: 'dt-team-assignments', panelId: 'dt-team-collaboration-content' },
        { value: 'completion', label: t('teamCompletionTitle'), id: 'dt-team-completion', panelId: 'dt-team-collaboration-content' },
      ]} /></header>
    <div id="dt-team-collaboration-content" className="dt-team-collaboration-body" role="tabpanel"
      aria-labelledby={tab === 'graph' ? 'dt-team-relations' : tab === 'members' ? 'dt-team-assignments' : 'dt-team-completion'}>
      {team.error && <div className="dt-team-issue" role="alert"><p>{team.error}</p><Button size="sm" disabled={retry.busy} onClick={() => { void retry.run() }}>{t('teamRetry')}</Button></div>}
      {tab === 'graph' ? <><div className="dt-team-count-line"><span>{t('studioTaskFlow')}</span><span>{t('teamCompletedCount', { done: team.completedMembers, total: team.memberCount })}</span></div>
        <TeamGraph team={team} selected={selected} select={select} /><section className="dt-team-selected-plan"><div><h3>{t('studioCurrentAssignment')}</h3><span>{active.name}</span></div>
          <p className="dt-team-assignment-summary">{active.role === 'coordinator' ? t('teamCoordinatorWork') : shortText(active.instructions, 80)}</p>{active.role === 'coordinator' && active.state === 'waiting' && <p className="dt-hint">{t('teamPlanningRound')}</p>}
          <Button size="sm" icon={<Icon name="message" size={14} />} onClick={() => select(active.id)}>{t('teamOpenSession')}</Button></section>
        {!!recent.length && <section className="dt-studio-recent"><h3>{t('studioRecentCollaboration')}</h3>{recent.map(event => <div key={`${event.member}:${event.id}`}>
          <Icon name={event.state === 'started' ? 'running' : 'message'} size={13} /><span title={event.summary}>{event.member} · {shortText(event.summary, 55)}</span><When at={event.at} /></div>)}</section>}
        <details className="dt-team-goal-disclosure"><summary>{t('teamGoal')}</summary><TeamText text={team.instructions} /></details></>
        : tab === 'members' ? <ul className="dt-team-assignment-list">{team.members.map(member => <li key={member.id} data-selected={member.id === selected || undefined}>
          <button type="button" className="dt-team-assignment-open" onClick={() => select(member.id)}><span className="dt-team-avatar"><Icon name={member.role === 'coordinator' ? 'queue' : 'user'} /></span>
            <span><strong>{member.name}</strong><TeamStatus state={member.state} member /></span><Icon name="chevron-right" size={14} /></button>
          <TeamText text={member.instructions} /><div className="dt-team-assignment-meta"><span>{member.model?.model ?? t('teamModelInherit')}{member.model?.reasoningEffort ? ` · ${member.model.reasoningEffort}` : ''}</span>
            <Button size="sm" onClick={() => select(member.id)}>{t('teamOpenSession')}</Button></div>
        </li>)}</ul> : <TeamCompletion team={team} />}
    </div><footer><Button size="sm" icon={<Icon name="review" />} onClick={delivery}>{t('teamDelivery')}</Button></footer>
  </aside>
}
