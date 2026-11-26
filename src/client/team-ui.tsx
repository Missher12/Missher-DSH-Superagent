/** State labels shared by the real team graph and its detail pane. */
import type { MemberState, TeamState } from '../teams/contracts.ts'
import { Dot, type DotState } from './controls.tsx'
import { usePanel } from './provider.tsx'

const teamLabels = { draft: 'teamStateDraft', planning: 'teamStatePlanning', working: 'teamStateWorking', waiting: 'teamStateWaiting', attention: 'teamStateAttention', failed: 'teamStateFailed', completed: 'teamStateCompleted', stopped: 'teamStateStopped' } as const
const memberLabels = { idle: 'teamCommanderIdle', planned: 'teamMemberPlanned', queued: 'teamMemberQueued', working: 'teamMemberWorking', waiting: 'teamMemberWaiting', attention: 'teamMemberAttention', failed: 'teamMemberFailed', finished: 'teamMemberFinished', stopped: 'teamMemberStopped' } as const
export const teamDot = (state: TeamState | MemberState | 'idle'): DotState => state === 'failed' ? 'error' : state === 'attention' ? 'warning' : state === 'working' || state === 'planning' ? 'ongoing' : state === 'finished' || state === 'completed' ? 'done' : 'idle'
export function TeamStatus({ state, member = false, label }: { state: TeamState | MemberState | 'idle'; member?: boolean; label?: string }) {
  const { t } = usePanel()
  return <span className="dt-team-status" data-state={state}><Dot state={teamDot(state)} />{label ?? t(member ? memberLabels[state as keyof typeof memberLabels] : teamLabels[state as TeamState])}</span>
}
export function TeamText({ text }: { text: string }) {
  return <p className="dt-team-text">{text}</p>
}
