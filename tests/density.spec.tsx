// @vitest-environment jsdom
import { beforeEach, expect, it, onTestFinished } from 'vitest'
import { usePanel, mount, remount, click, type, field, at, text } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
beforeEach(() => {
  server.setup = { ...server.setup, mode: 'local', accounts: null }
  at({ page: 'settings' })
  localStorage.setItem('dsh-superagent/ui-density', 'compact')
  onTestFinished(() => localStorage.removeItem('dsh-superagent/ui-density'))
})

it('uses the comfortable layout across pages and reopening, with no density setting or reset', async () => {
  await mount()
  expect(document.querySelector('.dt-local-page')?.getAttribute('data-density')).toBe('comfortable')
  expect(text()).not.toContain('界面密度')
  expect(text()).not.toContain('恢复默认')
  await type(field<HTMLInputElement>('同时执行'), '5')
  for (const page of ['任务', '工作区', '工作台', '设置']) {
    await click(page)
    expect(document.querySelector('.dt-local-page')?.getAttribute('data-density')).toBe('comfortable')
  }
  await remount()
  expect(document.querySelector('.dt-local-page')?.getAttribute('data-density')).toBe('comfortable')
  expect(field<HTMLInputElement>('同时执行').value).toBe('5')
  expect(server.settings.executor.maxWorkers).toBe(3)
  expect(server.requests.some(request => request.method === 'PUT')).toBe(false)
})
