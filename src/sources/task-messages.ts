/** Durable task results shared by local and external task entry points; retains the existing storage keys. */
import type { Store } from '../app/store.ts'
import type { OutboundMessage } from '../core/index.ts'
import { family } from '../kv.ts'

export interface TaskMessage { id: string; text: string; kind: OutboundMessage['kind']; at: string }
const messages = family<TaskMessage[]>('local-messages:')
type Host = { store: Pick<Store, 'get' | 'set' | 'atomic'> }
export const taskMessages = (host: { store: Pick<Store, 'get'> }, id: string): TaskMessage[] => host.store.get(messages(id)) ?? []
export function rememberTaskMessage(host: Host, id: string, message: OutboundMessage): void {
  host.store.atomic(() => {
    const previous = taskMessages(host, id)
    if (!previous.some(item => item.id === message.id)) host.store.set(messages(id), [...previous,
      { id: message.id, text: message.text, kind: message.kind, at: new Date().toISOString() }])
  })
}
