// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { usePanel, mount, click, text, all, type, at } from './fixtures/panel.tsx'
import { server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
beforeEach(() => { server.setup = { ...server.setup, mode: 'local', accounts: null } })
it('changes the selected embedded session model without leaving the workspace', async () => {
  server.renderSessions = true
  at({ page: 'overview', query: { session: 'master' } })
  await mount()
  await type(all('select[aria-label="会话模型"]')[0] as unknown as HTMLSelectElement, JSON.stringify(['worker-provider', 'worker-model']))
  expect(server.requests.find(item => item.method === 'PUT' && item.path === 'local/sessions/master/model')?.body)
    .toEqual({ provider: 'worker-provider', model: 'worker-model' })
  expect(server.opened).toEqual([])
  expect(all('[data-test-session="master"]')).toHaveLength(1)
  await click('上下文')
  expect(all('[data-test-context="master"]')).toHaveLength(1)
  expect(all('[data-test-session]')).toHaveLength(0)
  await click('会话')
  expect(all('[data-test-session="master"]')).toHaveLength(1)
})

it('opens the real dedicated workspace and coordinator session from the workbench', async () => {
  await mount()
  expect(all('[role="tab"][aria-selected="true"]').map(tab => tab.textContent)).toEqual(['工作台'])
  await click('打开专属工作区')
  expect(server.openedWorkspaces).toEqual(['superagent-space'])
  await click('共享任务调度')
  await click('在 DSH 中打开')
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
  at({ page: 'overview', query: { session: 'all-single' } })
  await mount()
  expect(text()).toContain('另一项派单')
  await click('执行器：检查路径')
  expect(text()).toContain('读取文件')
  expect(text()).toContain('测试应用')
  expect(text()).not.toContain('另一项派单')
  await click('在 DSH 中打开')
  expect(server.opened).toEqual(['worker-live'])
  server.ticketDetails['task-live'] = { ...server.ticketDetails.t1!, id: 'task-live', title: '检查路径', sessionId: 'worker-live', local: true }
  await click('查看任务')
  expect(text()).toContain('返回任务')
})

it('opens single-task file links inside the workbench and keeps the task navigation in one sidebar', async () => {
  server.renderSessions = true
  const path = '/tmp/project/result.txt'
  server.workbench.members.push({ id: 'worker-files', role: 'worker', state: 'finished', title: '交付文件', directory: '/tmp/project',
    taskId: 'task-files', tools: [], files: [{ path, summary: '输出', exists: true }] })
  server.teamFiles[path] = { path, relative: 'result.txt', size: 18, text: 'actual task output', binary: false, truncated: false }
  at({ page: 'overview', query: { session: 'worker-files' } }); await mount()
  const link = document.createElement('button'), opened: string[] = []
  link.type = 'button'; link.title = 'result.txt'; link.textContent = 'result.txt'
  link.addEventListener('click', () => opened.push('unmounted sidebar'))
  all('[data-test-session="worker-files"]')[0]!.append(link); await click(link)
  expect(text()).toContain('actual task output')
  expect(opened).toEqual([])
  expect(all('.dt-workbench-members')).toHaveLength(0)
  expect(all('.dt-team-sidebar')).toHaveLength(1)
})

it('shows a pending session without mixing other tasks’ activity into its workspace', async () => {
  server.renderSessions = true
  server.workbench.activity = [{ id: 'unrelated', kind: 'report', at: '2026-11-11T01:00:00Z', memberId: 'master', title: '另一项任务', summary: '不属于选中任务的活动' }]
  at({ page: 'overview', query: { session: 'worker-not-started' } }); await mount()
  expect(text()).toContain('该成员尚未创建执行会话')
  expect(text()).not.toContain('不属于选中任务的活动')
})
