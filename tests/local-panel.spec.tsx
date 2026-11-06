// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { usePanel, mount, remount, all, click, type, field, text, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
it('lets the user dispatch a local task and sends follow-up requirements to that task', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('新建任务')
  await type(field<HTMLInputElement>('任务标题'), '检查设置页')
  await type(field<HTMLSelectElement>('选择已有工作区'), '/tmp/work')
  await type(field<HTMLTextAreaElement>('任务要求'), '检查并修复已有按钮的对齐问题')
  await click('派出任务')
  expect(server.requests.find(item => item.path === 'local/tasks')?.body).toMatchObject({ title: '检查设置页', directory: '/tmp/work', instructions: '检查并修复已有按钮的对齐问题' })
  expect(text()).toContain('检查设置页')
  await type(field<HTMLTextAreaElement>('补充要求'), '保持现有配色')
  await click('发送补充')
  expect(server.requests.find(item => item.path === 'local/tasks/local-test/followup')?.body).toMatchObject({ text: '保持现有配色' })
})

it('opens directly on tasks and keeps local navigation understandable', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  expect(all('[role="tab"]').map(tab => tab.textContent)).toEqual(['任务', '设置', '使用帮助'])
  expect(text()).not.toContain('打开主 Session')
  await click('使用帮助')
  expect(text()).toContain('交给 Superagent 后台执行')
  expect(text()).toContain('DSH 关闭后')
  expect(text()).toContain('Git / MCP')
})

it('preserves an unfinished task draft across panel navigation and generates a title when omitted', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('新建任务')
  await type(field<HTMLInputElement>('工作区目录'), '/tmp/work')
  await type(field<HTMLTextAreaElement>('任务要求'), '分析登录失败的原因\n先分析，不改文件。')
  await click('使用帮助')
  await remount()
  await click('任务')
  expect(field<HTMLTextAreaElement>('任务要求').value).toContain('分析登录失败')
  await click('派出任务')
  expect(server.requests.find(item => item.path === 'local/tasks')?.body).toMatchObject({ title: '分析登录失败的原因' })
})

it('shows the latest usable result once and folds technical records away', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('新建任务')
  await type(field<HTMLInputElement>('工作区目录'), '/tmp/work')
  await type(field<HTMLTextAreaElement>('任务要求'), '检查项目说明')
  await click('派出任务')
  const task = server.ticketDetails['local-test']!
  task.summary = '执行器原始报告，稍后有简明结果'
  task.messages = [{ id: 'reply', kind: 'reply', text: '已检查说明，发现两个需要补充的地方。', at: '2026-09-24T00:00:00Z' }]
  task.stage = 'ended'
  task.ended = { by: 'executor', outcome: 'completed', reason: 'completed', at: '2026-09-24T00:00:00Z' }
  await remount()
  expect(text().split('已检查说明，发现两个需要补充的地方。')).toHaveLength(2)
  expect(text()).not.toContain('执行器原始报告')
  expect(text()).not.toContain('策略版本')
  expect(all('details').every(details => !details.hasAttribute('open'))).toBe(true)
  expect(text()).toContain('继续执行')
})

it('offers local settings without external-account and watcher configuration', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  at({ page: 'settings', query: { group: 'source' } })
  await mount()
  expect(text()).toContain('同时执行的任务数')
  expect(text()).toContain('任务模型')
  expect(text()).not.toContain('飞书机器人')
  expect(text()).not.toContain('准备命令')
  expect(text()).not.toContain('接单策略')
  await type(field<HTMLInputElement>('同时执行的任务数'), '2')
  await click('保存')
  expect(server.settings.executor.maxWorkers).toBe(2)
})

it('explains paused dispatch and restores task intake with one action', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  server.settings.paused = true
  await mount()
  expect(all('button').find(button => button.textContent === '新建任务')?.hasAttribute('disabled')).toBe(true)
  expect(text()).toContain('正在运行的任务会继续')
  await click('恢复派单')
  expect(server.settings.paused).toBe(false)
  await click('新建任务')
  expect(field<HTMLTextAreaElement>('任务要求')).toBeDefined()
})

it('prepares a stopped task as a new draft without silently dispatching it', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('新建任务')
  await type(field<HTMLInputElement>('工作区目录'), '/tmp/work')
  await type(field<HTMLTextAreaElement>('任务要求'), '只读取说明')
  await click('派出任务')
  const task = server.ticketDetails['local-test']!
  task.stage = 'ended'
  task.ended = { by: 'human', outcome: 'stopped', at: '2026-09-24T00:00:00Z' }
  task.actions = { retry: false, stop: false }
  await remount()
  await click('重新派单')
  expect(field<HTMLTextAreaElement>('任务要求').value).toBe('只读取说明')
  expect(field<HTMLInputElement>('工作区目录').value).toBe('/tmp/work')
  expect(server.requests.filter(item => item.method === 'POST' && item.path === 'local/tasks')).toHaveLength(1)
})
