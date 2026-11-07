import { afterEach, expect, it } from 'vitest'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('shows the dedicated control workspace and only real Superagent sessions without starting more work', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const sessions = host.agents.size
  const result = await host.api('GET', 'local/workbench')
  expect(result).toMatchObject({ status: 200, body: {
    workspace: { directory: host.directory },
    members: [{ id: host.runtime.masterId, role: 'orchestrator', state: 'idle' }],
    tasks: [], activity: [],
  } })
  expect(host.agents.size).toBe(sessions)
  expect(host.runtime.store.tickets.list()).toHaveLength(0)
})

it('reports live tool activity without disclosing tool arguments and clears running tools when the session idles', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const task = await host.runtime.local!.create({ requestId: 'workbench-live', title: '检查当前项目', instructions: '读取项目说明', directory: host.directory })
  await host.runtime.idle()
  const agent = host.ctx.agents.get(task.sessionId as SessionId)!
  host.ctx.emit('session/event', agent.session, { type: 'tool/call', seq: 30, time: Date.now(),
    data: { turn: 1, step: 1, callId: 'live-call', name: 'bash', arguments: '{"command":"SECRET_EXAMPLE"}' } } as never)
  const live = await host.api('GET', 'local/workbench')
  expect(live).toMatchObject({ status: 200, body: {
    members: expect.arrayContaining([expect.objectContaining({ id: task.sessionId, role: 'worker', state: 'running', taskId: task.ticketId,
      title: '检查当前项目', directory: realpathSync(host.directory), tools: [{ id: 'live-call', name: 'bash', state: 'running', at: expect.any(String) }] })]),
    activity: expect.arrayContaining([expect.objectContaining({ kind: 'tool', memberId: task.sessionId, tool: 'bash' })]),
  } })
  expect(JSON.stringify(live)).not.toContain('SECRET_EXAMPLE')
  host.agents.get(task.sessionId)!.status = 'idle'
  host.ctx.emit('agent/status', { agent, status: 'idle' })
  const idle = await host.api('GET', 'local/workbench')
  expect((idle.body as { members: { id: string; tools: { state: string }[] }[] }).members.find(member => member.id === task.sessionId)?.tools)
    .not.toEqual(expect.arrayContaining([expect.objectContaining({ state: 'running' })]))
})

it('keeps a disabled MCP application’s readable identity on its past task activity', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const mcp = host.runtime.mcp!
  const project = join(host.directory, 'project'); mkdirSync(project)
  const ctx = host.ctx, control = ctx.workspaceRegistry.list()[0]!
  ctx.workspaceRegistry.list = () => [control, { id: 'test-project', title: 'Project', path: project }] as ReturnType<typeof ctx.workspaceRegistry.list>
  const connection = await mcp.createClient({ name: '编辑器测试应用', workspaceIds: ['test-project'] })
  const principal = mcp.authenticate(connection.token)!
  const task = await mcp.create(principal, { requestId: 'named-mcp-task', workspaceId: 'test-project', title: '检查来源身份', instructions: '读取项目说明' })
  await host.runtime.idle()
  await mcp.setEnabled(connection.client.id, false)
  const result = await host.api('GET', 'local/workbench')
  expect(result).toMatchObject({ status: 200, body: {
    activity: expect.arrayContaining([expect.objectContaining({ kind: 'received', ticketId: task.ticketId,
      actor: expect.objectContaining({ name: { zh: '编辑器测试应用', en: '编辑器测试应用' } }) })]),
  } })
  expect(JSON.stringify(result)).not.toContain(connection.token)
})
