/** Local settings with shared model controls and separate connection/prompt editors. */
import { useState } from 'react'
import { LIMITS } from '../limits.ts'
import { Button, Icon, Input, SegmentedControl } from './controls.tsx'
import { DENSITIES, useDensity } from './density.ts'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { PromptsPage } from './prompts.tsx'
import { Field, Fields, ModelField, SettingsProvider, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { McpSettings } from './local-mcp.tsx'
import { SourceSettings } from './source.tsx'
import { EvalSettings } from './eval.tsx'
import { Section } from './widgets.tsx'

function InterfaceSettings() {
  const { t } = usePanel(), { density, setDensity } = useDensity()
  return <div className="dt-form dt-local-settings"><Section title={t('interfaceSettings')}>
    <Field label={t('interfaceDensity')}><SegmentedControl label={t('interfaceDensity')} value={density}
      options={DENSITIES.map(value => ({ value, label: t(`density.${value}`) }))} onChange={setDensity} /></Field>
    <div className="dt-actions dt-density-reset"><Button variant="ghost" disabled={density === 'compact'} onClick={() => setDensity('compact')}>{t('densityReset')}</Button></div>
  </Section></div>
}

function SettingsForm() {
  const { t } = usePanel()
  const { settings: { blocks } } = useSettings()
  const executor = blocks.executor.value
  const draft = useBlockDraft('executor', { ...executor, maxWorkers: String(executor.maxWorkers) }, blocks.executor.revision,
    value => ({ ...value, maxWorkers: numberOf(value.maxWorkers) }))
  return <form className="dt-form dt-local-settings" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <Section title={t('localSettingsTitle')}>
        <ModelField id="dt-local-model" label={t('localTaskModel')} value={draft.value.model}
          onChange={model => draft.edit({ ...draft.value, model })} />
        <Field label={t('localMaxWorkers')} hint={t('localConcurrencyHint')}><Input type="number" required
          min={LIMITS.maxWorkers.min} max={LIMITS.maxWorkers.max} value={draft.value.maxWorkers}
          onChange={event => draft.edit({ ...draft.value, maxWorkers: event.target.value })} /></Field>
      </Section>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

export function LocalSettings() {
  const { t } = usePanel()
  const [editor, setEditor] = useState<'mcp' | 'sources' | 'policy' | 'prompts'>()
  const entries = [{ id: 'mcp' as const, title: t('mcpTitle') }, { id: 'sources' as const, title: t('localExternalTitle') },
    { id: 'policy' as const, title: t('localExternalPolicy') }, { id: 'prompts' as const, title: t('settingsGroup.prompts') }]
  return <SettingsProvider><div className="dt-local-settings-root"><h2 className="dt-local-management-title">{t('tab.settings')}</h2><div className="dt-local-settings-layout"><nav className="dt-local-settings-nav" aria-label={t('localSettingsGroups')}>
    <button type="button" className="dt-local-setting-entry" aria-current={!editor ? 'page' : undefined} onClick={() => setEditor(undefined)}><Icon name="settings" /><span>{t('localGeneralSettings')}</span></button>
    {entries.map(entry => <button type="button" className="dt-local-setting-entry" key={entry.id} aria-label={entry.title} aria-current={editor === entry.id ? 'page' : undefined}
      onClick={() => setEditor(entry.id)}><Icon name={entry.id === 'prompts' ? 'message' : entry.id === 'policy' ? 'shield' : 'folder'} /><span>{entry.title}</span></button>)}
  </nav>{editor ? <section className="dt-local-settings-editor">
    <div className="dt-local-settings-content">{editor === 'mcp' ? <McpSettings /> : editor === 'sources' ? <SourceSettings include={['github', 'feishu']} />
      : editor === 'policy' ? <EvalSettings include={['github', 'feishu']} /> : <PromptsPage />}</div>
  </section> : <div className="dt-form dt-local-settings-page"><InterfaceSettings /><SettingsForm /></div>}</div></div></SettingsProvider>
}
