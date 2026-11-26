import { expect, it } from 'vitest'
import { horizontalTransfer } from '../src/client/team-graph-routing.ts'
import { teamRoutes } from '../src/client/team-transitions.ts'
import type { TeamView, TeamReviewRecord } from '../src/teams/contracts.ts'

it('separates staffing, actual handoffs and accepted returns, including a round stopped at its limit', () => {
  const review = { reviewerId: 'coordinator', ticketId: 'plan', assignmentId: 'r1', at: '2026-11-22T00:01:00Z',
    roundId: 'one', decision: 'revise', targets: ['build'], handled: true } as TeamReviewRecord
  const team = { members: [{ id: 'coordinator', dependencies: [] }, { id: 'build', ticketId: 'build-ticket', dependencies: [] },
      { id: 'check', ticketId: 'check-ticket', dependencies: ['build'], running: true }],
    workflow: { reviews: [review], roundId: 'one' }, handoffs: [] } as unknown as TeamView
  const events = (to: string) => teamRoutes(team).filter(route => route.to === to).flatMap(route => route.events)
  expect(events('build').map(event => event.kind)).toEqual(['dispatch'])
  expect(events('check')).toEqual([])
  team.workflow!.roundId = 'two'
  expect(events('build').map(event => event.kind)).toEqual(['dispatch', 'return'])
  team.handoffs.push({ id: 'handoff', from: 'build', to: 'check', version: 'v', at: review.at, ticketId: 'check-ticket' })
  expect(events('check').map(event => event.id)).toEqual(['handoff/handoff'])
})

it('routes sideways between adjacent stages and keeps the rework rail outside stacked sibling cards', () => {
  const planner = { column: 1, single: true, left: 110, right: 188, top: 100, bottom: 170 }
  const build = { column: 2, single: false, left: 210, right: 288, top: 30, bottom: 100 }
  const review = { ...build, column: 3, left: 310, right: 388 }
  expect(horizontalTransfer(planner, build, 15).path).toBe('M188,135 H199 V65 H210')
  const returned = horizontalTransfer(review, planner, 230)
  expect(returned.path).toBe('M310,65 H304 V230 H149 V170')
  expect(returned.length).toBe(386)
})
