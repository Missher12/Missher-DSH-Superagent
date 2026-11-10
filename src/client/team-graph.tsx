/** Nodes and connectors are drawn only from an explicitly persisted team plan. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { TeamMemberView, TeamView } from '../teams/contracts.ts'
import { Icon } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { TeamStatus } from './team-ui.tsx'

interface Line { id: string; path: string; dependency: boolean; active: boolean }
export function TeamGraph({ team, selected, select }: { team: TeamView; selected: string; select: (id: string) => void }) {
  const { t } = usePanel()
  const root = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLButtonElement>())
  const [lines, setLines] = useState<Line[]>([])
  const signature = `${team.state}|${team.handoffs.map(handoff => `${handoff.from}:${handoff.to}`).join(',')}|`
    + team.members.map(member => `${member.id}:${member.ticketId ?? ''}:${member.dependencies.join(',')}:${member.state}:${!!member.running}`).join('|')
  useLayoutEffect(() => {
    const measure = () => {
      const bounds = root.current?.getBoundingClientRect(); if (!bounds) return
      const connect = (from: string, to: string, dependency: boolean): Line[] => {
        const start = nodes.current.get(from)?.getBoundingClientRect(), end = nodes.current.get(to)?.getBoundingClientRect()
        if (!start || !end) return []
        const downward = end.top > start.bottom + 10
        const x1 = start.left + start.width / 2 - bounds.left, y1 = start.bottom - bounds.top
        const x2 = end.left + end.width / 2 - bounds.left, y2 = end.top - bounds.top
        const bend = downward ? (y1 + y2) / 2 : Math.max(y1, end.bottom - bounds.top) + 18
        const target = team.members.find(member => member.id === to), source = team.members.find(member => member.id === from)
        const active = !!target?.running && !['attention', 'failed', 'stopped', 'completed'].includes(team.state)
          && (!dependency || source?.state === 'finished' && team.handoffs.some(handoff => handoff.from === from && handoff.to === to))
        return [{ id: `${from}:${to}`, dependency, active, path: downward ? `M${x1},${y1} C${x1},${bend} ${x2},${bend} ${x2},${y2}`
          : `M${x1},${y1} C${x1},${bend} ${x2},${bend} ${x2},${end.bottom - bounds.top}` }]
      }
      setLines(team.members.flatMap(member => member.id === 'coordinator' ? [] : [
        ...member.ticketId ? connect('coordinator', member.id, false) : [],
        ...member.dependencies.flatMap(from => connect(from, member.id, true)),
      ]))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    for (const node of nodes.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [signature, team.id])
  const node = (member: TeamMemberView) => <button type="button" key={member.id} ref={element => {
    if (element) nodes.current.set(member.id, element); else nodes.current.delete(member.id)
  }} className="dt-team-node" data-state={member.state} data-running={member.running || undefined} data-coordinator={member.role === 'coordinator' || undefined} aria-pressed={selected === member.id}
    aria-label={`${member.name} · ${t('teamDetails')}`} onClick={() => select(member.id)}>
    <span className="dt-team-node-head"><span className="dt-team-avatar"><Icon name={member.role === 'coordinator' ? 'queue' : 'user'} size={18} /></span>
      <strong>{member.name}</strong><Icon name="chevron-right" size={14} /></span>
    <TeamStatus state={member.state} member />
    <span className="dt-team-node-action">{member.tools.findLast(tool => tool.state === 'running')?.detail
      ?? (member.attention || member.summary || t('teamNoProgress'))}</span>
    {member.dependencies.length > 0 && <span className="dt-team-node-deps">{t('teamPrerequisite', { names: member.dependencies.map(id => team.members.find(item => item.id === id)?.name ?? id).join('、') })}</span>}
    {member.model && <span className="dt-team-node-model">{member.model.model}</span>}
  </button>
  return <div className="dt-team-graph" ref={root} aria-label={t('teamGraph')}>
    <svg className="dt-team-lines" aria-hidden="true">{lines.map(line => <g key={line.id}><path d={line.path} data-dependency={line.dependency || undefined} data-active={line.active || undefined} />
      {line.active && <circle className="dt-team-flow-packet" r="2.5"><animateMotion dur={line.dependency ? '2.6s' : '2.1s'} repeatCount="indefinite" path={line.path} /></circle>}
    </g>)}</svg>
    <div className="dt-team-coordinator">{node(team.members[0]!)}</div>
    <div className="dt-team-workers">{team.members.slice(1).map(node)}</div>
    <div className="dt-team-legend"><span><i />{t('localDispatch')}</span><span><i data-dependency />{t('teamHandoff')}</span></div>
  </div>
}
