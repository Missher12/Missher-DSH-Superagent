import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { GitWorkspaces } from '../src/teams/git-workspaces.ts'

const roots: string[] = []
vi.setConfig({ testTimeout: 30_000 })
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function git(directory: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-C', directory, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'superagent-git-')); roots.push(root)
  const repository = join(root, '中文项目 with spaces'), work = join(root, '工作区 with spaces')
  mkdirSync(repository); git(repository, 'init', '-q'); git(repository, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repository, 'shared.txt'), 'base\n'); git(repository, 'add', '.'); git(repository, 'commit', '-qm', 'initial')
  return { repository, manager: new GitWorkspaces(work), original: git(repository, 'rev-parse', 'HEAD') }
}

it('isolates parallel changes and assembles dependency deliveries without changing the source checkout', async () => {
  const { repository, manager, original } = fixture(), team = await manager.plan(repository, 'team-one')
  const [front, back] = await Promise.all([manager.prepare(team, 'frontend'), manager.prepare(team, 'backend')])
  writeFileSync(join(front.workspace.directory, 'front.txt'), 'frontend\n')
  writeFileSync(join(back.workspace.directory, 'back.txt'), 'backend\n')
  const heads = await Promise.all([manager.capture(front.workspace), manager.capture(back.workspace)])
  const review = await manager.prepare(team, 'review', heads)
  expect(review.pending).toEqual([])
  expect(readFileSync(join(review.workspace.directory, 'front.txt'), 'utf8')).toBe('frontend\n')
  expect(readFileSync(join(review.workspace.directory, 'back.txt'), 'utf8')).toBe('backend\n')
  const assembled = await manager.prepare(team, 'coordinator', [await manager.capture(review.workspace), ...heads])
  expect(assembled.pending).toEqual([])
  expect(git(repository, 'rev-parse', 'HEAD')).toBe(original)
  expect(git(repository, 'status', '--porcelain')).toBe('')
  expect(new Set([front.workspace.directory, back.workspace.directory, assembled.workspace.directory]).size).toBe(3)
})

it('resumes the same branches after reconstruction and accepts a later dependency delivery', async () => {
  const { repository, manager } = fixture(), team = await manager.plan(repository, 'team-restart')
  const build = await manager.prepare(team, 'build')
  writeFileSync(join(build.workspace.directory, 'result.txt'), 'one\n')
  const first = await manager.capture(build.workspace)
  const review = await manager.prepare(team, 'review', [first]), firstReview = await manager.capture(review.workspace)
  const restored = JSON.parse(JSON.stringify(team))
  expect((await manager.prepare(restored, 'review', [first])).workspace.directory).toBe(review.workspace.directory)
  expect(await manager.capture(review.workspace)).toBe(firstReview)
  writeFileSync(join(build.workspace.directory, 'result.txt'), 'two\n')
  const second = await manager.capture(build.workspace)
  const next = await manager.prepare(restored, 'review', [second])
  expect(next.pending).toEqual([])
  expect(readFileSync(join(next.workspace.directory, 'result.txt'), 'utf8')).toBe('two\n')
})

it('keeps merge conflicts for the assigned session and refuses to report an unmerged delivery', async () => {
  const { repository, manager } = fixture(), team = await manager.plan(repository, 'team-conflict')
  const a = await manager.prepare(team, 'a'), b = await manager.prepare(team, 'b')
  writeFileSync(join(a.workspace.directory, 'shared.txt'), 'a\n'); writeFileSync(join(b.workspace.directory, 'shared.txt'), 'b\n')
  const heads = [await manager.capture(a.workspace), await manager.capture(b.workspace)]
  const review = await manager.prepare(team, 'review', heads)
  expect(review.conflicts).toEqual(['shared.txt']); expect(review.pending).toEqual([heads[1]])
  await expect(manager.capture(review.workspace)).rejects.toThrow(/冲突/)
  const resumed = await manager.prepare(JSON.parse(JSON.stringify(team)), 'review', heads)
  expect(resumed.conflicts).toEqual(['shared.txt'])
  writeFileSync(join(review.workspace.directory, 'shared.txt'), 'a and b\n')
  git(review.workspace.directory, 'add', 'shared.txt'); git(review.workspace.directory, 'commit', '-qm', 'resolve')
  expect((await manager.prepare(team, 'review', heads)).pending).toEqual([])
  await expect(manager.capture(review.workspace)).resolves.toMatch(/^[a-f0-9]{40,64}$/)
  expect(readFileSync(join(repository, 'shared.txt'), 'utf8')).toBe('base\n')
})

it('refuses dirty or nested source directories and never stages the original files', async () => {
  const { repository, manager } = fixture()
  writeFileSync(join(repository, 'private.txt'), 'keep me')
  await expect(manager.plan(repository, 'dirty')).rejects.toThrow(/未提交/)
  expect(readFileSync(join(repository, 'private.txt'), 'utf8')).toBe('keep me')
  expect(git(repository, 'diff', '--cached', '--name-only')).toBe('')
  const nested = join(repository, 'nested'); mkdirSync(nested)
  await expect(manager.plan(nested, 'nested')).rejects.toThrow(/根目录/)
})

it('does not adopt a foreign branch or discard unpublished changes when preparing new dependencies', async () => {
  const { repository, manager } = fixture(), team = await manager.plan(repository, 'team-foreign')
  const build = await manager.prepare(team, 'build'), review = await manager.prepare(team, 'review')
  writeFileSync(join(build.workspace.directory, 'result.txt'), 'delivery\n')
  const head = await manager.capture(build.workspace)
  writeFileSync(join(review.workspace.directory, 'mine.txt'), 'keep\n')
  await expect(manager.prepare(team, 'review', [head])).rejects.toThrow(/未提交/)
  expect(readFileSync(join(review.workspace.directory, 'mine.txt'), 'utf8')).toBe('keep\n')
  git(review.workspace.directory, 'switch', '-c', 'foreign')
  await expect(manager.capture(review.workspace)).rejects.toThrow(/分支/)
})
