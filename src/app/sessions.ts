/** Lifecycle, prompt/tool/skill decoration, message delivery, and budget retry tracking for orchestrator and worker DSH sessions. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { basename, dirname } from 'node:path'
import { z } from 'zod'
import { key, liveTicket, UserError, type Ticket } from '../core/index.ts'
import { mandateInstructions, ticketOfSession } from '../executor/dsh.ts'
import { workspaceOf } from '../executor/workspace.ts'
import type { HealthEntry } from '../infra/health.ts'
import { AgentDelivery, messageId } from './delivery.ts'
import type { Effects } from './effects.ts'
import type { Variable } from './execution-environment.ts'
import { RetryHealth } from './retry-health.ts'
import { initializeRoleModel, resolveRoleModel, sessionModels } from './role-models.ts'
import type { RoleModel } from '../policy.ts'
import { bundledSkills } from './skill-files.ts'
import { SKILL_PREFIX, type PromptVersion, type Prompts } from './prompts.ts'
import type { Store } from './store.ts'
import { KV, type SessionCommandProof } from '../kv.ts'
import { toolParameters, type RegisterTool, type Tool } from './tools/tool.ts'
import { PROJECT_OPS_READ_TOOLS, PROJECT_OPS_OTHER_TOOLS } from './plugin-tools.ts'

/** Host dependencies used by `Sessions`. */
export interface SessionsHost {
  /** DSH Cordis context: sessions, agents, persistence, and their events. */
  readonly context: Context
  readonly store: Pick<Store, 'tickets' | 'triggers' | 'settings' | 'get' | 'set' | 'keys'>
  readonly prompts: Pick<Prompts, 'current' | 'version' | 'compose' | 'skills'>
  readonly effects: Pick<Effects, 'enqueue' | 'handle' | 'idle' | 'pending'>
  /** The `models` health entry, which reports managed sessions waiting on a model-budget retry. */
  readonly health: HealthEntry
  readonly local?: boolean
  readonly masterId: string
  readonly lifetime: AbortSignal
  closing(): boolean
  /** Execution environment variables for `ticket`, rendered into its worker's system prompt. */
  environment(ticket: Ticket): Variable[]
  /** Tools to register on the main Session (`ticket === undefined`) or on `ticket`'s worker Session. */
  tools(agent: Agent, ticket?: Ticket): Tool[]
}

/**
 * What Sessions registered for an agent it decorated: the releases of its prompt section, tools and skill scope, the scope
 * its skills are registered in, and the skills of one prompt revision; for a worker's subagent, only its tool limits.
 */
interface SessionBinding { disposers: (() => void)[]; scope?: Context; skills?: { revision: number; dispose: () => void }; subagent?: true; model?: { current: ModelSelection } }
export interface SessionToolActivity { id: string; name: string; at: string; state: 'running' | 'done' | 'error' | 'interrupted'; detail?: string }
/** DSH jobs records terminal shell facts separately from tool/result when a command runs in the background. */
interface ShellSettlement {
  owner: string; kind: string; toolCall?: { callId: string }; status: string; detail?: string; producerReported: boolean
}

/** The agent presets Executor Sessions and the main Session are created with, which the bundle's patch defines. */
export const WORKER_PRESET = 'dsh-superagent-worker', ROUTER_PRESET = 'dsh-superagent-router'
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** DSH's agent preset registry selected `agentPreset` for a Session. */
    'agent-preset/selected'(sessionId: string, agentPreset: string): void
  }
}
/**
 * The DSH tools an Executor Session works with: files, search, the shell and its jobs, the web, skills and its todo list.
 * It gets no other tool the profile has, whenever it was registered: none that asks or shows a person something,
 * changes the profile, schedules work or starts goals outside the worker slots, the pause and a person's hold, starts or
 * messages other Sessions. Project Ops exposes only its four read-only project tools.
 */
const WORK_TOOLS = ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill', 'web_search',
  'web_fetch', 'skill', 'todo_write', ...PROJECT_OPS_READ_TOOLS]
const NATIVE_DELEGATION = new Set(['subagent', 'spawn_agent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent'])
const DELEGATION_NOTICE = '此任务由 Superagent 管理，请完成当前分工并用 orchestrator_report 回传；团队成员由插件派发，不另建原生子代理。'
/** What the main Session is told when it would wait: what it waits for comes to it, and a waiting step holds back the next. */
const NO_WAIT = 'Reports, follow_up notices, new candidates and a background job\'s end with its output arrive by themselves as messages; '
  + 'end the turn instead of waiting for them.'
/** What a main Session under `standard` is told when its command would wait the shell's default. */
const DEFAULT_WAIT = 'This shell waits up to 60 seconds by default: pass timeoutMs of at most 30000, or run_in_background, '
  + 'as a waiting step holds back new candidates.'
/** `sleep` at a command position: the start, after ; & | ( { ! ` or a newline, or after a keyword or a command that runs it. */
const SLEEP = /(?:^|[;&|({!`\n]|\b(?:do|then|else|elif|if|while|until|time|exec|nohup|command|env)\s)\s*(?:\S*\/)?sleep\b/
const PWSH_SLEEP = /(?:^|[;&|({\n])\s*(?:(?:\S+\\)?Start-Sleep|sleep)\b/i
/**
 * The main Session's guard: it refuses a shell command that sleeps or asks to hold the step longer than 30 seconds, and a
 * job wait longer than 5 seconds. Under `standard`, as a main Session created before the router preset runs, the shell holds
 * a command 60 seconds and a job wait lasts 30 seconds by default, so a command needs a timeout or the background, and a
 * job wait its timeout; the router preset ends both after 5 seconds.
 */
function noWait({ name, arguments: input }: { name: string; arguments: unknown }, routed: () => boolean): string | undefined {
  const args = (input ?? {}) as { command?: unknown; timeoutMs?: unknown; run_in_background?: unknown; wait?: unknown; timeout_ms?: unknown }
  if (name === 'bash' || name === 'pwsh') {
    const sleeps = typeof args.command === 'string' && (name === 'pwsh' ? PWSH_SLEEP : SLEEP).test(args.command)
    if (sleeps || typeof args.timeoutMs === 'number' && args.timeoutMs > 30_000) return NO_WAIT
    if (args.timeoutMs === undefined && args.run_in_background !== true && !routed()) return DEFAULT_WAIT
  }
  if (name === 'job_output' && args.wait === true && (typeof args.timeout_ms === 'number' ? args.timeout_ms > 5_000 : !routed())) return NO_WAIT
  return undefined
}

/**
 * Creates and decorates orchestrator and worker DSH `Agent` sessions with role models, system prompt sections from `Prompts`, runtime skills, and restricted tool sets.
 * `Runtime`, `DshExecutor`, `MasterAssessor`, `Settings`, and management routes/tools use it to ensure sessions, deliver deduplicated messages via `AgentDelivery`, and process ordered `relay` and `notice` effects.
 * Feeds session events into `RetryHealth` to report model budget waits on the `models` `HealthEntry`, and durably records which prompt revisions each session has worked under in `Store` (`KV.sessions.prompts`) to authorize prompt version reads.
 */
export class Sessions {
  private readonly agentDelivery: AgentDelivery
  /** Decorated agents mapped to their registered disposers and skill scope until the agent is disposed or `Sessions.dispose()` runs. */
  private readonly bindings = new Map<Agent, SessionBinding>()
  private readonly recentTools = new Map<string, SessionToolActivity[]>()
  private readonly retryHealth = new RetryHealth()
  private readonly ctx: Context
  /** Registers ordered `relay` and `notice` effect handlers that deliver to the main Session. */
  constructor(private readonly host: SessionsHost) {
    this.ctx = host.context
    this.agentDelivery = new AgentDelivery(host.context)
    // Deliver relays and notices to the main Session in the order they were queued.
    host.effects.handle('relay', ({ text }, requestId) => this.prompt(host.masterId, requestId, text, 'steer'), { ordered: true })
    host.effects.handle('notice', ({ value, summary }, name) => this.inject(name, value, summary), { ordered: true })
  }
  /** Subscribes to host agent and session events so newly created sessions are decorated and model-budget retries are reflected in health. Call once at startup. */
  install(): void {
    const ctx = this.ctx
    ctx.on('agent/disposed', ({ agent }) => {
      this.release(agent)
      this.recentTools.delete(agent.id)
      this.retryHealth.clear(agent.id); this.updateModelHealth()
    })
    ctx.on('session/event', (session, event) => {
      const agent = ctx.agents.get(session.id)
      const binding = agent && agent.session === session ? this.bindings.get(agent) : undefined
      if (event.type === 'model/selection' && ticketOfSession(session.id) && this.host.store.tickets.get(ticketOfSession(session.id)!)) {
        this.host.store.set(sessionModels(session.id), event.data)
      }
      if (!agent || !binding || binding.subagent) return
      if (event.type === 'model/selection') {
        this.host.store.set(sessionModels(agent.id), event.data)
        this.bindModel(agent, binding, event.data)
      }
      if (event.type === 'tool/call') {
        const tools = this.recentTools.get(agent.id) ?? []
        const started: SessionToolActivity = { id: event.data.callId, name: event.data.name, at: new Date(event.time).toISOString(), state: 'running' }
        try {
          const args = JSON.parse(event.data.arguments) as Record<string, unknown>
          const detail = [args.description, args.file_path, args.filePath, args.path].find(value => typeof value === 'string')
          if (typeof detail === 'string') started.detail = detail.replace(/\s+/g, ' ').slice(0, 240)
          const command = args.command ?? args.script
          if (['bash', 'pwsh'].includes(started.name) && typeof command === 'string') {
            const name = this.commandKey(agent.id, started.id)
            if (name) this.host.store.set(name, { id: started.id, command: command.trim(), at: started.at,
              sequence: Number(event.seq ?? 0), state: 'running' })
          }
        } catch { /* Some tools have no JSON arguments; their real name and state remain visible. */ }
        const recent = [...tools.filter(tool => tool.id !== started.id), started].slice(-24)
        this.recentTools.set(agent.id, recent)
      } else if (event.type === 'tool/result') {
        const name = this.commandKey(agent.id, event.data.message.toolCallId), proof = name && this.host.store.get(name)
        const tool = this.recentTools.get(agent.id)?.find(tool => tool.id === event.data.message.toolCallId)
        if (tool) tool.state = event.data.message.isError || proof?.state === 'error' ? 'error' : 'done'
        // A successful tool transport may have a non-zero exit or only a background-job receipt.
        if (name && proof && event.data.message.isError) this.host.store.set(name, { ...proof, state: 'error' })
      } else if ((event.type as string) === 'job/settled') {
        const job = event.data as unknown as ShellSettlement
        if (job.owner === agent.id && ['bash', 'pwsh'].includes(job.kind) && job.toolCall) {
          // This detail is generated by the shell producer, never taken from command stdout.
          const exit = /^exit code: (-?\d+)$/.exec(job.detail ?? '')
          const exitCode = exit ? Number(exit[1]) : undefined
          const state = job.status === 'completed' && job.producerReported && exitCode !== undefined
            ? exitCode === 0 ? 'done' : 'error'
            : ['failed', 'killed'].includes(job.status) || job.detail?.includes('[sandbox:') ? 'error' : undefined
          if (state) this.commandResult(agent.id, job.toolCall.callId, state, exitCode)
        }
      }
      this.retryHealth.observe(agent.id, event)
      this.updateModelHealth()
    })
    ctx.on('agent/created', async ({ agent }) => { await this.decorate(agent); return undefined })
    // Opening a Session in DSH's Web UI before its first turn may select the default preset for it: select ours again. After
    // its first turn DSH refuses any selection, which leaves it as it is.
    ctx.inject(['agentPresets'], child => {
      child.on('agent-preset/selected', (sessionId, preset) => {
        const ticketId = ticketOfSession(sessionId), agent = ctx.agents.get(sessionId as SessionId)
        const ours = sessionId === this.host.masterId ? ROUTER_PRESET : ticketId && this.host.store.tickets.get(ticketId) ? WORKER_PRESET : undefined
        if (!ours || preset === ours || !agent) return
        const presets = child.get('agentPresets') as { select(agent: Agent, preset: string): Promise<string> }
        presets.select(agent, ours).catch(() => {})
      })
    })
    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') for (const tool of this.recentTools.get(agent.id) ?? []) if (tool.state === 'running') tool.state = 'interrupted'
      if (status === 'idle' && !this.host.closing()) { this.retryHealth.clear(agent.id); this.updateModelHealth() }
    })
  }
  /** Selected model for a managed Session; an absent choice inherits its role's default. */
  model(id: string): RoleModel | null {
    this.requireManaged(id)
    const saved = this.host.store.get(sessionModels(id))
    if (saved) return saved
    const header = this.ctx.agents.get(id as SessionId)?.session.requestHeader()?.config
    if (header) return { provider: header.provider, model: header.model, ...(header.reasoningEffort ? { reasoningEffort: header.reasoningEffort } : {}) }
    const settings = this.host.store.settings()
    return id === this.host.masterId ? settings.eval.model : settings.executor.model
  }
  private requireManaged(id: string): void {
    const ticketId = ticketOfSession(id)
    if (id !== this.host.masterId && (!ticketId || !this.host.store.tickets.get(ticketId))) throw new UserError('unknownAssignment')
  }
  /** Change only this Session; an already assembled request keeps its model until the next step. */
  async selectModel(id: string, model: RoleModel | null): Promise<RoleModel> {
    this.requireManaged(id)
    const settings = this.host.store.settings()
    const fallback = model ?? (id === this.host.masterId ? settings.eval.model : settings.executor.model) ?? (await this.ctx.sessionController.modelCatalog()).default
    if (!fallback) throw new UserError('modelUnavailable', { block: 'executor', error: 'DSH 未配置默认模型' })
    let selected: ModelSelection
    try { selected = await resolveRoleModel(this.ctx, fallback) }
    catch (error) { throw new UserError('modelUnavailable', { block: 'executor', error: String(error) }) }
    const result = await this.ctx.sessionController.resolveAgent(id as SessionId)
    if ('error' in result && result.error.code !== 'session/not-found') throw result.error
    this.host.store.set(sessionModels(id), selected)
    if (!('error' in result)) {
      await this.decorate(result.agent)
      this.bindModel(result.agent, this.bindings.get(result.agent)!, selected)
      result.agent.session.append('model/selection', selected)
      await this.ctx.sessionPersistence.flush()
    }
    return selected
  }
  private bindModel(agent: Agent, binding: SessionBinding, model: RoleModel): void {
    const selected: ModelSelection = { provider: model.provider, model: model.model,
      ...(model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } : {}) }
    if (binding.model) binding.model.current = selected
    else {
      const selection = binding.model = { current: selected }
      let assembled: ModelSelection | undefined
      // Use the same prompt/request waterfall as role defaults on both supported SDK versions.
      binding.disposers.push(agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const snapshot = selection.current
        const result = await next()
        assembled = snapshot
        return { ...result, variables: { ...result.variables, provider: snapshot.provider, model: snapshot.model } }
      }, { prepend: true }), agent.ctx.on('agent/request', async (_payload, next) => {
        const snapshot = assembled
        const result = await next()
        if (!snapshot) return result
        const { reasoningEffort: _previous, ...rest } = result
        return { ...rest, ...snapshot }
      }, { prepend: true }))
    }
  }
  /** Resolves or creates session `id` in workspace `cwd`, seeds its model, and decorates its tools and prompts. */
  async ensure(id: string, cwd: string, title: string, role: 'orchestrator' | 'worker'): Promise<Agent> {
    const ctx = this.ctx
    if (this.host.local && role === 'orchestrator') {
      const workspace = await ctx.workspaceRegistry.create(cwd, 'Superagent')
      if (workspace.title === basename(cwd)) await workspace.setTitle('Superagent')
    }
    let created = false
    let result = await ctx.sessionController.resolveAgent(id as SessionId)
    if ('error' in result && result.error.code === 'session/not-found') {
      const workspace = await ctx.workspaceRegistry.create(cwd)
      // A Session keeps the preset it was created with, one of the bundle's own (cordis.patch.yml).
      await ctx.sessionController.create({ sessionId: id as SessionId, workspaceId: workspace.id,
        agentPreset: role === 'worker' ? WORKER_PRESET : ROUTER_PRESET })
      created = true
      result = await ctx.sessionController.resolveAgent(id as SessionId)
    }
    if ('error' in result) throw result.error
    const settings = this.host.store.settings()
    await initializeRoleModel(ctx, result.agent, this.host.store.get(sessionModels(id)) ?? (role === 'orchestrator' ? settings.eval.model : settings.executor.model))
    await this.decorate(result.agent)
    if (this.host.local && created) {
      const ticketId = ticketOfSession(id)
      const ticket = ticketId && this.host.store.tickets.get(ticketId)
      const workspace = ticket && workspaceOf(this.host.store, ticket)
      const preset = workspace ? workspace.permissionPreset : ctx.permissionPresets.defaultPreset
      ctx.permissionPresets.set(result.agent.session, preset)
    } else if (!this.host.local) ctx.permissionPresets.set(result.agent.session, 'danger-full-access')
    await ctx.sessionController.rename({ sessionId: id as SessionId, title })
    return result.agent
  }
  /** Returns whether `sessionId` already holds the message delivered under `requestId`, or `false` if the session does not exist. */
  async holds(sessionId: string, requestId: string): Promise<boolean> {
    const result = await this.ctx.sessionController.resolveAgent(sessionId as SessionId)
    return !('error' in result) && await this.agentDelivery.holds(result.agent, key(requestId))
  }
  /** Restore this runtime's tools/prompts before delivering once per request id to a retained DSH agent. */
  async prompt(sessionId: string, requestId: string, text: string, mode: 'queue' | 'steer' | { inject: string }, authorize?: () => void,
    accepted?: () => void): Promise<void> {
    const result = await this.ctx.sessionController.resolveAgent(sessionId as SessionId)
    if ('error' in result) throw result.error
    await this.decorate(result.agent)
    await this.agentDelivery.send(result.agent, key(requestId), text, mode, this.host.lifetime, authorize, accepted)
  }
  /** The id of the message `prompt` delivers under `requestId`, which DSH's inbox events name it by. */
  promptedId(requestId: string): MessageId { return messageId(key(requestId)) }
  async nativePrompt(sessionId: string, message: UserMessage, authorize: () => void): Promise<void> {
    const result = await this.ctx.sessionController.resolveAgent(sessionId as SessionId)
    if ('error' in result) throw result.error
    await this.decorate(result.agent)
    await this.agentDelivery.native(result.agent, message, this.host.lifetime, authorize)
  }
  /** Enqueues a steering relay to the main Session; relays are durable and retried by `Effects` until delivered, at most once per `requestId`. */
  relay(requestId: string, text: string): void { this.host.effects.enqueue('relay', requestId, { text }) }
  /** Enqueues a durable background notice for injection into the main Session; a new notice with the same `name` replaces a still-waiting notice of that `name`. */
  notify(name: string, value: Record<string, unknown>, summary: string): void { this.host.effects.enqueue('notice', name, { value, summary }) }
  /** Waits for currently runnable `notice` effects to settle and returns `'injected'` if notice `name` has reached the main Session or `'pending'` if it is still queued. */
  async delivery(name: string): Promise<'injected' | 'pending'> {
    await this.host.effects.idle('notice')
    return this.host.effects.pending('notice', name) ? 'pending' : 'injected'
  }
  /** Injects a notice into the main Session without waking it; no-op if the main Session does not exist yet. */
  private async inject(name: string, value: Record<string, unknown>, summary: string): Promise<void> {
    const resolved = await this.ctx.sessionController.resolveAgent(this.host.masterId as SessionId)
    if ('error' in resolved) return
    // Deduplicate by notice name and payload hash so retries are idempotent while updated payloads still deliver.
    const text = JSON.stringify(value)
    await this.agentDelivery.send(resolved.agent, `notice:${name}:${key(text)}`, text, { inject: summary }, this.host.lifetime)
  }
  /** Returns the current prompt revision, the active prompt revision of each loaded Session, and whether the main Session still has a pending `'prompts'` notice. */
  status() {
    const { store, prompts, effects } = this.host
    const sessions = store.keys(KV.sessions.prompts).flatMap(name => {
      const sessionId = name.slice(KV.sessions.prompts.prefix.length), revision = store.get(name)?.at(-1)
      return this.ctx.agents.get(sessionId as SessionId) && revision !== undefined ? [{ sessionId, revision }] : []
    })
    return { revision: prompts.current().revision, sessions, notificationPending: effects.pending('notice', 'prompts') }
  }
  /** Read-only live activity; only a tool's brief description or file path is exposed, never commands or outputs. */
  activity(sessionId: string) {
    const agent = this.ctx.agents.get(sessionId as SessionId)
    return { running: agent?.status === 'running', tools: this.recentTools.get(sessionId) ?? [], quotaWait: this.retryHealth.quotaWaiting(sessionId) }
  }
  /** Availability in the host and the explicit worker policy are separate signals. No tool is invoked here. */
  capabilities() {
    return { tools: [...PROJECT_OPS_READ_TOOLS, ...PROJECT_OPS_OTHER_TOOLS].map(name => {
      const lastCall = [...this.recentTools].flatMap(([sessionId, tools]) => tools.filter(tool => tool.name === name)
        .map(tool => ({ sessionId, at: tool.at, state: tool.state }))).sort((a, b) => b.at.localeCompare(a.at))[0]
      return { name, registered: typeof this.ctx.tools.get === 'function' && !!this.ctx.tools.get(name),
        worker: WORK_TOOLS.includes(name), lastCall }
    }) }
  }
  private commandKey(sessionId: string, callId = '') {
    const ticketId = ticketOfSession(sessionId)
    if (!this.host.local || !ticketId) return undefined
    const assignment = this.host.store.tickets.get(ticketId)?.assignments.at(-1)
    return assignment?.startedAt ? KV.sessions.commands(sessionId, assignment.id, callId) : undefined
  }
  private commandResult(sessionId: string, callId: string, state: SessionCommandProof['state'], exitCode?: number): void {
    const name = this.commandKey(sessionId, callId), proof = name && this.host.store.get(name)
    if (name && proof) {
      this.host.store.set(name, { ...proof, state, ...(exitCode !== undefined ? { exitCode } : {}) })
      const tool = this.recentTools.get(sessionId)?.find(tool => tool.id === callId)
      if (tool) tool.state = state
    }
  }
  /** Match the latest real call within this assignment; UI truncation and binding reloads cannot erase its evidence. */
  commandEvidence(sessionId: string, command: string, since: string) {
    const prefix = this.commandKey(sessionId)
    if (!prefix) return undefined
    return this.host.store.keys(prefix).flatMap(name => this.host.store.get<SessionCommandProof>(name) ?? [])
      .filter(proof => proof.at >= since && proof.command === command.trim())
      .sort((a, b) => a.sequence - b.sequence || a.at.localeCompare(b.at)).at(-1)
  }
  /** Returns the prompt version a Session runs under (the one bound on its latest model request, or the current version). */
  promptVersion(sessionId: string): PromptVersion {
    const revision = this.host.store.get(KV.sessions.prompts(sessionId))?.at(-1)
    return revision === undefined ? this.host.prompts.current() : this.host.prompts.version(revision)
  }
  /** Whether a Session is authorized to read `revision` (its active revision or any revision it previously ran under). */
  mayRead(sessionId: string, revision: number): boolean {
    return revision === this.promptVersion(sessionId).revision || (this.host.store.get(KV.sessions.prompts(sessionId)) ?? []).includes(revision)
  }
  /** Returns a tool registrar for `agent` that renders tool output as JSON text and attaches `output.image` as an image when present. */
  private registerTool(agent: Agent, binding: SessionBinding): RegisterTool {
    return (name, description, schema, execute) => {
      binding.disposers.push(agent.ctx.tools.register({ name, description, parameters: toolParameters(schema),
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => {
          const text = { type: 'text' as const, text: JSON.stringify(value) }
          const image = value && typeof value === 'object' && 'image' in value ? (value as { image: never }).image : undefined
          return image ? [text, { type: 'image' as const, attachment: image }] : [text]
        } },
        execute: (args, execution) => execute(schema.parse(args), execution.signal) }))
    }
  }
  /** Returns `sessionId`'s active model-budget retry state (`{ model_retry }`) for status listings, or `{}` when not waiting on one. */
  modelRetry(sessionId: string | undefined) {
    const retry = sessionId ? this.retryHealth.get(sessionId) : undefined
    return retry ? { model_retry: retry } : {}
  }
  private updateModelHealth(): void {
    const retries = this.retryHealth.list()
    this.host.health.set(retries.length
      ? { state: 'error', detail: retries.slice(0, 5).map(item => `${item.sessionId}: ${item.provider} is over its model budget; retried ${item.attempts} times, waiting since ${item.since}; the model and retry policy are unchanged`).join('; ') + (retries.length > 5 ? `; ${retries.length - 5} more Sessions` : ''), at: retries.at(-1)!.lastAt }
      : { state: 'ready', detail: 'No managed Session is waiting on a model budget retry' })
  }
  private ticketOf(agent: Agent): Ticket | undefined {
    const ticketId = ticketOfSession(agent.id)
    return ticketId === undefined ? undefined : this.host.store.tickets.get(ticketId)
  }
  private async decorate(agent: Agent): Promise<void> {
    if (this.bindings.has(agent)) return
    const host = this.host
    const master = agent.id === host.masterId
    const ticket = master ? undefined : this.ticketOf(agent)
    if (!master && !ticket) { this.limitSubagent(agent); return }
    const binding: SessionBinding = { disposers: [] }
    this.bindings.set(agent, binding)
    if (host.local && ticket) binding.disposers.push(agent.ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (exec.agent !== agent || !['bash', 'pwsh'].includes(exec.name)) return decision
      const value = result.value && typeof result.value === 'object' && !Array.isArray(result.value) ? result.value : undefined
      const sandbox = value?.sandbox && typeof value.sandbox === 'object' && !Array.isArray(value.sandbox) ? value.sandbox : undefined
      const exitCode = typeof value?.exitCode === 'number' && Number.isInteger(value.exitCode) ? value.exitCode : undefined
      const failed = result.isError || decision.kind === 'block' || value?.timedOut || value?.aborted || value?.signal || value?.stopped
        || sandbox?.denied || sandbox?.runnerFailed || exitCode !== undefined && exitCode !== 0
      if (failed || exitCode !== undefined) this.commandResult(agent.id, exec.callId, failed ? 'error' : 'done', exitCode)
      return decision
    }))
    const model = host.store.get(sessionModels(agent.id))
    if (model) this.bindModel(agent, binding, model)
    this.retryHealth.restore(agent.id, agent.session.snapshotEvents())
    if (agent.status === 'idle') this.retryHealth.clear(agent.id)
    this.updateModelHealth()
    // Disable variable interpolation so literal ${{ ... }} expressions in team prompts are preserved.
    binding.disposers.push(agent.ctx.systemPrompt.section({ name: 'dsh-superagent-policy', order: 9999, interpolate: false, text: context => {
      const version = this.promptFor(agent, context.signal !== undefined)
      const current = ticket && host.store.tickets.get(ticket.id)
      const composed = host.prompts.compose(version.config, master ? 'orchestrator' : 'worker', current ? host.environment(current) : undefined)
      return `[dsh-superagent prompt revision ${version.revision}]\n${composed}\n${current ? mandateInstructions(current.mandate) : ''}`
    }, ...(master ? { complete: true } : {}) }))
    // A recreated skill scope (e.g. after the skills service restarts) starts empty, so reset `binding.skills` before rebinding.
    const skillScope = agent.ctx.inject(['skills'], scope => {
      binding.scope = scope
      binding.skills = undefined
      this.bindSkills(binding, host.prompts.current())
    })
    binding.disposers.push(() => { skillScope.dispose().catch((error: unknown) => { this.ctx.logger.warn('dsh-superagent could not release a skill scope: %s', String(error)) }) })
    await skillScope
    // Bail out if the agent was disposed while awaiting the skill scope.
    if (this.bindings.get(agent) !== binding) return
    const register = this.registerTool(agent, binding)
    for (const tool of host.tools(agent, ticket)) register(tool.name, tool.description, tool.schema, tool.execute)
    if (master) {
      const parent = scopeParentOf(agent)
      const allow = ['skill', 'bash', 'pwsh', 'read', 'read_image', 'job_output', 'job_list', 'job_kill']
        .filter(name => agent.ctx.tools.get(name, parent))
      binding.disposers.push(agent.ctx.tools.restrict({ allow }),
        agent.ctx.tools.guard(execution => NATIVE_DELEGATION.has(execution.name) ? DELEGATION_NOTICE : noWait(execution, () => this.routed(agent))))
    } else {
      // An Executor Session keeps the profile's work tools it has, which DSH requires to be known; its own tools are not masked.
      binding.disposers.push(...this.workOnly(agent, ticket!.id))
    }
  }
  /**
   * Whether a Session runs the router preset: as DSH's preset registry last selected it, read through the session projection
   * on a DSH whose registry has no `presetForSession`, else as it was created; `standard`, the safer caps, when unreadable.
   */
  private routed(agent: Agent): boolean {
    try {
      const presets = this.ctx.get('agentPresets') as { presetForSession?: (session: Agent['session']) => string | null } | undefined
      const projections = this.ctx.get('sessionProjections') as { stateOf?: (session: Agent['session'], key: string) => unknown } | undefined
      const selected = typeof presets?.presetForSession === 'function' ? presets.presetForSession(agent.session)
        : projections?.stateOf?.(agent.session, 'agentPreset')
      return (selected ?? agent.session.header.agentPreset) === ROUTER_PRESET
    } catch { return false }
  }
  /**
   * An Executor Session's tools: only the profile's work tools, which DSH requires to be known, and none once its ticket
   * ended. A failed or blocked worker keeps its tools, so a person may continue it in its Session; only automated input waits
   * (see the executor). Read inherited tools through the parent scope, which includes the preset's tools. The global view
   * misses preset tools; the agent's own view also includes local tools such as subagent, which restrict refuses to name.
   */
  private workOnly(agent: Agent, ticketId: string): (() => void)[] {
    const store = this.host.store
    const parent = scopeParentOf(agent)
    const allow = WORK_TOOLS.filter(name => agent.ctx.tools.get(name, parent))
    return [agent.ctx.tools.restrict({ allow }), agent.ctx.tools.guard(execution => {
      if (NATIVE_DELEGATION.has(execution?.name)) return DELEGATION_NOTICE
      const current = store.tickets.get(ticketId)
      return !current || !liveTicket(current) ? 'Ticket ended; new work needs a new authorized ticket' : undefined
    })]
  }
  /**
   * A subagent of an Executor Session, or of one of its subagents, which runs under DSH's `standard` preset with the worker's
   * permissions, gets the same work tools as the worker, and none once the worker's ticket ended. Any other agent is left as
   * it is.
   */
  private limitSubagent(agent: Agent): void {
    let parent = agent.session.header.parentSession
    // Up the subagents' parents to the worker, which are loaded while their subagents run.
    for (let depth = 0; parent !== undefined && ticketOfSession(parent) === undefined && depth < 8; depth++) {
      parent = this.ctx.agents.get(parent)?.session.header.parentSession
    }
    const ticketId = parent === undefined ? undefined : ticketOfSession(parent)
    if (ticketId === undefined || !this.host.store.tickets.get(ticketId)) return
    this.bindings.set(agent, { disposers: this.workOnly(agent, ticketId), subagent: true })
  }
  /** Register the skills of a prompt version in the agent's skill scope, in place of an earlier version's. */
  private bindSkills(binding: SessionBinding, version: PromptVersion): void {
    const { scope, skills: previous } = binding
    if (!scope || previous?.revision === version.revision) return
    previous?.dispose()
    const disposers: (() => void)[] = []
    for (const [name, content] of this.host.prompts.skills(version.config)) {
      const bundled = name === 'feishu' || name === 'github' ? bundledSkills[name] : undefined
      const body = version.config.skills[name] ?? ''
      const description = bundled?.description ?? (body.replace(/\s+/g, ' ').slice(0, 120) || 'Custom dsh-superagent operational skill.')
      disposers.push(scope.skills.register({ name: `${SKILL_PREFIX}${name}`, description, content, source: 'runtime',
        ...(bundled ? { resourceBase: { kind: 'directory' as const, path: dirname(bundled.path) } } : {}) }))
    }
    binding.skills = { revision: version.revision, dispose: () => { disposers.forEach(dispose => dispose()) } }
  }
  /** Return the current prompt version, updating the agent's skills and recording the revision in Store when bound to a model request. */
  private promptFor(agent: Agent, bind: boolean): PromptVersion {
    const version = this.host.prompts.current()
    if (!bind) return version
    const binding = this.bindings.get(agent)
    if (binding) this.bindSkills(binding, version)
    const { store } = this.host
    const revisions = store.get(KV.sessions.prompts(agent.id)) ?? []
    const bound = [...revisions.filter(revision => revision !== version.revision), version.revision]
    if (revisions.at(-1) !== version.revision) store.set(KV.sessions.prompts(agent.id), bound)
    return version
  }
  /** Releases registrations for `agent` in reverse order (LIFO); disposing its skill scope releases its skills as well. */
  private release(agent: Agent): void {
    const binding = this.bindings.get(agent)
    if (!binding) return
    this.bindings.delete(agent)
    binding.skills?.dispose()
    for (const dispose of binding.disposers.splice(0).reverse()) {
      try { dispose() } catch (error) { this.ctx.logger.warn('dsh-superagent could not release what it registered for a Session: %s', String(error)) }
    }
  }
  /** Releases prompt sections, skills, and tools registered by `Sessions` across all decorated agents. */
  dispose(): void { for (const agent of [...this.bindings.keys()]) this.release(agent); this.recentTools.clear() }
}
