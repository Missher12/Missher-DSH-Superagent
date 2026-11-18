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

it('offers context only while its native conversation view is registered', async () => {
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
    expect(renderApp.mock.lastCall?.[0].renderContext).toBeTypeOf('function')
    await act(async () => { removeContext() })
    expect(renderApp.mock.lastCall?.[0].renderContext).toBeUndefined()
    expect(renderApp.mock.lastCall?.[0].renderSession).toBeTypeOf('function')
  } finally {
    await act(async () => { root.unmount() })
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous
  }
})
