// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { usePanel, mount, click, text, all } from './fixtures/panel.tsx'
import { server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
beforeEach(() => { server.setup = { ...server.setup, mode: 'local', accounts: null } })

it('opens the real dedicated workspace and coordinator session from the workbench', async () => {
  await mount()
  expect(all('[role="tab"][aria-selected="true"]').map(tab => tab.textContent)).toEqual(['工作台'])
  await click('打开专属工作区')
  expect(server.openedWorkspaces).toEqual(['superagent-space'])
  await click('调度')
  await click('打开会话')
  expect(server.opened).toEqual(['master'])
  expect(text()).toContain('等待派单')
  expect(text()).not.toContain('审核员')
})

it('filters activity by actual executor identity and opens its task or conversation', async () => {
  server.workbench.members.push({ id: 'worker-live', role: 'worker', state: 'running', title: '检查路径', directory: '/tmp/project',
    taskId: 'task-live', tools: [{ id: 'read-1', name: 'read', state: 'running', at: '2026-11-08T00:00:00Z' }],
    actor: { source: 'mcp', id: 'test-app', name: { zh: '测试应用', en: 'Test app' } } })
  server.workbench.tasks = [ticketSummary({ id: 'task-live', title: '检查路径', sessionId: 'worker-live', directory: '/tmp/project' })]
  server.workbench.activity = [
    { id: 'tool-1', kind: 'tool', at: '2026-11-08T00:00:00Z', memberId: 'worker-live', ticketId: 'task-live', title: '检查路径', tool: 'read', state: 'running' },
    { id: 'received-1', kind: 'received', at: '2026-11-07T23:59:00Z', memberId: 'master', title: '另一项派单' },
  ]
  await mount()
  expect(text()).toContain('另一项派单')
  await click('执行器：检查路径')
  expect(text()).toContain('读取文件')
  expect(text()).toContain('测试应用')
  expect(text()).not.toContain('另一项派单')
  await click('打开会话')
  expect(server.opened).toEqual(['worker-live'])
  server.ticketDetails['task-live'] = { ...server.ticketDetails.t1!, id: 'task-live', title: '检查路径', sessionId: 'worker-live', local: true }
  await click('查看任务')
  expect(text()).toContain('返回任务')
})
