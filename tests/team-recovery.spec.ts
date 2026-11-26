import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { KV } from '../src/kv.ts'
import { TeamRequestSchema } from '../src/teams/contracts.ts'
import { hasUnreadRequest } from '../src/core/index.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })
const request = () => TeamRequestSchema.parse({ requestId: 'audit-recovery', title: '隔离恢复检查', instructions: '实现函数并独立验证',
  members: [{ id: 'build', name: '实施', instructions: '实现函数', dependencies: [] },
    { id: 'check', name: '审核', instructions: '独立检验', dependencies: ['build'] }] })
async function settle() { await host!.runtime.idle(); await host!.runtime.teams!.reconcile(); await host!.runtime.idle() }
async function ready(ticketId: string) {
  const session = `worker-${ticketId}`
  await vi.waitFor(async () => {
    await settle()
    expect(host!.runtime.store.tickets.get(ticketId)!.assignments.at(-1)?.startedAt).toBeTruthy()
    expect(host!.tools.get(session)).toBeDefined()
    host!.step(session); await settle()
    expect(hasUnreadRequest(host!.runtime.store.tickets.get(ticketId)!)).toBe(false)
  }, { timeout: 8000, interval: 40 })
  return session
}
async function report(ticketId: string, state: string, extras = {}) {
  const session = await ready(ticketId)
  await host!.runTool(session, 'orchestrator_report', { state, summary: state === 'failed' ? '模型请求 HTTP 400，执行失败' : '隔离状态检查',
    ...(state === 'ready' ? { delivery: { files: [], checks: [], unverified: ['仅隔离调度，未调用模型'] } } : {}), ...extras })
  const agent = host!.agents.get(session)!
  agent.status = 'idle'; host!.ctx.emit('agent/status', { agent, status: 'idle' } as never)
  await settle()
}
it('intake commander receives a human answer and clears its pending attention', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  const id = team.commander!.ticketId!
  await report(id, 'blocked', { human_action: '请选择输出文件名' })
  const before = host.runtime.store.tickets.get(id)!
  await host.runtime.teams!.followup(team.id, '$commander', 'audit-human-answer', '文件名用 result.mjs，请继续。')
  await settle()
  const after = host.runtime.store.tickets.get(id)!
  const view = host.runtime.teams!.get(team.id)
  expect.soft(after.attention, '答复应清除总指挥等待答复状态').toBeUndefined()
  expect(after.inputs.length, '答复应送入当前接单总指挥').toBeGreaterThan(before.inputs.length)
})

it('recovers an intake answer retained by the older version after a reload', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  const id = team.commander!.ticketId!
  await report(id, 'blocked', { human_action: '请选择输出文件名' })
  const ticket = host.runtime.store.tickets.get(id)!
  const origin = host.runtime.store.triggers.get(ticket.origin.triggerId)!
  const answer = { ...origin, id: 'legacy-intake-answer', text: '文件名使用 result.mjs，请继续。', at: new Date().toISOString() }
  host.runtime.store.triggers.save(answer)
  host.runtime.teams!.inputReceived(id, false, answer)
  const directory = host.directory
  await host.runtime.stop(); host = await startRuntime(undefined, { mode: 'local', stateDir: directory })
  await settle()
  const resumed = host.runtime.store.tickets.get(id)!
  expect(resumed.attention).toBeUndefined()
  expect(resumed.inputs.some(input => input.kind === 'trigger' && input.triggerId === answer.id)).toBe(true)
  await settle()
  expect(host.runtime.store.tickets.get(id)!.inputs.filter(input => input.kind === 'trigger' && input.triggerId === answer.id)).toHaveLength(1)
})

it.each(['coordinator', 'build'])('team retry starts a new attempt for an actually failed %s', async role => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await report(team.commander!.ticketId!, 'ready')
  let view = host.runtime.teams!.get(team.id)
  if (role === 'build') { await report(view.coordinatorTicketId!, 'ready'); view = host.runtime.teams!.get(team.id) }
  const id = view.members.find(member => member.id === role)!.ticketId!
  await report(id, 'failed')
  const before = host.runtime.store.tickets.get(id)!
  const response = await host.api('POST', `local/teams/${team.id}/retry`)
  await settle()
  const after = host.runtime.store.tickets.get(id)!
  expect(response.status).toBe(200)
  expect(after.assignments.length, '团队重试应重派失败成员').toBeGreaterThan(before.assignments.length)
}, 30_000)

it('a failed intake commander projects a failed team state with a visible retry', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await report(team.commander!.ticketId!, 'failed')
  const view = host.runtime.teams!.get(team.id)
  expect.soft(view.commander!.state).toBe('failed')
  expect(view.state).toBe('failed')
})

it('the ticket retry control really restarts a failed commander', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  const id = team.commander!.ticketId!
  await report(id, 'failed')
  const before = host.runtime.store.tickets.get(id)!
  const response = await host.api('POST', `tickets/${id}/retry`)
  await settle(); await ready(id)
  const after = host.runtime.store.tickets.get(id)!
  expect(response.status).toBe(200)
  expect(after.assignments).toHaveLength(before.assignments.length + 1)
  expect(after.assignments.at(-1)?.startedAt).toBeTruthy()
})

it('a failed final-report commander projects failure instead of silently waiting', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory, members: [] })
  const commander = team.commander!.ticketId!
  await report(commander, 'ready')
  const planner = host.runtime.teams!.get(team.id).coordinatorTicketId!
  await report(planner, 'ready')
  await report(planner, 'ready')
  expect(host.runtime.teams!.get(team.id).phase).toBe('reporting')
  await report(commander, 'failed')
  const view = host.runtime.teams!.get(team.id)
  expect.soft(view.commander!.state).toBe('failed')
  expect(view.state).toBe('failed')
}, 30_000)

it('shows a failed external final reply and retries that receipt without repeating the team', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  let sendAttempts = 0, offline = true
  host.runtime.sources.register({ kind: 'external', title: { zh: '外部', en: 'External' }, description: { zh: '隔离回传检查', en: 'Audit' },
    schema: z.object({}).strict(), fields: [], health: [],
    workspace: () => ({ directory: host!.directory, permissionPreset: 'read-only' }),
    channel: { link: () => ({ url: '', label: { zh: '原线程', en: 'Thread' } }), send: async () => { sendAttempts++; if (offline) throw new Error('Audit: external delivery temporarily offline'); return 'sent' } } })
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...settings, sources: { ...settings.sources, external: { enabled: true, config: {}, execution: 'team' } },
    policy: { ...settings.policy, sources: { ...settings.policy.sources, external: { allowed: [{ id: 'human' }], admission: {} } } } })
  const trigger = { id: 'audit-external', source: 'external', threads: [{ source: 'external', id: 'original' }],
    actor: { source: 'external', id: 'human' }, human: true, addressed: 'direct' as const, at: new Date().toISOString(), text: '检查项目，不修改文件。', meta: {},
    channel: { source: 'external', thread: 'external:original', address: {} } }
  host.runtime.receive(trigger)
  host.runtime.engine.decide(trigger.id, { kind: 'accept', title: '隔离外部回传检查', scope: trigger.text, name: 'audit-external', reason: '授权检查' })
  await settle()
  let team = host.runtime.teams!.get(host.runtime.teams!.list()[0]!.id)
  team = await host.runtime.teams!.updatePlan(team.id, { revision: team.planRevision!, members: [] })
  await report(team.commander!.ticketId!, 'ready')
  const planner = host.runtime.teams!.get(team.id).coordinatorTicketId!
  await report(planner, 'ready')
  await ready(planner)
  const context = host.runtime.teams!.contextFor(planner)!
  await report(planner, 'ready', { team_review: { ...context.token, decision: 'pass', reason: '隔离流程检查通过', targets: [], evidence: [context.ownEvidence] } })
  await report(team.commander!.ticketId!, 'ready')
  await host.runtime.sendReplies(); await settle()
  const view = host.runtime.teams!.get(team.id)
  const pending = host.runtime.store.receipts.waiting().filter(message => message.ticketId === view.sourceTicketId && message.kind === 'reply')
  expect(sendAttempts).toBeGreaterThan(0)
  expect(pending).toHaveLength(1)
  expect(view.state).toBe('completed')
  expect(view.completion!.commander).toBe(true)
  expect(view.error).toBeUndefined()
  expect(view.sourceDelivery).toMatchObject({ state: 'retrying', attempts: 1, error: expect.stringContaining('offline') })
  const assignments = host.runtime.store.tickets.get(planner)!.assignments.length
  offline = false
  const response = await host.api('POST', `local/teams/${team.id}/delivery/retry`)
  expect(response.status).toBe(200)
  expect(host.runtime.teams!.get(team.id).sourceDelivery).toMatchObject({ state: 'sent' })
  expect(host.runtime.store.receipts.waiting().filter(message => message.ticketId === view.sourceTicketId && message.kind === 'reply')).toHaveLength(0)
  expect(host.runtime.store.tickets.get(planner)!.assignments).toHaveLength(assignments)
  const sentAttempts = sendAttempts
  await host.api('POST', `local/teams/${team.id}/delivery/retry`)
  expect(sendAttempts).toBe(sentAttempts)
}, 30_000)


it('replaces only a reserved dispatcher id and reuses its successor after restart', async () => {
  const reserved = 'orchestrator-retired'
  host = await startRuntime(store => store.set(KV.runtime.masterId, reserved), { mode: 'local' }, reserved)
  const replacement = host.runtime.masterId, directory = host.runtime.machine.stateDir
  expect(replacement).not.toBe(reserved)
  expect(host.agents.has(reserved)).toBe(false)
  expect(host.agents.has(replacement)).toBe(true)
  expect(host.runtime.store.get(KV.runtime.masterId)).toBe(replacement)
  await host.runtime.stop()
  host = await startRuntime(undefined, { mode: 'local', stateDir: directory }, reserved)
  expect(host.runtime.masterId).toBe(replacement)
}, 30000)
