/** Local defaults: model, worker capacity, and plain descriptions of permissions and adapters. */
import { useEffect, useState } from 'react'
import { LIMITS } from '../limits.ts'
import { type ApiResponse } from '../app/api.ts'
import { Input } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { PromptsPage } from './prompts.tsx'
import { Field, Fields, SettingsProvider, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint, Section } from './widgets.tsx'
import { McpSettings } from './local-mcp.tsx'
import { SourceSettings } from './source.tsx'
import { EvalSettings } from './eval.tsx'

function SettingsForm() {
  const { t, call } = usePanel()
  const { settings: { blocks } } = useSettings()
  const executor = blocks.executor.value
  const draft = useBlockDraft('executor', { ...executor, maxWorkers: String(executor.maxWorkers) }, blocks.executor.revision,
    value => ({ ...value, maxWorkers: numberOf(value.maxWorkers) }))
  const [catalog, setCatalog] = useState<ApiResponse<'GET models'>>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    call('GET models').then(value => { if (active) setCatalog(value) }, failure => { if (active) setError(errorText(failure)) })
    return () => { active = false }
  }, [call])
  const selection = draft.value.model
  const selected = selection ? JSON.stringify([selection.provider, selection.model]) : ''
  const choices = catalog?.groups.flatMap(group => group.models.map(model => ({ value: JSON.stringify([group.id, model.id]),
    label: `${group.name} · ${model.name}`, provider: group.id, model }))) ?? []
  const reasoning = choices.find(choice => choice.value === selected)?.model.reasoning
  const defaultModel = catalog?.default
  const defaultName = defaultModel && (catalog.groups.find(group => group.id === defaultModel.provider)?.models.find(model => model.id === defaultModel.model)?.name ?? defaultModel.model)
  return <form className="dt-form dt-local-settings" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <Section title={t('localSettingsTitle')}>
        <Field label={t('localTaskModel')} note={t('localModelHint')}>
          <select className="dt-select" value={selected} onChange={event => {
            const choice = choices.find(item => item.value === event.target.value)
            draft.edit({ ...draft.value, model: choice ? { provider: choice.provider, model: choice.model.id } : null })
          }}>
            <option value="">{defaultName ? t('localInheritModel', { model: defaultName }) : t('localInheritDefault')}</option>
            {selection && !choices.some(choice => choice.value === selected) && <option value={selected}>{selection.provider} · {selection.model}</option>}
            {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </Field>
        {selection && reasoning && <Field label={t('modelEffort')}><select className="dt-select" value={selection.reasoningEffort ?? ''}
          onChange={event => {
            const { reasoningEffort: _old, ...model } = selection
            draft.edit({ ...draft.value, model: { ...model, ...event.target.value ? { reasoningEffort: event.target.value } : {} } })
          }}><option value="">{t('modelEffortDefault')}</option>{reasoning.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select></Field>}
        {error && <p className="dt-error" role="status">{error}</p>}
        <Field label={t('localMaxWorkers')} note={t('localConcurrencyHint')}><Input type="number" required
          min={LIMITS.maxWorkers.min} max={LIMITS.maxWorkers.max} value={draft.value.maxWorkers}
          onChange={event => draft.edit({ ...draft.value, maxWorkers: event.target.value })} /></Field>
      </Section>
      <Section title={t('localPermissionTitle')}><Hint>{t('localPermissionHint')}</Hint></Section>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

export function LocalSettings() {
  const { t } = usePanel()
  const [promptsOpen, setPromptsOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false), [policyOpen, setPolicyOpen] = useState(false)
  return <SettingsProvider><div className="dt-form dt-local-settings-page"><SettingsForm /><McpSettings />
    <details className="dt-local-details dt-local-prompt-settings" onToggle={event => setSourcesOpen(event.currentTarget.open)}>
      <summary>{t('localExternalTitle')}</summary>
      <div className="dt-local-details-body">{sourcesOpen && <SourceSettings include={['github', 'feishu']} />}</div>
    </details>
    <details className="dt-local-details dt-local-prompt-settings" onToggle={event => setPolicyOpen(event.currentTarget.open)}>
      <summary>{t('localExternalPolicy')}</summary>
      <div className="dt-local-details-body">{policyOpen && <EvalSettings include={['github', 'feishu']} />}</div>
    </details>
    <details className="dt-local-details dt-local-prompt-settings" onToggle={event => setPromptsOpen(event.currentTarget.open)}>
      <summary>{t('settingsGroup.prompts')}</summary>
      <div className="dt-local-details-body">{promptsOpen && <PromptsPage />}</div>
    </details>
  </div></SettingsProvider>
}
