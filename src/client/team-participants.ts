/** The shared dispatcher has a real session, but is not an executing team member. */
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import type { T } from './text.ts'

export const COMMANDER = '$commander'
export type TeamParticipant = Omit<TeamMemberView, 'role' | 'state'> & {
  role: TeamMemberView['role'] | 'commander'
  state: TeamMemberView['state'] | 'idle'
}
export function teamParticipants(team: TeamView, t: T): TeamParticipant[] {
  const commander = team.commander
  if (!commander?.sessionId) return team.members
  return [{ ...commander, id: COMMANDER, role: 'commander', name: t('teamCommander'), instructions: t('teamCommanderWork'),
    state: commander.running || commander.quotaWait ? 'working' : 'idle', dependencies: [], summary: '', retry: false, events: [] }, ...team.members]
}
export function participantIcon(member: TeamParticipant) {
  return member.role === 'commander' ? 'queue' : member.role === 'coordinator' || member.responsibility === 'manager' ? 'agent'
    : member.responsibility === 'reviewer' || member.id === 'check' ? 'shield' : 'code'
}
export function participantWork(member: TeamParticipant, t: T) {
  return member.role === 'coordinator' ? t('teamCoordinatorWork') : member.instructions
}
