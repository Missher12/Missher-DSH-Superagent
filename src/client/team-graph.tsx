/** Nodes and connectors are drawn only from an explicitly persisted team plan. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { TeamView } from '../teams/contracts.ts'
import { Icon } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { TeamStatus } from './team-ui.tsx'
import { COMMANDER, participantIcon, participantDetail, participantStatus, teamFeedback, teamParticipants, type TeamParticipant } from './team-participants.ts'
import { horizontalTransfer, type GraphBox } from './team-graph-routing.ts'
import { TeamGraphTip } from './team-graph-tip.tsx'
import { teamRoutes, type GraphTransfer } from './team-transitions.ts'

type Geometry = ReturnType<typeof horizontalTransfer>
export function TeamGraph({ team, selected, select, addMember }: { team: TeamView; selected: string; select: (id: string) => void; addMember?: (member: TeamParticipant) => ReactNode }) {
  const { t, renderPressure } = usePanel()
  const participants = teamParticipants(team, t), commander = participants.find(member => member.role === 'commander')
  const feedback = teamFeedback(team), arrow = useId()
  const root = useRef<HTMLDivElement>(null), nodes = useRef(new Map<string, HTMLButtonElement>())
  // A management link with a separate task dependency appears once a transfer uses it.
  const routes = teamRoutes(team).filter(route => route.events.length || route.dependency || !team.members.find(member => member.id === route.to)?.dependencies.length)
  const [geometry, setGeometry] = useState(new Map<string, Geometry>())
  const [hover, setHover] = useState<string>(), tipId = useId()
  const dismiss = useCallback(() => setHover(undefined), [])
  const [pulses, setPulses] = useState(new Map<string, GraphTransfer>())
  const seen = useRef<Set<string> | null>(null)
  const eventKey = JSON.stringify(routes.map(route => [route.id, ...route.events.map(e => e.id)]))
  useEffect(() => {
    const previous = seen.current, fresh = new Map<string, GraphTransfer>()
    const known = previous ?? new Set<string>()
    for (const route of routes) for (const event of route.events) {
      if (previous && !known.has(event.id)) fresh.set(route.id, event)
      known.add(event.id)
    }
    seen.current = known
    if (!fresh.size || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setPulses(current => new Map([...current, ...fresh]))
  }, [eventKey])
  useEffect(() => {
    if (!pulses.size) return
    const timer = setTimeout(() => setPulses(new Map()), 1650)
    return () => clearTimeout(timer)
  }, [pulses])
  const ranks = new Map<string, number>([[COMMANDER, -1], ['coordinator', 0]])
  const workers = team.members.filter(member => member.id !== 'coordinator')
  for (let i = 0; i <= workers.length; i++) for (const worker of workers) {
    if (ranks.has(worker.id)) continue
    const parents = [worker.parentId ?? 'coordinator', ...worker.dependencies]
    if (parents.every(id => ranks.has(id))) ranks.set(worker.id, 1 + Math.max(...parents.map(id => ranks.get(id)!)))
  }
  const groups = Map.groupBy(team.members, member => ranks.get(member.id) ?? 1)
  const columns = [...groups.entries()].sort(([a], [b]) => a - b).map(([, members]) => members)
  const ordered = commander ? [[commander], ...columns] : columns
  const columnOf = new Map(ordered.flatMap((col, i) => col.map(member => [member.id, i] as const)))
  const railIndex = new Map<string, number>()
  let topRails = 0, bottomRails = 0
  for (const route of routes) {
    const from = columnOf.get(route.from), to = columnOf.get(route.to)
    if (from === undefined || to === undefined || to === from + 1) continue
    const bottom = to <= from && route.to !== COMMANDER
    railIndex.set(route.id, bottom ? ++bottomRails : -(++topRails))
  }
  const layoutKey = JSON.stringify([routes.map(route => route.id), team.members.map(member => [member.id, member.parentId, member.dependencies])])
  useLayoutEffect(() => {
    const measure = () => {
      const bounds = root.current?.getBoundingClientRect(); if (!bounds) return
      const measured = new Map<string, Geometry>()
      const boxes = new Map<string, GraphBox>()
      for (const [id, el] of nodes.current) {
        const column = columnOf.get(id)
        if (column === undefined) continue
        const rect = el.getBoundingClientRect()
        boxes.set(id, { column, single: ordered[column]!.length === 1, left: rect.left - bounds.left, right: rect.right - bounds.left,
          top: rect.top - bounds.top, bottom: rect.bottom - bounds.top })
      }
      for (const route of routes) {
        const start = boxes.get(route.from), end = boxes.get(route.to)
        if (!start || !end) continue
        const rail = railIndex.get(route.id) ?? 0
        const railY = rail > 0 ? bounds.height - 14 - 12 * (bottomRails - rail) : 15 + 12 * (topRails + rail)
        measured.set(route.id, horizontalTransfer(start, end, railY))
      }
      setGeometry(measured)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    for (const node of nodes.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [layoutKey])
  const inspect = participants.find(member => member.id === hover)
  const anchor = hover && nodes.current.get(hover)
  const arrivals = new Map(routes.flatMap(route => {
    const event = pulses.get(route.id)
    return event ? [[route.to, event] as const] : []
  }))
  const neighbors = new Set(hover ? [hover, ...routes.filter(r => r.from === hover || r.to === hover).flatMap(r => [r.from, r.to])] : [])
  const node = (member: TeamParticipant) => <button type="button" key={member.id} ref={element => {
    if (element) nodes.current.set(member.id, element); else nodes.current.delete(member.id)
  }} className="dt-team-node" data-member={member.id} data-dimmed={hover && !neighbors.has(member.id) || undefined} data-role={member.role} data-function={member.responsibility} data-state={member.state} data-running={member.running || undefined} data-coordinator={member.role === 'coordinator' || undefined} aria-pressed={selected === member.id}
    aria-label={`${member.name} · ${t('teamDetails')}`} aria-describedby={hover === member.id ? tipId : undefined}
    onPointerEnter={event => { if (event.pointerType !== 'touch') setHover(member.id) }}
    onPointerLeave={dismiss} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setHover(member.id) }}
    onBlur={dismiss} onClick={() => { dismiss(); select(member.id) }}>
    {arrivals.has(member.id) && <span key={arrivals.get(member.id)!.id} aria-hidden="true" className="dt-graph-arrival" data-return={arrivals.get(member.id)!.kind === 'return' || undefined} />}
    <span className="dt-team-node-head"><span className="dt-team-avatar"><Icon name={participantIcon(member)} size={17} /></span>
      <strong>{member.name}</strong></span><TeamStatus state={member.running && member.state === 'finished' ? 'working' : member.state} member label={participantStatus(team, member, t)} />
    <span className="dt-team-node-role" title={participantDetail(team, member, t)}>{participantDetail(team, member, t)}</span>
    {member.sessionId && renderPressure ? renderPressure(member.sessionId, !!member.running) :
      <span className="dt-member-pressure"><span>{t('sessionContextTitle')}</span><small>{t('studioNoPressure')}</small></span>}
  </button>
  const branch = (member: TeamParticipant) => <div className="dt-team-branch" key={member.id} data-parent={member.role === 'member' ? member.parentId ?? 'coordinator' : undefined}>
    {node(member)}{addMember && <div className="dt-team-branch-action">{addMember(member)}</div>}
  </div>
  return <div className="dt-team-graph" style={{ gridTemplateColumns: `repeat(${Math.max(1, ordered.length)}, minmax(0, 1fr))`,
    minWidth: ordered.length * 72 + Math.max(0, ordered.length - 1) * 20 + 24,
    paddingBlockStart: 36 + topRails * 12, paddingBlockEnd: 34 + bottomRails * 12 }} data-feedback={!!feedback || undefined} ref={root} aria-label={t('teamGraph')}>
    <svg className="dt-team-lines" aria-hidden="true"><defs><marker id={arrow} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path className="dt-team-return-arrow" d="M0,0 L6,3 L0,6 Z" /></marker></defs>
      {routes.map(route => {
        const line = geometry.get(route.id)
        if (!line) return null
        const currentReturn = feedback?.from === route.from && feedback.to.includes(route.to)
        const returns = route.events.filter(event => event.kind === 'return').length
        const pulse = pulses.get(route.id), count = returns || route.events.length
        const label = returns ? t('graphReturnTimes', { count: returns }) : t('graphTimes', { count })
        return <g key={route.id} data-route-from={route.from} data-route-to={route.to} data-dimmed={hover && route.from !== hover && route.to !== hover || undefined}>
          <path d={line.path} data-dependency={route.dependency || undefined} data-feedback={currentReturn || undefined}
            data-visited={route.events.length > 0 || undefined} markerEnd={currentReturn ? `url(#${arrow})` : undefined} data-selected={route.to === selected || undefined} />
          <circle className="dt-graph-port" cx={line.start.x} cy={line.start.y} r="2.5" /><circle className="dt-graph-port" cx={line.end.x} cy={line.end.y} r="2.5" />
          {pulse && line.length > 0 && <g key={pulse.id} className="dt-graph-flight" data-return={pulse.kind === 'return' || undefined}
            style={{ '--dt-end': `${-line.length}px`, '--dt-flight-gap': `${line.length + 3}px`, '--dt-trail': `${Math.min(44, line.length * .35)}px` } as CSSProperties}>
            <circle className="dt-graph-launch" cx={line.start.x} cy={line.start.y} r="3" />
            <path d={line.path} className="dt-graph-trail" /><path d={line.path} className="dt-graph-signal" />
          </g>}
          {(returns > 0 || count > 1) && <g className="dt-graph-tally" data-return={returns > 0 || undefined} transform={`translate(${line.tally.x} ${line.tally.y})`}>
            <title>{label}</title><rect x="-12" y="-7" width="24" height="14" rx="6" /><text textAnchor="middle" dy="3.5">{returns ? '↺' : '×'}{count}</text>
          </g>}
        </g>
      })}
    </svg>
    {inspect && anchor && <TeamGraphTip id={tipId} team={team} member={inspect} routes={routes} anchor={anchor} dismiss={dismiss} />}
    {commander && <div className="dt-live-rank" data-rank="-1">{branch(commander)}</div>}
    {Array.from(groups).sort(([a], [b]) => a - b).map(([rank, members]) => <div className="dt-live-rank" data-rank={rank} key={rank}>{members.map(branch)}</div>)}
  </div>
}
