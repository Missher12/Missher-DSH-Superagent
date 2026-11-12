/** Local settings with shared model controls and separate connection/prompt editors. */
import { useState } from 'react'
import { LIMITS } from '../limits.ts'
import { Icon, Input, type IconName } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { PromptsPage } from './prompts.tsx'
import { Field, Fields, ModelField, SettingsProvider, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { McpSettings } from './local-mcp.tsx'
import { SourceSettings } from './source.tsx'
import { EvalSettings } from './eval.tsx'
import { Section } from './widgets.tsx'
import { sourceMark } from './marks.ts'

type ConnectionSource = 'mcp' | 'github' | 'feishu'
function Connections({ selected, onSelect }: { selected: ConnectionSource; onSelect: (source: ConnectionSource) => void }) {
  const { t } = usePanel(), { settings: { sources } } = useSettings()
  return <div className="dt-connections">
    <nav className="dt-connections-nav" aria-label={t('localConnectionSources')}>
      {(['mcp', 'github', 'feishu'] as const).map(id => {
        const source = sources.find(source => source.id === id)
        const status = source && sourceMark(t, source.state)
        const name = id === 'mcp' ? 'MCP' : t(`source.${id}`)
        return <button type="button" key={id} aria-label={name} aria-current={selected === id ? 'page' : undefined}
          aria-controls="dt-connection-content" onClick={() => onSelect(id)}>
          <Icon name={id === 'mcp' ? 'agent' : id === 'github' ? 'pull' : 'message'} size={18} />
          <span><strong>{name}</strong><small data-state={status?.dot}>{id === 'mcp' ? 'HTTP · stdio' : status?.label ?? t('sourceNotInstalled')}</small></span>
        </button>
      })}
    </nav>
    <div id="dt-connection-content" className="dt-connections-body" key={selected}>
      {selected === 'mcp' ? <McpSettings /> : <SourceSettings include={[selected]} />}
    </div>
  </div>
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

function SettingsBody() {
  const { t } = usePanel()
  const [editor, setEditor] = useState('general')
  const [connection, setConnection] = useState<ConnectionSource>('mcp')
  const entries: { id: string; title: string; icon: IconName }[] = [
    { id: 'general', title: t('localGeneralSettings'), icon: 'settings' },
    { id: 'connections', title: t('localConnections'), icon: 'agent' },
    { id: 'policy', title: t('localExternalPolicy'), icon: 'shield' },
    { id: 'prompts', title: t('settingsGroup.prompts'), icon: 'file' },
  ]
  return <div className="dt-local-settings-root"><h2 className="dt-local-management-title">{t('tab.settings')}</h2>
    <div className="dt-local-settings-layout"><nav className="dt-local-settings-nav" aria-label={t('localSettingsGroups')}>
      {entries.map(entry => <button type="button" className="dt-local-setting-entry" key={entry.id} aria-label={entry.title}
        aria-current={editor === entry.id ? 'page' : undefined} aria-controls="dt-settings-content" onClick={() => setEditor(entry.id)}>
        <Icon name={entry.icon} /><span>{entry.title}</span></button>)}
    </nav><section id="dt-settings-content" className="dt-local-settings-editor" aria-label={entries.find(entry => entry.id === editor)?.title}>
      <div className="dt-local-settings-content" key={editor}>{editor === 'general' ? <SettingsForm />
        : editor === 'connections' ? <Connections selected={connection} onSelect={setConnection} />
        : editor === 'policy' ? <EvalSettings include={['github', 'feishu']} /> : <PromptsPage />}</div>
    </section></div>
  </div>
}

export function LocalSettings() { return <SettingsProvider><SettingsBody /></SettingsProvider> }
