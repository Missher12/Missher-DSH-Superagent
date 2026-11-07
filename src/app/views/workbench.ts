/** Real control workspace, managed session identities, and bounded activity derived from existing task records. */
import type { Context } from '@deepseek-ai/cordis'
import { realpathSync } from 'node:fs'
import { ticketStage, type Trigger } from '../../core/index.ts'
import type { Sessions } from '../sessions.ts'
import { newestFirst, snapshot, type ActorView, type ViewHost } from './records.ts'
import { ticketRow } from './tickets.ts'

interface Activity {
  id: string; at: string; kind: 'received' | 'assigned' | 'report' | 'ended' | 'tool'
  memberId: string; ticketId?: string; title: string; summary?: string; tool?: string
  state?: string; actor?: ActorView
}
interface Member {
  id: string; role: 'orchestrator' | 'worker'; state: 'running' | 'idle' | 'attention' | 'finished'
  title: string; directory: string; tools: ReturnType<Sessions['activity']>['tools']; taskId?: string; actor?: ActorView
}
export function workbench(host: ViewHost, context: Pick<Context, 'workspaceRegistry'>, sessions: Pick<Sessions, 'activity'>,
  directory: string, masterId: string) {
  const canonical = realpathSync(directory)
  const workspace = context.workspaceRegistry.list().find(workspace => workspace.path === directory || workspace.path === canonical)
  const view = snapshot(host)
  const clients = host.sources.instance<{ clients: { id: string; name: string }[] }>('mcp')?.config.clients ?? []
  const actorOf = (trigger: Trigger | undefined): ActorView | undefined => {
    if (!trigger) return undefined
    const actor = view.actor(trigger.actor, trigger.human)
    if (actor.source !== 'mcp') return actor
    const name = clients.find(client => client.id === actor.id)?.name
    return { ...actor, name: name ? { zh: name, en: name } : { zh: 'MCP 应用', en: 'MCP application' } }
  }
  const all = host.store.tickets.list().sort(newestFirst)
  const selected = [...all.filter(ticket => !ticket.ended).slice(0, 24), ...all.filter(ticket => ticket.ended).slice(0, 8)]
  const tasks = selected.map(ticket => ticketRow(view, ticket))
  const live = sessions.activity(masterId)
  const members: Member[] = [{ id: masterId, role: 'orchestrator', state: live.running ? 'running' : 'idle',
    title: '', directory, tools: live.tools },
  ...selected.flatMap<Member>((ticket, index) => {
    const row = tasks[index]!
    if (!row.sessionId || !ticket.assignments.some(assignment => assignment.startedAt)) return []
    const live = sessions.activity(row.sessionId), stage = ticketStage(ticket).stage
    const trigger = host.store.triggers.get(ticket.origin.triggerId)
    return [{ id: row.sessionId, role: 'worker' as const, title: ticket.title, taskId: ticket.id, directory: row.directory ?? '',
      state: live.running ? 'running' : stage === 'ended' ? 'finished' : stage === 'person' ? 'attention' : 'idle', tools: live.tools,
      actor: actorOf(trigger) }]
  })]
  const activity: Activity[] = selected.flatMap(ticket => {
    const memberId = tasks.find(row => row.id === ticket.id)?.sessionId ?? masterId
    const trigger = host.store.triggers.get(ticket.origin.triggerId)
    const items: Activity[] = [{ id: `received:${ticket.id}`, kind: 'received', memberId: masterId, ticketId: ticket.id,
      title: ticket.title, at: ticket.createdAt, actor: actorOf(trigger) }]
    for (const assignment of ticket.assignments) {
      if (assignment.startedAt) items.push({ id: `assigned:${assignment.id}`, kind: 'assigned', memberId, ticketId: ticket.id,
        title: ticket.title, at: assignment.startedAt })
      if (assignment.report) items.push({ id: `report:${assignment.id}`, kind: 'report', memberId, ticketId: ticket.id,
        title: ticket.title, at: assignment.report.at, summary: assignment.report.summary.slice(0, 240), state: assignment.report.state })
    }
    if (ticket.ended) items.push({ id: `ended:${ticket.id}`, kind: 'ended', memberId, ticketId: ticket.id,
      title: ticket.title, at: ticket.ended.at, state: ticket.ended.outcome })
    return items
  })
  for (const member of members) for (const tool of member.tools) activity.push({ id: `tool:${member.id}:${tool.id}`,
    kind: 'tool', memberId: member.id, ticketId: member.taskId, title: member.title, at: tool.at, tool: tool.name, state: tool.state })
  return {
    workspace: workspace ? { id: String(workspace.id), title: workspace.title, directory: workspace.path } : undefined,
    members, tasks, activity: activity.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, 40),
    sources: host.sources.instances().filter(source => source.installed).map(source => ({ id: source.id,
      title: host.sources.kind(source.kind)?.title ?? source.id, enabled: source.enabled })),
  }
}
export type WorkbenchView = ReturnType<typeof workbench>
