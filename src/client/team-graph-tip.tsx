import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { TeamView } from '../teams/contracts.ts'
import { usePanel } from './provider.tsx'
import { effortLabel } from './model-labels.ts'
import { participantDetail, type TeamParticipant } from './team-participants.ts'
import { workbenchToolLabel, fullTime } from './text.ts'
import type { GraphRoute } from './team-transitions.ts'

export function TeamGraphTip({ id, anchor, team, member, routes, dismiss }: {
  id: string; anchor: HTMLButtonElement; team: TeamView; member: TeamParticipant; routes: GraphRoute[]; dismiss: () => void
}) {
  const bubble = useRef<HTMLDivElement>(null), { t, renderPressure } = usePanel()
  useLayoutEffect(() => {
    const node = bubble.current
    if (!node) return
    const position = () => {
      const a = anchor.getBoundingClientRect(), b = node.getBoundingClientRect(), gap = 7, margin = 8
      node.style.left = `${Math.max(margin, Math.min(a.left, window.innerWidth - b.width - margin))}px`
      const top = a.bottom + gap + b.height <= window.innerHeight - margin ? a.bottom + gap : a.top - b.height - gap
      node.style.top = `${Math.max(margin, top)}px`
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    position()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position)
    resize?.observe(node); resize?.observe(anchor)
    window.addEventListener('scroll', dismiss, true); window.addEventListener('resize', dismiss); window.addEventListener('keydown', escape)
    return () => { resize?.disconnect(); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', escape) }
  }, [anchor, dismiss])
  const events = routes.filter(route => route.to === member.id).flatMap(route => route.events)
  const tool = member.tools.findLast(item => item.state === 'running') ?? member.tools.at(-1)
  const review = team.workflow?.reviews.findLast(item => item.reviewerId === member.id || item.targets.includes(member.id))
  return createPortal(<div id={id} role="tooltip" className="dt-graph-tip" ref={bubble}>
    <strong>{member.name}</strong><p>{participantDetail(team, member, t)}</p>
    <dl>{member.model && <><dt>{t('localTaskModel')}</dt><dd>{[member.model.provider, member.model.model, member.model.reasoningEffort && effortLabel(member.model.reasoningEffort, member.model.reasoningEffort, t)].filter(Boolean).join(' · ')}</dd></>}
      {tool && <><dt>{t('graphLastTool')}</dt><dd>{workbenchToolLabel(t, tool.name)} · {fullTime(tool.at, t('lang'))}</dd></>}
      {events.length > 0 && <><dt>{t('graphReceived')}</dt><dd>{t('graphTimes', { count: events.length })}</dd></>}
      {member.dependencies.length > 0 && <><dt>{t('teamDependencies')}</dt><dd>{member.dependencies.map(id => team.members.find(person => person.id === id)?.name ?? id).join(' · ')}</dd></>}
    </dl>{member.sessionId && renderPressure?.(member.sessionId)}{review?.reason && <p className="dt-graph-tip-review">{review.reason}</p>}
  </div>, document.body)
}
