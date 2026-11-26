/** Compact interface acceptance settings and real per-reviewer execution status. */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { InterfaceCheck, TeamView } from '../teams/contracts.ts'
import { Button, Icon, Input } from './controls.tsx'
import { ComposerField, ComposerForm, ComposerModal, WritingArea } from './composer.tsx'
import { useAction, usePanel } from './provider.tsx'
import { errorText } from './text.ts'

export function InterfaceCheckFields({ checks, change }: { checks: InterfaceCheck[]; change: (checks: InterfaceCheck[]) => void }) {
  const { t } = usePanel()
  const list = useRef<HTMLElement>(null), focusNew = useRef(false)
  useLayoutEffect(() => {
    if (focusNew.current) {
      list.current?.querySelector<HTMLInputElement>('.dt-interface-field:last-child input')?.focus()
      focusNew.current = false
    }
  }, [checks.length])
  return <section ref={list} className="dt-interface-fields"><div className="dt-interface-heading"><h3>{t('teamInterfaceChecks')}</h3>
    <Button size="sm" disabled={checks.length >= 8} icon={<Icon name="plus" />} onClick={() => { focusNew.current = true; change([...checks, { id: `check-${crypto.randomUUID().slice(0, 10)}`, name: '', command: '' }]) }}>{t('teamAddCheck')}</Button></div>
    {checks.length ? checks.map((check, index) => <div className="dt-interface-field" key={check.id}>
      <ComposerField label={t('teamCheckName')} required><Input required maxLength={80} value={check.name} onChange={event => change(checks.map(item => item.id === check.id ? { ...item, name: event.target.value } : item))} /></ComposerField>
      <ComposerField label={t('teamCheckCommand')} required><WritingArea required maxLength={6000} value={check.command} placeholder="node --test integration.test.mjs"
        onChange={event => change(checks.map(item => item.id === check.id ? { ...item, command: event.target.value } : item))} /></ComposerField>
      <div className="dt-interface-remove"><Button size="sm" variant="ghost" aria-label={t('teamRemoveCheck', { count: index + 1 })} onClick={() => change(checks.filter(item => item.id !== check.id))}>{t('teamRemoveItem')}</Button></div>
    </div>) : <p className="dt-hint">{t('teamInterfaceAutomatic')}</p>}
  </section>
}
export function TeamAcceptance({ team, reload }: { team: TeamView; reload: () => Promise<void> }) {
  const { t, call } = usePanel(), form = useId()
  const [open, setOpen] = useState(false), [checks, setChecks] = useState<InterfaceCheck[]>([]), [failure, setFailure] = useState<string>(), [revision, setRevision] = useState(0)
  const editable = ['draft', 'briefing', 'planning'].includes(team.phase ?? '') && team.state !== 'stopped'
  const save = useAction(async () => {
    setFailure(undefined)
    try { await call('PUT local/teams/:id/acceptance', { id: team.id, body: { revision, interfaceChecks: checks } }); setOpen(false); await reload() }
    catch (error) { setFailure(errorText(error)); throw error }
  })
  const name = (id: string) => team.members.find(member => member.id === id)?.name ?? id
  return <section className="dt-team-interface"><div className="dt-interface-heading"><h3>{t('teamInterfaceChecks')}</h3>{editable && <Button size="sm" onClick={() => {
    setChecks((team.interfaceChecks ?? []).map(({ id, name, command }) => ({ id, name, command }))); setFailure(undefined); setRevision(team.controlRevision ?? 0); setOpen(true)
  }}>{t('teamEditChecks')}</Button>}</div>
    {team.interfaceChecks?.length ? <ul>{team.interfaceChecks.map(check => <li key={check.id}>
      <div><Icon size={15} name={check.failed?.length ? 'alert' : check.passed.length === check.reviewers.length ? 'decision' : 'clock'} /><strong>{check.name}</strong><span>{check.passed.length}/{check.reviewers.length}</span></div>
      <details><summary>{t('teamCheckDetails')}</summary><code>{check.command}</code><ul>{check.reviewers.map(id => <li key={id}><span>{name(id)}</span><span>{t(check.failed?.includes(id) ? 'teamInterfaceFailed' : check.passed.includes(id) ? 'teamInterfacePassed' : 'teamCheckPending')}</span></li>)}</ul></details>
    </li>)}</ul> : <p className="dt-hint">{t('teamInterfaceAutomatic')}</p>}
    <ComposerModal open={open} title={t('teamInterfaceChecks')} kind="followup" form={form} busy={save.busy} action={t('save')} close={() => setOpen(false)}>
      <ComposerForm id={form} disabled={save.busy} failure={failure} onSubmit={() => { void save.run() }}><InterfaceCheckFields checks={checks} change={setChecks} /></ComposerForm>
    </ComposerModal>
  </section>
}

export function TeamCompletion({ team }: { team: TeamView }) {
  const { t } = usePanel(), facts = team.completion
  return <section className="dt-team-completion"><h3>{t('teamCompletionTitle')}</h3><ol>
    {([['teamCompletionMembers', facts?.members], ['teamCompletionReview', facts?.finalReview], ['teamCompletionEvidence', facts?.evidence],
      ...(facts?.commander !== undefined ? [['teamCompletionCommander', facts.commander] as const] : [])] as const)
      .map(([label, done]) => <li key={label} data-done={done || undefined}><Icon name={done ? 'decision' : 'clock'} /><span>{t(label)}</span></li>)}
  </ol>{!facts && <p className="dt-hint">{t('teamCompletionLegacy')}</p>}
    {facts?.issues.map(issue => <p className="dt-error" key={issue}>{issue}</p>)}
    {facts && <div className="dt-team-check-totals"><span>{t('teamCompletionPassed', { count: facts.checks.passed })}</span>
      <span>{t('teamCompletionFailed', { count: facts.checks.failed })}</span><span>{t('teamCompletionNotRun', { count: facts.checks.notRun })}</span></div>}
    {!!facts?.unverified.length && <section><h3>{t('teamUnverified')}</h3><ul>{facts.unverified.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
  </section>
}
