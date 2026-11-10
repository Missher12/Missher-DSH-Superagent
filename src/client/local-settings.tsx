/** Local defaults: model, worker capacity, and plain descriptions of permissions and adapters. */
import { useEffect, useState } from 'react'
import { LIMITS } from '../limits.ts'
import { type ApiResponse } from '../app/api.ts'
import { Button, Icon, Input } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { PromptsPage } from './prompts.tsx'
import { Field, Fields, SettingsProvider, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint, Section } from './widgets.tsx'
import { McpSettings } from './local-mcp.tsx'
import { SourceSettings } from './source.tsx'
import { EvalSettings } from './eval.tsx'
import { LocalPlugins } from './local-plugins.tsx'

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
      <details className="dt-local-details"><summary>{t('localPermissionTitle')}</summary><div className="dt-local-details-body"><Hint>{t('localPermissionHint')}</Hint></div></details>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

export function LocalSettings() {
  const { t } = usePanel()
  const [editor, setEditor] = useState<'plugins' | 'mcp' | 'sources' | 'policy' | 'prompts'>()
  const entries = [{ id: 'plugins' as const, title: t('localPluginsTitle') }, { id: 'mcp' as const, title: t('mcpTitle') }, { id: 'sources' as const, title: t('localExternalTitle') },
    { id: 'policy' as const, title: t('localExternalPolicy') }, { id: 'prompts' as const, title: t('settingsGroup.prompts') }]
  return <SettingsProvider><div className="dt-local-settings-root"><h2 className="dt-local-management-title">{t('tab.settings')}</h2><div className="dt-local-settings-layout"><nav className="dt-local-settings-nav" aria-label={t('localSettingsGroups')}>
    <button type="button" className="dt-local-setting-entry" aria-current={!editor ? 'page' : undefined} onClick={() => setEditor(undefined)}><Icon name="settings" /><span>{t('localSettingsTitle')}</span></button>
    {entries.map(entry => <button type="button" className="dt-local-setting-entry" key={entry.id} aria-label={entry.title} aria-current={editor === entry.id ? 'page' : undefined}
      onClick={() => setEditor(entry.id)}><Icon name={entry.id === 'plugins' ? 'session' : entry.id === 'prompts' ? 'message' : entry.id === 'policy' ? 'shield' : 'folder'} /><span>{entry.title}</span></button>)}
  </nav>{editor ? <section className="dt-local-settings-editor">
    <header className="dt-local-editor-head"><Button variant="ghost" icon={<Icon name="chevron-left" />} onClick={() => setEditor(undefined)}>{t('localBackSettings')}</Button>
      {editor !== 'mcp' && <h2>{entries.find(entry => entry.id === editor)!.title}</h2>}</header>
    <div className="dt-local-settings-content">{editor === 'plugins' ? <LocalPlugins /> : editor === 'mcp' ? <McpSettings /> : editor === 'sources' ? <SourceSettings include={['github', 'feishu']} />
      : editor === 'policy' ? <EvalSettings include={['github', 'feishu']} /> : <PromptsPage />}</div>
  </section> : <div className="dt-form dt-local-settings-page"><SettingsForm /></div>}</div></div></SettingsProvider>
}
