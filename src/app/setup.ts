/** Probes repository and account CLIs, configures the worker execution environment and command shims, and tracks setup readiness. */
import type { Context } from '@deepseek-ai/cordis'
import { UserError } from '../core/index.ts'
import { SETUP_FIELDS, resolveDeployment, resolveFeishuBot, workerProbe, type Deployment, type Machine } from '../deployment.ts'
import { agentVariables, applyEnvironment, verifyEnvironment, withoutDirectory, workerBin, writeEnvironment } from '../infra/environment.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'
import { canonicalWorkspace } from '../executor/workspace.ts'

export interface SetupHost {
  readonly context: Context
  readonly machine: Machine
  readonly lifetime: AbortSignal
  restart(): void
}

const setupFields = (settings: Settings) =>
  JSON.stringify(Object.entries(SETUP_FIELDS).map(([id, keys]) => keys.map(key => settings.sources[id]?.config[key] ?? '')))
export const setupChanged = (before: Settings, after: Settings, local = false): boolean => setupFields(before) !== setupFields(after)
  || local && ['github', 'feishu'].some(id => !!before.sources[id]?.enabled !== !!after.sources[id]?.enabled)

/**
 * Resolves the target repository, GitHub account, and optional Feishu bot by probing CLIs, then writes and applies the isolated git and shim environment used by worker processes.
 * `Runtime` runs it at startup to gate orchestration readiness, while `Settings` uses it to validate account changes, update blocked command shims, and schedule restarts.
 */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  feishuProblem?: SetupProblem
  githubProblem?: SetupProblem
  /** PATH with the worker shim directory removed so the host's own CLI calls invoke the real binaries. */
  private readonly path: string
  /** Environment variables pointing agent subprocesses at the isolated git config and command shims. */
  private readonly variables: Record<string, string | undefined>
  private restoreEnvironment?: () => void
  constructor(private readonly host: SetupHost) {
    this.path = withoutDirectory(process.env.PATH ?? '', workerBin(host.machine.stateDir))
    this.variables = agentVariables(host.machine.stateDir)
  }
  /** Host command environment with agent git variables applied and the worker shim directory excluded from PATH. */
  get commandEnvironment(): Record<string, string | undefined> {
    return this.host.machine.mode === 'local' ? {} : { ...this.variables, PATH: this.path }
  }
  get deployment(): Deployment {
    if (!this.resolved) throw new Error(`dsh-superagent is waiting for setup: ${this.problem?.detail ?? 'setup has not run'}`)
    return this.resolved
  }
  configured(): boolean { return this.resolved !== undefined }
  get local(): boolean { return this.host.machine.mode === 'local' }
  /** Resolve deployment accounts and apply the worker environment, recording `SetupError` failures in `problem`/`feishuProblem` and rethrowing unexpected errors. */
  async run(settings: Settings): Promise<boolean> {
    try { this.resolved = await this.resolve(settings); return true }
    catch (error) {
      if (!(error instanceof SetupError)) throw error
      this.problem = error.problem
      return false
    }
  }
  /** Trigger a restart to re-run setup, refusing if setup and Feishu are already healthy so running assignments are not interrupted. */
  check(): void {
    if (this.configured() && !this.feishuProblem && !this.githubProblem) throw new UserError('setupComplete')
    this.restart()
  }
  /** Defer the restart to the next macrotask so the current HTTP or tool caller receives its response first. */
  restart(): void { setTimeout(this.host.restart, 0) }
  /** Verify account CLIs for a modified source block before saving, ignoring setup errors belonging to other blocks. */
  async checkAccounts(block: SettingsBlock, settings: Settings, previous?: Settings, hasGithubTasks = false): Promise<void> {
    if (this.local) {
      if (block !== 'source:github' && block !== 'source:feishu') return
      const id = block.slice(7) as 'github' | 'feishu'
      const source = settings.sources[id]
      const before = String(previous?.sources.github?.config.repository ?? '')
      const after = String(settings.sources.github?.config.repository ?? '')
      if (id === 'github' && hasGithubTasks && before && before.toLowerCase() !== after.toLowerCase()) throw new SetupError('repositoryInUse')
      if (source?.enabled) await this.localAccount(id, source.config)
      return
    }
    const { machine } = this.host
    const check = block === 'source:feishu' ? resolveFeishuBot(machine, settings.sources.feishu?.config, this.probe())
      : resolveDeployment(machine, settings.sources.github?.config, this.probe())
    await check.catch((error: unknown) => { if (!(error instanceof SetupError) || error.place === block.slice(7)) throw error })
  }
  async blockCommands(blocked: readonly string[]): Promise<void> {
    if (this.resolved?.github) await writeEnvironment(this.resolved, blocked)
  }
  restore(): void { this.restoreEnvironment?.(); this.restoreEnvironment = undefined }
  /** Probes CLIs the way worker shells run them, using `stateDir` as `cwd` since it exists even before the repository clone is valid. */
  private probe() {
    const { context, machine, lifetime } = this.host
    return workerProbe(context.subprocess, machine.stateDir, machine.stateDir, lifetime)
  }
  /** Check a local project before allowing an external source to execute in it. */
  private async localAccount(id: 'github' | 'feishu', config: Record<string, unknown>) {
    let directory: string
    try { directory = canonicalWorkspace({ directory: String(config.workspaceDirectory ?? ''), permissionPreset: 'workspace-write' }).directory }
    catch (error) { throw new SetupError(id === 'github' ? 'githubWorkspaceInvalid' : 'feishuWorkspaceInvalid', { output: error instanceof Error ? error.message : String(error) }) }
    if (id === 'feishu') return resolveFeishuBot(this.host.machine, config, this.probe())
    const deployment = await resolveDeployment(this.host.machine, config, this.probe())
    try {
      for (const flag of [[], ['--push']]) {
        const raw = (await this.probe()(['git', '-C', directory, 'remote', 'get-url', ...flag, 'origin'])).trim()
        let repository: string | undefined
        const scp = /^(?:[^@]+@)?(?:github\.com|ssh\.github\.com):([^/].+)$/.exec(raw)
        if (scp) repository = scp[1]
        else {
          const url = new URL(raw)
          if (url.hostname === 'github.com' || url.hostname === 'ssh.github.com') repository = url.pathname.replace(/^\//, '')
        }
        if (repository?.replace(/\.git$/, '').toLowerCase() !== deployment.repository.toLowerCase()) throw new Error('Repository mismatch')
      }
    } catch { throw new SetupError('githubWorkspaceInvalid', { output: '请使用监听仓库的独立本地 checkout，并确认 origin 的读取与推送地址。' }) }
    try {
      const root = `repos/${deployment.repository}`
      const api = (path: string, query: string) => this.probe()([deployment.github!.cli, 'api', `${root}/${path}`, '--jq', query])
      await api('issues?per_page=1', 'length')
      await api('pulls?per_page=1', 'length')
      await api('actions/runs?per_page=1', '.total_count')
      const branch = (await this.probe()([deployment.github!.cli, 'api', root, '--jq', '.default_branch'])).trim()
      if (branch && branch !== 'null') {
        await api(`commits/${encodeURIComponent(branch)}/statuses?per_page=1`, 'length')
      }
    } catch (error) { throw new SetupError('githubAccessIncomplete', { output: error instanceof Error ? error.message : String(error) }) }
    return deployment
  }
  private async resolve(settings: Settings): Promise<Deployment> {
    const { context, machine, lifetime } = this.host
    if (machine.mode === 'local') {
      let deployment: Deployment = { ...machine, repository: '' }
      this.githubProblem = this.feishuProblem = undefined
      for (const id of ['github', 'feishu'] as const) {
        const source = settings.sources[id]
        if (!source?.enabled) continue
        try {
          const account = await this.localAccount(id, source.config)
          if (id === 'github') deployment = account as Deployment
          else if (account) deployment = { ...deployment, feishu: account as NonNullable<Deployment['feishu']> }
        } catch (error) {
          if (!(error instanceof SetupError)) throw error
          if (id === 'github') this.githubProblem = error.problem
          else this.feishuProblem = error.problem
          context.logger.warn('dsh-superagent leaves %s disconnected: %s', id, error.message)
        }
      }
      return deployment
    }
    const probe = this.probe()
    const deployment = await resolveDeployment(machine, settings.sources.github?.config, probe)
    const feishu = await resolveFeishuBot(machine, settings.sources.feishu?.config, probe).catch((error: unknown) => {
      if (!(error instanceof SetupError)) throw error
      this.feishuProblem = error.problem
      context.logger.warn('dsh-superagent leaves Feishu out: %s', error.message)
      return undefined
    })
    const resolved = { ...deployment, ...(feishu ? { feishu } : {}) }
    const machineProblem = (error: unknown): never => {
      if (error instanceof SetupError) throw error
      throw new SetupError('environmentFailed', { output: error instanceof Error ? error.message : String(error) })
    }
    await writeEnvironment(resolved, settings.executor.blockedCommands).catch(machineProblem)
    this.restoreEnvironment = applyEnvironment(this.variables, machine.stateDir, this.path)
    await verifyEnvironment(resolved, context.subprocess, lifetime).catch((error: unknown) => {
      this.restore()
      machineProblem(error)
    })
    return resolved
  }
}
