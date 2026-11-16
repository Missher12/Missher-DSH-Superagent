/** The team commander reports verified deliveries; legacy teams retain their shared dispatcher. */
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import type { T } from './text.ts'

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
  if (member.id === COMMANDER && team.phase === 'briefing') return t('teamIntake')
  if (member.id === COMMANDER && team.phase === 'reporting') return t('teamReporting')
  if (member.id === 'coordinator' && team.phase === 'planning') return t('teamPlanning')
  if (member.id === 'coordinator' && team.phase === 'reviewing') return t('teamReplanning')
  if (member.id === 'coordinator' && team.phase === 'integrating') return t('teamFinalReview')
  const review = team.workflow?.reviews.findLast(review => review.reviewerId === member.id)
  if (review?.decision === 'revise') return t(team.phase === 'reviewing' ? 'teamReturned' : member.running ? 'teamRechecking' : 'teamAwaitRecheck')
  if (review?.decision === 'pass' && member.state === 'finished') return t('teamReviewPassed')
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
