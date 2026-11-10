/** Session-local model choices shared by task creation and the embedded conversation toolbar. */
import type { RoleModel } from '../policy.ts'
import { usePoll } from './api.ts'
import { useAction, usePanel } from './provider.tsx'

export function ModelSelect({ value, onChange, id, disabled, label, defaultLabel }: {
  value?: RoleModel | null; onChange: (model: RoleModel | undefined) => void; id?: string; disabled?: boolean; label?: string; defaultLabel?: string
}) {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET models'), [call], 60_000)
  const selected = value ? JSON.stringify([value.provider, value.model]) : ''
  const listed = data?.groups.some(group => group.id === value?.provider && group.models.some(model => model.id === value?.model))
  const group = data?.groups.find(group => group.id === value?.provider)
  const selectedName = value ? `${group?.name ?? value.provider} · ${group?.models.find(model => model.id === value.model)?.name ?? value.model}` : defaultLabel ?? t('taskModelDefault')
  return <select id={id} className="dt-select dt-model-select" aria-label={label} disabled={disabled || !data}
    value={selected} title={error ? t('modelPickerError') : selectedName} onChange={event => {
      if (!event.target.value) { onChange(undefined); return }
      const [provider, model] = JSON.parse(event.target.value) as [string, string]
      onChange({ provider, model })
    }}>
    <option value="">{error ? t('modelPickerError') : defaultLabel ?? t('taskModelDefault')}</option>
    {value && !listed && <option value={selected}>{value.provider} · {value.model}</option>}
    {data?.groups.map(group => <optgroup label={group.name} key={group.id}>
      {group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}>{group.name} · {model.name}</option>)}
    </optgroup>)}
  </select>
}

export function SessionModelPicker({ sessionId, running }: { sessionId: string; running: boolean }) {
  const { t, call, notify } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET local/sessions/:id/model', { id: sessionId }), [call, sessionId], 2000)
  const change = useAction(async (model: RoleModel | undefined) => {
    await call('PUT local/sessions/:id/model', { id: sessionId, body: model ?? null })
    await reload(); notify(t(running ? 'sessionModelNext' : 'sessionModelSaved'))
  })
  return <label className="dt-session-model" title={error ? t('modelPickerError') : t('sessionModelNext')}>
    <span>{t('modelLabel')}</span><ModelSelect label={t('sessionModelLabel')} value={data} disabled={change.busy || data === undefined}
      onChange={model => { void change.run(model) }} />
  </label>
}
