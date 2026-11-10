/** Editable, explicit member plans; no sessions exist until the task is dispatched. */
import type { TeamMember } from '../teams/contracts.ts'
import { Button, Icon, Input } from './controls.tsx'
import { ModelSelect } from './model-picker.tsx'
import { usePanel } from './provider.tsx'
import { Field } from './settings-kit.tsx'
import type { T } from './text.ts'

export function defaultMembers(t: T): TeamMember[] {
  return [{ id: 'build', name: t('teamDefaultBuild'), instructions: t('teamDefaultBuildWork'), dependencies: [] },
    { id: 'check', name: t('teamDefaultCheck'), instructions: t('teamDefaultCheckWork'), dependencies: ['build'] }]
}
export function TeamMembersEditor({ members, onChange, disabled }: { members: TeamMember[]; onChange: (members: TeamMember[]) => void; disabled: boolean }) {
  const { t } = usePanel()
  const edit = (id: string, patch: Partial<TeamMember>) => onChange(members.map(member => member.id === id ? { ...member, ...patch } : member))
  return <div className="dt-team-members-editor">{members.map((member, index) => <details className="dt-team-plan-member" key={member.id} open={index === 0 || undefined}>
    <summary><strong>{member.name || t('teamMemberNumber', { count: index + 1 })}</strong><span>{member.instructions}</span></summary>
    <div className="dt-team-plan-fields">
      <Field label={t('teamMemberName')}><Input required maxLength={60} value={member.name} onChange={event => edit(member.id, { name: event.target.value })} /></Field>
      <Field label={t('teamMemberWork')}><textarea required className="dt-textarea dt-team-role-input" rows={2} maxLength={4000} value={member.instructions}
        onChange={event => edit(member.id, { instructions: event.target.value })} /></Field>
      <Field label={t('teamDependencies')}><fieldset className="dt-fieldset dt-team-dependencies" aria-label={`${member.name} · ${t('teamDependencies')}`}>
        {members.slice(0, index).map(previous => <label key={previous.id}><input type="checkbox" checked={member.dependencies.includes(previous.id)} onChange={event => edit(member.id,
          { dependencies: event.target.checked ? [...member.dependencies, previous.id] : member.dependencies.filter(id => id !== previous.id) })} /><span>{previous.name}</span></label>)}
        {!index && <span className="dt-hint">{t('teamNoDependencies')}</span>}
      </fieldset></Field>
      <Field label={t('localTaskModel')}><ModelSelect defaultLabel={t('teamModelInherit')} value={member.model} onChange={model => edit(member.id, { model })} /></Field>
      <div className="dt-danger-zone"><Button size="sm" icon={<Icon name="trash" />} disabled={disabled || members.length <= 2} title={members.length <= 2 ? t('teamMinMembers') : undefined}
        onClick={() => onChange(members.filter(value => value.id !== member.id).map(value => ({ ...value, dependencies: value.dependencies.filter(id => id !== member.id) })))}>{t('teamRemoveMember')}</Button></div>
    </div>
  </details>)}<div className="dt-actions"><Button size="sm" icon={<Icon name="plus" />} disabled={disabled || members.length >= 6} onClick={() => onChange([...members,
    { id: `member-${crypto.randomUUID().slice(0, 12)}`, name: t('teamMemberNumber', { count: members.length + 1 }), instructions: '', dependencies: [members.at(-1)!.id] }])}>{t('teamAddMember')}</Button></div></div>
}
