// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, retainKnownSession } from '../src/navigation.ts'
import { initialLocation, parseRoute, remember, setupPage } from '../src/client/route.ts'
const id = 'orchestrator-test' as SessionId
function fixture(ready = false) {
  const pending = Promise.withResolvers<void>()
  const state = { phase: ready ? 'ready' : 'pending', byId: ready ? { [id]: {} } : {} as Record<string, object> }
  const refresh = vi.fn(async () => { await pending.promise })
  // Navigation reads only catalog readiness and membership, not summary fields.
  const sessions = { list: { getSnapshot: () => state }, refresh } as unknown as Pick<ISessions, 'list' | 'refresh'>
  return { sessions, pending, state, refresh }
}
it('waits for initial catalog hydration before opening the linked master', async () => {
  const { sessions, pending, state } = fixture(); const open = vi.fn()
  const navigation = openKnownSession(sessions, id, open, new AbortController().signal)
  expect(open).not.toHaveBeenCalled()
  state.phase = 'ready'; state.byId[id] = {}; pending.resolve()
  await expect(navigation).resolves.toBe(true)
  expect(open).toHaveBeenCalledExactlyOnceWith(id)
})
it('opens known Sessions without another network refresh', async () => {
  const { sessions, refresh } = fixture(true); const open = vi.fn()
  await expect(openKnownSession(sessions, id, open, new AbortController().signal)).resolves.toBe(true)
  expect(open).toHaveBeenCalledExactlyOnceWith(id); expect(refresh).not.toHaveBeenCalled()
})
it('reports unavailable targets without calling the throwing Session selector', async () => {
  const { sessions, pending, state } = fixture(); const open = vi.fn()
  const navigation = openKnownSession(sessions, id, open, new AbortController().signal)
  state.phase = 'ready'; pending.resolve()
  await expect(navigation).rejects.toMatchObject({ code: 'not-listed' })
  expect(open).not.toHaveBeenCalled()
})
it('does not navigate after the panel unmounts or a newer request supersedes it', async () => {
  const { sessions, pending, state } = fixture(); const open = vi.fn(); const controller = new AbortController()
  const navigation = openKnownSession(sessions, id, open, controller.signal)
  controller.abort(); state.phase = 'ready'; state.byId[id] = {}; pending.resolve()
  await expect(navigation).resolves.toBe(false); expect(open).not.toHaveBeenCalled()
})
it('hydrates the catalog before retaining a transcript restored by a page reload', async () => {
  const { sessions, pending, state } = fixture()
  const reference = { ready: Promise.resolve(), release: vi.fn() }
  const retain = vi.fn(() => reference)
  const host = { ...sessions, retain } as unknown as Pick<ISessions, 'list' | 'refresh' | 'retain'>
  const result = retainKnownSession(host, id, new AbortController().signal)
  expect(retain).not.toHaveBeenCalled()
  state.phase = 'ready'; state.byId[id] = {}; pending.resolve()
  await expect(result).resolves.toBe(reference)
  expect(retain).toHaveBeenCalledOnce()
})
it('releases a transcript when cancelled while its history is opening', async () => {
  const { sessions } = fixture(true), opening = Promise.withResolvers<void>(), controller = new AbortController()
  const reference = { ready: opening.promise, release: vi.fn() }
  const retain = vi.fn((_id, options) => {
    options.signal.addEventListener('abort', () => opening.reject(new Error('cancelled')), { once: true })
    return reference
  })
  const host = { ...sessions, retain } as unknown as Pick<ISessions, 'list' | 'refresh' | 'retain'>
  const result = retainKnownSession(host, id, controller.signal)
  controller.abort()
  await expect(result).rejects.toThrow('cancelled')
  expect(reference.release).toHaveBeenCalledOnce()
})
it('reports unavailable restored transcripts without calling the throwing retainer', async () => {
  const { sessions, pending, state } = fixture(), retain = vi.fn(() => { throw new Error('unknown session') })
  const host = { ...sessions, retain } as unknown as Pick<ISessions, 'list' | 'refresh' | 'retain'>
  const result = retainKnownSession(host, id, new AbortController().signal)
  state.phase = 'ready'; pending.resolve()
  await expect(result).rejects.toMatchObject({ code: 'not-listed' })
  expect(retain).not.toHaveBeenCalled()
})
it('reopens the page this tab showed last, and the overview for a route that no longer exists', () => {
  remember({ route: { page: 'eval', query: { filter: 'stop' } }, stack: [{ page: 'overview' }] })
  expect(initialLocation()).toEqual({ route: { page: 'eval', query: { filter: 'stop' } }, stack: [{ page: 'overview' }] })
  // The Eval tab was previously named Policy; a route saved under the old name falls back to overview.
  sessionStorage.setItem('dsh-superagent/route', JSON.stringify({ route: { page: 'policy' }, stack: [] }))
  expect(initialLocation()).toEqual({ route: { page: 'overview' }, stack: [] })
  sessionStorage.setItem('dsh-superagent/route', JSON.stringify({ route: { page: 'trigger', id: 'github:1' }, stack: [{ page: 'policy' }, { page: 'trigger' }] }))
  expect(initialLocation().stack).toEqual([{ page: 'trigger' }])
  sessionStorage.setItem('dsh-superagent/route', '{')
  expect(initialLocation().route).toEqual({ page: 'overview' })
})
it('reads each page a tab remembered with the parameters it takes, and leaves out what it does not know', () => {
  expect(parseRoute({ page: 'trigger', query: { filter: 'nope', trigger: 'e1' } })).toEqual({ page: 'trigger' })
  expect(parseRoute({ page: 'trigger', id: 'github:1', query: { trigger: 'e1', filter: 'recent' } }))
    .toEqual({ page: 'trigger', id: 'github:1', query: { trigger: 'e1' } })
  expect(parseRoute({ page: 'eval', query: { filter: 'stop', window: '7d' } })).toEqual({ page: 'eval', query: { filter: 'stop' } })
  expect(parseRoute({ page: 'execution', id: 5, query: { filter: 'idle' } })).toEqual({ page: 'execution', query: { filter: 'idle' } })
  expect(parseRoute({ page: 'settings', query: { group: 'policy', source: 'feishu' } }))
    .toEqual({ page: 'settings', query: { group: 'source', source: 'feishu' } })
  expect([parseRoute('overview'), parseRoute(null)]).toEqual([undefined, undefined])
})
it('opens the settings that fix each setup problem: the Deployment group, or the card of the Source it names', () => {
  expect(setupPage('deployment')).toEqual({ page: 'settings', query: { group: 'deployment' } })
  for (const place of ['github', 'feishu'] as const) expect(setupPage(place)).toEqual({ page: 'settings', query: { group: 'source', source: place } })
})
