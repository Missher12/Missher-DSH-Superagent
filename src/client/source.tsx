/** Source status view (health, filtered Triggers, dropped replies) and Source settings cards. */
import { useEffect, useRef, useState } from 'react'
import type { FieldSpec } from '../sources/kind.ts'
import { ApiError, usePoll, type DroppedReply, type SourceStatusRow, type SourceView } from './api.ts'
import { Button, DisclosureRow, Dot, Icon, InfoTip, Input, Switch, Tag } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { sourceMark } from './marks.ts'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { ConfigHistory, Field, Fields, SourceField, useBlockDraft, useSettings } from './settings-kit.tsx'
import { actorName, errorText, healthText, localized, readableMarkers, reasonLabel, valueLabel, when } from './text.ts'
import { CheckSetupButton, ConfirmButton, Hint, LabelValue, LoadState, SetupMessage, StatusHead, When } from './widgets.tsx'

function SourceCard({ source }: { source: SourceView }) {
  const { t, call, restart, notify } = usePanel()
  const { running } = usePanelData()
  const { reload } = useSettings()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [configuring, setConfiguring] = useState(false), [removing, setRemoving] = useState(false), [failure, setFailure] = useState<string>()
  const refreshLabels = async () => { const { added } = await call('POST sources/:id/labels',
    { id: source.id }); await reload(); return added }
  const draft = useBlockDraft(`source:${source.id}`, source.value, source.revision)
  const value = draft.value
  const { problem, value: saved } = source
  const connector = source.id === 'github' || source.id === 'feishu' ? source.id : undefined
  const connected = !!saved.config.credential || !!saved.config.cli || !!saved.config.workspaceDirectory
  const knownAppId = typeof saved.config.appId === 'string' ? saved.config.appId : typeof source.facts.appId === 'string' ? source.facts.appId : ''
  const [appId, setAppId] = useState(knownAppId), [appSecret, setAppSecret] = useState('')
  const previousAppId = useRef(knownAppId)
  useEffect(() => { const previous = previousAppId.current; previousAppId.current = knownAppId
    setAppId(value => value === previous ? knownAppId : value) }, [knownAppId])
  const accountChanged = connector === 'feishu' && (!!appSecret || appId !== knownAppId || configuring && !value.config.cli && !value.config.credential)
  const discard = () => { setAppId(knownAppId); setAppSecret(''); setConfiguring(false); draft.discard() }
  const connect = useAction(async () => {
    setFailure(undefined)
    try {
      const result = await call('POST feishu/connect', { body: { revision: source.revision, appId,
        ...appSecret ? { appSecret } : {}, brand: source.facts.brand === 'lark' ? 'lark' : 'feishu', value } })
      setAppSecret(''); setConfiguring(false); draft.discard()
      if (result.restarting) restart(); else await reload()
    } catch (error) {
      setFailure(errorText(error))
      if (error instanceof ApiError && error.status === 409) await reload()
      throw error
    }
  })
  const cleared = (enabled: boolean, from = value) => ({ enabled, config: { ...from.config, cli: '', workspaceDirectory: '',
    ...connector === 'feishu' ? { appId: '', credential: '', chats: [], directMessages: false, otherChats: 'none' } : {} } })
  const replace = () => {
    setFailure(undefined); setConfiguring(true); draft.edit(cleared(true))
    if (connector === 'feishu') { setAppId(''); setAppSecret('') }
    requestAnimationFrame(() => {
      const field = source.fields.find(field => field.key === 'cli')
      if (field) document.querySelector<HTMLInputElement>(`#dt-source-${source.id} input[aria-label=${JSON.stringify(connector === 'feishu' ? 'App ID' : localized(t, field.label))}]`)?.focus()
    })
  }
  const remove = async () => {
    setFailure(undefined); setRemoving(true)
    try {
      const result = await call('PUT settings/:block', { block: `source:${source.id}`, body: { value: cleared(false, saved), revision: source.revision } })
      discard(); setConfiguring(false); notify(t('sourceRemoved'))
      if (result.restarting) restart(); else await reload()
    } catch (error) {
      setFailure(errorText(error))
      if (error instanceof ApiError && error.status === 409) await reload()
      throw error
    } finally { setRemoving(false) }
  }
  const changed = (key: string) => String(value.config[key] ?? '') !== String(saved.config[key] ?? '')
  // Saving a modified setup-sensitive field restarts dsh-superagent, interrupting running Assignments.
  const restarts = draft.dirty && source.restarts.some(changed)
  const description = localized(t, source.description)
  // Hide derived facts for unsaved field edits until the new value is saved.
  const field = (spec: FieldSpec) => <SourceField key={spec.key} field={spec} value={value.config[spec.key]} saved={saved.config[spec.key]}
    labels={source.labels}
    refreshLabels={refreshLabels} fact={spec.type === 'fact' || !changed(spec.key) ? source.facts[spec.key] : undefined}
    onChange={next => draft.edit({ ...value, config: { ...value.config, [spec.key]: next,
      ...connector === 'feishu' && spec.key === 'cli' ? { appId: '', credential: '' } : {} } })} />
  const advanced = source.fields.filter(spec => spec.advanced)
  if (connector && source.installed && !saved.enabled && !connected && !configuring) return <ConnectSource id={connector}
    onConnect={() => { setConfiguring(true); draft.edit({ ...value, enabled: true }) }} />
  return <form id={`dt-source-${source.id}`} className="dt-card" onSubmit={event => {
    if (accountChanged) { event.preventDefault(); void connect.run() } else void draft.submit(event)
  }}>
    <Fields disabled={draft.busy || connect.busy || removing}>
      <div className="dt-card-head">
        <div className="dt-row-main">
          <div className="dt-row-title">
            <span className="dt-card-title">{localized(t, source.title)}</span>{description && <InfoTip text={description} />}
            {!source.installed && <Tag tone="warning">{t('sourceNotInstalled')}</Tag>}
            <span className="dt-status-text" data-state={sourceMark(t, source.state).dot}>{sourceMark(t, source.state).label}</span>
          </div>
        </div>
        {connector && connected && <Button className="dt-source-connect" variant="outline" disabled={draft.busy || connect.busy || removing} onClick={replace}>{t('sourceReplaceAction')}</Button>}
        {source.installed && <Switch checked={value.enabled} onChange={enabled => draft.edit({ ...value, enabled })}
          label={t('sourceEnable', { name: localized(t, source.title) })} />}
      </div>
      {problem && <div className="dt-source-problem">
        <div className="dt-subhead"><p className="dt-error" role="status"><SetupMessage problem={{ ...problem, values: { ...problem.values, output: '' } }} lead /></p><CheckSetupButton /></div>
        {problem.values.output && <details className="dt-source-error-details"><summary>{t('sourceErrorDetails')}</summary>
          <pre>{problem.values.output}</pre></details>}
      </div>}
      {!source.installed && <Hint>{t('sourceNotInstalledHint')}</Hint>}
      {source.installed && connector === 'feishu' && <div className="dt-feishu-account">
        <Field label="App ID" note={source.facts.cli && localized(t, source.facts.cli)}><Input value={appId} required={accountChanged} pattern="cli_[A-Za-z0-9]+" maxLength={120}
          placeholder="cli_…" autoComplete="off" spellCheck={false} onChange={event => setAppId(event.target.value)} /></Field>
        <Field label="App Secret"><Input type="password" value={appSecret} maxLength={2048} autoComplete="new-password" spellCheck={false}
          required={accountChanged && (appId !== knownAppId || !saved.config.cli && !saved.config.credential || configuring)}
          placeholder={knownAppId && (saved.config.cli || saved.config.credential) && !configuring ? t('feishuSecretSaved') : t('feishuSecretPlaceholder')}
          onChange={event => setAppSecret(event.target.value)} /></Field>
      </div>}
      {source.installed && source.fields.filter(spec => !spec.advanced).map(field)}
      {source.installed && advanced.length > 0 && <DisclosureRow icon={<Icon name="settings" />} title={t('advanced')} open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}>
        <div className="dt-disclosure-body">{advanced.map(field)}</div>
      </DisclosureRow>}
    </Fields>
    {connector && connected && <div className="dt-danger-zone dt-source-actions"><ConfirmButton label={t('sourceRemoveAction')}
      title={t('sourceRemoveTitle', { name: localized(t, source.title) })} message={t('sourceRemoveHint') + (connector === 'github' ? t('sourceRepositoryRetained') : '')}
      icon="trash" disabled={draft.busy || connect.busy || removing || running > 0} disabledReason={running > 0 ? t('sourceRemoveBusy') : undefined} onConfirm={remove} /></div>}
    {failure && <p className="dt-error" role="alert">{failure}</p>}
    <SaveBar {...draft} dirty={draft.dirty || accountChanged} busy={draft.busy || connect.busy || removing}
      status={accountChanged && running > 0 ? t('feishuConnectionBusy') : restarts && running > 0 ? t('restartInterrupts', { count: running }) : undefined}
      onDiscard={discard} />
  </form>
}

function ConnectSource({ id, onConnect }: { id: 'github' | 'feishu'; onConnect?: () => void }) {
  const { t, enableSource } = usePanel(), { reload } = useSettings()
  const name = t(`source.${id}`)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string>()
  const connect = async () => {
    if (busy || (!enableSource && !onConnect)) return
    setBusy(true); setFailure(undefined)
    try { if (onConnect) onConnect(); else { await enableSource!(id); await reload() } }
    catch (error) { setFailure(errorText(error)) }
    finally { setBusy(false) }
  }
  return <section className="dt-section">
    <div className="dt-card-head"><h3 className="dt-card-title">{name}</h3><Tag tone="neutral">{t('sourceConnectStatus')}</Tag></div>
    <div className="dt-subhead"><Hint>{t(onConnect || enableSource ? 'sourceConnectHint' : 'sourceConnectUnavailable')}</Hint>
      <Button className="dt-source-connect" variant="outline" disabled={busy || (!enableSource && !onConnect)} onClick={() => { void connect() }}>{t('sourceConnectAction', { name })}</Button></div>
    {failure && <p className="dt-error" role="alert">{failure}</p>}
  </section>
}

export function SourceSettings({ focus, include }: { focus?: string; include?: readonly string[] }) {
  const { sources } = useSettings().settings
  const { t } = usePanel()
  const shown = sources.filter(source => !include || include.includes(source.id))
  useEffect(() => { if (focus) document.getElementById(`dt-source-${focus}`)?.scrollIntoView?.({ block: 'start' }) }, [focus])
  const rows = include ?? shown.map(source => source.id)
  return <div className="dt-form">
    {rows.map(id => {
      const source = shown.find(source => source.id === id)
      return source?.installed || !include ? source && <SourceCard key={id} source={source} />
        : id === 'github' || id === 'feishu' ? <ConnectSource key={id} id={id} /> : source && <SourceCard key={id} source={source} />
    })}
    <ConfigHistory blocks={include ? include.map(id => `source:${id}`) : ['source:']} />
  </div>
}

function DroppedReplies({ items }: { items: DroppedReply[] }) {
  const { t, navigate } = usePanel()
  const [open, setOpen] = useState(false)
  // Link to the message's Ticket, or fall back to its Thread for messages queued before receipts recorded `ticketId`.
  const target = (item: DroppedReply): { route: Route; name: string } | undefined => item.ticket
    ? { route: { page: 'execution', id: item.ticket.id }, name: item.ticket.title }
    : item.thread ? { route: { page: 'trigger', id: item.thread }, name: t('term.thread') } : undefined
  return <DisclosureRow icon={<Icon name="dismiss" />} title={<>{t('sourceDroppedTitle')} <span
    className="dt-count">{items.length}</span></>} open={open}
    onToggle={() => setOpen(!open)}>
    <div className="dt-disclosure-body">
      <Hint>{t('sourceDroppedHint')}</Hint>
      <ul className="dt-list">{items.map(item => {
        const link = target(item)
        return <li key={item.id} className="dt-row"><Dot state="idle" /><div className="dt-row-main">
          <div className="dt-row-title dt-line">{readableMarkers(t, item.preview) || t('empty')}</div>
          <div className="dt-row-meta">
            <Tag tone="neutral">{reasonLabel(t, item.dropped.reason)}</Tag><When at={item.dropped.at} />
            {link && <button type="button" className="dt-textlink" onClick={() => navigate(link.route)}>{link.name}</button>}
          </div>
        </div></li>
      })}</ul>
    </div>
  </DisclosureRow>
}
function SourceRow({ source }: { source: SourceStatusRow }) {
  const { t, navigate } = usePanel()
  const { setup } = usePanelData()
  const [filteredOpen, setFilteredOpen] = useState(false)
  const { problem, dropped } = source
  const { dot, label: state } = sourceMark(t, source.state)
  const { received, filtered, lastAt } = source.stats
  // Omit healthy parts and suppress per-part notes when a setup problem already explains why the Source is stopped.
  const notes = source.enabled && !problem && !setup?.problem ? source.health.filter(item => item.state === 'error'
    || item.state === 'paused') : []
  return <li className="dt-row">
    <Dot state={dot} label={state} />
    <div className="dt-row-main">
      <div className="dt-row-title"><span className="dt-row-name">{localized(t, source.title)}</span><span className="dt-status-text"
        data-state={dot}>{state}</span></div>
      <div className="dt-row-meta">
        {received > 0 && <LabelValue label={t('sourceReceivedLabel')}
          value={received} />}{filtered > 0 && <LabelValue label={t('sourceFilteredLabel')} value={filtered} />}
        {lastAt && <LabelValue label={t('sourceLatestLabel')} value={when(lastAt, t('lang'))} />}
      </div>
      {problem && <p className="dt-error">
        <SetupMessage problem={problem} lead /> <button type="button" className="dt-textlink"
          onClick={() => navigate(settingsRoute('source', { source: source.id }))}>
          {t('sourceOpenSettings')}
        </button>
      </p>}
      {notes.map(item => <p key={item.name} className={item.state === 'error' ? 'dt-error dt-clamp' : 'dt-hint dt-clamp'}>
        {valueLabel(t, 'health', item.name)}{t('labelSeparator')}<span className={item.code ? undefined : 'dt-mono'}>{healthText(t,
          item)}</span>
      </p>)}
      {source.filtered.length > 0 && <DisclosureRow icon={<Icon name="filter" />} title={t('sourceFilteredTitle')} open={filteredOpen}
        onToggle={() => setFilteredOpen(!filteredOpen)}>
        <div className="dt-disclosure-body">
          <ul className="dt-list">{source.filtered.map(item => <li key={item.id} className="dt-row"><Dot state="idle" /><div
            className="dt-row-main">
            <div className="dt-row-title">{actorName(t, item.actor)}{t('labelSeparator')}{readableMarkers(t, item.preview)
              || t('empty')}</div>
            <div className="dt-row-meta"><Tag tone="neutral">{reasonLabel(t, item.reason)}</Tag><When at={item.at} /></div>
          </div></li>)}</ul>
        </div>
      </DisclosureRow>}
      {dropped.length > 0 && <DroppedReplies items={dropped} />}
    </div>
  </li>
}

export function SourceStatus() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error } = usePoll(() => call('GET sources'), [])
  // Global deployment setup problems halt all Sources and show at the top; Source-specific setup problems show on that Source's row.
  const elsewhere = setup?.problem?.place === 'deployment' ? setup.problem : undefined
  return <div className="dt-form">
    <StatusHead hint={t('sourceStatusIntro')} settings="source" />
    {elsewhere && <p className="dt-error">
      <SetupMessage problem={elsewhere} lead /> <button type="button" className="dt-textlink"
        onClick={() => navigate(setupPage(elsewhere.place))}>{t('setupFixLink')}</button>
    </p>}
    <LoadState error={error} loading={!data} />
    {data && <ul className="dt-list">{data.map(source => <SourceRow key={source.id} source={source} />)}</ul>}
  </div>
}
