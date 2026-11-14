/** Type-only management API contract between the web panel and host routes, imported by the panel without bundling host code. */
import type { LocalRequest, LocalTasks } from '../sources/local.ts'
import type { McpClientRequest, McpTasks } from '../sources/mcp.ts'
import type { z } from 'zod'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { PromptConfig, Prompts } from './prompts.ts'
import type { PromptsView, StateView, TicketPageView } from './http.ts'
import type { HistoryView } from './settings-history.ts'
import type { OverviewView } from './views/overview.ts'
import type { SettingsView } from './views/settings.ts'
import type { SourceStatusView } from './views/sources.ts'
import type { DecisionListView, SearchView, ThreadDetailView, ThreadListView } from './views/threads.ts'
import type { TicketListView } from './views/tickets.ts'
import type { WorkbenchView } from './views/workbench.ts'
import type { LocalTeams } from '../teams/local.ts'
import type { FeishuConnectRequest, FeishuConnectResult } from './feishu-connect.ts'
import type { TeamRequest, TeamMember } from '../teams/contracts.ts'

export const TICKET_FILTERS = ['open', 'person', 'working', 'idle', 'ended'] as const
export const THREAD_FILTERS = ['subscribed', 'evaluating', 'recent', 'all'] as const
export type TicketFilter = typeof TICKET_FILTERS[number]
export type ThreadFilter = typeof THREAD_FILTERS[number]
export const LOCAL_BOARD_COLUMNS = ['queued', 'running', 'attention', 'idle', 'ended'] as const
export type LocalBoardColumn = typeof LOCAL_BOARD_COLUMNS[number]
interface Paged { offset?: number; limit?: number }
/** Whether a context update was already injected into the main Session or is still pending delivery. */
type Delivery = 'injected' | 'pending'

export interface Api {
  'POST feishu/connect': { body: FeishuConnectRequest; response: FeishuConnectResult }
  'GET local/workbench': { query?: { session?: string; team?: string }; response: WorkbenchView }
  'POST local/teams': { body: TeamRequest; response: Awaited<ReturnType<LocalTeams['create']>> }
  'POST local/teams/:id/members': { body: TeamMember; response: Awaited<ReturnType<LocalTeams['addMember']>> }
  'GET local/teams/:id': { response: ReturnType<LocalTeams['get']> }
  'GET local/teams/:id/file': { query: { path: string }; response: ReturnType<LocalTeams['file']> }
  'POST local/teams/:id/stop': { response: ReturnType<LocalTeams['stopTeam']> }
  'POST local/teams/:id/retry': { response: Awaited<ReturnType<LocalTeams['retry']>> }
  'POST local/teams/:id/followup': { body: { memberId: string; requestId: string; text: string }; response: Awaited<ReturnType<LocalTeams['followup']>> }
  'GET local/sessions/:id/model': { response: import('../policy.ts').RoleModel | null }
  'PUT local/sessions/:id/model': { body: import('../policy.ts').RoleModel | null; response: import('../policy.ts').RoleModel }
  'GET mcp': { response: ReturnType<McpTasks['view']> }
  'POST mcp/clients': { body: z.infer<typeof McpClientRequest>; response: Awaited<ReturnType<McpTasks['createClient']>> }
  'PUT mcp/clients/:id': { body: z.infer<typeof McpClientRequest>; response: Awaited<ReturnType<McpTasks['updateClient']>> }
  'POST mcp/clients/:id/token': { response: ReturnType<McpTasks['rotateToken']> }
  'POST mcp/clients/:id/test': { body: { token: string; transport: 'stdio' | 'http' }; response: Awaited<ReturnType<McpTasks['checkConnection']>> }
  'POST mcp/clients/:id/enabled': { body: { enabled: boolean }; response: Awaited<ReturnType<McpTasks['setEnabled']>> }
  'DELETE mcp/clients/:id': { response: Awaited<ReturnType<McpTasks['removeClient']>> }
  'GET local/board': { query: Paged & { column: LocalBoardColumn; q?: string }; response: ReturnType<typeof import('./views/tickets.ts').localBoard> }
  'GET local/workspaces': { response: ReturnType<LocalTasks['workspaces']> }
  'GET local/permissions': { response: ReturnType<LocalTasks['permissions']> }
  'POST local/workspaces': { body: { directory: string; title?: string }; response: Awaited<ReturnType<LocalTasks['addWorkspace']>> }
  'DELETE local/workspaces/:id': { response: Awaited<ReturnType<LocalTasks['removeWorkspace']>> }
  'GET local/capabilities': { response: ReturnType<import('./sessions.ts').Sessions['capabilities']> }
  'POST local/tasks': { body: LocalRequest; response: Awaited<ReturnType<LocalTasks['create']>> }
  'GET local/tasks/:id/workbench': { response: { team?: string; member?: string; session?: string } }
  'GET local/tasks/:id/file': { query: { path: string }; response: ReturnType<LocalTasks['file']> }
  'POST local/tasks/:id/followup': { body: { requestId: string; text: string }; response: Awaited<ReturnType<LocalTasks['followup']>> }
  'GET state': { response: StateView }
  'GET overview': { response: OverviewView }
  'GET search': { query: { q: string }; response: SearchView }
  'GET sources': { response: SourceStatusView[] }
  'GET settings': { response: SettingsView }
  'POST sources/:id/labels': { response: { added: string[] } }
  'GET threads': { query?: Paged & { filter?: ThreadFilter }; response: ThreadListView }
  'GET threads/:key': { query?: { limit?: number; before?: string; around?: string }; response: ThreadDetailView }
  'POST threads/:key/unsubscribe': { response: { removed: boolean; thread: string; context_delivery: Delivery } }
  'POST triggers/:id/requeue': { response: { queued: boolean } }
  'GET decisions': { query?: Paged & { kind?: string; window?: '24h' }; response: DecisionListView }
  'POST decisions/:id/dismiss': { response: { dismissed: true } }
  'GET tickets': { query?: Paged & { state?: TicketFilter }; response: TicketListView }
  'GET tickets/:id': { response: TicketPageView }
  'POST tickets/:id/retry': { response: { retried: true } }
  'POST tickets/:id/stop': { response: { stopped: true } }
  'POST executor/pause': { body: { paused: boolean }; response: { paused: boolean } }
  'PUT settings/:block': { body: { value: unknown; revision: number }; response: { revision: number; restarting: boolean } }
  'GET policy/history': { response: HistoryView }
  'POST policy-sync/:id': { response: { policy: unknown } }
  'POST setup/check': { response: { restarting: true } }
  'GET models': { response: ModelCatalog & { taskDefault?: import('../policy.ts').RoleModel | null } }
  'GET prompts': { query?: { revision?: number; offset?: number }; response: PromptsView }
  'PUT prompts': { body: { config: PromptConfig; baseRevision: number }; response: { revision: number; context_delivery: Delivery } }
  'POST prompts/preview': { body: PromptConfig; response: ReturnType<Prompts['preview']> }
}
type Path<K> = K extends `${string} ${infer P}` ? P : never
type Params<P> = P extends `${string}:${infer Name}/${infer Rest}` ? Record<Name, string> & Params<Rest>
  : P extends `${string}:${infer Name}` ? Record<Name, string> : unknown
export type RouteParams<K extends keyof Api> = Params<Path<K>>
export type ApiRequest<K extends keyof Api> = RouteParams<K> & Omit<Api[K], 'response'>
export type ApiResponse<K extends keyof Api> = Api[K]['response']
