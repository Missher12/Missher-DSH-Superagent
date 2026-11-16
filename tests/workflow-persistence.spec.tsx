// @vitest-environment jsdom
import { act } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { usePanel, mount, remount, all, click, type, field, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'
usePanel()
beforeEach(() => localStorage.clear())
async function open() {
  server.setup = { ...server.setup, mode: 'local', accounts: null }; server.renderSessions = true
  server.teamViews['review-team'] = { id: 'review-team', name: '编排检查', title: '编排检查', instructions: '实现并检查页面',
    directory: '/tmp/review', state: 'completed', createdAt: '2026-11-16T01:00:00Z', updatedAt: '2026-11-16T01:00:00Z',
    completedMembers: 1, memberCount: 1, summary: '', handoffs: [], deliveries: [], planRevision: 0,
    members: [
      { id: 'coordinator', name: '策划', role: 'coordinator', instructions: '复核', dependencies: [], state: 'finished', ticketId: 'planner', sessionId: 'worker-planner', summary: '', retry: false, tools: [], events: [] },
      { id: 'build', name: '前端', role: 'member', instructions: '实现页面', dependencies: [], state: 'finished', ticketId: 'build', sessionId: 'worker-build', summary: '', retry: false, tools: [], events: [] },
    ] }
  at({ page: 'overview', query: { team: 'review-team', member: 'build' } })
  await mount()
  vi.spyOn(all('.dt-team-focus-workbench')[0]!, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect)
  await click('编排')
}
it('retains saved node positions, zoom and inspector width when the workflow is reopened', async () => {
  await open()
  const node = all('[data-node="build"]')[0]!, original = node.style.top
  await act(async () => { node.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  const moved = node.style.top; expect(moved).not.toBe(original)
  await click('管理层级'); await click('执行流程')
  expect(all('[data-node="build"]')[0]!.style.top).toBe(moved)
  await click('＋');
  const divider = all('.dt-flow-resizer')[0]!
  await act(async () => { divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
  const zoom = all('.dt-flow-world')[0]!.style.transform
  const width = all('.dt-flow-editor')[0]!.style.getPropertyValue('--flow-inspector')
  await click('保存'); await remount(); await click('编排')
  const reopened = all('[data-node="build"]')[0]!.style.top
  expect(reopened).toBe(moved)
  expect(all('.dt-flow-world')[0]!.style.transform).toBe(zoom)
  expect(all('.dt-flow-editor')[0]!.style.getPropertyValue('--flow-inspector')).toBe(width)
})
it('retains unsaved member edits when opening its conversation and only discards on cancel', async () => {
  await open(); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  await type(field<HTMLTextAreaElement>('分工'), '新的分工草稿')
  await click(all('[role="dialog"] button').find(b => b.textContent === '打开执行会话')!)
  expect(all('.dt-workflow-modal')).toHaveLength(0)
  await remount()
  await click('编排'); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  const reopened = field<HTMLTextAreaElement>('分工').value
  expect(reopened).toBe('新的分工草稿')
  await click('取消'); await click('编排'); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  expect(field<HTMLTextAreaElement>('分工').value).toBe('实现页面')
})

it('ignores damaged stored drafts and layouts instead of crashing the workflow', async () => {
  sessionStorage.setItem('dsh-superagent/workflow-draft/review-team', '{"revision":0,"members":[null]}')
  localStorage.setItem('dsh-superagent/workflow-view/review-team', '{"layouts":{"delivery":{"build":null}},"zoom":"broken"}')
  await open(); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  expect(field<HTMLTextAreaElement>('分工').value).toBe('实现页面')
  expect(all('[data-node="build"]')[0]!.style.top).toBe('40px')
})
