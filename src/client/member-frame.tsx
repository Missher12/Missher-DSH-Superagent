import type { ComponentType, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotEntryDef, SlotMap, SlotSpec, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'superagent.member.frame': { kind: 'single'; scope: 'session-maybe' }
  }
}

type Outlet = (key: string, owner: object, options?: object) => ReactNode
type FrameProps = { renderSlot: Outlet; renderSlotChain: Outlet }
type Registry = Pick<Context['slots'], 'entriesOfSlot' | 'subscribe' | 'register'>
type ViewRegistration = StoredEntry['options'] & Pick<StoredEntry, 'store' | 'locale' | 'inject' | 'select' | 'children'> & { name: string }

const frame = 'superagent.member.frame'
const globalNavigation = 'conversation.header.leading'
const localName = (key: string) => key === 'main.conversation' ? frame : `${frame}.${key}`

/** rc.5 exposes the transcript as a factory and the full conversation frame as a slot.
 * Mount its registered components under the member's SessionProvider. Each header
 * extension gets its original store, locale and scope, with separately owned outlets.
 * The outer workspace already supplies global navigation. */
export function installMemberFrame(slots: Registry): () => void {
  function follow(source: keyof SlotMap & string): () => void {
    const mounted = new Map<StoredEntry, () => void>()
    const sync = () => {
      const entries = slots.entriesOfSlot(source)
      for (const [entry, dispose] of mounted) {
        if (!entries.includes(entry)) { dispose(); mounted.delete(entry) }
      }
      for (const entry of entries) {
        if (mounted.has(entry)) continue
        const Component = entry.component as ComponentType<FrameProps>
        const children: Record<string, SlotSpec<SlotEntryDef>> = {}
        const originals = Object.entries(entry.children ?? {}).filter(([key]) => key !== globalNavigation)
        for (const [key, spec] of originals) children[localName(key)] = spec
        const options: ViewRegistration = { ...entry.options, name: localName(source), children,
          store: entry.store, locale: entry.locale, inject: entry.inject, select: entry.select }
        const remap = (outlet: Outlet): Outlet => (key, owner, opts) =>
          key === globalNavigation ? null : outlet(localName(key), owner, opts)
        const Adapted = entry.children ? (props: FrameProps) =>
          <Component {...props} renderSlot={remap(props.renderSlot)} renderSlotChain={remap(props.renderSlotChain)} /> : Component
        // Registrations read from the live ledger are type-erased by the public API.
        // Each copied declaration retains the original scope, kind and owner props.
        const register = slots.register as (options: ViewRegistration, component: ComponentType<FrameProps>) => () => void
        const dispose = register.call(slots, options, Adapted)
        const nested: (() => void)[] = []
        try {
          for (const [key] of originals) nested.push(follow(key as keyof SlotMap & string))
        } catch (error) {
          for (const stop of nested.reverse()) stop()
          dispose()
          throw error
        }
        mounted.set(entry, () => { for (const stop of nested) stop(); dispose() })
      }
    }
    const unsubscribe = slots.subscribe(source, sync)
    const stop = () => { unsubscribe(); for (const dispose of mounted.values()) dispose(); mounted.clear() }
    try { sync() } catch (error) { stop(); throw error }
    return stop
  }
  return follow('main.conversation')
}
