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

it('reopens the acknowledged plan when the workbench still serves the previous revision', async () => {
  await open(); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  await type(field<HTMLInputElement>('名称'), '发布检验')
  const stale = server.teamViews['review-team']!
  const fetchNormally = globalThis.fetch
  vi.stubGlobal('fetch', (url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'PUT' && String(url).endsWith('/review-team/plan')) {
      const { members } = JSON.parse(String(options.body))
      return Promise.resolve(Response.json({ ...stale, planRevision: 1, members: [stale.members[0], { ...stale.members[1], ...members[0] }] }))
    }
    return fetchNormally(url, options)
  })
  await click('保存'); await click('编排'); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  expect(field<HTMLInputElement>('名称').value).toBe('发布检验')
  const draft = JSON.parse(sessionStorage.getItem('dsh-superagent/workflow-draft/review-team')!)
  expect(draft.revision).toBe(1)
})

it('ignores damaged stored drafts and layouts instead of crashing the workflow', async () => {
  sessionStorage.setItem('dsh-superagent/workflow-draft/review-team', '{"revision":0,"members":[null]}')
  localStorage.setItem('dsh-superagent/workflow-view/review-team', '{"layouts":{"delivery":{"build":null}},"zoom":"broken"}')
  await open(); await click(all('[data-node="build"] .dt-flow-node-body')[0]!)
  expect(field<HTMLTextAreaElement>('分工').value).toBe('实现页面')
  expect(Number.parseFloat(all('[data-node="build"]')[0]!.style.top)).toBeGreaterThan(Number.parseFloat(all('[data-node="coordinator"]')[0]!.style.top))
})

it('uses square turns for forward, return and dragged same-row links', async () => {
  const { orthogonalRoute } = await import('../src/client/workflow-routing.ts')
  for (const end of [{ x: 270, y: 300 }, { x: 80, y: 30 }, { x: 320, y: 100 }]) {
    const { path } = orthogonalRoute({ x: 110, y: 100 }, end, 420)
    expect(path.match(/[a-z]/gi)).toEqual(expect.arrayContaining(['M', 'H', 'V']))
    expect(path).not.toMatch(/[CLQASTZ]/i)
    expect(path.endsWith('V' + end.y)).toBe(true)
  }
})

it('shows actual session occupancy and keeps unknown capacity separate from zero usage', async () => {
  const { occupancy } = await import('../src/client/member-pressure.tsx')
  expect(occupancy({ projectedTokens: 0, pressureTokens: 19, contextWindow: 100 })).toEqual({ used: 0, limit: 100, percent: 0 })
  expect(occupancy({ pressureTokens: 120, contextWindow: 100 })).toEqual({ used: 120, limit: 100, percent: 100 })
  for (const invalid of [undefined, {}, { pressureTokens: 0, contextWindow: 0 }, { pressureTokens: -1, contextWindow: 100 }]) expect(occupancy(invalid)).toBeUndefined()
})

it('keeps connectors and downstream cards clear of wrapped content without rewriting saved positions', async () => {
  const { fitWorkflowCards } = await import('../src/client/workflow-routing.ts')
  const layout = { lead: { x: 30, y: 40 }, build: { x: 30, y: 230 }, check: { x: 30, y: 420 }, sibling: { x: 290, y: 230 } }
  const fitted = fitWorkflowCards(layout, { lead: 250, build: 180 }, 216, 126)
  expect(fitted.build).toEqual({ x: 30, y: 354 })
  expect(fitted.check).toEqual({ x: 30, y: 598 })
  expect(fitted.sibling).toEqual(layout.sibling)
  expect(fitWorkflowCards(layout, {}, 216, 126)).toEqual(layout)
})

it('restores a partial layout without covering a saved node or its add action', async () => {
  const { restoreWorkflowLayout } = await import('../src/client/workflow-routing.ts')
  const defaults = { planner: { x: 36, y: 40 }, check: { x: 30, y: 230 }, added: { x: 290, y: 230 } }
  const saved = { planner: { x: 100, y: 40 }, check: { x: 292, y: 232 } }
  const placed = restoreWorkflowLayout(defaults, saved, 216, 126)
  expect(placed.planner).toEqual(saved.planner)
  expect(placed.check).toEqual(saved.check)
  expect(placed.added!.x).toBeGreaterThan(placed.check!.x + 216)
  expect(restoreWorkflowLayout(defaults, placed, 216, 126)).toEqual(placed)
})
