import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Trigger } from '../src/core/index.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('binds an external task to its configured workspace and permission rather than message metadata', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const project = join(host.directory, 'project')
  const other = join(host.directory, 'other')
  mkdirSync(project); mkdirSync(other)
  const kind: SourceKind<{ directory: string; permissionPreset: string }> = {
    kind: 'external', title: { zh: 'MCP', en: 'MCP' }, description: { zh: 'MCP', en: 'MCP' },
    schema: z.object({ directory: z.string().default(project), permissionPreset: z.string().default('workspace-write') }),
    fields: [], health: [], workspace: (_trigger, config) => config,
  }
  host.runtime.sources.register(kind)
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...settings, policy: { ...settings.policy, sources: { ...settings.policy.sources,
    external: { allowed: [{ id: 'client' }], admission: {} } } } })
  const trigger: Trigger = { id: 'external-workspace', source: 'external', threads: [{ source: 'external', id: 'client:one' }],
    actor: { source: 'external', id: 'client' }, human: true, addressed: 'direct', at: new Date().toISOString(),
    text: 'Inspect the selected project.', meta: { directory: other, permissionPreset: 'danger-full-access' } }
  host.runtime.receive(trigger)
  const accepted = host.runtime.engine.decide(trigger.id, { kind: 'accept', title: 'Inspect project', scope: trigger.text,
    name: 'external-task', reason: 'Explicit request from an allowed client' })
  expect(accepted.ticketId).toBeTruthy()
  await host.runtime.idle()
  const ticket = host.runtime.store.tickets.get(accepted.ticketId!)!
  expect(ticket.execution?.directory).toBe(realpathSync(project))
  const agent = host.agents.get(`worker-${ticket.id}`)! as unknown as { session: import('@deepseek-ai/dsh-session').Session }
  expect(host.ctx.permissionPresets.current(agent.session)).toBe('workspace-write')
})

it('serializes local and external tasks in one project and preserves the accepted binding across configuration changes', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const project = join(host.directory, 'project')
  const other = join(host.directory, 'other')
  mkdirSync(project); mkdirSync(other)
  host.runtime.sources.register({ kind: 'external', title: { zh: 'MCP', en: 'MCP' }, description: { zh: 'MCP', en: 'MCP' },
    schema: z.object({ directory: z.string().default(project), permissionPreset: z.string().default('workspace-write') }),
    fields: [], health: [], workspace: (_trigger, config) => config,
  })
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 2 },
    policy: { ...settings.policy, sources: { ...settings.policy.sources, external: { allowed: [{ id: 'client' }], admission: {} } } } })
  const first = await host.runtime.local!.create({ requestId: 'local-first', title: 'Local task', instructions: 'Inspect README.', directory: project })
  await host.runtime.idle()
  const trigger: Trigger = { id: 'external-second', source: 'external', threads: [{ source: 'external', id: 'client:second' }],
    actor: { source: 'external', id: 'client' }, human: true, addressed: 'direct', at: new Date().toISOString(), text: 'Check the project.', meta: {} }
  host.runtime.receive(trigger)
  const accepted = host.runtime.engine.decide(trigger.id, { kind: 'accept', title: 'External task', scope: trigger.text,
    name: 'external-task', reason: 'Explicit client request' })
  expect(accepted.ticketId).toBeTruthy()
  await host.runtime.idle()
  expect(host.agents.has(`worker-${accepted.ticketId}`)).toBe(false)
  const current = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...current, sources: { ...current.sources,
    external: { enabled: true, config: { directory: other, permissionPreset: 'danger-full-access' } } } })
  host.runtime.local!.stop(first.ticketId)
  await host.runtime.idle()
  await vi.waitFor(() => expect(host!.agents.has(`worker-${accepted.ticketId}`)).toBe(true), { timeout: 7000 })
  const second = host.runtime.store.tickets.get(accepted.ticketId!)!
  expect(second.execution?.directory).toBe(realpathSync(project))
  const agent = host.agents.get(`worker-${second.id}`)! as unknown as { session: import('@deepseek-ai/dsh-session').Session }
  expect(agent).toBeDefined()
  expect(host.ctx.permissionPresets.current(agent.session)).toBe('workspace-write')
}, 10000)
