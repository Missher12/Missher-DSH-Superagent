import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamRequestSchema } from '../src/teams/contracts.ts'
import { previewDeliveryFile } from '../src/teams/delivery.ts'
import { hasUnreadRequest } from '../src/core/index.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })
const request = () => TeamRequestSchema.parse({ requestId: 'team-one', title: '团队开发验收', instructions: '实现函数并验证结果。',
  members: [{ id: 'build', name: '实施', instructions: '实现函数', dependencies: [] },
    { id: 'check', name: '验证', instructions: '检查实现并运行测试', dependencies: ['build'] }] })
async function settle() { await host!.runtime.idle(); await host!.runtime.teams!.reconcile(); await host!.runtime.idle() }
async function readySession(ticketId: string) {
  await settle(); const session = `worker-${ticketId}`
  // A registered session can belong to an earlier round. Wait for this assignment and its durable input consumption.
  await vi.waitFor(async () => {
    await settle()
    expect(host!.runtime.store.tickets.get(ticketId)!.assignments.at(-1)?.startedAt).toBeTruthy()
    expect(host!.tools.get(session)).toBeDefined(); host!.step(session); await settle()
    expect(hasUnreadRequest(host!.runtime.store.tickets.get(ticketId)!)).toBe(false)
  }, { timeout: 8000, interval: 40 })
  return session
}
async function complete(ticketId: string, summary = '本成员分工完成', delivery?: object) {
  const session = await readySession(ticketId)
  await host!.runTool(session, 'orchestrator_report', { state: 'ready', summary, delivery: delivery ?? { files: [], checks: [], unverified: ['本回合未运行其他检查'] } })
  const agent = host!.agents.get(session)!
  agent.status = 'idle'; host!.ctx.emit('agent/status', { agent, status: 'idle' } as never)
  await settle()
}
async function nativeShellResult(sessionId: string, callId: string, value: Record<string, unknown>) {
  const agent = host!.ctx.agents.get(sessionId as never)!
  await agent.ctx.waterfall('tools/post-execute', { agent, callId, rootCallId: callId, name: 'pwsh', arguments: {},
    signal: new AbortController().signal, token: {} } as never, { isError: false, value, content: [] } as never,
  async () => ({ kind: 'accept' as const }))
}

it('pins the selected permission for both the coordinator and dependent members', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const result = await host.api('POST', 'local/teams', { ...request(), directory: host.directory, permissionPreset: 'read-only' })
  expect(result.status).toBe(200)
  const team = result.body as { id: string; coordinatorTicketId: string }
  const coordinator = await readySession(team.coordinatorTicketId)
  expect(host.ctx.permissionPresets.current((host.agents.get(coordinator) as unknown as { session: import('@deepseek-ai/dsh-session').Session }).session)).toBe('read-only')
  Object.defineProperty(host.ctx.permissionPresets, 'defaultPreset', { value: 'danger-full-access', configurable: true })
  await complete(team.coordinatorTicketId)
  const member = host.runtime.teams!.get(team.id).members.find(item => item.id === 'build')!
  const session = await readySession(member.ticketId!)
  expect(host.ctx.permissionPresets.current((host.agents.get(session) as unknown as { session: import('@deepseek-ai/dsh-session').Session }).session)).toBe('read-only')
}, 20_000)

it('adds an idempotent member to an existing team and preserves earlier sessions and dependency handoffs', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await complete(team.coordinatorTicketId!)
  const before = host.runtime.teams!.get(team.id)
  const plan = { id: 'research', name: '研究', instructions: '核对源文件与边界', dependencies: ['check'] }
  const result = await host.api('POST', `local/teams/${team.id}/members`, plan)
  expect(result.status).toBe(200)
  expect((await host.api('POST', `local/teams/${team.id}/members`, plan)).status).toBe(200)
  let view = host.runtime.teams!.get(team.id)
  expect(view.members).toHaveLength(4)
  expect(view.members.find(member => member.id === 'research')!.sessionId).toBeUndefined()
  expect(view.members.find(member => member.id === 'build')!.ticketId).toBe(before.members.find(member => member.id === 'build')!.ticketId)
  expect((await host.api('POST', `local/teams/${team.id}/members`, { ...plan, instructions: 'different' })).status).toBe(400)
  expect((await host.api('POST', `local/teams/${team.id}/members`, { ...plan, id: 'invalid', dependencies: ['unknown'] })).status).toBe(400)
  await complete(view.members.find(member => member.id === 'build')!.ticketId!)
  view = host.runtime.teams!.get(team.id)
  await complete(view.members.find(member => member.id === 'check')!.ticketId!)
  view = host.runtime.teams!.get(team.id)
  expect(view.members.find(member => member.id === 'research')!.ticketId).toBeTruthy()
  await complete(view.members.find(member => member.id === 'research')!.ticketId!)
  await complete(team.coordinatorTicketId!)
  expect(host.runtime.teams!.get(team.id).state).toBe('completed')
  host.runtime.teams!.stopTeam(team.id)
  expect((await host.api('POST', `local/teams/${team.id}/members`, { ...plan, id: 'later' })).status).toBe(400)
}, 40_000)

it('keeps finalization open until the coordinator supplies delivery evidence', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await complete(team.coordinatorTicketId!)
  await complete(host.runtime.teams!.get(team.id).members.find(member => member.id === 'build')!.ticketId!)
  await complete(host.runtime.teams!.get(team.id).members.find(member => member.id === 'check')!.ticketId!)
  const session = await readySession(team.coordinatorTicketId!)
  await host.runTool(session, 'orchestrator_report', { state: 'ready', summary: '没有给出结构化交付记录' })
  const agent = host.agents.get(session)!; agent.status = 'idle'; host.ctx.emit('agent/status', { agent, status: 'idle' } as never)
  await settle()
  let view = host.runtime.teams!.get(team.id)
  expect(view.state).toBe('attention')
  expect(view.completion?.issues.join(' ')).toContain('交付记录')
  await host.runtime.teams!.followup(team.id, 'coordinator', 'final-evidence', '补齐最终交付记录')
  await complete(team.coordinatorTicketId!, '最终复核完成', { files: [], checks: [], unverified: ['没有运行浏览器检查'] })
  view = host.runtime.teams!.get(team.id)
  expect(view.state).toBe('completed')
  expect(view.completion?.unverified).toContain('没有运行浏览器检查')
}, 40_000)

it('creates an explicit plan once, starts a real coordinator, and does not call a planning round a completed goal', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  expect(team.state).toBe('planning')
  expect(team.members.map(member => member.ticketId).filter(Boolean)).toHaveLength(1)
  expect((await host.runtime.teams!.create({ ...request(), directory: host.directory })).id).toBe(team.id)
  await expect(host.runtime.teams!.create({ ...request(), directory: host.directory, instructions: '另一项要求' })).rejects.toThrow('requestId')
  await complete(team.coordinatorTicketId!, '分工与依赖已核对，等待成员执行')
  const active = host.runtime.teams!.get(team.id)
  expect(active.state).not.toBe('completed')
  expect(active.members[0]!.state).toBe('waiting')
  expect(active.members.find(member => member.id === 'build')!.ticketId).toBeTruthy()
  expect(active.members.find(member => member.id === 'check')!.ticketId).toBeUndefined()
  expect(host.runtime.store.tickets.list()).toHaveLength(2)
  expect(host.runtime.store.tickets.get(active.members.find(member => member.id === 'build')!.ticketId!)!.mandate.scope).toContain('分工与依赖已核对，等待成员执行')
}, 20_000)

it('dispatches actual dependent work, delivers its predecessor report, and finishes only after a new coordinator summary', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await complete(team.coordinatorTicketId!)
  const build = host.runtime.teams!.get(team.id).members.find(member => member.id === 'build')!
  writeFileSync(join(host.directory, 'result.txt'), 'actual-team-output')
  await complete(build.ticketId!, '已生成真实文件 result.txt', { files: [{ path: 'result.txt', summary: '真实产出' }], unverified: ['尚未进行浏览器检查'] })
  const handoff = host.runtime.teams!.get(team.id)
  const check = handoff.members.find(member => member.id === 'check')!
  expect(check.ticketId).toBeTruthy()
  expect(handoff.handoffs).toEqual([expect.objectContaining({ from: 'build', to: 'check', ticketId: check.ticketId })])
  expect(host.runtime.store.tickets.get(check.ticketId!)!.mandate.scope).toContain('已生成真实文件 result.txt')
  const preset = (id: string) => host!.runtime.store.triggers.get(host!.runtime.store.tickets.get(id)!.origin.triggerId)!.meta.permissionPreset
  expect(preset(check.ticketId!)).toBe(preset(build.ticketId!))
  await complete(check.ticketId!, '已复核文件，检查仍未运行')
  expect(host.runtime.teams!.get(team.id).state).not.toBe('completed')
  expect(host.runtime.store.tickets.get(team.coordinatorTicketId!)!.assignments).toHaveLength(2)
  await complete(team.coordinatorTicketId!, '目标已经复核，交付 result.txt；未验证浏览器')
  const finished = host.runtime.teams!.get(team.id)
  expect(finished.state).toBe('completed')
  expect(finished.completedMembers).toBe(2)
  const file = realpathSync(join(host.directory, 'result.txt'))
  expect(finished.deliveries.find(delivery => delivery.memberId === 'build')!.record.files[0]).toMatchObject({ exists: true, path: file })
  expect(host.runtime.teams!.file(team.id, file)).toMatchObject({ text: 'actual-team-output' })
  writeFileSync(join(host.directory, 'large.txt'), '中文'.repeat(30_000))
  const large = realpathSync(join(host.directory, 'large.txt'))
  expect(previewDeliveryFile(host.directory, large, [large])).toMatchObject({ binary: false, truncated: true })
  await expect(host.api('GET', `local/teams/${team.id}/file?path=${encodeURIComponent('../outside.txt')}`)).resolves.toMatchObject({ status: 400 })
  await host.runtime.teams!.followup(team.id, 'build', 'later-change', '把产出改成第二版')
  expect(host.runtime.teams!.get(team.id).state).not.toBe('completed')
  await complete(build.ticketId!, '第二版已经完成')
  const updated = host.runtime.teams!.get(team.id)
  expect(host.runtime.store.tickets.get(check.ticketId!)!.ended).toBeUndefined()
  expect(updated.handoffs).toHaveLength(2)
  await complete(check.ticketId!, '已复核第二版')
  expect(host.runtime.teams!.get(team.id).state).not.toBe('completed')
  await complete(team.coordinatorTicketId!, '第二版目标复核完成')
  expect(host.runtime.teams!.get(team.id).state).toBe('completed')
  expect(host.runtime.store.tickets.list()).toHaveLength(3)
}, 40_000)

it('preserves finished work and shows the actual member needing a human instead of finishing the team', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const input = request(); input.members[1]!.dependencies = []
  const team = await host.runtime.teams!.create({ ...input, directory: host.directory })
  await complete(team.coordinatorTicketId!)
  let view = host.runtime.teams!.get(team.id)
  const first = view.members.find(member => member.id === 'build')!, second = view.members.find(member => member.id === 'check')!
  await complete(first.ticketId!, '文件实现已经完成')
  await readySession(second.ticketId!)
  await host.runTool(`worker-${second.ticketId}`, 'orchestrator_report', { state: 'blocked', summary: '验证环境尚未登录', human_action: '请登录测试环境后补充说明' })
  await settle(); view = host.runtime.teams!.get(team.id)
  expect(view.state).toBe('attention')
  expect(view.members.find(member => member.id === 'build')!.state).toBe('finished')
  expect(view.members.find(member => member.id === 'check')).toMatchObject({ state: 'attention', attention: '请登录测试环境后补充说明' })
  expect(host.runtime.store.tickets.get(team.coordinatorTicketId!)!.assignments).toHaveLength(1)
}, 20_000)

it('stops remaining team dispatch and never resumes manually stopped work through follow-ups', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await complete(team.coordinatorTicketId!)
  const stopped = host.runtime.teams!.stopTeam(team.id)
  await settle()
  expect(stopped.state).toBe('stopped')
  expect(host.runtime.store.tickets.list()).toHaveLength(2)
  expect(host.runtime.teams!.get(team.id).members.find(member => member.id === 'check')!.sessionId).toBeUndefined()
  await expect(host.runtime.teams!.followup(team.id, 'build', 'late', '继续')).rejects.toThrow('停止')
})

it('does not accept invented files or commands as successful delivery evidence', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'evidence', title: '核对证据', instructions: '实际检查', directory: host.directory })
  await host.runtime.idle(); host.step(task.sessionId)
  await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '完成', delivery: {
    files: [{ path: 'missing.txt' }],
  } })).rejects.toThrow('不存在')
  await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '完成', delivery: {
    checks: [{ command: 'node --test', outcome: 'passed' }],
  } })).rejects.toThrow('真实执行')
  expect(host.runtime.store.tickets.get(task.ticketId)!.ended).toBeUndefined()
  const agent = host.ctx.agents.get(task.sessionId as never)!
  host.ctx.emit('session/event', agent.session, { type: 'tool/call', time: Date.now(), data: {
    callId: 'actual-check', name: 'pwsh', arguments: JSON.stringify({ command: 'node --test' }),
  } } as never)
  await nativeShellResult(task.sessionId, 'actual-check', { exitCode: 0 })
  host.ctx.emit('session/event', agent.session, { type: 'tool/result', time: Date.now(), data: { message: { toolCallId: 'actual-check', isError: false } } } as never)
  await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '完成实际检查', delivery: {
    checks: [{ command: 'node --test', outcome: 'passed', details: '成员报告检查通过' }],
  } })
  expect(await host.api('GET', `tickets/${task.ticketId}`)).toMatchObject({ body: { deliveryReport: { checks: [{ toolCallId: 'actual-check', outcome: 'passed' }] } } })
  expect(await host.api('GET', 'local/workbench')).not.toHaveProperty('body.members.0.command')
})

it.each(['many later activities', 'released session bindings'])('keeps actual check evidence after %s', async circumstance => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'durable-evidence', title: '长任务交付', instructions: '运行检查并交付', directory: host.directory })
  await host.runtime.idle(); host.step(task.sessionId)
  const agent = host.ctx.agents.get(task.sessionId as never)!
  const emit = (type: string, seq: number, data: unknown) => host!.ctx.emit('session/event', agent.session,
    { type, seq, time: Date.now(), data } as never)
  emit('tool/call', 1, { callId: 'real-long-check', name: 'pwsh', arguments: JSON.stringify({ command: 'node --test' }) })
  await nativeShellResult(task.sessionId, 'real-long-check', { exitCode: 0 })
  emit('tool/result', 2, { message: { toolCallId: 'real-long-check', isError: false } })
  if (circumstance === 'many later activities') {
    for (let i = 0; i < 40; i++) {
      emit('tool/call', i * 2 + 3, { callId: `read-${i}`, name: 'read', arguments: JSON.stringify({ path: `source-${i}.mjs` }) })
      emit('tool/result', i * 2 + 4, { message: { toolCallId: `read-${i}`, isError: false } })
    }
  } else {
    host.runtime.sessions.dispose()
    await host.runtime.sessions.ensure(task.sessionId, host.directory, task.title, 'worker')
  }
  await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '已完成真实检查及后续核对',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })
  expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
  expect(await host.api('GET', `tickets/${task.ticketId}`)).toMatchObject({ body: {
    deliveryReport: { checks: [{ toolCallId: 'real-long-check', outcome: 'passed' }] },
  } })
})

it('keeps check evidence after a runtime restart but never reuses it for a later assignment', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'proof-restart', title: '验证恢复', instructions: '检查文件', directory: host.directory })
  await host.runtime.idle(); host.step(task.sessionId)
  const agent = host.ctx.agents.get(task.sessionId as never)!
  for (const event of [
    { type: 'tool/call', seq: 1, data: { callId: 'before-restart', name: 'pwsh', arguments: JSON.stringify({ command: 'node --test' }) } },
    { type: 'tool/result', seq: 2, data: { message: { toolCallId: 'before-restart', isError: false } } },
  ]) {
    if (event.type === 'tool/result') await nativeShellResult(task.sessionId, 'before-restart', { exitCode: 0 })
    host.ctx.emit('session/event', agent.session, { ...event, time: Date.now() } as never)
  }
  const first = host.runtime.store.tickets.get(task.ticketId)!.assignments.at(-1)!
  await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '检查完成',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })
  const directory = host.directory
  await host.runtime.stop(); host = await startRuntime(undefined, { mode: 'local', stateDir: directory })
  expect(host.runtime.sessions.commandEvidence(task.sessionId, 'node --test', first.startedAt!)).toMatchObject({ id: 'before-restart', state: 'done' })
  await host.runtime.local!.followup(task.ticketId, 'new-assignment', '继续检查新的更改')
  await host.runtime.idle(); host.step(task.sessionId)
  await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '不能沿用旧检查',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })).rejects.toThrow('真实执行')
  expect(host.runtime.store.tickets.get(task.ticketId)!.ended).toBeUndefined()
}, 20_000)

it('uses the latest command result even when call IDs sort differently and activity has moved on', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'latest-proof', title: '最新检查结果', instructions: '检查代码', directory: host.directory })
  await host.runtime.idle(); host.step(task.sessionId)
  const agent = host.ctx.agents.get(task.sessionId as never)!
  for (const [index, callId, failed] of [[1, 'z-passed', false], [3, 'a-failed', true]] as const) {
    host.ctx.emit('session/event', agent.session, { type: 'tool/call', seq: index, time: Date.now(), data: {
      callId, name: 'pwsh', arguments: JSON.stringify({ command: 'node --test' }),
    } } as never)
    await nativeShellResult(task.sessionId, callId, { exitCode: failed ? 7 : 0 })
    host.ctx.emit('session/event', agent.session, { type: 'tool/result', seq: index + 1, time: Date.now(),
      data: { message: { toolCallId: callId, isError: failed } } } as never)
  }
  for (let index = 0; index < 40; index++) host.ctx.emit('session/event', agent.session, { type: 'tool/call', seq: index + 5,
    time: Date.now(), data: { callId: `read-${index}`, name: 'read', arguments: '{}' } } as never)
  await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '不应通过',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })).rejects.toThrow('执行出错')
  await host.runTool(task.sessionId, 'orchestrator_report', { state: 'failed', summary: '最新检查失败',
    delivery: { checks: [{ command: 'node --test', outcome: 'failed' }] } })
  expect(await host.api('GET', `tickets/${task.ticketId}`)).toMatchObject({ body: {
    deliveryReport: { checks: [{ toolCallId: 'a-failed', outcome: 'failed' }] },
  } })
})

it.each([{ exitCode: 7 }, { exitCode: 0, aborted: true }])('rejects passed checks for a native unsuccessful result %j', async value => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'canonical-failure', title: '真实退出状态', instructions: '执行检查', directory: host.directory })
  await host.runtime.idle(); host.step(task.sessionId)
  const agent = host.ctx.agents.get(task.sessionId as never)!
  host.ctx.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: Date.now(), data: {
    callId: 'shell-with-exit', name: 'pwsh', arguments: JSON.stringify({ command: 'node --test' }),
  } } as never)
  await nativeShellResult(task.sessionId, 'shell-with-exit', value)
  // DSH can render a non-zero process exit as a successful tool transport result.
  host.ctx.emit('session/event', agent.session, { type: 'tool/result', seq: 2, time: Date.now(),
    data: { message: { toolCallId: 'shell-with-exit', isError: false } } } as never)
  await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '不能误报',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })).rejects.toThrow('执行出错')
  expect(host.runtime.store.tickets.get(task.ticketId)!.ended).toBeUndefined()
})

it.each([0, 7])('waits for the actual background process settlement with exit %i', async exitCode => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'background-proof', title: '后台检查', instructions: '等待真实检查', directory: host.directory })
  await host.runtime.idle(); host.step(task.sessionId)
  const agent = host.ctx.agents.get(task.sessionId as never)!
  host.ctx.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: Date.now(), data: {
    callId: 'background-check', name: 'pwsh', arguments: JSON.stringify({ command: 'node --test' }),
  } } as never)
  await nativeShellResult(task.sessionId, 'background-check', { jobId: 'native-job', status: 'running' })
  host.ctx.emit('session/event', agent.session, { type: 'tool/result', seq: 2, time: Date.now(),
    data: { message: { toolCallId: 'background-check', isError: false } } } as never)
  await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '还没有完成',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })).rejects.toThrow('真实执行结束')
  host.ctx.emit('session/event', agent.session, { type: 'job/settled', seq: 3, time: Date.now(), data: {
    jobId: 'native-job', owner: agent.id, kind: 'pwsh', toolCall: { callId: 'background-check', rootCallId: 'background-check' },
    status: 'completed', producerReported: true, cause: 'producer', detail: `exit code: ${exitCode}`,
  } } as never)
  if (exitCode) await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '不能误报',
    delivery: { checks: [{ command: 'node --test', outcome: 'passed' }] } })).rejects.toThrow('执行出错')
  await host.runTool(task.sessionId, 'orchestrator_report', { state: exitCode ? 'failed' : 'ready', summary: '后台检查已经实际结束',
    delivery: { checks: [{ command: 'node --test', outcome: exitCode ? 'failed' : 'passed' }] } })
  expect(await host.api('GET', `tickets/${task.ticketId}`)).toMatchObject({ body: {
    deliveryReport: { checks: [{ toolCallId: 'background-check', exitCode }] },
  } })
  expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe(exitCode ? undefined : 'completed')
})

it('rejects unknown members and cyclic delivery dependencies before creating any task', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const input = request(); input.members[0]!.dependencies = ['check']
  await expect(host.runtime.teams!.create({ ...input, directory: host.directory })).rejects.toThrow('循环')
  expect(host.runtime.store.tickets.list()).toHaveLength(0)
})

it('restores a persisted team without redispatching its completed planning round or duplicating members', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create({ ...request(), directory: host.directory })
  await complete(team.coordinatorTicketId!)
  const before = host.runtime.teams!.get(team.id), directory = host.directory
  await host.runtime.stop()
  host = await startRuntime(undefined, { mode: 'local', stateDir: directory })
  await settle()
  const restored = host.runtime.teams!.get(team.id)
  expect(restored.members.map(member => member.ticketId)).toEqual(before.members.map(member => member.ticketId))
  expect(restored.state).not.toBe('completed')
  expect(host.runtime.store.tickets.list()).toHaveLength(2)
}, 20_000)
