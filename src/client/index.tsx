/** Browser plugin entry point registering the sidebar icon, main management panel, and Plugin Manager config view. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderSlots, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, pickWorkspaceDirectory, SessionNavigationError } from '../navigation.ts'
import { App } from './app.tsx'
import { PluginConfig, usePageForm } from './deployment.tsx'
import { en, zh } from './locales.ts'
import type { T } from './text.ts'
import { LoadState } from './widgets.tsx'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { superagent: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'superagent.session': { kind: 'single'; scope: 'session' } }
}
type ConversationSeat = PropsRenderSlots<'superagent.session'>

/** Own a native Session reference only while this embedded transcript is mounted. Task input goes through durable follow-up intake below it. */
function EmbeddedSession({ ctx, id, seat }: { ctx: ClientContext; id: string; seat: ConversationSeat }) {
  const [reference, setReference] = useState<SessionReference>()
  const [error, setError] = useState<Error>()
  useEffect(() => {
    let active = true
    const ref = ctx.sessions.retain(id as SessionId, { source: 'superagent' })
    ref.ready.then(() => { if (active) setReference(ref) }, failure => { if (active) setError(failure instanceof Error ? failure : new Error(String(failure))) })
    return () => { active = false; ref.release() }
  }, [ctx, id])
  if (!reference) return <LoadState loading={!error} error={error} />
  const { SessionProvider, renderSlot } = seat
  return <SessionProvider session={reference}><div className="dt-native-transcript" data-superagent-session={id}>
    {renderSlot('superagent.session', {})}
  </div></SessionProvider>
}

type ClientContext = Context & { sessions: ISessions }
const NS = 'dshSuperagent'
const PANEL_ID = 'dsh-superagent' as MainPanelId
const ENTRY = 'dsh-superagent'

function HammerIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5h9l3.5 1.75v2.5L15 9.5H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M10 9.5v10.25a1.75 1.75 0 0 0 3.5 0V9.5" /><path d="M10 15.5h3.5" />
  </svg>
}

/** Mounted panel wrapper; cancels any pending Session navigation when a new one starts or the panel unmounts. */
function Mounted({ ctx, t, seat }: { ctx: ClientContext; t: T; seat: ConversationSeat }) {
  const pending = useRef<AbortController>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const openSession = useCallback(async (id: string) => {
    pending.current?.abort()
    const request = new AbortController(); pending.current = request
    try {
      await openKnownSession(ctx.sessions, id as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
    } catch (error) {
      if (error instanceof SessionNavigationError) throw new Error(t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed'))
      throw error
    }
  }, [ctx, t])
  const openWorkspace = useCallback(async (id: string) => {
    await ctx.uiWorkspace.openWorkspace(id as Parameters<typeof ctx.uiWorkspace.openWorkspace>[0])
  }, [ctx])
  const pickDirectory = useCallback(() => pickWorkspaceDirectory(() => ctx.uiWorkspace.pickDirectory()), [ctx])
  const form = usePageForm(ctx.get('configForms')?.get<Record<string, unknown>>(ENTRY))
  const renderSession = useCallback((id: string) => <EmbeddedSession key={id} ctx={ctx} id={id} seat={seat} />, [ctx, seat])
  return <App t={t} openSession={openSession} renderSession={renderSession} openWorkspace={openWorkspace} pickDirectory={pickDirectory} deploymentForm={form} />
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']
/** Registers the panel, sidebar icon, and Plugin Manager config view; `configForms` is optional (without it, machine settings are read-only). */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}),
    children: { 'superagent.session': { kind: 'single', scope: 'session' } } },
    (props: { t: T } & ConversationSeat) => <Mounted ctx={ctx} t={props.t} seat={props} />))
  ctx.slots.inject('superagent.session', () => ctx.slots.register({ name: 'superagent.session' },
    ({ renderFactorySlot }: PropsRenderFactories) => renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false })))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => t('panel'), locale: NS }, HammerIcon))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${ENTRY}#${ENTRY}`, locale: NS },
    (props: PluginConfigViewProps & { t: T }) => <PluginConfig t={props.t} view={props.view} form={props.form} />))
}
