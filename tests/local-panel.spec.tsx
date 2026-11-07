// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, all, click, type, field, text, at } from './fixtures/panel.tsx'
import { server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
beforeEach(() => at({ page: 'execution' }))
it('shows every runtime error and does not claim to be ready while a problem needs attention', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  server.health = { models: { state: 'error', detail: '模型暂时不可用' }, reply: { state: 'error', detail: '结果投递失败' } }
  await mount()
  expect(text()).toContain('模型暂时不可用')
  expect(text()).toContain('结果投递失败')
  expect(all('.dt-local-status')[0]?.textContent).toContain('需处理')
  expect(all('.dt-local-status')[0]?.textContent).not.toContain('就绪')
})

it('shows waiting tasks separately without treating them as requests for human attention', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  server.tickets.open = [ticketSummary({ id: 'waiting-for-trigger', title: '等待下一步要求' }, { stage: 'idle' })]
  await mount()
  const waiting = all('section[aria-label="等待触发"]')[0]
  expect(waiting).toBeDefined()
  expect(waiting?.textContent).toContain('等待下一步要求')
  expect(all('section[aria-label="待处理"]')[0]?.textContent).not.toContain('等待下一步要求')
})

it('edits, previews and saves upstream prompts from local settings without changing executor settings', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  server.settings.executor.maxWorkers = 3
  at({ page: 'settings' })
  await mount()
  expect(all('.dt-prompt-nav')).toHaveLength(0)
  const entry = all('button').find(item => item.getAttribute('aria-label') === zh['settingsGroup.prompts'])
  expect(entry, 'Local settings expose the upstream prompt editor').toBeDefined()
  await click(entry!)
  await type(field<HTMLTextAreaElement>(zh.promptBody), 'Keep local task results concise.')
  await click(zh.promptViewFull)
  expect(text()).toContain('Keep local task results concise.')
  await click(zh.promptViewHistory)
  expect(text()).toContain('版本 0')
  await click(zh.promptViewEdit)
  await click(zh.save)
  expect(server.prompts.current.config.communication).toBe('Keep local task results concise.')
  expect(server.settings.executor.maxWorkers).toBe(3)
  expect(server.requests.some(item => item.path.startsWith('settings/') && item.method === 'PUT')).toBe(false)
})

it('resets the built-in work instructions to local defaults rather than GitHub workflow instructions', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  const localWork = 'Work only inside the selected existing workspace.'
  const config = { ...server.prompts.current.config, overrides: { 'runtime/work': { text: localWork } } }
  server.prompts.defaults = config
  server.prompts.current.config = config
  at({ page: 'settings' })
  await mount()
  const entry = all('button').find(item => item.getAttribute('aria-label') === zh['settingsGroup.prompts'])
  expect(entry, 'Local settings expose the upstream prompt editor').toBeDefined()
  await click(entry!)
  const part = all('.dt-prompt-nav .dt-nav-item').find(item => item.querySelector('span')?.firstChild?.textContent === zh['promptPart.runtime/work'])
  expect(part).toBeDefined()
  expect(part!.querySelector('.dt-changed-tag')).toBeNull()
  await click(part!)
  await type(field<HTMLTextAreaElement>(zh.promptBody), 'A temporary local customization.')
  expect(part!.querySelector('.dt-changed-tag')).not.toBeNull()
  await click(zh.promptResetSection)
  expect(field<HTMLTextAreaElement>(zh.promptBody).value).toBe(localWork)
  expect(part!.querySelector('.dt-changed-tag')).toBeNull()
  expect(server.requests.some(item => item.path === 'prompts' && item.method === 'PUT')).toBe(false)
})

it('shows assignment recovery and delivery history in the local task record', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  const task = server.ticketDetails.t1!
  task.local = true
  task.assignments = [{ id: 'before-restart', state: 'ended', createdAt: '2026-09-21T00:00:00Z',
    endedAt: '2026-09-21T00:10:00Z', endedReason: 'hostRestarted' }, ...task.assignments]
  task.inputs.push({ id: 'recovery-note', kind: 'note', at: '2026-09-22T00:05:00Z', delivered: true,
    text: '重启后先检查已写入的文件。' })
  at({ page: 'execution', id: task.id })
  await mount()
  const records = all('details').find(item => item.querySelector('summary')?.textContent === zh.localRecords)!
  expect(records.hasAttribute('open')).toBe(false)
  await click(records.querySelector('summary')!)
  expect(records.textContent).toContain('授权详情')
  expect(records.textContent).toContain('Alice')
  expect(records.textContent).toContain('abcdef1234567890')
  expect(records.textContent).toContain('第 2 次派工')
  expect(records.textContent).toContain('dsh-superagent 重启')
  expect(records.textContent).toContain('重启后先检查已写入的文件。')
  expect(records.textContent).toContain('未送达')
  expect(records.textContent).toContain('已送达')
})

it('separates queued, running, waiting and finished tasks and opens the selected worker conversation', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  const running = ticketSummary({ id: 'board-run', title: '执行中的任务', sessionId: 'worker-board-run' })
  const queued = ticketSummary({ id: 'board-queue', title: '排队中的任务', sessionId: '' }, { stage: 'working', action: 'queued' })
  const waiting = ticketSummary({ id: 'board-wait', title: '等待回复的任务', sessionId: 'worker-board-wait' }, { stage: 'person', action: 'answer' })
  server.tickets.open = [running, queued]
  server.person = [waiting]
  server.ticketDetails[running.id] = { ...server.ticketDetails.t1!, id: running.id, title: running.title,
    sessionId: running.sessionId, local: true }
  await mount()
  const column = (name: string) => all(`section[aria-label="${name}"]`)[0]
  expect(column('排队中')).toBeDefined()
  expect(column('排队中')?.textContent).toContain('排队中的任务')
  expect(column('运行中')?.textContent).toContain('执行中的任务')
  expect(column('运行中')?.textContent).not.toContain('排队中的任务')
  expect(column('待处理')?.textContent).toContain('等待回复的任务')
  expect(column('已结束')?.textContent).toContain('旧工单')
  const open = [...column('运行中')!.querySelectorAll('button')].find(button => button.textContent?.trim() === '打开会话')!
  await click(open)
  expect(server.opened).toEqual(['worker-board-run'])
  await click('执行中的任务')
  expect(text()).toContain('返回任务')
  expect(text()).toContain('进展')
})

it('lets the user dispatch a local task and sends follow-up requirements to that task', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('新建任务')
  await type(field<HTMLInputElement>('任务标题'), '检查设置页')
  await type(field<HTMLSelectElement>('选择工作区'), '/tmp/work')
  await type(field<HTMLTextAreaElement>('任务要求'), '检查并修复已有按钮的对齐问题')
  await click('派出任务')
  expect(server.requests.find(item => item.path === 'local/tasks')?.body).toMatchObject({ title: '检查设置页', directory: '/tmp/work', instructions: '检查并修复已有按钮的对齐问题' })
  expect(text()).toContain('检查设置页')
  await type(field<HTMLTextAreaElement>('补充要求'), '保持现有配色')
  await click('发送')
  expect(server.requests.find(item => item.path === 'local/tasks/local-test/followup')?.body).toMatchObject({ text: '保持现有配色' })
})

it('opens the workbench and keeps local navigation understandable', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  at({ page: 'overview' })
  await mount()
  expect(all('[role="tab"]').map(tab => tab.textContent)).toEqual(['工作台', '任务', '工作区', '设置', '帮助'])
  expect(text()).not.toContain('打开主 Session')
  await click('帮助')
  expect(text()).toContain('交给 Superagent 后台执行')
  expect(text()).toContain('DSH 关闭后')
  expect(text()).toContain('Git / MCP')
})

it('keeps prompt edits when returning from the bounded editor to settings', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  at({ page: 'settings' })
  await mount()
  await click(zh['settingsGroup.prompts'])
  await type(field<HTMLTextAreaElement>(zh.promptBody), '保留尚未保存的提示词')
  await click(zh.localBackSettings)
  expect(all('.dt-prompt-nav')).toHaveLength(0)
  expect(text()).toContain(zh.localTaskModel)
  await click(zh['settingsGroup.prompts'])
  expect(field<HTMLTextAreaElement>(zh.promptBody).value).toBe('保留尚未保存的提示词')
  expect(server.requests.some(item => item.path === 'prompts' && item.method === 'PUT')).toBe(false)
})

it('preserves an unfinished task draft across panel navigation and generates a title when omitted', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('新建任务')
  await type(field<HTMLInputElement>('工作区目录'), '/tmp/work')
  await type(field<HTMLTextAreaElement>('任务要求'), '分析登录失败的原因\n先分析，不改文件。')
  await click('帮助')
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
  expect(text()).toContain('同时执行')
  expect(text()).toContain('任务模型')
  expect(text()).not.toContain('飞书机器人')
  expect(text()).not.toContain('准备命令')
  expect(text()).not.toContain('接单策略')
  await type(field<HTMLInputElement>('同时执行'), '2')
  await click('保存')
  expect(server.settings.executor.maxWorkers).toBe(2)
})

it('explains paused dispatch and restores task intake with one action', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  server.settings.paused = true
  await mount()
  expect(all('button').find(button => button.textContent === '新建任务')?.hasAttribute('disabled')).toBe(true)
  expect(text()).toContain('正在运行的任务会继续')
  await click('恢复')
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

it('opens a real workspace and prepares its task without dispatching or losing the draft', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('工作区')
  expect(text()).toContain('/tmp/work')
  await click('打开工作区')
  expect(server.openedWorkspaces).toEqual(['workspace-test'])
  await click('派任务')
  expect(field<HTMLInputElement>('工作区目录').value).toBe('/tmp/work')
  expect(server.requests.filter(item => item.method === 'POST' && item.path === 'local/tasks')).toHaveLength(0)
  await type(field<HTMLTextAreaElement>('任务要求'), '保留这段要求')
  await click('工作区')
  await click('派任务')
  expect(field<HTMLTextAreaElement>('任务要求').value).toBe('保留这段要求')
})

it('keeps full reports in task details while the board stays concise', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  const finished = server.tickets.ended[0]!
  finished.summary = '完整报告包含检查记录和改动说明'
  finished.ended = { by: 'executor', outcome: 'completed', reason: 'completed', at: '2026-11-06T00:00:00Z' }
  server.ticketDetails[finished.id] = { ...server.ticketDetails.t1!, id: finished.id, title: finished.title, local: true,
    stage: 'ended', summary: finished.summary, ended: finished.ended }
  await mount()
  expect(text()).not.toContain(finished.summary)
  await click(finished.title)
  expect(text()).toContain(finished.summary)
})

it('adds the directory selected by the native picker and treats cancellation as no change', async () => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  await mount()
  await click('工作区')
  await click('添加工作区')
  expect(server.requests.filter(item => item.method === 'POST' && item.path === 'local/workspaces')).toHaveLength(0)
  server.pickedDirectory = '/tmp/picked-project'
  await click('添加工作区')
  expect(text()).toContain('/tmp/picked-project')
  expect(server.requests.find(item => item.method === 'POST' && item.path === 'local/workspaces')?.body).toEqual({ directory: '/tmp/picked-project' })
})
