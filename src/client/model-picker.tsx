/** Session-local model choices shared by task creation and the embedded conversation toolbar. */
import type { RoleModel } from '../policy.ts'
import { usePoll } from './api.ts'
import { useAction, usePanel } from './provider.tsx'
import { Select } from './select.tsx'
import { effortLabel } from './model-labels.ts'

export function ModelSelect({ value, onChange, id, disabled, label, 'aria-label': ariaLabel, defaultLabel }: {
  value?: RoleModel | null; onChange: (model: RoleModel | undefined) => void; id?: string; disabled?: boolean; label?: string; 'aria-label'?: string; defaultLabel?: string
}) {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET models'), [call], 60_000)
  const selected = value ? JSON.stringify([value.provider, value.model]) : ''
  const listed = data?.groups.some(group => group.id === value?.provider && group.models.some(model => model.id === value?.model))
  const group = data?.groups.find(group => group.id === value?.provider)
  const selectedName = value ? `${group?.name ?? value.provider} · ${group?.models.find(model => model.id === value.model)?.name ?? value.model}` : defaultLabel ?? t('taskModelDefault')
  return <Select id={id} className="dt-model-select" aria-label={label ?? ariaLabel} disabled={disabled || !data}
    value={selected} title={error ? t('modelPickerError') : selectedName} onChange={event => {
      if (!event.target.value) { onChange(undefined); return }
      const [provider, model] = JSON.parse(event.target.value) as [string, string]
      onChange({ provider, model })
    }}>
    <option value="">{error ? t('modelPickerError') : defaultLabel ?? t('taskModelDefault')}</option>
    {value && !listed && <option value={selected} data-detail={value.provider}>{value.model}</option>}
    {data?.groups.map(group => <optgroup label={group.name} key={group.id}>
      {group.models.map(model => <option key={model.id} data-detail={group.name} value={JSON.stringify([group.id, model.id])}>{model.name}</option>)}
    </optgroup>)}
  </Select>
}

/** Only expose reasoning efforts supported by the actual selected or inherited model. */
export function ReasoningSelect({ value, inherited, onChange, id, disabled, label, 'aria-label': ariaLabel }: {
  value?: RoleModel | null; inherited?: RoleModel | null; onChange: (model: RoleModel | undefined) => void; id?: string; disabled?: boolean; label?: string; 'aria-label'?: string
}) {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET models'), [call], 60_000)
  const effective = value ?? inherited ?? data?.default
  const options = data?.groups.find(group => group.id === effective?.provider)?.models.find(model => model.id === effective?.model)?.reasoning?.efforts ?? []
  const effort = value ? value.reasoningEffort ?? '' : effective?.reasoningEffort ?? ''
  return <Select id={id} className="dt-reasoning-select" aria-label={label ?? ariaLabel} value={effort}
    disabled={disabled || !data || !effective || !options.length} onChange={event => {
      if (!effective) return
      const { reasoningEffort: _old, ...model } = effective
      onChange({ ...model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) })
    }}>
    <option value="">{error ? t('modelPickerError') : options.length ? t('modelEffortDefault') : t('modelEffortUnavailable')}</option>
    {effort && !options.some(option => option.id === effort) && <option value={effort}>{effort}</option>}
    {options.map(option => <option key={option.id} value={option.id}>{effortLabel(option.id, option.name, t)}</option>)}
  </Select>
}

export function SessionModelPicker({ sessionId, running }: { sessionId: string; running: boolean }) {
  const { t, call, notify } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET local/sessions/:id/model', { id: sessionId }), [call, sessionId], 2000)
  const change = useAction(async (model: RoleModel | undefined) => {
    await call('PUT local/sessions/:id/model', { id: sessionId, body: model ?? null })
    await reload(); notify(t(running ? 'sessionModelNext' : 'sessionModelSaved'))
  })
  return <div className="dt-session-model-controls" title={error ? t('modelPickerError') : t('sessionModelNext')}>
    <div className="dt-session-model"><span>{t('modelLabel')}</span><ModelSelect label={t('sessionModelLabel')} value={data} disabled={change.busy || data === undefined}
      onChange={model => { void change.run(model) }} /></div>
    <div className="dt-session-model dt-session-effort"><span>{t('modelEffortShort')}</span><ReasoningSelect label={t('modelEffort')} value={data}
      disabled={change.busy || data === undefined} onChange={model => { void change.run(model) }} /></div>
  </div>
}
