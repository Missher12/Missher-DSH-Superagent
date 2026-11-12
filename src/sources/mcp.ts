/** Authenticated external task intake. Clients select only workspaces explicitly granted by the DSH operator. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Runtime } from '../app/runtime.ts'
import { key, latestReport, ticketStage, type OutboundMessage, type Ticket, type Trigger } from '../core/index.ts'
import { canonicalWorkspace } from '../executor/workspace.ts'
import { workerSessionId } from '../executor/dsh.ts'
import { family, KV } from '../kv.ts'
import type { SourceKind } from './kind.ts'
import { rememberTaskMessage, taskMessages } from './task-messages.ts'
import { MCP_PATH, McpCreateRequest, McpFollowupRequest } from '../mcp/contract.ts'
import { checkMcpConnection } from '../mcp/check.ts'
export { McpCreateRequest, McpFollowupRequest } from '../mcp/contract.ts'

const Project = z.object({ id: z.string().min(1), title: z.string(), directory: z.string().min(1) }).strict()
const Client = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), enabled: z.boolean(), projects: z.array(Project).min(1).max(64) }).strict()
const Config = z.object({ clients: z.array(Client).max(32).default([]) }).strict()
type McpConfig = z.infer<typeof Config>
export const McpClientRequest = z.object({ name: z.string().trim().min(1).max(100), workspaceIds: z.array(z.string().min(1)).min(1).max(64) }).strict()
export interface McpPrincipal { clientId: string; token: string }
/** An expected intake refusal, safe to return to the authenticated client or local operator. */
export class McpTaskError extends Error { constructor(readonly status: 400 | 401 | 404 | 409, message: string) { super(message) } }
const secrets = family<{ digest: string; issuedAt: string }>('mcp-client-secret:')
const used = family<string>('mcp-client-used:')
const requests = family<{ ticketId: string; request: string }>('mcp-request:')
const digest = (token: string) => createHash('sha256').update(token).digest()

/** Configures client grants and maps authenticated MCP requests into persistent Superagent tasks. */
export class McpTasks {
  private readonly unregister: () => void
  constructor(private readonly runtime: Runtime, private readonly ctx: Context) {
    const kind: SourceKind<McpConfig> = {
      kind: 'mcp', title: { zh: 'MCP 外部派单', en: 'MCP task intake' },
      description: { zh: '已授权的应用在指定工作区派出任务。', en: 'Authorized applications dispatch tasks in selected workspaces.' },
      schema: Config, fields: [], health: [],
      scope: ({ meta }, config) => {
        const client = config.clients.find(item => item.id === meta.clientId && item.enabled)
        const project = client?.projects.find(item => item.id === meta.workspaceId && item.directory === meta.directory)
        return project ? { listened: true, observed: false, row: 'clients' } : { listened: false, reason: 'mcp_workspace_not_allowed' }
      },
      workspace: (trigger, config) => {
        const client = config.clients.find(item => item.id === trigger.actor.id && item.id === trigger.meta.clientId && item.enabled)
        const project = client?.projects.find(item => item.id === trigger.meta.workspaceId && item.directory === trigger.meta.directory)
        if (!project) throw new McpTaskError(400, '当前连接无权使用这个工作区')
        return { directory: project.directory, permissionPreset: ctx.permissionPresets.defaultPreset }
      },
      channel: {
        allowed: (address, config) => config.clients.some(client => client.id === address.clientId && client.enabled
          && client.projects.some(project => project.id === address.workspaceId && project.directory === address.directory)),
        send: async (_host, message) => this.send(message),
        link: () => ({ url: '', label: { zh: 'MCP 客户端', en: 'MCP client' } }),
      },
    }
    this.unregister = runtime.sources.register(kind)
    const settings = runtime.store.settings()
    if (!settings.sources.mcp || !settings.policy.sources.mcp) runtime.store.saveSettings({ ...settings,
      sources: { ...settings.sources, mcp: settings.sources.mcp ?? { enabled: false, config: { clients: [] } } },
      policy: { ...settings.policy, sources: { ...settings.policy.sources, mcp: settings.policy.sources.mcp
        ?? { allowed: [], admission: { clients: { unlistedAddressed: 'explicit' } } } } } })
  }
  private instance() { return this.runtime.sources.instance<McpConfig>('mcp')! }
  private clients() { return this.instance().config.clients }
  view() {
    return { url: `http://127.0.0.1:${this.ctx.webServer.port}${MCP_PATH}`, enabled: this.instance().enabled,
      clients: this.clients().map(client => ({ ...client, credentialConfigured: !!this.runtime.store.get(secrets(client.id)),
        lastUsedAt: this.runtime.store.get(used(client.id)) ?? null })) }
  }
  private configuration(token: string) {
    const packageRoot = dirname(createRequire(import.meta.url).resolve('@missher/dsh-superagent/package.json'))
    return {
      stdio: { mcpServers: { superagent: { command: process.execPath, args: [join(packageRoot, 'lib/mcp-bridge.js'), '--state-dir', this.runtime.machine.stateDir],
        env: { DSH_SUPERAGENT_TOKEN: token, ELECTRON_RUN_AS_NODE: '1' } } } },
      http: { mcpServers: { superagent: { url: this.view().url, headers: { Authorization: `Bearer ${token}` } } } },
    }
  }
  authenticate(token: string): McpPrincipal | undefined {
    const id = /^dshsa_([a-f0-9-]{36})_[a-f0-9]{64}$/.exec(token)?.[1]
    if (!id || !this.instance().enabled || !this.clients().some(client => client.id === id && client.enabled)) return undefined
    const saved = this.runtime.store.get(secrets(id))
    if (!saved || !/^[a-f0-9]{64}$/.test(saved.digest)) return undefined
    return timingSafeEqual(digest(token), Buffer.from(saved.digest, 'hex')) ? { clientId: id, token } : undefined
  }
  async checkConnection(id: string, token: string, transport: 'stdio' | 'http') {
    if (this.authenticate(token)?.clientId !== id) throw new McpTaskError(401, '连接令牌已失效，请重新生成配置')
    try { return { transport, ...await checkMcpConnection(this.configuration(token)[transport].mcpServers.superagent) } }
    catch (error) { throw new McpTaskError(400, `MCP 连接测试失败：${(error instanceof Error ? error.message : String(error)).replaceAll(token, '[已隐藏]').slice(0, 400)}`) }
  }
  touch(principal: McpPrincipal): void {
    this.client(principal)
    const previous = this.runtime.store.get(used(principal.clientId))
    if (!previous || Date.now() - Date.parse(previous) >= 1000) this.runtime.store.set(used(principal.clientId), new Date().toISOString())
  }
  private client(principal: McpPrincipal) {
    if (this.authenticate(principal.token)?.clientId !== principal.clientId) throw new McpTaskError(401, '连接令牌已失效，请在 DSH 中重新配置')
    return this.clients().find(item => item.id === principal.clientId)!
  }
  private projects(ids: string[]) {
    const available = this.runtime.local!.workspaces()
    return [...new Set(ids)].map(id => {
      const project = available.find(item => item.id === id)
      if (!project) throw new McpTaskError(400, '工作区不存在，请重新选择')
      return { id: project.id, title: project.title, directory: canonicalWorkspace({ directory: project.directory,
        permissionPreset: this.ctx.permissionPresets.defaultPreset }).directory }
    })
  }
  private async save(clients: McpConfig['clients']) {
    await this.runtime.settings.save('source:mcp', { enabled: clients.some(client => client.enabled), config: { clients } },
      this.runtime.store.blockRevision('source:mcp'), 'panel')
    this.runtime.store.set(KV.sources.labels('mcp'), Object.fromEntries(clients.map(client => [client.id, client.name])))
  }
  async createClient(value: z.infer<typeof McpClientRequest>) {
    const input = McpClientRequest.parse(value)
    const client = { id: randomUUID(), name: input.name, enabled: true, projects: this.projects(input.workspaceIds) }
    await this.save([...this.clients(), client])
    return { client, ...this.rotateToken(client.id) }
  }
  async updateClient(id: string, value: z.infer<typeof McpClientRequest>) {
    const input = McpClientRequest.parse(value)
    if (!this.clients().some(client => client.id === id)) throw new McpTaskError(404, '找不到这个连接')
    await this.save(this.clients().map(client => client.id === id ? { ...client, name: input.name, projects: this.projects(input.workspaceIds) } : client))
    return this.view()
  }
  rotateToken(id: string) {
    if (!this.clients().some(client => client.id === id)) throw new McpTaskError(404, '找不到这个连接')
    const token = `dshsa_${id}_${randomBytes(32).toString('hex')}`
    this.runtime.store.set(secrets(id), { digest: digest(token).toString('hex'), issuedAt: new Date().toISOString() })
    return { token, configuration: this.configuration(token) }
  }
  async setEnabled(id: string, enabled: boolean) {
    if (!this.clients().some(client => client.id === id)) throw new McpTaskError(404, '找不到这个连接')
    await this.save(this.clients().map(client => client.id === id ? { ...client, enabled } : client))
    return this.view()
  }
  async removeClient(id: string) {
    if (!this.clients().some(client => client.id === id)) throw new McpTaskError(404, '找不到这个连接')
    await this.save(this.clients().filter(client => client.id !== id))
    this.runtime.store.delete(secrets(id)); this.runtime.store.delete(used(id))
    return this.view()
  }
  workspaces(principal: McpPrincipal) { return this.client(principal).projects }
  private project(principal: McpPrincipal, id: string) {
    const project = this.client(principal).projects.find(item => item.id === id)
    if (!project) throw new McpTaskError(400, '当前连接无权使用这个工作区')
    return project
  }
  private owned(principal: McpPrincipal, id: string): Ticket {
    const client = this.client(principal)
    const ticket = this.runtime.store.tickets.get(id)
    const origin = ticket && this.runtime.store.triggers.get(ticket.origin.triggerId)
    if (!ticket || origin?.source !== 'mcp' || origin.actor.id !== client.id || origin.meta.clientId !== client.id
      || !client.projects.some(project => project.id === origin.meta.workspaceId && project.directory === origin.meta.directory)) {
      throw new McpTaskError(404, '任务不存在或不属于当前连接')
    }
    return ticket
  }
  get(principal: McpPrincipal, id: string) {
    const ticket = this.owned(principal, id)
    return { ticketId: ticket.id, title: ticket.title, stage: ticketStage(ticket), directory: ticket.execution?.directory,
      sessionId: workerSessionId(id), summary: latestReport(ticket)?.summary ?? '', updatedAt: ticket.updatedAt,
      paused: this.runtime.store.settings().paused, ...(ticket.attention ? { attention: ticket.attention } : {}), messages: taskMessages(this.runtime, id) }
  }
  list(principal: McpPrincipal, offset = 0, limit = 20) {
    this.client(principal)
    const tasks = this.runtime.store.tickets.list().filter(ticket => {
      try { this.owned(principal, ticket.id); return true } catch (error) { if (error instanceof McpTaskError && error.status === 404) return false; throw error }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { total: tasks.length, items: tasks.slice(offset, offset + limit).map(ticket => this.get(principal, ticket.id)),
      next_offset: offset + limit < tasks.length ? offset + limit : null }
  }
  async create(principal: McpPrincipal, value: z.infer<typeof McpCreateRequest>) {
    const input = McpCreateRequest.parse(value)
    const project = this.project(principal, input.workspaceId)
    const request = { ...input, title: input.title ?? input.instructions.split('\n')[0]!.slice(0, 80) }
    const id = key('mcp-task', principal.clientId, input.requestId), encoded = JSON.stringify(request)
    return this.runtime.store.atomic(() => {
      const old = this.runtime.store.get(requests(id))
      if (old) {
        if (old.request !== encoded) throw new McpTaskError(409, '同一个 requestId 不能用于不同的任务请求')
        return this.get(principal, old.ticketId)
      }
      const trigger: Trigger = { id, source: 'mcp', threads: [{ source: 'mcp', id: `${principal.clientId}:${input.requestId}` }],
        actor: { source: 'mcp', id: principal.clientId }, human: true, addressed: 'direct', at: new Date().toISOString(),
        text: input.instructions, meta: { clientId: principal.clientId, workspaceId: project.id, directory: project.directory },
        channel: { source: 'mcp', thread: `mcp:${principal.clientId}:${input.requestId}`,
          address: { clientId: principal.clientId, workspaceId: project.id, directory: project.directory } } }
      this.runtime.receive(trigger)
      const decision = this.runtime.engine.decide(id, { kind: 'accept', title: request.title, scope: input.instructions,
        name: 'mcp-task', reason: '已授权 MCP 客户端明确派出的任务' })
      if (!decision.ticketId) throw new McpTaskError(400, '任务未获得执行授权，请检查 MCP 连接范围')
      this.runtime.store.set(requests(id), { ticketId: decision.ticketId, request: encoded })
      return this.get(principal, decision.ticketId)
    })
  }
  async followup(principal: McpPrincipal, value: z.infer<typeof McpFollowupRequest>) {
    const input = McpFollowupRequest.parse(value)
    const ticket = this.owned(principal, input.ticketId)
    if (ticket.ended?.by === 'human') throw new McpTaskError(400, '任务已被人工停止；请明确创建新任务')
    const origin = this.runtime.store.triggers.get(ticket.origin.triggerId)!
    const trigger = { ...origin, id: key('mcp-followup', principal.clientId, ticket.id, input.requestId), text: input.text, at: new Date().toISOString() }
    const old = this.runtime.store.triggers.get(trigger.id)
    if (old && old.text !== trigger.text) throw new McpTaskError(409, '同一个 requestId 不能用于不同的补充要求')
    this.runtime.receive(trigger)
    return this.get(principal, ticket.id)
  }
  stop(principal: McpPrincipal, id: string) {
    const ticket = this.owned(principal, id)
    if (!ticket.ended) this.runtime.engine.stopTicket(id)
    return this.get(principal, id)
  }
  retry(principal: McpPrincipal, id: string, requestId: string) {
    z.string().trim().min(1).max(200).parse(requestId)
    const ticket = this.owned(principal, id)
    const idempotency = key('mcp-retry', principal.clientId, id, requestId)
    if (this.runtime.store.get(requests(idempotency))) return this.get(principal, id)
    if (ticket.ended?.by === 'human') throw new McpTaskError(400, '任务已被人工停止；请明确创建新任务')
    this.runtime.store.atomic(() => {
      this.runtime.engine.retryTicket(id)
      this.runtime.store.set(requests(idempotency), { ticketId: id, request: requestId })
    })
    return this.get(principal, id)
  }
  private send(message: OutboundMessage): 'sent' | 'gone' {
    const id = message.ticketId
    const ticket = id ? this.runtime.store.tickets.get(id) : undefined
    const origin = ticket && this.runtime.store.triggers.get(ticket.origin.triggerId)
    if (!id || origin?.source !== 'mcp' || origin.actor.id !== message.channel.address.clientId) return 'gone'
    rememberTaskMessage(this.runtime, id, message)
    return 'sent'
  }
  dispose() { this.unregister() }
}
