import { Select } from './select.tsx'
/** Eval status view (Decision log) and Eval settings group (Policy rules, per-Source admission, and assessor settings). */
import { useId, useState } from 'react'
import { ADMISSION_DEFAULTS, ADMISSION_OPTIONS, type Admission, type AdmissionCell } from '../admission.ts'
import type { AdmissionRowView } from '../sources/kind.ts'
import { LIMITS } from '../limits.ts'
import { DECISION_FILTERS, DECISION_KINDS, usePoll, type DecisionFilter, type Settings, type SourceView } from './api.ts'
import { Button, DisclosureRow, Icon, InfoTip, Input, Modal, Pill, SegmentedTabs, Switch } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { useAction, usePanel } from './provider.tsx'
import { DecisionLine } from './rows.tsx'
import { ConfigHistory, Field, Fields, ModelField, SourceField, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { localized, valueLabel, when } from './text.ts'
import { Hint, LabelValue, LoadMore, LoadState, Section, StatusHead } from './widgets.tsx'
import { McpSettings } from './local-mcp.tsx'
import { sourceMark } from './marks.ts'

export function EvalStatus({ filter, window, paused }: { filter: DecisionFilter; window: '24h' | undefined; paused: boolean }) {
  const { t, call, navigate } = usePanel()
  const [limit, setLimit] = useState(30)
  const { data, error } = usePoll(() => call('GET decisions', { query: { limit, kind: DECISION_KINDS[filter],
    ...window ? { window } : {} } }), [filter, limit, window])
  const show = (key: DecisionFilter, last24h: boolean) => navigate({ page: 'eval', query: { ...key === 'work' ? {} : { filter: key },
    ...last24h ? { window: '24h' } : {} } }, true)
  return <>
    <StatusHead hint={t('evalStatusIntro')} settings="eval" />
    {paused && <p className="dt-banner">
      {t('evalRecordsPaused')} <button type="button" className="dt-textlink"
        onClick={() => navigate({ page: 'execution' })}>{t('resumeWhere')}</button>
    </p>}
    <div className="dt-filters">
      {DECISION_FILTERS.map(key => <Pill key={key} active={filter === key} onClick={() => { setLimit(30); show(key, !!window) }}>
        {t(`decisionFilter.${key}`)}
      </Pill>)}
      {window && <><span className="dt-filter-gap" /><Pill active onClick={() => show(filter, false)}>{t('lastDayOnly')}</Pill></>}
    </div>
    <LoadState error={error} loading={!data} />
    {data && (data.items.length ? <ul className="dt-list">{data.items.map(decision => <DecisionLine key={decision.id}
      decision={decision} />)}</ul> : <Hint>{t('none')}</Hint>)}
    {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 30)} />}
  </>
}

type Rule = Settings['policy']['rules'][number]
function RuleRow({ rule, expanded, onToggle, onChange, onDuplicate, onRemove }: {
  rule: Rule; expanded: boolean; onToggle: () => void; onChange: (rule: Rule) => void; onDuplicate: () => void; onRemove: () => void
}) {
  const { t } = usePanel()
  const name = rule.name.trim() || t('newRule')
  return <li className="dt-rule">
    <DisclosureRow icon={<span className="dt-rule-dot" data-enabled={rule.enabled
      || undefined} />} title={name} open={expanded} onToggle={onToggle}>
      <div className="dt-rule-body">
        <Field label={t('ruleName')}><Input value={rule.name} required maxLength={LIMITS.ruleName} onChange={event => onChange({ ...rule,
          name: event.target.value })} /></Field>
        <Field label={t('ruleInstruction')}>
          <textarea className="dt-textarea" rows={4} required maxLength={LIMITS.ruleInstruction} value={rule.instruction}
            placeholder={t('ruleInstructionPlaceholder')}
            onChange={event => onChange({ ...rule, instruction: event.target.value })} />
        </Field>
        <div className="dt-actions">
          <Button variant="ghost" size="sm" icon={<Icon name="copy" />} onClick={onDuplicate}>{t('duplicate')}</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="trash" />} onClick={onRemove}>{t('remove')}</Button>
        </div>
      </div>
    </DisclosureRow>
    <Switch className="dt-rule-switch" checked={rule.enabled} onChange={enabled => onChange({ ...rule, enabled })} label={t('ruleEnable',
      { name })} />
  </li>
}

/** Local rules use a compact list; closing the editor retains the existing versioned policy draft. */
function NativeRuleList({ rules, onChange, invalidRule, clearInvalid }: { rules: Rule[]; onChange: (rules: Rule[]) => void;
  invalidRule?: string; clearInvalid: () => void }) {
  const { t } = usePanel(), formId = useId()
  const [editor, setEditor] = useState<{ id: string; created?: boolean }>()
  const active = rules.find(rule => rule.id === (editor?.id ?? invalidRule))
  const update = (next: Rule) => onChange(rules.map(rule => rule.id === next.id ? next : rule))
  const close = () => {
    if (editor?.created && active && !active.name.trim() && !active.instruction.trim()) onChange(rules.filter(rule => rule.id !== active.id))
    setEditor(undefined); clearInvalid()
  }
  const add = () => {
    const rule = { id: crypto.randomUUID(), name: '', enabled: true, instruction: '' }
    onChange([...rules, rule]); setEditor({ id: rule.id, created: true })
  }
  return <>
    <div className="dt-dispatch-rules-head"><Hint>{t('dispatchRulesSummary', { count: rules.filter(rule => rule.enabled).length })}</Hint>
      <Button variant="outline" size="sm" icon={<Icon name="plus" />} onClick={add}>{t('addRule')}</Button></div>
    {rules.length ? <ul className="dt-rules dt-native-rules">{rules.map((rule, index) => {
      const name = rule.name.trim() || t('newRule')
      return <li key={rule.id} className="dt-native-rule-row">
        <button type="button" className="dt-rule-edit" aria-label={t('dispatchEditRule', { name })} onClick={() => setEditor({ id: rule.id })}>
          <strong>{name}</strong><span>{rule.instruction || t('dispatchRuleEmpty')}</span></button>
        <Switch checked={rule.enabled} label={t('ruleEnable', { name })} onChange={enabled => update({ ...rule, enabled })} />
        <Button size="sm" icon={<Icon name="copy" />} aria-label={t('dispatchCopyRule', { name })} title={t('duplicate')}
          onClick={() => onChange([...rules.slice(0, index + 1), { ...rule, id: crypto.randomUUID(), name: `${name}${t('copySuffix')}`.slice(0, LIMITS.ruleName) }, ...rules.slice(index + 1)])} />
      </li>
    })}</ul> : <Hint>{t('rulesEmpty')}</Hint>}
    <Modal className="dt-rule-dialog" open={!!active} title={t(editor?.created ? 'newRule' : 'dispatchRuleTitle')} closeLabel={t('close')} onClose={close}
      footer={<><Hint>{t('dispatchRuleDraftHint')}</Hint><Button type="submit" form={formId} variant="primary">{t('dispatchFinishEdit')}</Button></>}>
      {active && <form id={formId} className="dt-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); close() }}>
        <Field label={t('ruleName')}><Input required value={active.name} maxLength={LIMITS.ruleName}
          onChange={event => update({ ...active, name: event.target.value })} /></Field>
        <Field label={t('ruleInstruction')}><textarea className="dt-textarea" required rows={5} value={active.instruction}
          maxLength={LIMITS.ruleInstruction} placeholder={t('ruleInstructionPlaceholder')}
          onChange={event => update({ ...active, instruction: event.target.value })} /></Field>
        <div className="dt-danger-zone"><Button size="sm" icon={<Icon name="trash" />} onClick={() => {
          onChange(rules.filter(rule => rule.id !== active.id)); setEditor(undefined); clearInvalid()
        }}>{t('dispatchDeleteRule')}</Button></div>
      </form>}
    </Modal>
  </>
}

type Part = Record<string, unknown>
function SourcePart({ source, part, saved, dirty, onChange, reload, local }: {
  source: SourceView; part: Part; saved: Part; dirty: boolean; onChange: (next: Part) => void; reload: () => Promise<void>; local?: boolean
}) {
  const { t, call, notify } = usePanel()
  const policy = source.policy!
  const sync = policy.sync
  const run = useAction(() => call('POST policy-sync/:id', { id: source.id }), { reload })
  // Syncing saves the Policy block, so require unsaved edits to be saved or discarded first.
  const syncNow = () => { if (dirty) notify(t('syncNeedsSave')); else void run.run() }
  return <div className="dt-part">
    {policy.fields.map(field => <SourceField key={field.key} field={local && ['allowed', 'bots'].includes(field.key)
      ? { ...field, label: { zh: t(field.key === 'allowed' ? 'dispatchAllowedUsers' : 'dispatchCandidateBots'),
        en: t(field.key === 'allowed' ? 'dispatchAllowedUsers' : 'dispatchCandidateBots') } } : field} value={part[field.key]} saved={saved[field.key]} fact={undefined}
      labels={source.labels}
      onChange={next => onChange({ ...part, [field.key]: next })} />)}
    {sync && <div className="dt-row-buttons">
      <Button variant="outline" size="sm" icon={<Icon name="refresh" />} disabled={run.busy || !sync.ready} onClick={syncNow}>{localized(t,
        sync.label)}</Button>
      {sync.health?.state === 'ready' && sync.health.at && <LabelValue label={t('syncDone')} value={when(sync.health.at, t('lang'))} />}
      {sync.health?.state === 'error' && <span className="dt-error dt-clamp">{sync.health.detail}</span>}
    </div>}
    {policy.rows ? <AdmissionTable rows={policy.rows} labels={source.labels} table={(part.admission ?? {}) as AdmissionTable}
      explicit={localized(t, policy.explicit)}
      local={local} onChange={admission => onChange({ ...part, admission })} />
      : <div className="dt-field"><span className="dt-field-head">{t('explicitRequest')}</span><span>{localized(t,
        policy.explicit)}</span></div>}
  </div>
}

type AdmissionTable = Record<string, Partial<Record<AdmissionCell, Admission>>>
const CELLS: readonly AdmissionCell[] = ['listedUnaddressed', 'unlistedAddressed', 'unlistedUnaddressed']
function AdmissionTable({ rows, labels, table, explicit, onChange, local }: {
  rows: AdmissionRowView[]; labels: Record<string,
  string>; table: AdmissionTable; explicit: string; onChange: (table: AdmissionTable) => void; local?: boolean
}) {
  const { t } = usePanel()
  const name = (row: AdmissionRowView) => labels[row.id] ?? localized(t, row.label)
  const set = (row: string, cell: AdmissionCell, value: Admission) => onChange({ ...table, [row]: { ...table[row], [cell]: value } })
  const select = (row: AdmissionRowView, cell: AdmissionCell) => {
    const value = table[row.id]?.[cell] ?? ADMISSION_DEFAULTS[cell]
    // Reserve a fixed-width slot for the warning icon so selecting a value never shifts column widths.
    return <td key={cell} data-label={t(`admissionCell.${cell}`)}><span className="dt-admission-cell">
      <Select className="dt-select" aria-label={`${name(row)} · ${t(`admissionCell.${cell}`)}`} value={value} onChange={event => set(row.id,
        cell, event.target.value as Admission)}>
        {ADMISSION_OPTIONS[cell].map(option => <option key={option} value={option}>{t(`${local ? 'dispatchValue' : 'admissionValue'}.${option}`)}</option>)}
      </Select>
      <span className="dt-admission-slot">{cell === 'unlistedAddressed' && value === 'explicit' && <InfoTip
        text={t('admissionAnyoneWarning')} icon="alert" warn />}</span>
    </span></td>
  }
  const shown = local ? rows.filter(row => CELLS.some(cell => row.cells[cell])) : rows
  return <Section title={t(local ? 'dispatchMessageHandling' : 'admission')} hint={`${t('admissionHint')}\n${explicit}\n${t('admissionFootnote')}`}>
    {!shown.length ? <Hint>{t('dispatchNoScopes')}</Hint> :
    <table className="dt-table dt-admission">
      <thead>
        <tr><th scope="col">{t('admissionScope')}</th>
          <th scope="col">{t('admissionListed')}<small>{t('admissionUnaddressed')}</small></th>
          <th scope="col">{t('admissionUnlisted')}<small>{t('admissionAddressed')}</small></th>
          <th scope="col">{t('admissionUnlisted')}<small>{t('admissionUnaddressed')}</small></th></tr>
      </thead>
      <tbody>{shown.map(row => <tr key={row.id}>
        <td className="dt-admission-scope">{name(row)}<small>{localized(t, row.note)}</small></td>
        {CELLS.map(cell => row.cells[cell] ? select(row, cell) : <td key={cell} className="dt-admission-na" data-label={t(`admissionCell.${cell}`)}
          aria-label={t('admissionNotReceived')}>—</td>)}
      </tr>)}</tbody>
    </table>}
  </Section>
}

function PolicyBlock({ include, area = 'all', onInvalidRule }: { include?: readonly string[]; area?: 'all' | 'sources' | 'rules'; onInvalidRule?: () => void }) {
  const { t } = usePanel()
  const sourceTabs = useId()
  const { settings: { blocks, sources, policyVersion }, reload } = useSettings()
  const draft = useBlockDraft('policy', blocks.policy.value, blocks.policy.revision)
  const policy = draft.value
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [invalidRule, setInvalidRule] = useState<string>()
  const local = area !== 'all'
  const parts = sources.filter(source => source.installed && (local ? source.id !== 'local' : !!source.policy) && (!include || include.includes(source.id)))
    .sort((a, b) => local ? Number(b.id === 'mcp') - Number(a.id === 'mcp') : 0)
  const [tab, setTab] = useState<string>()
  const current = parts.find(source => source.id === tab) ?? parts[0]
  const edit = (next: Partial<typeof policy>) => draft.edit({ ...policy, ...next })
  const toggle = (id: string) => { const next = new Set(expanded); if (next.has(id)) next.delete(id); else next.add(id); setExpanded(next) }
  const insert = (rule: Rule, at: number) => {
    setExpanded(new Set([...expanded, rule.id]))
    edit({ rules: [...policy.rules.slice(0, at), rule, ...policy.rules.slice(at)] })
  }
  // Expand all rules when native form validation fails inside a collapsed rule.
  const reveal = (target: EventTarget) => { if (target instanceof Element
    && target.closest('.dt-rules')) setExpanded(new Set(policy.rules.map(rule => rule.id))) }
  const part = (id: string) => (policy.sources[id] ?? { allowed: [] }) as Part
  const add = () => insert({ id: crypto.randomUUID(), name: '', enabled: true, instruction: '' }, policy.rules.length)
  return <form className={`dt-form dt-block${local ? ' dt-dispatch-policy' : ''}`} onSubmit={event => {
    const invalid = local ? policy.rules.find(rule => !rule.name.trim() || !rule.instruction.trim()) : undefined
    if (invalid) { event.preventDefault(); setInvalidRule(invalid.id); onInvalidRule?.(); return }
    void draft.submit(event)
  }}
    onInvalidCapture={event => reveal(event.target)}>
    <Fields disabled={draft.busy}>
      {area !== 'sources' && <Section title={t('rules')} hint={`${t('rulesHint')}\n${t('policyVersion')} ${policyVersion.slice(0, 8)}\n${t('policyVersionHint')}`}
        action={!local && <Button variant="ghost" size="sm" icon={<Icon name="plus" />}
        onClick={add}>{t('addRule')}</Button>}>
        {local ? <NativeRuleList rules={policy.rules} onChange={rules => edit({ rules })} invalidRule={invalidRule} clearInvalid={() => setInvalidRule(undefined)} /> : policy.rules.length ? <ul className="dt-rules">{policy.rules.map((rule, index) => <RuleRow key={rule.id} rule={rule}
          expanded={expanded.has(rule.id)}
          onToggle={() => toggle(rule.id)} onChange={next => edit({ rules: policy.rules.map((item, position) => position === index ? next
            : item) })}
          onDuplicate={() => insert({ ...rule, id: crypto.randomUUID(), name: `${rule.name}${t('copySuffix')}`.slice(0, LIMITS.ruleName) },
            index + 1)}
          onRemove={() => edit({ rules: policy.rules.filter((_, position) => position !== index) })} />)}</ul>
            : <Hint>{t('rulesEmpty')}</Hint>}
      </Section>}
      {area !== 'rules' && current && <Section title={t(local ? 'dispatchSources' : 'policyPerSource')} hint={t('policyPerSourceHint')}>
        <div className="dt-source-policy-layout"><div className="dt-source-policy">
          <div className="dt-source-policy-nav" role="tablist" aria-label={t('policyPerSource')}>
            {parts.map((source, index) => <button key={source.id} id={`${sourceTabs}-${source.id}`} type="button" role="tab" aria-label={source.id === 'mcp' ? 'MCP' : localized(t, source.title)}
              aria-selected={source === current} aria-controls={`${sourceTabs}-body`} tabIndex={source === current ? 0 : -1} className="dt-subtab"
              onClick={() => setTab(source.id)} onKeyDown={event => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? parts.length - 1
                  : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (index + 1) % parts.length
                    : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (index + parts.length - 1) % parts.length : undefined
                if (next === undefined) return
                event.preventDefault(); setTab(parts[next]!.id)
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
              }}>
              <Icon name={source.id === 'mcp' ? 'agent' : source.id === 'github' ? 'code' : source.policy ? 'message' : 'agent'} />
              {local ? <span><strong>{source.id === 'mcp' ? 'MCP' : localized(t, source.title)}</strong><small>{sourceMark(t, source.state).label}</small></span> : localized(t, source.title)}
            </button>)}
          </div>
          <div className="dt-source-policy-body" role="tabpanel" id={`${sourceTabs}-body`} aria-labelledby={`${sourceTabs}-${current.id}`}>
            {current.id === 'mcp' ? <McpSettings permissions /> : current.policy ? <SourcePart key={current.id} source={current} part={part(current.id)}
              saved={(blocks.policy.value.sources[current.id] ?? {}) as Part} dirty={draft.dirty}
              local={local} reload={reload} onChange={next => edit({ sources: { ...policy.sources,
                [current.id]: next as typeof policy.sources[string] } })} /> : <Hint>{t('dispatchSourceManaged')}</Hint>}
          </div>
        </div></div>
      </Section>}
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

function EvalBlock({ local = false }: { local?: boolean }) {
  const { t } = usePanel()
  const block = useSettings().settings.blocks.eval
  const saved = { ...block.value, timeoutSeconds: String(block.value.timeoutSeconds) }
  const draft = useBlockDraft('eval', saved, block.revision, value => ({ ...value, timeoutSeconds: numberOf(value.timeoutSeconds) }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  return <form className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t(local ? 'dispatchAssessmentMode' : 'evalSettings')}<InfoTip text={t('evalIntro')} /></h2>
      <Field label={t('acceptMode')} hint={t(`modeOption.${value.mode}`)}>
        <Select value={value.mode} onChange={event => edit({ mode: event.target.value as typeof value.mode })}>
          {(['off', 'observe', 'auto'] as const).map(mode => <option key={mode} value={mode}>{valueLabel(t, 'mode', mode)}</option>)}
        </Select>
      </Field>
      <Field label={t('evalTimeout')} hint={t('evalTimeoutHint')}>
        <Input type="number" min={LIMITS.evalTimeoutSeconds.min} max={LIMITS.evalTimeoutSeconds.max} required value={value.timeoutSeconds}
          onChange={event => edit({ timeoutSeconds: event.target.value })} />
      </Field>
      <Section title={t('assessorModel')} hint={t('assessorModelHint')}>
        <ModelField id="dt-eval-model" value={value.model} onChange={model => edit({ model })} />
      </Section>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

export function EvalSettings({ version, include, layout }: { version?: string | undefined; include?: readonly string[]; layout?: 'local' }) {
  const { t } = usePanel(), panelId = useId()
  const [page, setPage] = useState<'sources' | 'rules' | 'assessment'>('sources')
  if (layout === 'local') return <div className="dt-form dt-dispatch-settings">
    <SegmentedTabs className="dt-dispatch-tabs" label={t('dispatchSettingsSections')} value={page} onChange={setPage}
      items={(['sources', 'rules', 'assessment'] as const).map(value => ({ value, label: t(`dispatchSection.${value}`),
        id: `${panelId}-${value}`, panelId: `${panelId}-body` }))} />
    <div className="dt-dispatch-body" role="tabpanel" id={`${panelId}-body`} aria-labelledby={`${panelId}-${page}`}>
      {page === 'assessment' ? <EvalBlock local /> : <PolicyBlock area={page} onInvalidRule={() => setPage('rules')} />}
    </div>
    <ConfigHistory blocks={['policy', 'eval']} versions {...version ? { focus: version } : {}} />
  </div>
  return <div className="dt-form">
    <PolicyBlock {...include ? { include } : {}} />
    <EvalBlock />
    <ConfigHistory blocks={['policy', 'eval']} versions {...version ? { focus: version } : {}} />
  </div>
}
