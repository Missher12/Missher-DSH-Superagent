// @vitest-environment jsdom
import { beforeEach, expect, it, onTestFinished } from 'vitest'
import { usePanel, mount, remount, click, type, field, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
beforeEach(() => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  at({ page: 'settings' })
  localStorage.removeItem('dsh-superagent/ui-density')
  onTestFinished(() => localStorage.removeItem('dsh-superagent/ui-density'))
})
const density = () => document.querySelector('.dt-local-page')?.getAttribute('data-density')

it('applies density immediately across pages, remembers it after reopening, and restores the default independently of executor drafts', async () => {
  await mount()
  expect(density()).toBe('compact')
  await type(field<HTMLInputElement>('同时执行'), '5')
  await click('标准')
  expect(density()).toBe('standard')
  await click('宽松')
  expect(density()).toBe('comfortable')
  for (const page of ['任务', '工作区', '工作台', '设置']) {
    await click(page)
    expect(density()).toBe('comfortable')
  }
  await remount()
  expect(density()).toBe('comfortable')
  expect(field<HTMLInputElement>('同时执行').value).toBe('5')
  expect(server.settings.executor.maxWorkers).toBe(3)
  expect(server.requests.some(request => request.method === 'PUT')).toBe(false)
  await click('恢复默认')
  expect(density()).toBe('compact')
  await remount()
  expect(density()).toBe('compact')
})

it('uses the compact default when a stored density is unsupported', async () => {
  localStorage.setItem('dsh-superagent/ui-density', 'unsupported-value')
  await mount()
  expect(density()).toBe('compact')
})
