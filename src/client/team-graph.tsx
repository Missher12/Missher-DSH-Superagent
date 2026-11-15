/** Nodes and connectors are drawn only from an explicitly persisted team plan. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import { Icon } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { TeamStatus } from './team-ui.tsx'
import { COMMANDER, participantIcon, participantWork, teamParticipants, type TeamParticipant } from './team-participants.ts'
import { effortLabel } from './model-labels.ts'

interface Line { id: string; to: string; path: string; dependency: boolean; active: boolean }
export function TeamGraph({ team, selected, select, addMember }: { team: TeamView; selected: string; select: (id: string) => void; addMember?: (member: TeamMemberView) => ReactNode }) {
  const { t } = usePanel()
  const participants = teamParticipants(team, t), commander = participants.find(member => member.role === 'commander')
  const root = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLButtonElement>())
  const [lines, setLines] = useState<Line[]>([])
  const signature = `${team.state}|${team.handoffs.map(handoff => `${handoff.from}:${handoff.to}`).join(',')}|`
    + participants.map(member => `${member.id}:${member.parentId ?? ''}:${member.ticketId ?? ''}:${member.dependencies.join(',')}:${member.state}:${!!member.running}`).join('|')
  useLayoutEffect(() => {
    const measure = () => {
      const bounds = root.current?.getBoundingClientRect(); if (!bounds) return
      const connect = (from: string, to: string, dependency: boolean): Line[] => {
        const start = nodes.current.get(from)?.getBoundingClientRect(), end = nodes.current.get(to)?.getBoundingClientRect()
        if (!start || !end) return []
        const x1 = (dependency ? start.right : start.left) - bounds.left, y1 = start.top + start.height / 2 - bounds.top
        const x2 = (dependency ? end.right : end.left) - bounds.left, y2 = end.top + end.height / 2 - bounds.top
        const lane = dependency ? Math.max(x1, x2) + 9 : Math.min(x1, x2) - 15
        const direction = y2 >= y1 ? 1 : -1, inset = dependency ? -5 : 5
        const target = team.members.find(member => member.id === to), source = team.members.find(member => member.id === from)
        const active = !!target?.running && !['attention', 'failed', 'stopped', 'completed'].includes(team.state)
          && (!dependency || source?.state === 'finished' && team.handoffs.some(handoff => handoff.from === from && handoff.to === to))
        return [{ id: `${from}:${to}:${dependency}`, to, dependency, active,
          path: `M${x1},${y1} H${lane + inset} Q${lane},${y1} ${lane},${y1 + 5 * direction} V${y2 - 5 * direction} Q${lane},${y2} ${lane + inset},${y2} H${x2}` }]
      }
      setLines([...(commander ? connect(COMMANDER, 'coordinator', false) : []), ...team.members.flatMap(member => member.id === 'coordinator' ? [] : [
        ...connect(member.parentId ?? 'coordinator', member.id, false),
        ...member.dependencies.flatMap(from => connect(from, member.id, true)),
      ])])
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    for (const node of nodes.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [signature, team.id])
  const node = (member: TeamParticipant) => <button type="button" key={member.id} ref={element => {
    if (element) nodes.current.set(member.id, element); else nodes.current.delete(member.id)
  }} className="dt-team-node" data-role={member.role} data-state={member.state} data-running={member.running || undefined} data-coordinator={member.role === 'coordinator' || undefined} aria-pressed={selected === member.id}
    aria-label={`${member.name} · ${t('teamDetails')}`} title={member.name + (member.dependencies.length ? ' · ' + t('teamPrerequisite', { names: member.dependencies.map(id => team.members.find(item => item.id === id)?.name ?? id).join('、') }) : '')} onClick={() => select(member.id)}>
    <span className="dt-team-node-head"><span className="dt-team-avatar"><Icon name={participantIcon(member)} size={17} /></span>
      <strong>{member.name}</strong><TeamStatus state={member.state} member /></span>
    <span className="dt-team-node-role" title={member.role === 'commander' ? t('teamCommanderShared') : member.instructions}>{participantWork(member, t)}</span>
    <span className="dt-team-node-bottom"><span className="dt-team-node-model" title={member.model ? `${member.model.provider} · ${member.model.model}` : undefined}>
      <span>{member.model?.model ?? t(member.role === 'commander' ? 'localInheritDefault' : 'teamModelInherit')}</span>
      {member.model?.reasoningEffort && <span className="dt-team-node-effort">{effortLabel(member.model.reasoningEffort, member.model.reasoningEffort, t)}</span>}
    </span><Icon name="message" size={13} /></span>
  </button>
  const branch = (member: TeamMemberView) => <div className="dt-team-branch" key={member.id} data-parent={member.parentId ?? 'coordinator'}>
    {node(member)}{(member.role === 'coordinator' || member.responsibility === 'manager') && addMember && <div className="dt-team-branch-action">{addMember(member)}</div>}
  </div>
  const ordered: TeamMemberView[] = [], seen = new Set<string>()
  const visit = (member: TeamMemberView) => {
    if (seen.has(member.id)) return
    seen.add(member.id); ordered.push(member)
    for (const child of team.members) if (child.id !== 'coordinator' && (child.parentId ?? 'coordinator') === member.id) visit(child)
  }
  for (const member of team.members) visit(member)
  return <div className="dt-team-graph" ref={root} aria-label={t('teamGraph')}>
    <svg className="dt-team-lines" aria-hidden="true">{lines.map(line => <g key={line.id}><path d={line.path} data-dependency={line.dependency || undefined} data-selected={line.to === selected || undefined} data-active={line.active || undefined} />
      {line.active && <circle className="dt-team-flow-packet" r="2.5"><animateMotion dur={line.dependency ? '2.6s' : '2.1s'} repeatCount="indefinite" path={line.path} /></circle>}
    </g>)}</svg>
    {commander && node(commander)}
    {ordered.map(branch)}
  </div>
}
