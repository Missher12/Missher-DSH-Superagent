/** State labels shared by the real team graph and its detail pane. */
import type { MemberState, TeamState } from '../teams/contracts.ts'
import { useState } from 'react'
import { Dot, type DotState } from './controls.tsx'
import { usePanel } from './provider.tsx'

const teamLabels = { planning: 'teamStatePlanning', working: 'teamStateWorking', waiting: 'teamStateWaiting', attention: 'teamStateAttention', failed: 'teamStateFailed', completed: 'teamStateCompleted', stopped: 'teamStateStopped' } as const
const memberLabels = { planned: 'teamMemberPlanned', queued: 'teamMemberQueued', working: 'teamMemberWorking', waiting: 'teamMemberWaiting', attention: 'teamMemberAttention', failed: 'teamMemberFailed', finished: 'teamMemberFinished', stopped: 'teamMemberStopped' } as const
export const teamDot = (state: TeamState | MemberState): DotState => state === 'failed' ? 'error' : state === 'attention' ? 'warning' : state === 'working' || state === 'planning' ? 'ongoing' : state === 'finished' || state === 'completed' ? 'done' : 'idle'
export function TeamStatus({ state, member = false }: { state: TeamState | MemberState; member?: boolean }) {
  const { t } = usePanel()
  return <span className="dt-team-status" data-state={state}><Dot state={teamDot(state)} />{t(member ? memberLabels[state as MemberState] : teamLabels[state as TeamState])}</span>
}
export function TeamText({ text }: { text: string }) {
  const { t } = usePanel(), [expanded, setExpanded] = useState(false)
  const long = text.length > 180 || text.split('\n').length > 3
  return <div className="dt-team-copy"><p className={`dt-team-text${long && !expanded ? ' dt-team-text-clamped' : ''}`}>{text}</p>
    {long && <button type="button" className="dt-textlink" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'collapse' : 'expand')}</button>}</div>
}
