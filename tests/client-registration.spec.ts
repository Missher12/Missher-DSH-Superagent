// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply } from '../src/client/index.tsx'

const renderApp = vi.hoisted(() => vi.fn((_props: { renderContext?: unknown; renderSession?: unknown }) => null))
vi.mock('../src/client/app.tsx', () => ({ App: renderApp }))

function hostSlots() {
  const core = new SlotCore()
  core.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' }, 'plugins.row.config': { kind: 'keyed', scope: 'root' } } },
  (_props: PropsRenderSlots<'main' | 'sidebar.panellist' | 'plugins.row.config'>) => null)
  core.register({ name: 'main', key: 'native', children: { 'conversation.session': { kind: 'single', scope: 'session' },
    'conversation.session.header': { kind: 'single', scope: 'session' } } },
    (_props: PropsRenderSlots<'conversation.session' | 'conversation.session.header'>) => null)
  core.register({ name: 'conversation.session', children: { 'conversation.view': { kind: 'list', scope: 'session' } } },
    (_props: PropsRenderSlots<'conversation.view'>) => null)
  core.register({ name: 'conversation.session.header', children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } },
    (_props: PropsRenderSlots<'conversation.session.header.actions'>) => null)
  const context = { get: () => undefined, effect: (effect: () => unknown) => effect(), locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: { inject: (_name: string, effect: () => unknown) => effect(), register: core.register.bind(core),
      subscribe: core.subscribe.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core) } }
  return { core, context: context as unknown as Parameters<typeof apply>[0] }
}

it('registers alongside the native conversation without redeclaring its slots', () => {
  const { context } = hostSlots()
  expect(() => apply(context)).not.toThrow()
})

it('keeps one native session provider while host views are registered or removed', async () => {
  const { core, context } = hostSlots()
  apply(context)
  core.register({ name: 'conversation.view', id: 'chat' }, () => null)
  const panel = core.entriesOfSlot('main').find(entry => entry.options.key === 'dsh-superagent')!.component as ComponentType<{ t: (key: string) => string }>
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => { root.render(createElement(panel, { t: key => key })) })
    expect(renderApp.mock.lastCall?.[0].renderSession).toBeTypeOf('function')
    expect(renderApp.mock.lastCall?.[0].renderContext).toBeUndefined()
    let removeContext!: () => void
    await act(async () => { removeContext = core.register({ name: 'conversation.view', id: 'context-manager' }, () => null) })
    expect(core.entriesOfSlot('conversation.view').map(entry => entry.options.id)).toContain('context-manager')
    expect(core.entriesOfSlot('superagent.session')).toHaveLength(1)
    await act(async () => { removeContext() })
    expect(renderApp.mock.lastCall?.[0].renderContext).toBeUndefined()
    expect(renderApp.mock.lastCall?.[0].renderSession).toBeTypeOf('function')
  } finally {
    await act(async () => { root.unmount() })
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous
  }
})

it('keeps the member header extensions in sync with the native frame and releases its own slots', async () => {
  const { installMemberFrame } = await import('../src/client/member-frame.tsx')
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    'main.conversation': { kind: 'single', scope: 'session-maybe' },
    'superagent.member.frame': { kind: 'single', scope: 'session-maybe' },
  } }, (_props: PropsRenderSlots<'main.conversation' | 'superagent.member.frame'>) => null)
  const stop = installMemberFrame(core)
  const detach = core.register({ name: 'main.conversation', children: {
    'conversation.header': { kind: 'single', scope: 'session-maybe' },
  } }, (_props: PropsRenderSlots<'conversation.header'>) => null)
  core.register({ name: 'conversation.header', children: {
    'conversation.header.leading': { kind: 'single', scope: 'root' },
    'conversation.session.header': { kind: 'single', scope: 'session' },
  } }, (_props: PropsRenderSlots<'conversation.header.leading' | 'conversation.session.header'>) => null)
  core.register({ name: 'conversation.session.header', children: {
    'conversation.session.header.actions': { kind: 'list', scope: 'session' },
  } }, (_props: PropsRenderSlots<'conversation.session.header.actions'>) => null)
  const local = 'superagent.member.frame.conversation.session.header.actions'
  const action = () => null
  const remove = core.register({ name: 'conversation.session.header.actions', id: 'executor' }, action)
  await vi.waitFor(() => expect(core.entriesOfSlot(local).map(entry => entry.component)).toEqual([action]))
  expect(core.specDynamic('superagent.member.frame.conversation.header.leading')).toBeUndefined()
  remove()
  await vi.waitFor(() => expect(core.entriesOfSlot(local)).toHaveLength(0))
  core.register({ name: 'conversation.session.header.actions', id: 'executor' }, action)
  stop()
  expect(core.specDynamic(local)).toBeUndefined()
  expect(core.entriesOfSlot('conversation.session.header.actions')[0]?.component).toBe(action)
  detach()
})
