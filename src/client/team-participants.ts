/** The team commander reports verified deliveries; legacy teams retain their shared dispatcher. */
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import { workbenchToolLabel, type T } from './text.ts'

export const COMMANDER = '$commander'
export type TeamParticipant = Omit<TeamMemberView, 'role' | 'state'> & {
  role: TeamMemberView['role'] | 'commander'
  state: TeamMemberView['state'] | 'idle'
}
export function teamParticipants(team: TeamView, t: T): TeamParticipant[] {
  const commander = team.commander
  if (!commander) return team.members
  return [{ ...commander, id: COMMANDER, role: 'commander', name: t('teamCommander'), instructions: t('teamCommanderWork'),
    state: commander.state ?? (commander.running || commander.quotaWait ? 'working' : 'idle'), dependencies: [],
    summary: commander.summary ?? '', retry: commander.retry ?? false, events: commander.events ?? [] }, ...team.members]
}
export function participantIcon(member: TeamParticipant) {
  return member.role === 'commander' ? 'queue' : member.role === 'coordinator' || member.responsibility === 'manager' ? 'agent'
    : member.responsibility === 'reviewer' || member.id === 'check' ? 'shield' : 'code'
}
export function participantWork(member: TeamParticipant, t: T) {
  return member.role === 'coordinator' ? t('teamCoordinatorWork') : member.instructions
}
export function participantStatus(team: TeamView, member: TeamParticipant, t: T): string | undefined {
  if (['attention', 'failed', 'stopped'].includes(member.state)) return
  if (member.quotaWait) return t('teamQuotaWaiting')
  if (member.running && member.state === 'finished') return t('teamFinishing')
  if (member.id === COMMANDER && team.phase === 'completed') return t('teamReported')
  if (member.id === COMMANDER && team.phase === 'briefing') return t('teamIntake')
  if (member.id === COMMANDER && team.phase === 'reporting') return t('teamReporting')
  if (member.id === 'coordinator' && team.phase === 'planning') return t('teamPlanning')
  if (member.id === 'coordinator' && team.phase === 'reviewing') return t('teamReplanning')
  if (member.id === 'coordinator' && team.phase === 'integrating') return t('teamFinalReview')
  const review = team.workflow?.reviews.findLast(review => review.reviewerId === member.id)
  if (review?.decision === 'revise') return t(team.phase === 'reviewing' ? 'teamReturned' : member.running ? 'teamRechecking' : 'teamAwaitRecheck')
  if (review?.decision === 'pass' && member.state === 'finished') return t('teamReviewPassed')
}
export function teamProductCount(team: TeamView): number {
  const files = team.finalDelivery?.artifacts ?? [...team.deliveries.flatMap(delivery => delivery.record.files), ...team.finalDelivery?.record.files ?? []]
  return new Set(files.map(file => file.path)).size
}
/** Current work or the concrete reason for waiting, never an inferred success. */
export function participantDetail(team: TeamView, member: TeamParticipant, t: T): string {
  if (member.attention) return member.attention
  if (member.state === 'failed') return member.summary || t('teamNeedsHelp')
  if (member.state === 'stopped') return t('teamWorkStopped')
  if (member.quotaWait) return t('teamModelQuotaWait')
  const tool = member.tools.findLast(tool => tool.state === 'running')
  if (member.running) return tool ? `${workbenchToolLabel(t, tool.name)}${tool.detail ? ` · ${tool.detail}` : ''}`
    : t(member.state === 'finished' ? 'teamFinishing' : 'teamThinking')
  if (team.state === 'draft') return participantWork(member, t)
  if (member.state === 'finished') return t('teamFilesDelivered', { count: member.id === COMMANDER ? teamProductCount(team) : member.delivery?.files.length ?? 0 })
  if (member.id === COMMANDER) return t(team.phase === 'briefing' ? 'teamIntake' : 'teamAwaitFinalReview')
  if (member.id === 'coordinator' && team.workflow?.pendingReview) return team.workflow.pendingReview.reason
  const waiting = team.members.filter(item => item.state !== 'finished' && (member.id === 'coordinator'
    ? item.role === 'member' : member.dependencies.includes(item.id)))
  if (waiting.length && !['briefing', 'planning', 'creating'].includes(team.phase ?? '')) return t('teamWaitingFor', { names: waiting.map(item => item.name).join('、') })
  if (team.phase === 'briefing') return t('teamAwaitCommander')
  if (team.phase === 'planning' && member.id !== 'coordinator') return t('teamAwaitPlanner')
  if (member.state === 'queued') return t('teamAwaitSlot')
  return participantStatus(team, member, t) || participantWork(member, t)
}
export function teamFeedback(team: TeamView) {
  if (team.phase === 'reviewing' && team.workflow?.pendingReview) {
    const review = team.workflow.pendingReview
    return { from: review.reviewerId, to: ['coordinator'], reason: review.reason, revising: false }
  }
  if (team.phase === 'working' && team.workflow && team.workflow.round > 1) {
    const review = team.workflow.reviews.findLast(review => review.reviewerId === 'coordinator' && review.decision === 'revise' && review.handled)
    if (review) return { from: 'coordinator', to: review.targets.filter(id => team.members.some(member => member.id === id)), reason: review.reason, revising: true }
  }
}
