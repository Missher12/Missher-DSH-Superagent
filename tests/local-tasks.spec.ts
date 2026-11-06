import { mkdirSync, realpathSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

describe('DSH local task source', () => {
  it('serves the same local prompt defaults to the main session and panel after a custom version is saved', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    host.runtime.prompts.save({ ...host.runtime.prompts.current().config, communication: 'A saved custom notification rule.' }, 0, 'panel')
    let text = '', offset: number | null = 0
    while (offset !== null) {
      const page = await host.runTool(host.runtime.masterId, 'orchestrator_read', { resource: 'prompts/defaults', offset, limit: 8000 }) as {
        text: string; next_offset: number | null
      }
      text += page.text; offset = page.next_offset
    }
    const defaults = JSON.parse(text).config
    expect(defaults.scope).toContain('Execute only tasks explicitly dispatched by the user.')
    expect(defaults.skills.local).toContain('omit pr_number')
    expect(defaults.communication).not.toBe('A saved custom notification rule.')
    expect(await host.api('GET', 'prompts')).toMatchObject({ status: 200, body: { defaults } })
  })

  it('keeps waiting tickets separate from tickets needing a person', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const task = await host.runtime.local!.create({ requestId: 'board-idle', title: '等待后续要求', instructions: '检查说明', directory: host.directory })
    await host.runtime.idle()
    const agent = host.agents.get(`worker-${task.ticketId}`)!
    agent.status = 'idle'
    host.ctx.emit('agent/status', { agent, status: 'idle' } as never)
    await vi.waitFor(() => expect(host!.runtime.store.tickets.get(task.ticketId)!.assignments.at(-1)?.report?.state).toBe('waiting'))
    expect(await host.api('GET', 'local/board?column=attention')).toMatchObject({ status: 200, body: { total: 0, items: [] } })
    expect(await host.api('GET', 'local/board?column=idle')).toMatchObject({ status: 200,
      body: { total: 1, items: [{ id: task.ticketId, stage: 'idle' }] } })
  })

  it('creates one task in the chosen workspace, preserves permissions, and rejects reused IDs with changed scope', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const local = host.runtime.local
    expect(local).toBeDefined()
    const request = { requestId: 'first-request', title: '修复按钮间距', instructions: '只修改按钮间距，并说明验证结果。', directory: host.directory }
    const task = await local!.create(request)
    await host.runtime.idle()
    const ticket = host.runtime.store.tickets.get(task.ticketId)!
    expect(ticket.execution?.directory).toBe(realpathSync(host.directory))
    expect(host.ctx.permissionPresets.current((host.agents.get(`worker-${task.ticketId}`) as unknown as { session: import('@deepseek-ai/dsh-session').Session }).session)).toBe('workspace-write')
    expect((await local!.create(request)).ticketId).toBe(task.ticketId)
    expect(host.runtime.store.tickets.list()).toHaveLength(1)
    await expect(local!.create({ ...request, instructions: '顺便重写整个页面' })).rejects.toThrow(/request|请求/i)
    expect(host.runtime.store.tickets.list()).toHaveLength(1)
  })

  it('routes follow-ups only to their task and a manual stop prevents further execution', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const local = host.runtime.local
    expect(local).toBeDefined()
    const one = await local!.create({ requestId: 'one', title: '第一个任务', instructions: '检查项目说明', directory: host.directory })
    const two = await local!.create({ requestId: 'two', title: '第二个任务', instructions: '检查另一个文件', directory: host.directory })
    await host.runtime.idle()
    await local!.followup(one.ticketId, 'follow-one', '只处理 README')
    await host.runtime.idle()
    const oneInputs = host.runtime.store.tickets.get(one.ticketId)!.inputs
    const twoInputs = host.runtime.store.tickets.get(two.ticketId)!.inputs
    expect(oneInputs.some(input => input.kind === 'trigger' && host!.runtime.store.triggers.get(input.triggerId)?.text === '只处理 README')).toBe(true)
    expect(twoInputs.some(input => input.kind === 'trigger' && host!.runtime.store.triggers.get(input.triggerId)?.text === '只处理 README')).toBe(false)
    local!.stop(one.ticketId)
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(one.ticketId)!.ended?.by).toBe('human')
    await expect(local!.followup(one.ticketId, 'after-stop', '继续')).rejects.toThrow(/stop|停止/i)
  })

  it('rejects missing directories and paused intake without leaving an unfinished task', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const local = host.runtime.local
    expect(local).toBeDefined()
    await expect(local!.create({ requestId: 'missing', title: '检查', instructions: '检查', directory: `${host.directory}/missing` })).rejects.toThrow()
    await host.runtime.settings.pause(true, 'panel')
    await expect(local!.create({ requestId: 'paused', title: '检查', instructions: '检查', directory: host.directory })).rejects.toThrow(/pause|暂停/i)
    expect(host.runtime.store.tickets.list()).toHaveLength(0)
  })

  it('persists ready results and returns the result to the originating DSH session once', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    await host.controller.create({ sessionId: 'origin' })
    const task = await host.runtime.local!.create({ requestId: 'return-result', title: '检查说明', instructions: '检查 README', directory: host.directory, originSessionId: 'origin' })
    await host.runtime.idle()
    await host.runTool(`worker-${task.ticketId}`, 'orchestrator_report', { state: 'ready', summary: '已检查 README，未修改文件。' })
    await host.runtime.idle()
    const send = () => host!.runTool(host!.runtime.masterId, 'orchestrator_reply', { ticket_id: task.ticketId, purpose: 'result', text: '已检查 README，未修改文件。' })
    await send(); await send(); await host.runtime.idle()
    expect(host.runtime.local!.get(task.ticketId).messages.filter(message => message.kind === 'reply')).toHaveLength(1)
    const origin = host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === 'origin')
    expect(origin).toHaveLength(1)
    expect(origin[0]!.text).toContain('已检查 README，未修改文件。')
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
  })

  it('keeps the task and request identity when the runtime restarts', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const request = { requestId: 'restart-request', title: '检查工作区', instructions: '读取说明', directory: host.directory }
    const task = await host.runtime.local!.create(request)
    await host.runtime.idle()
    await host.runtime.stop()
    const second = await startRuntime(undefined, { mode: 'local', stateDir: host.directory })
    try {
      expect(second.runtime.local!.get(task.ticketId).title).toBe('检查工作区')
      expect((await second.runtime.local!.create(request)).ticketId).toBe(task.ticketId)
      expect(second.runtime.store.tickets.list()).toHaveLength(1)
    } finally { await second.stop() }
  })

  it('queues tasks sharing a local directory even when more worker slots are available', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const settings = host.runtime.store.settings()
    host.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 2 } })
    const first = await host.runtime.local!.create({ requestId: 'same-one', title: '第一个修改', instructions: '修改第一个文件', directory: host.directory })
    const second = await host.runtime.local!.create({ requestId: 'same-two', title: '第二个修改', instructions: '修改第二个文件', directory: host.directory })
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(first.ticketId)!.assignments.at(-1)!.state).toBe('running')
    expect(host.runtime.store.tickets.get(second.ticketId)!.assignments.at(-1)!.state).toBe('pending')
    host.runtime.local!.stop(first.ticketId)
  })

  it('keeps running conversations visible beyond a full page of queued tasks and moves failures and stops to their own columns', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const local = host.runtime.local!
    const first = await local.create({ requestId: 'board-running', title: '正在执行的任务', instructions: '检查说明', directory: host.directory })
    const queued = []
    for (let index = 0; index < 22; index++) queued.push(await local.create({ requestId: `board-queue-${index}`,
      title: `排队任务 ${index}`, instructions: '检查另一个文件', directory: host.directory }))
    await host.runtime.idle()
    expect(await host.api('GET', 'local/board?column=running&limit=1')).toMatchObject({ status: 200,
      body: { total: 1, next_offset: null, items: [{ id: first.ticketId, sessionId: `worker-${first.ticketId}`, stage: 'working' }] } })
    expect(await host.api('GET', 'local/board?column=queued&limit=1')).toMatchObject({ status: 200,
      body: { total: 22, next_offset: 1, items: [{ stage: 'working', action: 'queued', sessionId: '' }] } })
    expect(await host.api('GET', `local/board?column=queued&q=${encodeURIComponent('排队任务 21')}&limit=1`)).toMatchObject({ status: 200,
      body: { total: 1, next_offset: null, items: [{ id: queued[21]!.ticketId }] } })
    await host.runTool(`worker-${first.ticketId}`, 'orchestrator_report', { state: 'failed', summary: '执行失败，需要检查配置' })
    await host.runtime.idle()
    expect(await host.api('GET', 'local/board?column=attention')).toMatchObject({ status: 200,
      body: { total: 1, items: [{ id: first.ticketId, stage: 'person', action: 'failed' }] } })
    local.stop(queued[0]!.ticketId)
    await host.runtime.idle()
    expect(await host.api('GET', 'local/board?column=ended')).toMatchObject({ status: 200,
      body: { total: 1, items: [{ id: queued[0]!.ticketId, ended: { outcome: 'stopped' } }] } })
  })

  it('keeps a worker permission reduction when its session is resolved again', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    await host.controller.create({ sessionId: 'permission-origin' })
    const origin = host.agents.get('permission-origin') as unknown as { session: import('@deepseek-ai/dsh-session').Session }
    host.ctx.permissionPresets.set(origin.session, 'danger-full-access')
    const task = await host.runtime.local!.create({ requestId: 'permissions', title: '检查', instructions: '检查说明', directory: host.directory, originSessionId: 'permission-origin' })
    await host.runtime.idle()
    const worker = host.agents.get(`worker-${task.ticketId}`) as unknown as { session: import('@deepseek-ai/dsh-session').Session }
    host.ctx.permissionPresets.set(worker.session, 'workspace-write')
    await host.runtime.sessions.ensure(`worker-${task.ticketId}`, host.directory, '检查', 'worker')
    expect(host.ctx.permissionPresets.current(worker.session)).toBe('workspace-write')
  })

  it('continues a completed local task once when the user sends a follow-up', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const task = await host.runtime.local!.create({ requestId: 'continue', title: '检查说明', instructions: '读取说明', directory: host.directory })
    await host.runtime.idle()
    await host.runTool(`worker-${task.ticketId}`, 'orchestrator_report', { state: 'ready', summary: '已读取说明' })
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
    await host.runtime.local!.followup(task.ticketId, 'next-step', '再总结三个要点')
    await host.runtime.local!.followup(task.ticketId, 'next-step', '再总结三个要点')
    await host.runtime.idle()
    const continued = host.runtime.store.tickets.get(task.ticketId)!
    expect(continued.ended).toBeUndefined()
    expect(continued.inputs.filter(input => input.kind === 'trigger' && host!.runtime.store.triggers.get(input.triggerId)?.text === '再总结三个要点')).toHaveLength(1)
    expect(host.runtime.store.tickets.list()).toHaveLength(1)
  })
})

it('registers an existing project as a DSH workspace without dispatching a task', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const directory = `${host.directory}/workspace-project`
  mkdirSync(directory)
  expect(await host.api('POST', 'local/workspaces', { directory })).toMatchObject({ status: 200,
    body: { id: realpathSync(directory), title: 'workspace-project', directory: realpathSync(directory) } })
  expect(host.runtime.store.tickets.list()).toHaveLength(0)
  expect((await host.api('POST', 'local/workspaces', { directory: `${directory}/missing` })).status).toBeGreaterThanOrEqual(400)
})
