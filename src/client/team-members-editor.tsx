/** Editable, explicit member plans; no sessions exist until the task is dispatched. */
import { useState } from 'react'
import type { TeamMember } from '../teams/contracts.ts'
import { Button, Icon, Input } from './controls.tsx'
import { ModelSelect, ReasoningSelect } from './model-picker.tsx'
import { usePanel } from './provider.tsx'
import { ComposerField as Field } from './composer.tsx'
import type { T } from './text.ts'
import type { RoleModel } from '../policy.ts'

export function defaultMembers(t: T): TeamMember[] {
  return [{ id: 'build', name: t('teamDefaultBuild'), instructions: t('teamDefaultBuildWork'), dependencies: [] },
    { id: 'check', name: t('teamDefaultCheck'), instructions: t('teamDefaultCheckWork'), dependencies: ['build'] }]
}
export function TeamMembersEditor({ members, onChange, disabled, model }: { members: TeamMember[]; onChange: (members: TeamMember[]) => void; disabled: boolean; model?: RoleModel }) {
  const { t } = usePanel()
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(members.map((member, index) =>
    [member.id, index === 0 || !member.instructions.trim()])))
  const edit = (id: string, patch: Partial<TeamMember>) => onChange(members.map(member => member.id === id ? { ...member, ...patch } : member))
  return <div className="dt-team-members-editor">{members.map((member, index) => <details className="dt-team-plan-member" key={member.id} open={expanded[member.id] ?? false}
    onToggle={event => { const open = event.currentTarget.open; setExpanded(current => current[member.id] === open ? current : { ...current, [member.id]: open }) }}>
    <summary><Icon name="chevron-right" size={14} /><strong title={member.name}>{member.name || t('teamMemberNumber', { count: index + 1 })}</strong><span title={member.instructions}>{member.instructions}</span></summary>
    <div className="dt-team-plan-fields">
      <Field required label={t('teamMemberName')}><Input required maxLength={60} value={member.name} onChange={event => edit(member.id, { name: event.target.value })} /></Field>
      <Field required label={t('teamMemberWork')}><textarea required className="dt-textarea dt-team-role-input" rows={2} maxLength={4000} value={member.instructions}
        onChange={event => edit(member.id, { instructions: event.target.value })} /></Field>
      <Field label={t('teamDependencies')}><fieldset className="dt-fieldset dt-team-dependencies" aria-label={`${member.name} · ${t('teamDependencies')}`}>
        {members.slice(0, index).map(previous => <label key={previous.id}><input type="checkbox" checked={member.dependencies.includes(previous.id)} onChange={event => edit(member.id,
          { dependencies: event.target.checked ? [...member.dependencies, previous.id] : member.dependencies.filter(id => id !== previous.id) })} /><span>{previous.name}</span></label>)}
        {!index && <span className="dt-hint">{t('teamNoDependencies')}</span>}
      </fieldset></Field>
      <div className="dt-composer-grid"><Field label={t('localTaskModel')}><ModelSelect defaultLabel={t('teamModelInherit')} value={member.model} onChange={model => edit(member.id, { model })} /></Field>
      <Field label={t('modelEffort')}><ReasoningSelect value={member.model} inherited={model} onChange={model => edit(member.id, { model })} /></Field></div>
      <div className="dt-danger-zone"><Button size="sm" icon={<Icon name="trash" />} disabled={disabled || members.length <= 2} title={members.length <= 2 ? t('teamMinMembers') : undefined}
        onClick={() => onChange(members.filter(value => value.id !== member.id).map(value => ({ ...value, dependencies: value.dependencies.filter(id => id !== member.id) })))}>{t('teamRemoveMember')}</Button></div>
    </div>
  </details>)}<div className="dt-actions"><Button size="sm" icon={<Icon name="plus" />} disabled={disabled || members.length >= 6} onClick={() => {
    const id = `member-${crypto.randomUUID().slice(0, 12)}`
    setExpanded(current => ({ ...current, [id]: true }))
    onChange([...members, { id, name: t('teamMemberNumber', { count: members.length + 1 }), instructions: '', dependencies: [members.at(-1)!.id] }])
  }}>{t('teamAddMember')}</Button></div></div>
}
