// @vitest-environment jsdom
import { act } from 'react'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { usePanel, mount, all, click, type, field, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
beforeEach(() => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  at({ page: 'overview' })
  localStorage.removeItem('dsh-superagent/studio-widths')
})
afterEach(() => localStorage.removeItem('dsh-superagent/studio-widths'))

it('validates a task inline before dispatch and keeps its text through menu and dialog changes', async () => {
  await mount(); await click('新建任务'); await click('单成员'); await click('派出任务')
  expect(all('.dt-composer-field-error').some(error => error.textContent?.includes('任务要求'))).toBe(true)
  expect(document.activeElement).toBe(field('任务要求'))
  expect(server.requests.some(item => item.method === 'POST' && item.path === 'local/tasks')).toBe(false)
  await type(field<HTMLTextAreaElement>('任务要求'), '核对真实输入\n保留第二行和中文内容')
  await click('取消'); await click('新建任务')
  expect(field<HTMLTextAreaElement>('任务要求').value).toBe('核对真实输入\n保留第二行和中文内容')
  await click('派出任务')
  expect(server.requests.find(item => item.method === 'POST' && item.path === 'local/tasks')?.body)
    .toMatchObject({ title: '核对真实输入', instructions: '核对真实输入\n保留第二行和中文内容' })
})

it('collects a workspace name and real directory before registering the project', async () => {
  at({ page: 'source' }); server.pickedDirectory = '/tmp/studio-project'
  await mount(); await click('添加工作区')
  expect(all('[role="dialog"][aria-label="添加工作区"]')).toHaveLength(1)
  expect(server.requests.some(item => item.method === 'POST' && item.path === 'local/workspaces')).toBe(false)
  await type(field<HTMLInputElement>('工作区名称'), '协作项目')
  await click(all('[role="dialog"] button[type="submit"]')[0]!)
  expect(all('.dt-composer-field-error').some(error => error.textContent?.includes('项目目录'))).toBe(true)
  await click('选择项目目录')
  expect(field<HTMLInputElement>('项目目录').value).toBe('/tmp/studio-project')
  expect(all('.dt-composer-field-error').some(error => !!error.textContent)).toBe(false)
  await click(all('[role="dialog"] button[type="submit"]')[0]!)
  expect(server.requests.find(item => item.method === 'POST' && item.path === 'local/workspaces')?.body)
    .toEqual({ directory: '/tmp/studio-project', title: '协作项目' })
  expect(all('[role="dialog"]')).toHaveLength(0)
})

it('resizes the project sidebar with the keyboard and keeps its width across pages', async () => {
  await mount()
  const separator = all('[role="separator"][aria-label="调整项目侧栏宽度"]')[0]!
  expect(separator).toBeDefined()
  const initial = Number(separator.getAttribute('aria-valuenow'))
  await act(async () => { separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  expect(Number(separator.getAttribute('aria-valuenow'))).toBe(initial + 16)
  await click('设置'); await click('工作台')
  expect(all('[role="separator"][aria-label="调整项目侧栏宽度"]')[0]!.getAttribute('aria-valuenow')).toBe(String(initial + 16))
  expect(JSON.parse(localStorage.getItem('dsh-superagent/studio-widths')!).left).toBe(initial + 16)
})

it('returns to the beginning of a task form when clearing a scrolled draft', async () => {
  await mount(); await click('新建任务')
  await type(field<HTMLTextAreaElement>('任务要求'), '尚未派出的草稿')
  const body = all('.dt-composer-modal .dt-modal-body')[0]!
  body.scrollTop = 160
  await click('清空草稿')
  expect(field<HTMLTextAreaElement>('任务要求').value).toBe('')
  expect(body.scrollTop).toBe(0)
})
