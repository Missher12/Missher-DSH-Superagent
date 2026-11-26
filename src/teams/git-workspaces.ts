/** Local Git deliveries: independent worktrees, persistent branches, and explicit integration. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute, sep } from 'node:path'
import { GIT_LOCATION } from '../infra/environment.ts'

export interface GitWorkspace {
  repository: string; directory: string; branch: string; inputs: string[]
  head?: string; version?: string
}
export interface GitTeam {
  repository: string; base: string; integration: GitWorkspace; members: Record<string, GitWorkspace>
}
export interface GitMerge { workspace: GitWorkspace; conflicts: string[]; pending: string[] }
/** A delivery still has outstanding Git changes to reconcile. */
export class GitDeliveryPending extends Error {}
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)
const inside = (root: string, path: string) => { const part = relative(root, path); return !part || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep) }

/** Creates and integrates isolated Git worktrees for a team. */
export class GitWorkspaces {
  constructor(private readonly root: string, private readonly signal?: AbortSignal) {}
  private async run(directory: string, args: string[], allowFailure = false): Promise<{ output: string; code: number }> {
    this.signal?.throwIfAborted()
    const hooks = join(this.root, '.hooks'); await mkdir(hooks, { recursive: true })
    return new Promise((resolve, reject) => {
      execFile('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'core.longpaths=true', '-c', 'commit.gpgsign=false',
        '-c', 'user.name=Superagent', '-c', 'user.email=superagent@localhost', '-c', 'merge.autoStash=false',
        '-C', directory, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2 << 20,
        signal: this.signal, env: { ...process.env, ...Object.fromEntries(GIT_LOCATION.map(name => [name, undefined])),
          GIT_CONFIG_COUNT: undefined, GIT_CONFIG_PARAMETERS: undefined, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' } }, (error, stdout, stderr) => {
        const code = error ? typeof error.code === 'number' ? error.code : -1 : 0
        if (error && (!allowFailure || code < 0)) reject(new Error(`Git 操作失败：${error.code === 'ENOENT' ? '请先安装 Git，并让 DSH 能从 PATH 找到它' : (stderr || error.message).trim().slice(0, 1400)}`))
        else resolve({ output: stdout.trim(), code })
      })
    })
  }
  private async text(directory: string, ...args: string[]) { return (await this.run(directory, args)).output }
  /** Only the selected repository root is admitted; a subdirectory would expand its scope. */
  async plan(repository: string, id: string): Promise<GitTeam> {
    const directory = await realpath(repository)
    const top = await realpath(await this.text(directory, 'rev-parse', '--show-toplevel'))
    if (relative(top, directory)) throw new Error('Git 并行需要选择项目的 Git 根目录')
    if (inside(directory, this.root)) throw new Error('Git 并行工作区不能放在原项目目录内，请调整工作区根目录')
    const base = (await this.run(directory, ['rev-parse', '--verify', 'HEAD'], true)).output
    if (!/^[a-f0-9]{40,64}$/.test(base)) throw new Error('Git 并行需要项目已有一次提交')
    if (await this.text(directory, 'status', '--porcelain=v1', '-z')) throw new Error('原项目有未提交的修改，请先提交或选择同目录串行')
    return { repository: directory, base, integration: { repository: directory,
      directory: join(this.root, hash(id), 'integration'), branch: `superagent/${hash(id)}/integration`, inputs: [] }, members: {} }
  }
  private async check(workspace: GitWorkspace): Promise<void> {
    if (relative(await realpath(workspace.directory), await realpath(await this.text(workspace.directory, 'rev-parse', '--show-toplevel')))
      || await this.text(workspace.directory, 'symbolic-ref', '--short', 'HEAD') !== workspace.branch) throw new Error('工作区分支已改变，请在原会话检查后继续')
    const common = (directory: string) => this.text(directory, 'rev-parse', '--path-format=absolute', '--git-common-dir').then(path => realpath(path))
    if (relative(await common(workspace.directory), await common(workspace.repository))) throw new Error('工作区已不属于原项目，请检查 Git 目录')
  }
  private async ensure(team: GitTeam, workspace: GitWorkspace): Promise<void> {
    if (await stat(workspace.directory).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) {
      await this.check(workspace); return
    }
    await mkdir(dirname(workspace.directory), { recursive: true })
    const branch = await this.run(team.repository, ['show-ref', '--verify', '--quiet', `refs/heads/${workspace.branch}`], true)
    await this.text(team.repository, 'worktree', 'add', ...(branch.code === 0 ? [] : ['-b', workspace.branch]), workspace.directory, branch.code === 0 ? workspace.branch : team.base)
    await this.check(workspace)
  }
  private async pending(workspace: GitWorkspace): Promise<string[]> {
    const pending: string[] = []
    for (const head of workspace.inputs) {
      if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error('交付提交无效')
      const result = await this.run(workspace.directory, ['merge-base', '--is-ancestor', head, 'HEAD'], true)
      if (result.code === 1) pending.push(head)
      else if (result.code !== 0) throw new Error('交付提交已不可用，请检查成员工作区')
    }
    return pending
  }
  private async conflicts(workspace: GitWorkspace) {
    return (await this.text(workspace.directory, 'diff', '--name-only', '--diff-filter=U', '-z')).split('\0').filter(Boolean)
  }
  private async merging(workspace: GitWorkspace) {
    return (await this.run(workspace.directory, ['rev-parse', '--verify', '-q', 'MERGE_HEAD'], true)).code === 0
  }
  async prepare(team: GitTeam, member: string, inputs: string[] = []): Promise<GitMerge> {
    const workspace = member === 'coordinator' ? team.integration : team.members[member] ??= {
      repository: team.repository, directory: join(dirname(team.integration.directory), hash(member)),
      branch: `${team.integration.branch.slice(0, -'integration'.length)}member-${hash(member)}`, inputs: [] }
    workspace.inputs = [...new Set(inputs)]
    await this.ensure(team, workspace)
    const pending = await this.pending(workspace)
    if (!await this.merging(workspace)) {
      if (pending.length && await this.text(workspace.directory, 'status', '--porcelain=v1', '-z')) throw new Error('成员工作区有未提交的修改，请在原会话处理后继续')
      for (const head of pending) {
        const merge = await this.run(workspace.directory, ['merge', '--no-ff', '--no-edit', head], true)
        if (merge.code !== 0) {
          if (!await this.merging(workspace)) throw new Error(`无法合并交付 ${head.slice(0, 8)}，请在成员会话检查 Git 状态`)
          break
        }
      }
    }
    return { workspace, conflicts: await this.conflicts(workspace), pending: await this.pending(workspace) }
  }
  /** A ready report seals only this isolated worktree; unresolved inputs cannot become a delivery. */
  async capture(workspace: GitWorkspace): Promise<string> {
    await this.check(workspace)
    if ((await this.conflicts(workspace)).length) throw new GitDeliveryPending('交付仍有 Git 合并冲突，请先解决冲突，再提交交付')
    if (await this.text(workspace.directory, 'status', '--porcelain=v1', '-z') || await this.merging(workspace)) {
      await this.text(workspace.directory, 'add', '--all')
      await this.text(workspace.directory, 'commit', '--allow-empty', '-m', 'Superagent: record task delivery')
    }
    if ((await this.pending(workspace)).length) throw new GitDeliveryPending('尚未汇入全部前置交付，请在当前分支合并列出的提交后重新验证')
    return this.text(workspace.directory, 'rev-parse', 'HEAD')
  }
}
