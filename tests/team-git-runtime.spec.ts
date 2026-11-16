/** Real Git repositories with the in-memory host; native model acceptance is separate. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { startRuntime, type Host } from './fixtures/host.ts'
import { hasUnreadRequest } from '../src/core/index.ts'
import { TeamRequestSchema } from '../src/teams/contracts.ts'

let host: Host
afterEach(async () => { await host?.stop() })
async function settle() { await host.runtime.idle(); await host.runtime.teams!.reconcile(); await host.runtime.idle() }
async function ready(id: string) {
  await vi.waitFor(async () => { await settle(); const ticket = host.runtime.store.tickets.get(id)!
    expect(ticket.assignments.at(-1)?.startedAt, JSON.stringify({ title: ticket.title, assignment: ticket.assignments.at(-1), team: host.runtime.teams!.list() })).toBeTruthy()
    host.step(`worker-${id}`); await settle(); expect(hasUnreadRequest(host.runtime.store.tickets.get(id)!)).toBe(false)
  }, { timeout: 10_000, interval: 40 })
  return host.ctx.agents.get(`worker-${id}` as never)!
}
async function complete(id: string, files: string[] = [], checked = false) {
  const agent = await ready(id), command = 'node --test', callId = `git-check-${id}`
  if (checked) {
    host.ctx.emit('session/event', agent.session, { type: 'tool/call', seq: 1, time: Date.now(), data: { callId, name: 'pwsh', arguments: JSON.stringify({ command }) } } as never)
    await agent.ctx.waterfall('tools/post-execute', { agent, callId, rootCallId: callId, name: 'pwsh', arguments: {}, signal: new AbortController().signal, token: {} } as never,
      { isError: false, value: { exitCode: 0 }, content: [] } as never, async () => ({ kind: 'accept' as const }))
    host.ctx.emit('session/event', agent.session, { type: 'tool/result', seq: 2, time: Date.now(), data: { message: { toolCallId: callId, isError: false } } } as never)
  }
  const context = host.runtime.teams!.contextFor(id)!
  await host.runTool(agent.id, 'orchestrator_report', { state: 'ready', summary: '分工完成',
    delivery: { files: files.map(path => ({ path })), checks: checked ? [{ command, outcome: 'passed' }] : [] },
    ...(context.phase === 'integrating' ? { team_review: { ...context.token, decision: 'pass', reason: '完成', evidence: [context.ownEvidence] } } : {}) })
  const fake = host.agents.get(agent.id)!; fake.status = 'idle'; host.ctx.emit('agent/status', { agent: fake, status: 'idle' } as never)
  await settle()
}
function repository() {
  const path = join(host.directory, '原项目 with spaces'); mkdirSync(path)
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-C', path, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q'); writeFileSync(join(path, 'README.md'), 'base\n'); git('add', '.'); git('commit', '-qm', 'initial')
  return { path, git }
}

it('runs independent team members concurrently and gives downstream sessions the assembled code', async () => {
  host = await startRuntime(undefined, { mode: 'local' }); const repo = repository(), initial = repo.git('rev-parse', 'HEAD')
  const settings = host.runtime.store.settings(); host.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 3 } })
  const team = await host.runtime.teams!.create(TeamRequestSchema.parse({ requestId: 'git-parallel', title: 'Git 并行', instructions: '前后端并行开发，汇总后检验',
    directory: repo.path, workflow: { maxRounds: 3, workspace: 'worktree' }, members: [
      { id: 'front', name: '前端', instructions: '前端', dependencies: [] }, { id: 'back', name: '后端', instructions: '后端', dependencies: [] },
      { id: 'check', name: '检验', instructions: '检查前后端', dependencies: ['front', 'back'] },
    ] }))
  expect(team.directory).not.toBe(repo.path); await complete(team.coordinatorTicketId!)
  const view = () => host.runtime.teams!.get(team.id), member = (id: string) => view().members.find(member => member.id === id)!
  await ready(member('front').ticketId!); await ready(member('back').ticketId!)
  expect(member('front').directory).not.toBe(member('back').directory)
  expect(member('front').running && member('back').running).toBe(true)
  writeFileSync(join(member('front').directory!, 'front.txt'), 'front\n'); writeFileSync(join(member('back').directory!, 'back.txt'), 'back\n')
  await complete(member('front').ticketId!, ['front.txt']); expect(member('check').ticketId).toBeUndefined()
  await complete(member('back').ticketId!, ['back.txt']); await ready(member('check').ticketId!)
  expect(readFileSync(join(member('check').directory!, 'front.txt'), 'utf8')).toBe('front\n')
  expect(readFileSync(join(member('check').directory!, 'back.txt'), 'utf8')).toBe('back\n')
  expect(host.runtime.teams!.file(team.id, join(member('front').directory!, 'front.txt')).text).toBe('front\n')
  await complete(member('check').ticketId!, ['front.txt', 'back.txt'])
  expect(view().state).not.toBe('completed')
  await complete(team.coordinatorTicketId!, ['front.txt'], true)
  expect(view().state).not.toBe('completed')
  expect(view().commander?.ticketId).toBeTruthy()
  expect(view().finalDelivery?.record.files).toHaveLength(1)
  expect(view().finalDelivery?.artifacts?.map(file => file.path.split(/[\\/]/).at(-1))).toEqual(['front.txt', 'back.txt'])
  const product = view().finalDelivery!.artifacts!.find(file => file.path.endsWith('back.txt'))!
  expect(host.runtime.teams!.artifact(team.id, product.path).exists).toBe(true)
  expect(host.runtime.teams!.file(team.id, product.path).text).toBe('back\n')
  await complete(view().commander!.ticketId!, ['front.txt', 'back.txt'])
  expect(view().state).toBe('completed'); expect(view().git?.head).toMatch(/^[a-f0-9]{40,64}$/)
  expect(repo.git('rev-parse', 'HEAD')).toBe(initial); expect(repo.git('status', '--porcelain')).toBe('')
}, 60_000)

it('hands the verified result to the task commander and waits for its actual final report', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const team = await host.runtime.teams!.create(TeamRequestSchema.parse({ requestId: 'commander-result', title: '交付回传', instructions: '交付说明文档',
    directory: host.directory, workflow: { maxRounds: 3 }, members: [] }))
  await complete(team.coordinatorTicketId!)
  writeFileSync(join(host.directory, 'result.md'), '# Finished\n')
  await complete(team.coordinatorTicketId!, ['result.md'])
  const handoff = host.runtime.teams!.get(team.id)
  expect(handoff.state).not.toBe('completed')
  expect(handoff.commander!.sessionId).not.toBe(host.runtime.masterId)
  expect(handoff.finalDelivery!.record.files[0]!.path).toBe(realpathSync(join(host.directory, 'result.md')))
  await complete(handoff.commander!.ticketId!, ['result.md'])
  const finished = host.runtime.teams!.get(team.id)
  expect(finished.state).toBe('completed')
  expect(finished.commander!.summary).toBe(finished.summary)
  expect(finished.completion!.commander).toBe(true)
  expect(host.runtime.teams!.artifact(team.id, finished.finalDelivery!.record.files[0]!.path).name).toBe('result.md')
  expect(() => host.runtime.teams!.artifact(team.id, join(host.directory, 'not-reported.txt'))).toThrow(/交付/)
  await host.runtime.teams!.followup(team.id, '$commander', 'more', '补充 README 使用方法')
  await settle()
  const continued = host.runtime.teams!.get(team.id)
  expect(continued.state).not.toBe('completed')
  expect(continued.commander!.ticketId).toBe(finished.commander!.ticketId)
  const forwarded = host.runtime.store.tickets.get(team.coordinatorTicketId!)!.inputs.filter(input => input.kind === 'trigger')
    .map(input => host.runtime.store.triggers.get(input.triggerId)?.text)
  expect(forwarded).toContain('补充 README 使用方法')
}, 30_000)

it('rejects a dirty project before creating a parallel team or a session', async () => {
  host = await startRuntime(undefined, { mode: 'local' }); const repo = repository()
  writeFileSync(join(repo.path, 'mine.txt'), 'keep')
  await expect(host.runtime.teams!.prepare({ requestId: 'dirty', title: 'dirty', directory: repo.path, coordinatorName: '策划', members: [],
    workflow: { maxRounds: 3, workspace: 'worktree' } })).rejects.toThrow(/未提交/)
  expect(host.runtime.teams!.list()).toHaveLength(0)
  expect(readFileSync(join(repo.path, 'mine.txt'), 'utf8')).toBe('keep')
})

it('restores a Git source team in place and revokes its isolated workers when original access is removed', async () => {
  host = await startRuntime(undefined, { mode: 'local' }); const repo = repository()
  const source = () => host.runtime.sources.register({ kind: 'git-origin', title: { zh: '测试', en: 'Test' }, description: { zh: '测试', en: 'Test' },
    schema: z.object({}).strict(), fields: [], health: [], workspace: () => ({ directory: repo.path, permissionPreset: 'workspace-write' }) })
  source()
  const settings = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, teamWorkspace: 'worktree' },
    sources: { ...settings.sources, 'git-origin': { enabled: true, config: {}, execution: 'team' } },
    policy: { ...settings.policy, sources: { ...settings.policy.sources, 'git-origin': { allowed: [{ id: 'human' }], admission: {} } } } })
  const trigger = { id: 'git-source', source: 'git-origin', threads: [{ source: 'git-origin', id: 'one' }],
    actor: { source: 'git-origin', id: 'human' }, human: true, addressed: 'direct' as const, at: new Date().toISOString(), text: '开发当前项目', meta: {} }
  host.runtime.receive(trigger)
  host.runtime.engine.decide(trigger.id, { kind: 'accept', title: '源项目', scope: trigger.text, name: 'git-origin', reason: '用户要求' })
  await settle()
  const original = host.runtime.teams!.get(host.runtime.teams!.list()[0]!.id)
  expect(original.git?.repository).toBe(realpathSync(repo.path))
  expect(host.runtime.teams!.allowedWorker(original.coordinatorTicketId!)).toBe(true)
  const stateDir = host.directory
  await host.runtime.stop(); host = await startRuntime(undefined, { mode: 'local', stateDir }); source(); await settle()
  const restored = host.runtime.teams!.get(original.id)
  expect(restored.directory).toBe(original.directory)
  expect(restored.coordinatorTicketId).toBe(original.coordinatorTicketId)
  const current = host.runtime.store.settings()
  host.runtime.store.saveSettings({ ...current, sources: { ...current.sources, 'git-origin': { ...current.sources['git-origin']!, enabled: false } } })
  await settle()
  expect(host.runtime.teams!.get(original.id)).toMatchObject({ state: 'stopped', error: expect.stringContaining('授权已撤销') })
  expect(host.runtime.teams!.allowedWorker(original.coordinatorTicketId!)).toBe(false)
  expect(repo.git('status', '--porcelain')).toBe('')
}, 30_000)
