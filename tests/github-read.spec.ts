import { afterEach, expect, it, vi } from 'vitest'
import { Commands, CliError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { readGithub, pullChecks, ciCounts, ciSummary, ciFact } from '../src/sources/github-read.ts'

const commands = new Commands(() => testDeployment(), {}, new AbortController().signal)
afterEach(() => vi.restoreAllMocks())

it('reads paginated Actions jobs and statuses when a fine-grained token cannot use Checks', async () => {
  const gh = vi.spyOn(commands, 'gh').mockRejectedValueOnce(new CliError('Checks API unavailable for this token', 403))
    .mockResolvedValueOnce([{ workflow_runs: [
      { id: 2, workflow_id: 9, name: 'test', event: 'push', status: 'completed', conclusion: 'failure' },
      { id: 1, workflow_id: 9, name: 'old run', event: 'push', status: 'completed', conclusion: 'success' },
    ] }]).mockResolvedValueOnce([{ jobs: [{ name: 'unit', status: 'completed', conclusion: 'failure' }] }])
  vi.spyOn(commands, 'pages').mockResolvedValue([{ context: 'legacy-ci', state: 'pending' }])
  const result = await pullChecks(commands, 'abc')
  expect(result).toEqual({ head: 'abc', coverage: 'actions-and-statuses', checks: [{ name: 'test / unit', status: 'completed', conclusion: 'failure' }],
    statuses: [{ context: 'legacy-ci', state: 'pending' }] })
  expect(gh.mock.calls[1]![0][1]).toContain('head_sha=abc')
  expect(gh.mock.calls[2]![0][1]).toBe('repos/acme/widgets/actions/runs/2/jobs?filter=latest&per_page=100')
  expect(gh).toHaveBeenCalledTimes(3)
  expect(ciCounts(result)).toMatchObject({ failed: 1, running: 1, coverage: 'actions-and-statuses' })
  expect(ciSummary(result, 'main', 'checks')).toContain('GitHub Actions and commit statuses only')
})

it('does not call an empty CI result a passing check', () => {
  const snapshot = { head: 'abc', checks: [], statuses: [] }
  expect(ciSummary(snapshot, 'main', 'checks')).not.toContain('passed')
  expect(ciFact(ciCounts(snapshot)).value).not.toEqual({ zh: '通过', en: 'passed' })
})

it('propagates an unavailable Actions fallback instead of calling CI successful', async () => {
  vi.spyOn(commands, 'gh').mockRejectedValueOnce(new CliError('Checks unavailable', 403)).mockRejectedValueOnce(new CliError('Actions unavailable', 403))
  await expect(pullChecks(commands, 'abc')).rejects.toThrow('Actions unavailable')
})

it('reads a bounded comment page and exposes the next page reference', async () => {
  const gh = vi.spyOn(commands, 'gh').mockResolvedValue(Array.from({ length: 20 }, (_, id) => ({ id, body: 'comment' })))
  expect(await readGithub(commands, 'github/issues/123/comments/2')).toMatchObject({ next_resource: 'github/issues/123/comments/3' })
  expect(gh).toHaveBeenCalledWith(['api', 'repos/acme/widgets/issues/123/comments?per_page=20&page=2'])
})

it('rejects unsupported or escaping paths without making a request', async () => {
  const gh = vi.spyOn(commands, 'gh')
  for (const resource of ['github/../outside', 'github/issues/1/reviews', 'github/pulls/1/checks/2', 'github/issues/1?repo=other']) {
    await expect(readGithub(commands, resource)).rejects.toThrow()
  }
  expect(gh).not.toHaveBeenCalled()
})

it('reads checks across pages and canonicalizes the latest status per context', async () => {
  vi.spyOn(commands, 'gh').mockResolvedValue([{ check_runs: [{ name: 'z', status: 'completed', conclusion: 'success' }] }, { check_runs: [{ name: 'a', status: 'in_progress', conclusion: null }] }])
  vi.spyOn(commands, 'pages').mockResolvedValue([{ context: 'build', state: 'success' }, { context: 'build', state: 'failure' }])
  const result = await pullChecks(commands, 'abc')
  expect(result.checks.map((check: { name: string }) => check.name)).toEqual(['a', 'z'])
  expect(result.statuses).toEqual([{ context: 'build', state: 'success' }])
})

it('reads any requested PR’s CI on demand without restricting the author', async () => {
  const gh = vi.spyOn(commands, 'gh').mockResolvedValueOnce({ head: { sha: 'abc' }, user: { login: 'another-author' } }).mockResolvedValueOnce([{ check_runs: [] }])
  vi.spyOn(commands, 'pages').mockResolvedValue([])
  expect(await readGithub(commands, 'github/pulls/123/checks')).toEqual({ head: 'abc', checks: [], statuses: [] })
  expect(gh).toHaveBeenCalledTimes(2)
})

/** Fake GitHub REST API pull request review comment payload. */
const reviewComment = (id: number, reply?: number) => ({ id, url: `https://api.github.com/repos/acme/widgets/pulls/comments/${id}`,
  pull_request_review_id: 77, node_id: 'PRRC_x', path: 'src/render.ts', line: 43, original_line: 43, side: 'RIGHT', commit_id: 'abc',
  diff_hunk: '@@ -40,6 +40,8 @@\n   const title = view.title\n   const margin = 12\n+  const padding = 8',
  user: { login: id === 2 ? 'review-bot[bot]' : 'carol', id: 5, type: id === 2 ? 'Bot' : 'User', avatar_url: 'https://avatars/5', html_url: 'https://github.com/carol' },
  body: `comment ${id}`, created_at: `2026-09-09T00:00:0${id}Z`, updated_at: `2026-09-09T00:00:0${id}Z`,
  html_url: `https://github.com/acme/widgets/pull/9#discussion_r${id}`, author_association: 'MEMBER', reactions: { total_count: 0 },
  _links: { self: { href: 'x' } }, ...reply ? { in_reply_to_id: reply } : {} })
it('reads a page of review comments as messages: id, author, time, text, the comment each answers, and the file and line', async () => {
  vi.spyOn(commands, 'gh').mockResolvedValue([reviewComment(1), reviewComment(2, 1)])
  expect(await readGithub(commands, 'github/pulls/9/comments/1')).toEqual({ messages: [
    { id: '1', from: 'carol', at: '2026-09-09T00:00:01Z', text: 'comment 1', url: 'https://github.com/acme/widgets/pull/9#discussion_r1',
      path: 'src/render.ts', line: 43 },
    { id: '2', from: 'review-bot[bot]', at: '2026-09-09T00:00:02Z', text: 'comment 2', bot: true, reply_to: '1',
      url: 'https://github.com/acme/widgets/pull/9#discussion_r2', path: 'src/render.ts', line: 43 }] })
})
it('reads a review thread from any of its comments, the first with its file, line and diff lines', async () => {
  vi.spyOn(commands, 'pages').mockResolvedValue([reviewComment(3), reviewComment(2, 1), reviewComment(1), reviewComment(4, 3)].map(item => ({
    ...item, user: { login: item.user.login, type: item.user.type } })))
  const thread = await readGithub(commands, 'github/pulls/9/thread/2') as { messages: { id: string; text: string; reply_to?: string }[] }
  expect(thread.messages.map(message => [message.id, message.reply_to])).toEqual([['1', undefined], ['2', '1']])
  expect(thread.messages[0]!.text).toBe('src/render.ts:43\n   const title = view.title\n   const margin = 12\n+  const padding = 8\n\ncomment 1')
  await expect(readGithub(commands, 'github/issues/9/thread/2')).rejects.toThrow('require a pull request')
})
it('reads an Issue or PR as its author, time, title, state, description and a PR\'s branches', async () => {
  vi.spyOn(commands, 'gh').mockResolvedValue({ number: 9, id: 1, title: 'Fix the margin', state: 'open', body: 'Details', draft: true,
    user: { login: 'carol', type: 'User' }, created_at: '2026-09-09T00:00:00Z', html_url: 'https://github.com/acme/widgets/pull/9',
    head: { ref: 'agent/fix', sha: 'abc', repo: {} }, base: { ref: 'main' }, labels: [{ name: 'ui', color: 'fff' }], node_id: 'x', _links: {} })
  expect(await readGithub(commands, 'github/pulls/9')).toEqual({ number: 9, title: 'Fix the margin', state: 'open', draft: true, head: 'agent/fix',
    base: 'main', labels: ['ui'], id: '9', from: 'carol', at: '2026-09-09T00:00:00Z', text: 'Details', url: 'https://github.com/acme/widgets/pull/9' })
})

it('keeps the reviewed PR file list distinct from files already present on base', async () => {
  const ref = { base: { sha: 'base' }, head: { sha: 'head' }, changed_files: 1 }
  const gh = vi.spyOn(commands, 'gh').mockResolvedValueOnce(ref).mockResolvedValueOnce([{ filename: 'README.md' }]).mockResolvedValueOnce({ tree: { sha: 'same' } }).mockResolvedValueOnce({ tree: { sha: 'same' } }).mockResolvedValueOnce(ref)
  expect(await readGithub(commands, 'github/pulls/27/changes')).toEqual({ number: 27, base: 'base', head: 'head', total: 1, files: ['README.md'], sameTreeAsBase: true })
  expect(gh.mock.calls.map(call => call[0][1])).toEqual(['repos/acme/widgets/pulls/27', 'repos/acme/widgets/pulls/27/files?per_page=100', 'repos/acme/widgets/git/commits/base', 'repos/acme/widgets/git/commits/head', 'repos/acme/widgets/pulls/27'])
})

it.each(['base', 'head', 'incomplete'])('rejects an unstable or partial PR file list: %s', async change => {
  const ref = { base: { sha: 'b' }, head: { sha: 'h' }, changed_files: 1 }
  vi.spyOn(commands, 'gh').mockResolvedValueOnce(ref).mockResolvedValueOnce(change === 'incomplete' ? [] : [{ filename: 'README.md' }])
    .mockResolvedValueOnce({ tree: { sha: 'one' } }).mockResolvedValueOnce({ tree: { sha: 'two' } })
    .mockResolvedValueOnce(change === 'incomplete' ? ref : { ...ref, [change]: { sha: 'other' } })
  await expect(readGithub(commands, 'github/pulls/27/changes')).rejects.toThrow('不完整')
})

it.each([['completed', 'success', 0, 0], ['completed', 'failure', 1, 0], ['in_progress', null, 0, 1]] as const)(
  'keeps the actual Actions workflow result when jobs and statuses are forbidden (%s, %s)', async (status, conclusion, failed, running) => {
    const denied = new CliError('forbidden', 403)
    vi.spyOn(commands, 'gh').mockRejectedValueOnce(denied).mockResolvedValueOnce([{ workflow_runs: [
      { id: 2, workflow_id: 9, name: 'test', event: 'pull_request', status, conclusion },
    ] }]).mockRejectedValueOnce(denied)
    vi.spyOn(commands, 'pages').mockRejectedValueOnce(denied)
    const result = await pullChecks(commands, 'abc')
    expect(ciCounts(result)).toEqual({ failed, running, coverage: 'actions-only' })
    expect(result.checks[0]?.name).toContain('job details unavailable')
    expect(ciSummary(result, 'PR', 'checks')).toContain('GitHub Actions only')
  })

it('routes direct team CLI comments and Checks reads to the host while allowing repository work', async () => {
  const { githubTeamShellAdvice: advice } = await import('../src/sources/github-channel.ts')
  for (const write of ['gh issue comment 21 --body-file note', 'GH=/tools/github-agent; "$GH" pr comment 21 --body ok',
    '"/tools/github-agent" api --method POST repos/acme/widgets/issues/21/comments -f body=ok',
    'gh api repos/acme/widgets/pulls/3/comments --input note.json']) expect(advice(write)).toContain('统一回传')
  for (const read of ['gh pr checks 27', '/tools/github-agent api repos/a/b/commits/sha/check-runs',
    'gh pr view 27 --json statusCheckRollup']) expect(advice(read)).toContain('orchestrator_read')
  for (const allowed of ['gh pr create --body-file note', 'gh api repos/a/b/issues/2/comments', 'git diff origin/main']) expect(advice(allowed)).toBeUndefined()
})

it('retries an interrupted plain GitHub read once and never replays a comment write', async () => {
  const { z } = await import('zod')
  const eof = new CliError('Get https://api.github.com: EOF')
  const gh = vi.spyOn(commands, 'gh').mockRejectedValueOnce(eof).mockResolvedValueOnce({ ok: true })
  expect(await commands.api(z.unknown(), 'pulls/9')).toEqual({ ok: true })
  expect(gh).toHaveBeenCalledTimes(2)
  gh.mockClear().mockRejectedValue(eof)
  await expect(commands.api(z.unknown(), 'issues/9/comments', '--method', 'POST', '-f', 'body=test')).rejects.toBe(eof)
  expect(gh).toHaveBeenCalledTimes(1)
})

it('blocks GitHub comment writes over HTTP without blocking reads or pull creation', async () => {
  const { githubTeamShellAdvice: advice } = await import('../src/sources/github-channel.ts')
  const issue = 'https://api.github.com/repos/acme/widgets/issues/25/comments'
  for (const write of [
    ['curl -sS -X POST', '  -H "Accept: application/vnd.github+json"', '  "' + issue + '"', "  -d '{\"body\":\"done\"}'"].join(' \\\n'),
    'curl --json @response.json "' + issue + '"', 'Invoke-RestMethod -Method Post -Uri "' + issue + '" -Body $message',
    "python3 -c \"import requests; requests.post('" + issue + "', json=payload)\"",
    "gh api graphql -f query='mutation{addComment(input:$input){clientMutationId}}'",
  ]) expect(advice(write)).toContain('统一回传')
  for (const allowed of ['curl -sS "' + issue + '"', 'gh pr create --body-file note', 'curl -X POST https://api.github.com/repos/a/b/pulls -d @pr.json']) expect(advice(allowed)).toBeUndefined()
})
