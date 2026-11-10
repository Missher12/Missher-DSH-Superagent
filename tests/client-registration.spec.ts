import { expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply } from '../src/client/index.tsx'

it('registers alongside the native conversation without redeclaring its slots', () => {
  const core = new SlotCore()
  core.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' }, 'plugins.row.config': { kind: 'keyed', scope: 'root' } } },
  (_props: PropsRenderSlots<'main' | 'sidebar.panellist' | 'plugins.row.config'>) => null)
  core.register({ name: 'main', key: 'native', children: { 'conversation.session': { kind: 'single', scope: 'session' } } },
    (_props: PropsRenderSlots<'conversation.session'>) => null)
  const context = { effect: (effect: () => unknown) => effect(), locale: { register: () => () => {}, bind: () => (key: string) => key },
    slots: { inject: (_name: string, effect: () => unknown) => effect(), register: core.register.bind(core) } }
  expect(() => apply(context as unknown as Parameters<typeof apply>[0])).not.toThrow()
})
