import type { TeamView } from '../teams/contracts.ts'
import { COMMANDER } from './team-participants.ts'

export interface GraphTransfer { id: string; kind: 'dispatch' | 'handoff' | 'return'; at?: string }
export interface GraphRoute { id: string; from: string; to: string; dependency: boolean; events: GraphTransfer[] }

/** Planned connections stay quiet until a ticket, a handoff or an accepted review records movement. */
export function teamRoutes(team: TeamView): GraphRoute[] {
  const routes = new Map<string, GraphRoute>()
  const connect = (from: string, to: string, dependency = false) => {
    const id = JSON.stringify([from, to])
    let route = routes.get(id)
    if (!route) { route = { id, from, to, dependency, events: [] }; routes.set(id, route) }
    if (dependency) route.dependency = true
    return route
  }
  if (team.commander) connect(COMMANDER, 'coordinator')
  for (const member of team.members) {
    if (member.id === 'coordinator') continue
    const parent = connect(member.parentId ?? 'coordinator', member.id)
    for (const from of member.dependencies) connect(from, member.id, true)
    if (member.ticketId && !member.dependencies.length) parent.events.push({ id: `ticket/${member.ticketId}`, kind: 'dispatch' })
  }
  const reviews = team.workflow?.reviews ?? []
  for (const handoff of team.handoffs) {
    const returned = handoff.to === 'coordinator' && reviews.some(review => review.reviewerId === handoff.from && review.roundId === handoff.version && review.decision === 'revise')
    connect(handoff.from, handoff.to).events.push({ id: `handoff/${handoff.id}`, kind: returned ? 'return' : 'handoff', at: handoff.at })
  }
  for (const review of reviews) {
    if (review.reviewerId !== 'coordinator' || review.decision !== 'revise' || !review.handled || review.roundId === team.workflow?.roundId) continue
    for (const target of review.targets) connect('coordinator', target).events.push({ id: `review/${review.assignmentId}/${target}`, kind: 'return', at: review.at })
  }
  for (const event of team.timeline ?? []) {
    if (event.kind === 'phase' && event.detail === 'reporting' && team.commander) connect('coordinator', COMMANDER).events.push({ id: `report/${event.id}`, kind: 'handoff', at: event.at })
  }
  // Older records can retain the current review without its original handoff row.
  if (team.phase === 'reviewing' && team.workflow?.pendingReview) connect(team.workflow.pendingReview.reviewerId, 'coordinator')
  for (const route of routes.values()) route.events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  return [...routes.values()]
}
