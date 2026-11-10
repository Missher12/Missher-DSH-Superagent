// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { TeamView } from '../src/teams/contracts.ts'
import { usePanel, mount, all, click, type, field, text, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'
import { zh } from '../src/client/locales.ts'

usePanel()
const team = (): TeamView => ({ id: 'explicit-team', name: '真实团队', title: '实现并验证格式化器', instructions: '实现格式化函数，交付文件与检查记录。',
  directory: '/tmp/project', state: 'working', createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:02:00Z', coordinatorTicketId: 'planner-task',
  completedMembers: 1, memberCount: 2, summary: '', handoffs: [], deliveries: [], members: [
    { id: 'coordinator', name: '协调', role: 'coordinator', instructions: '核对分工与最终目标', dependencies: [], state: 'waiting', ticketId: 'planner-task', sessionId: 'worker-planner-task', summary: '规划完成，等待成员交付', retry: false, tools: [], events: [] },
    { id: 'build', name: '实施', role: 'member', instructions: '完成格式化器', dependencies: [], state: 'finished', ticketId: 'build-task', sessionId: 'worker-build-task', summary: '已经实现函数', retry: false, tools: [], events: [] },
    { id: 'check', name: '验证', role: 'member', instructions: '运行测试', dependencies: ['build'], state: 'attention', ticketId: 'check-task', sessionId: 'worker-check-task', summary: '等待测试环境登录', attention: '请登录测试环境', retry: false,
      tools: [{ id: 'read-source', name: 'read', at: '2026-11-10T01:02:00Z', state: 'done', detail: 'formatter.mjs' }], events: [] },
  ] })
beforeEach(() => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }; server.renderSessions = true
  server.teamViews['explicit-team'] = team(); server.nextTeamId = 'explicit-team'
  at({ page: 'overview' })
})
it('shows only explicit teams and keeps legacy tasks separate from team collaborators', async () => {
  await mount()
  expect(all('.dt-team-overview-item')).toHaveLength(1)
  expect(text()).toContain('单成员任务')
  expect(all('.dt-team-node')).toHaveLength(0)
  await click(all('.dt-team-overview-item')[0]!)
  expect(all('.dt-team-node')).toHaveLength(3)
  expect(text()).toContain('协调回合已结束，团队仍在等待成员交付')
  expect(all('.dt-team-count-line')[0]!.textContent).not.toContain('目标完成')
})
it('opens the selected actual member session and sends its durable follow-up through the team route', async () => {
  at({ page: 'overview', query: { team: 'explicit-team', member: 'check' } })
  await mount()
  expect(all('.dt-team-details')[0]!.textContent).toContain('请登录测试环境')
  await click('上下文')
  expect(all('.dt-team-detail-content [data-test-context="worker-check-task"]')).toHaveLength(1)
  expect(all('[data-test-session]')).toHaveLength(0)
  await click('打开执行会话')
  expect(all('.dt-team-native-controls button[aria-label="打开执行会话"]')).toHaveLength(0)
  await click('活动'); expect(text()).toContain('formatter.mjs')
  expect(all('.dt-team-native-controls button[aria-label="打开执行会话"]')).toHaveLength(1)
  await click('打开执行会话')
  expect(all('[data-test-session="worker-check-task"]')).toHaveLength(1)
  expect(all('.dt-team-native-controls button[aria-label="打开执行会话"]')).toHaveLength(0)
  expect(field<HTMLSelectElement>(zh.sessionModelLabel)).toBeDefined()
  await type(field<HTMLTextAreaElement>('补充要求'), '已经登录，请继续验证')
  await click('发送')
  expect(server.requests.find(item => item.path === 'local/teams/explicit-team/followup')?.body).toMatchObject({ memberId: 'check', text: '已经登录，请继续验证' })
})
it('keeps the context plugin bound to the newly selected member', async () => {
  at({ page: 'overview', query: { team: 'explicit-team', member: 'coordinator' } })
  await mount(); await click('上下文')
  expect(all('[data-test-context="worker-planner-task"]')).toHaveLength(1)
  vi.spyOn(all('.dt-team-focus-workbench')[0]!, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect)
  await click(all('.dt-team-node')[1]!)
  expect(all('[data-test-context="worker-build-task"]')).toHaveLength(1)
  expect(all('[data-test-context="worker-planner-task"]')).toHaveLength(0)
})
it('creates a real editable team plan including member models and explicit delivery dependencies', async () => {
  await mount(); await click('新建任务')
  expect(field<HTMLSelectElement>('协作方式').value).toBe('team')
  await type(field<HTMLTextAreaElement>('任务要求'), '修复格式化函数并验证边界')
  await type(field<HTMLInputElement>('团队名称'), '格式化小队')
  const firstRole = all('.dt-team-plan-member')[0]!
  await type(firstRole.querySelector('textarea')!, '实现 formatLabel')
  await type(firstRole.querySelector('select')!, JSON.stringify(['worker-provider', 'worker-model']))
  await click('派出任务')
  expect(server.requests.find(item => item.path === 'local/teams' && item.method === 'POST')?.body).toMatchObject({ name: '格式化小队',
    members: [{ id: 'build', instructions: '实现 formatLabel', model: { provider: 'worker-provider', model: 'worker-model' } }, { id: 'check', dependencies: ['build'] }] })
  expect(all('[role="dialog"]')).toHaveLength(0)
  expect(all('.dt-team-node')).toHaveLength(3)
})
it('opens new member fields immediately instead of hiding the required empty assignment', async () => {
  await mount(); await click('新建任务'); await click('添加成员')
  const member = all('.dt-team-plan-member').at(-1)!
  expect(member.hasAttribute('open')).toBe(true)
  expect(member.querySelector('textarea')?.value).toBe('')
})
it('keeps a new member expanded and focused while entering, clearing, and rewriting the assignment', async () => {
  await mount(); await click('新建任务'); await click('添加成员')
  const member = all('.dt-team-plan-member').at(-1)! as HTMLDetailsElement
  const assignment = member.querySelector('textarea')!
  assignment.focus()
  for (const value of ['z', '整理接口文档并验证示例', '', '重新填写完整分工']) {
    await type(assignment, value)
    expect(member.open).toBe(true)
    expect(document.activeElement).toBe(assignment)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  }
  const draft = JSON.parse(sessionStorage.getItem('dsh-superagent/local-draft')!)
  expect(draft.members[2].instructions).toBe('重新填写完整分工')
})
it('keeps activity previews short while leaving full reports in the original task', async () => {
  const view = server.teamViews['explicit-team']!, member = view.members[1]!
  const report = '已完成格式化功能。' + '详细实现和逐项解释。'.repeat(35) + '完整记录末尾'
  member.summary = report
  member.events = [{ id: 'report-long', at: view.updatedAt, state: 'ready', summary: report }]
  at({ page: 'overview', query: { team: view.id, member: member.id } })
  await mount(); await click('活动')
  const activity = all('.dt-team-member-activity')[0]!
  expect(activity.textContent).toContain('已完成格式化功能')
  expect(activity.textContent).not.toContain('完整记录末尾')
  expect(activity.textContent!.length).toBeLessThan(320)
  expect(member.summary).toBe(report)
  expect(all('button').some(button => button.textContent === '在 DSH 中打开')).toBe(true)
})
it('closes all workspace views without stopping tasks and reopens the same member from its task card', async () => {
  at({ page: 'overview', query: { team: 'explicit-team', member: 'check' } })
  await mount()
  await click('关闭全部工作区')
  expect(text()).toContain('请打开一个工作区')
  expect(text()).toContain('真实团队')
  expect(all('[data-test-session]')).toHaveLength(0)
  expect(server.requests.some(item => /\/stop$/.test(item.path))).toBe(false)
  await click(all('.dt-team-overview-item')[0]!)
  expect(all('.dt-team-workspace-tab')).toHaveLength(1)
  expect(text()).not.toContain('请打开一个工作区')
})
it('returns from management pages to the selected task and member while keeping an explicitly closed workspace empty', async () => {
  at({ page: 'overview', query: { team: 'explicit-team', member: 'build' } })
  await mount()
  for (const page of ['任务', '工作区', '设置']) {
    await click(page)
    await click('工作台')
    expect(all('[data-test-session="worker-build-task"]')).toHaveLength(1)
    expect(JSON.parse(sessionStorage.getItem('dsh-superagent/route')!).route.query).toEqual({ team: 'explicit-team', member: 'build' })
  }
  await click('关闭全部工作区')
  await click('设置'); await click('工作台')
  expect(text()).toContain('请打开一个工作区')
  expect(all('[data-test-session]')).toHaveLength(0)
})
it('reviews actual reported files and commands without inventing approvals or passed checks', async () => {
  const view = server.teamViews['explicit-team']!
  view.deliveries = [{ memberId: 'build', name: '实施', record: { ticketId: 'build-task', assignmentId: 'run-build', sessionId: 'worker-build-task', at: view.updatedAt,
    files: [{ path: '/tmp/project/formatter.mjs', summary: '格式化器实现', exists: true }], checks: [], unverified: ['尚未检查 Windows'] } }]
  server.teamFiles['/tmp/project/formatter.mjs'] = { path: '/tmp/project/formatter.mjs', relative: 'formatter.mjs', size: 22, text: 'export const actual = 1', binary: false, truncated: false }
  at({ page: 'overview', query: { team: 'explicit-team', member: 'build' } }); await mount(); await click('交付结果')
  expect(text()).toContain('尚未检查 Windows')
  expect(text()).toContain('尚未提供结构化检查记录')
  expect(text()).not.toContain('成员报告通过')
  expect(all('button').some(button => /批准|approve/i.test(button.textContent ?? ''))).toBe(false)
  await click(all('.dt-team-details .dt-team-files button')[0]!)
  expect(all('[role="dialog"]')).toHaveLength(1)
  expect(text()).toContain('export const actual = 1')
})
