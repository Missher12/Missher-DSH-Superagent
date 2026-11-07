import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Trigger } from '../src/core/index.ts'
import { CHAT, MEMBER, feishu, startRuntime, type Host } from './fixtures/host.ts'
import { githubKind } from '../src/sources/github.ts'
import { feishuKind } from '../src/sources/feishu.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('binds GitHub and Feishu intake to the configured local project using the DSH default permission', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  host.runtime.sources.register(githubKind); host.runtime.sources.register(feishuKind)
  const project = join(host.directory, 'project'), chatProject = join(host.directory, 'chat-project')
  mkdirSync(project); mkdirSync(chatProject)
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...settings, sources: { ...settings.sources,
    github: { enabled: true, config: { ...settings.sources.github!.config, workspaceDirectory: project } },
    feishu: { enabled: true, config: { ...settings.sources.feishu!.config, workspaceDirectory: chatProject,
      chats: [{ chatId: CHAT, listen: 'all' }] } },
  }, policy: { ...settings.policy, sources: { ...settings.policy.sources,
    github: { allowed: [{ id: 'alice' }], admission: {} }, feishu: { allowed: [{ id: MEMBER }], admission: {} } } } })
  const github: Trigger = { id: 'local-github-workspace', source: 'github', threads: [{ source: 'github', id: '42' }],
    actor: { source: 'github', id: 'alice' }, human: true, addressed: 'mention', at: new Date().toISOString(),
    text: 'Inspect the selected repository.', meta: { number: 42, isPr: false, kind: 'issue', directory: '/untrusted/path' } }
  host.runtime.receive(github)
  const accepted = host.runtime.engine.decide(github.id, { kind: 'accept', title: 'Inspect GitHub project', scope: github.text,
    name: 'github-inspect', reason: 'Allowed repository request' })
  await host.runtime.idle()
  expect(host.runtime.store.tickets.get(accepted.ticketId!)?.execution?.directory).toBe(realpathSync(project))
  expect(host.agents.has(`worker-${accepted.ticketId}`)).toBe(true)
  host.runtime.engine.stopTicket(accepted.ticketId!)
  const message = feishu('local-adapter-1', 'Inspect the selected project.')
  host.runtime.receive(message)
  const second = host.runtime.engine.decide(message.id, { kind: 'accept', title: 'Inspect Feishu project', scope: message.text,
    name: 'feishu-inspect', reason: 'Allowed chat request' })
  await host.runtime.idle()
  expect(host.runtime.store.tickets.get(second.ticketId!)?.execution?.directory).toBe(realpathSync(chatProject))
  expect(host.agents.has(`worker-${second.ticketId}`)).toBe(true)
})

it('does not poison local task prompts when an optional GitHub source has no connected account', async () => {
  host = await startRuntime(store => {
    const settings = store.settings()
    store.saveSettings({ ...settings, sources: { ...settings.sources, github: { enabled: false, config: {} } } })
  }, { mode: 'local' })
  host.runtime.sources.register(githubKind)
  expect(host.runtime.context(githubKind).configured()).toBe(false)
  const task = await host.runtime.local!.create({ requestId: 'disconnected-github', title: 'Local task', instructions: 'Read project.', directory: host.directory })
  await host.runtime.idle()
  expect(host.agents.has(task.sessionId)).toBe(true)
})

it('refuses local GitHub execution without a selected project instead of creating an empty control-directory workspace', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  host.runtime.sources.register(githubKind)
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...settings, policy: { ...settings.policy, sources: { ...settings.policy.sources,
    github: { allowed: [{ id: 'alice' }], admission: {} } } } })
  const trigger: Trigger = { id: 'missing-github-workspace', source: 'github', threads: [{ source: 'github', id: '43' }],
    actor: { source: 'github', id: 'alice' }, human: true, addressed: 'mention', at: new Date().toISOString(),
    text: 'Inspect the repository.', meta: { number: 43, isPr: false, kind: 'issue' } }
  host.runtime.receive(trigger)
  expect(() => host!.runtime.engine.decide(trigger.id, { kind: 'accept', title: 'Inspect project', scope: trigger.text,
    name: 'github-inspect', reason: 'Allowed request' })).toThrow(/工作区/)
  expect(host.runtime.store.tickets.list()).toHaveLength(0)
})
