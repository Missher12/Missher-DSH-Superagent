import { mkdirSync, realpathSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

describe('DSH local task source', () => {
  it('adopts a native composer message once and keeps its original inbox message until it is read', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const task = await host.runtime.local!.create({ requestId: 'native-composer', title: '原生输入', instructions: '实现原要求', directory: host.directory })
    await host.runtime.idle(); host.step(task.sessionId)
    const agent = host.agents.get(task.sessionId)!
    const message = { id: 'native-input-one', role: 'user', content: [{ type: 'text', text: '补齐原生输入要求' }], source: { type: 'user-rpc', kind: 'user', rpcId: 'native-rpc-one' } }
    host.ctx.emit('agent/inbox/inserted', { agent, message } as never)
    agent.steer(message as never)
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.inputs).toContainEqual(expect.objectContaining({ human: true, readAt: null }))
    await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '旧结果' })).rejects.toThrow(/unread|pending/)
    host.step(task.sessionId); await host.runtime.idle()
    await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '包含原生输入要求' })
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
    expect(agent.inbox.nextStep.filter(item => item.id === 'native-input-one')).toHaveLength(1)
    const count = host.runtime.store.tickets.get(task.ticketId)!.inputs.length
    host.ctx.emit('agent/inbox/inserted', { agent, message } as never)
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.inputs.length).toBe(count)
    const later = { ...message, id: 'native-input-two', content: [{ type: 'text', text: '完成后再补一条' }],
      source: { ...message.source, rpcId: 'native-rpc-two' } }
    host.ctx.emit('agent/inbox/inserted', { agent, message: later } as never)
    agent.steer(later as never); await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended).toBeUndefined()
    await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '过早完成' })).rejects.toThrow(/unread|pending/)
    host.step(task.sessionId); await host.runtime.idle()
    await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '完成后补充也已处理' })
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
  })
  it('restores report tools before a follow-up wakes an existing worker whose plugin bindings were released', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const task = await host.runtime.local!.create({ requestId: 'rebind', title: '恢复待回复会话', instructions: '等待补充要求', directory: host.directory })
    await host.runtime.idle(); host.step(task.sessionId)
    await host.runTool(task.sessionId, 'orchestrator_report', { state: 'blocked', summary: '等待确认', human_action: '请确认继续' })
    const agent = host.agents.get(task.sessionId)!
    agent.status = 'idle'; host.ctx.emit('agent/status', { agent, status: 'idle' } as never)
    await host.runtime.idle()
    // Plugin reloads release registrations while DSH retains the same Agent and Session objects.
    host.runtime.sessions.dispose()
    expect(host.tools.get(task.sessionId)!.has('orchestrator_report')).toBe(false)
    await host.runtime.local!.followup(task.ticketId, 'after-reload', '确认继续')
    await host.runtime.idle(); host.step(task.sessionId); await host.runtime.idle()
    expect(host.tools.get(task.sessionId)!.has('orchestrator_report')).toBe(true)
    await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '已处理补充要求', human_action: null })
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
    expect(host.runtime.store.tickets.list()).toHaveLength(1)
  })
  it('keeps task and session model choices separate from global task defaults and restores them', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const defaults = host.runtime.store.settings().executor.model
    const task = await host.runtime.local!.create({ requestId: 'model-choice', title: '选择模型', instructions: '检查说明',
      model: { provider: 'example', model: 'first' } })
    await host.runtime.idle()
    expect(host.runtime.sessions.model(task.sessionId)).toMatchObject({ provider: 'example', model: 'first' })
    const changed = await host.api('PUT', `local/sessions/${task.sessionId}/model`, { provider: 'example', model: 'second' })
    expect(changed).toMatchObject({ status: 200, body: { provider: 'example', model: 'second' } })
    expect(host.ctx.agents.get(task.sessionId as import('@deepseek-ai/dsh-session').SessionId)!.session.append).toHaveBeenCalledWith('model/selection', expect.objectContaining({ model: 'second' }))
    expect(host.runtime.store.settings().executor.model).toEqual(defaults)
    const directory = host.directory
    await host.runtime.stop()
    const second = await startRuntime(undefined, { mode: 'local', stateDir: directory })
    try {
      expect(second.runtime.sessions.model(task.sessionId)).toMatchObject({ provider: 'example', model: 'second' })
      expect((await second.runtime.local!.create({ requestId: 'model-default', title: '继承默认', instructions: '检查说明' })).ticketId).not.toBe(task.ticketId)
      expect(second.runtime.store.settings().executor.model).toEqual(defaults)
    } finally { await second.stop() }
  })
  it('keeps the real worker inbox and result relay live until a queued follow-up is consumed', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const task = await host.runtime.local!.create({ requestId: 'finish-race', title: '完成边界', instructions: '执行原要求', directory: host.directory })
    await host.runtime.idle()
    await host.runtime.local!.followup(task.ticketId, 'extra', '还要新增测试')
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.inputs).toContainEqual(expect.objectContaining({ human: true, readAt: null }))
    await expect(host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: 'Old result' })).rejects.toThrow(/pending|unread/)
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended).toBeUndefined()
    await expect(host.runTool(host.runtime.masterId, 'orchestrator_reply', { ticket_id: task.ticketId, purpose: 'result', text: 'Old result' })).rejects.toThrow(/not ready/)
    host.step(task.sessionId)
    await host.runtime.idle()
    await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '包含新增测试' })
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended?.outcome).toBe('completed')
    await host.runtime.local!.followup(task.ticketId, 'after', '完成后再补充')
    await host.runtime.idle()
    expect(host.runtime.store.tickets.get(task.ticketId)!.ended).toBeUndefined()
    expect(host.runtime.store.tickets.get(task.ticketId)!.assignments).toHaveLength(2)
  })
  it('creates an independent content-named task directory once when no project is selected', async () => {
    host = await startRuntime(undefined, { mode: 'local' })
    const request = { requestId: 'standalone', title: '../整理研究笔记 / 新任务', instructions: '生成笔记和测试。' }
    const task = await host.runtime.local!.create(request)
    expect(dirname(task.directory!)).toBe(realpathSync(join(host.directory, 'work')))
    expect(basename(task.directory!)).toMatch(/^task-整理研究笔记-新任务-/)
    expect(existsSync(task.directory!)).toBe(true)
    expect((await host.runtime.local!.create(request)).ticketId).toBe(task.ticketId)
    expect(readdirSync(join(host.directory, 'work'))).toHaveLength(1)
    await host.runtime.idle()
    expect((await host.api('GET', 'local/workbench'))).toMatchObject({ body: { workspace: { directory: realpathSync(join(host.directory, 'work')) } } })
  })
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
it('registers an explicitly named project through the workspace form API', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const directory = join(host.directory, 'named-project'); mkdirSync(directory)
  expect(await host.api('POST', 'local/workspaces', { directory, title: '协作项目' })).toMatchObject({ status: 200,
    body: { title: '协作项目', directory: realpathSync(directory) } })
  expect(host.runtime.local!.workspaces().find(item => item.directory === realpathSync(directory))?.title).toBe('协作项目')
  expect(host.runtime.store.tickets.list()).toHaveLength(0)
})
it('removes only a workspace registration and retains completed tasks, session logs and files', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const directory = join(host.directory, 'removable-project'); mkdirSync(directory)
  writeFileSync(join(directory, 'keep.txt'), 'keep this file')
  const workspace = await host.runtime.local!.addWorkspace(directory)
  const task = await host.runtime.local!.create({ requestId: 'removal-check', title: '完成后移除', instructions: '读取文件', directory })
  await host.runtime.idle(); host.step(task.sessionId)
  await host.runTool(task.sessionId, 'orchestrator_report', { state: 'ready', summary: '已核对文件' })
  await host.runtime.idle()
  await expect(host.runtime.local!.removeWorkspace(workspace.id)).rejects.toThrow('正在运行')
  const agent = host.agents.get(task.sessionId)!; agent.status = 'idle'
  host.ctx.emit('agent/status', { agent, status: 'idle' } as never)
  await host.runtime.idle()
  const original = host.runtime.store.tickets.get(task.ticketId)
  expect(await host.api('DELETE', `local/workspaces/${encodeURIComponent(workspace.id)}`)).toMatchObject({ status: 200, body: { removed: true } })
  expect(host.runtime.local!.workspaces().some(item => item.id === workspace.id)).toBe(false)
  expect(readFileSync(join(directory, 'keep.txt'), 'utf8')).toBe('keep this file')
  expect(host.runtime.store.tickets.get(task.ticketId)).toEqual(original)
  expect(host.agents.has(task.sessionId)).toBe(true)
  expect(await host.runtime.local!.removeWorkspace(workspace.id)).toEqual({ removed: false })
  expect(await host.runtime.local!.addWorkspace(directory)).toMatchObject({ directory: realpathSync(directory) })
})
it('refuses removal of the task root and a workspace with unfinished work', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const root = host.runtime.local!.workspaces().find(workspace => workspace.protected)!
  await expect(host.runtime.local!.removeWorkspace(root.id)).rejects.toThrow('任务根工作区')
  const directory = join(host.directory, 'active-project'); mkdirSync(directory)
  const workspace = await host.runtime.local!.addWorkspace(directory)
  await host.runtime.local!.create({ requestId: 'active-removal', title: '仍在运行', instructions: '核对文件', directory })
  await host.runtime.idle()
  expect(host.runtime.local!.workspaces().find(item => item.id === workspace.id)!.activeTasks).toBeGreaterThan(0)
  await expect(host.runtime.local!.removeWorkspace(workspace.id)).rejects.toThrow('未完成')
})
