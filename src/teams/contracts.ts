/** Explicit, persisted team plans and worker-owned delivery evidence. */
import { z } from 'zod'
import { planIssues } from './plan.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { RoleModelSchema, type RoleModel } from '../policy.ts'
import type { GitTeam } from './git-workspaces.ts'

export const InterfaceCheckSchema = z.object({ id: z.string().regex(/^[\w-]{1,60}$/), name: z.string().trim().min(1).max(80),
  command: z.string().trim().min(1).max(6000) }).strict()
const interfaceChecks = z.array(InterfaceCheckSchema).max(8).refine(items => new Set(items.map(item => item.id)).size === items.length, '验收标识不能重复')
export const TeamControlsSchema = z.object({ revision: z.number().int().nonnegative(), interfaceChecks }).strict()
export type TeamControls = z.infer<typeof TeamControlsSchema>
export type InterfaceCheck = z.infer<typeof InterfaceCheckSchema>
export interface TeamTimelineEvent { id: string; at: string; kind: 'phase' | 'review' | 'interrupted' | 'recovered' | 'resumed' | 'controls' | 'blocked'; round?: number; memberId?: string; targets?: string[]; decision?: TeamReview['decision']; detail: string }

export const TeamMemberSchema = z.object({
  id: z.string().regex(/^[\w-]{1,60}$/).refine(id => id !== 'coordinator', '成员标识不能使用 coordinator'),
  name: z.string().trim().min(1).max(60), instructions: z.string().trim().min(1).max(4000),
  dependencies: z.array(z.string()).max(11).default([]), model: RoleModelSchema.optional(),
  parentId: z.string().min(1).max(60).optional(),
  responsibility: z.enum(['manager', 'implementer', 'reviewer']).optional(),
}).strict()
const TeamRequestFields = z.object({
  requestId: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(80).optional(), instructions: z.string().trim().min(1).max(24000),
  directory: z.string().min(1).optional(), model: RoleModelSchema.optional(),
  permissionPreset: z.string().trim().min(1).max(200).optional(),
  coordinatorName: z.string().trim().min(1).max(60).default('协调'),
  interfaceChecks: interfaceChecks.optional(),
  members: z.array(TeamMemberSchema).max(12),
  workflow: z.object({ maxRounds: z.number().int().min(1).max(8).default(3), workspace: z.enum(['shared', 'worktree']).optional() }).strict().optional(),
}).strict()
function validatePlan(request: { members: TeamMember[]; interfaceChecks?: InterfaceCheck[]; workflow?: unknown }, context: z.RefinementCtx) {
  for (const issue of planIssues(request.members)) context.addIssue({ code: 'custom', ...issue })
  if (request.interfaceChecks?.length && (!request.workflow || !request.members.some(member => member.responsibility === 'reviewer'))) context.addIssue({ code: 'custom', path: ['interfaceChecks'], message: '接口验收需要循环工作流与独立审核成员' })
}
export const TeamRequestSchema = TeamRequestFields.superRefine(validatePlan)
export const TeamPreparationSchema = TeamRequestFields.omit({ instructions: true }).superRefine(validatePlan)
export const TeamEditSchema = z.object({ revision: z.number().int().nonnegative(), members: z.array(TeamMemberSchema).max(12) }).strict().superRefine(validatePlan)
export type TeamPreparation = z.infer<typeof TeamPreparationSchema>
export type TeamEdit = z.infer<typeof TeamEditSchema>
export type TeamRequest = z.infer<typeof TeamRequestSchema>
export type TeamMember = z.infer<typeof TeamMemberSchema>
export const TeamPlanPatchSchema = z.object({
  planVersion: z.number().int().positive(),
  interfaceChecks: interfaceChecks.optional(),
  changes: z.array(TeamMemberSchema.pick({ id: true, instructions: true, parentId: true }).partial().required({ id: true })
    .extend({ dependencies: z.array(z.string()).max(11).optional() })).max(12).default([]),
  add: z.array(TeamMemberSchema.omit({ model: true })).max(12).default([]),
  remove: z.array(z.string().min(1)).max(12).default([]),
}).strict()
export const TeamReviewSchema = z.object({
  planVersion: z.number().int().positive(), roundId: z.string().min(1), inputVersion: z.string().min(1),
  decision: z.enum(['pass', 'revise', 'blocked']), reason: z.string().trim().min(1).max(2000),
  targets: z.array(z.string()).max(12).default([]),
  evidence: z.array(z.object({ ticketId: z.string().min(1), assignmentId: z.string().min(1) }).strict()).min(1).max(20),
}).strict().refine(value => value.decision === 'revise' ? value.targets.length > 0 : value.targets.length === 0,
  '返工必须指定成员；通过或受阻不能携带返工成员')
export type TeamReview = z.infer<typeof TeamReviewSchema>
export interface TeamReviewRecord extends TeamReview { reviewerId: string; ticketId: string; assignmentId: string; at: string; handled?: boolean }
export interface TeamWorkflow {
  planVersion: number; round: number; roundId: string; reviews: TeamReviewRecord[]
  pendingReview?: TeamReviewRecord; reviewBaseline?: string; halted?: string
  /** A human follow-up can grant one more round after an automatic pause. */
  roundLimit?: number
  changedMembers?: string[]
}
export type TeamState = 'draft' | 'planning' | 'working' | 'waiting' | 'attention' | 'failed' | 'completed' | 'stopped'
export type MemberState = 'planned' | 'queued' | 'working' | 'waiting' | 'attention' | 'failed' | 'finished' | 'stopped'

export const DeliverySchema = z.object({
  files: z.array(z.object({ path: z.string().trim().min(1).max(4096), summary: z.string().trim().max(400).default('') }).strict()).max(30).default([]),
  checks: z.array(z.object({ command: z.string().trim().min(1).max(6000), outcome: z.enum(['passed', 'failed', 'not-run']),
    details: z.string().trim().max(2000).default('') }).strict()).max(20).default([]),
  unverified: z.array(z.string().trim().min(1).max(1200)).max(20).default([]),
}).strict()
export type DeliveryInput = z.infer<typeof DeliverySchema>
export interface DeliveryRecord extends Omit<DeliveryInput, 'files' | 'checks'> {
  ticketId: string; assignmentId: string; sessionId: string; at: string
  files: { path: string; summary: string; exists: boolean; size?: number }[]
  checks: (DeliveryInput['checks'][number] & { toolCallId?: string; exitCode?: number })[]
}
export interface TeamRecord {
  controlRevision?: number
  timeline?: TeamTimelineEvent[]
  git?: GitTeam
  commanderReporting?: true
  commanderIntake?: true
  commanderBrief?: string
  commanderTicketId?: string
  commanderVersion?: string
  commanderAssignment?: string
  finalDelivery?: { version: string; summary: string; record: DeliveryRecord;
    artifacts?: (DeliveryRecord['files'][number] & { memberId: string; name: string })[] }
  commanderInputs?: { id: string; text: string; native?: UserMessage }[]
  id: string; request: TeamRequest; encoded: string; createdAt: string; updatedAt: string
  phase: 'draft' | 'briefing' | 'creating' | 'planning' | 'working' | 'reviewing' | 'integrating' | 'reporting' | 'completed'
  setupSessionId?: string
  pendingMessages?: UserMessage[]
  planRevision?: number
  retiredMembers?: { plan: TeamMember; ticketId?: string; removedAt: string }[]
  coordinatorTicketId?: string; directory?: string; permissionPreset?: string
  members: { plan: TeamMember; ticketId?: string; dependencyVersion?: string; pendingRound?: string }[]
  handoffs: { id: string; from: string; to: string; ticketId: string; at: string; version: string }[]
  finalVersion?: string; finalBaseline?: string; finalAssignment?: string
  continuations?: Record<string, { cycle: string; attempts: number; version: string }>
  continuationBlock?: { ticketId: string; assignmentId: string }
  eventWaits?: Record<string, { thread: string; after: string; assignment: string; waiting: boolean }>
  stoppedAt?: string; error?: string
  workflow?: TeamWorkflow
  sourceTicketId?: string
  sourceInputs?: Record<string, string>
  sourceResult?: string
}

/** Public views intentionally distinguish planned roles, ended member runs, and completed team goals. */
export interface TeamMemberView {
  branch?: string
  plan?: TeamMember
  id: string; name: string; instructions: string; dependencies: string[]; role: 'coordinator' | 'member'
  parentId?: string; responsibility?: TeamMember['responsibility']
  state: MemberState; ticketId?: string; sessionId?: string; directory?: string; model?: RoleModel | null
  summary: string; attention?: string; retry: boolean
  tools: { id: string; name: string; at: string; state: 'running' | 'done' | 'error' | 'interrupted'; detail?: string }[]
  events: { id: string; at: string; state: string; summary: string }[]
  delivery?: DeliveryRecord
  running?: boolean
  quotaWait?: boolean
}
export interface TeamCompletion {
  commander?: boolean
  members: boolean; finalReview: boolean; evidence: boolean; issues: string[]
  checks: { passed: number; failed: number; notRun: number }; unverified: string[]
}
export interface TeamIndex {
  id: string; name: string; title: string; instructions: string; directory?: string; state: TeamState
  coordinatorTicketId?: string; createdAt: string; updatedAt: string; completedMembers: number; memberCount: number; summary: string
  activeMembers?: number; currentAction?: string
}
export interface TeamView extends TeamIndex {
  controlRevision?: number
  interfaceChecks?: (InterfaceCheck & { reviewers: string[]; passed: string[]; failed?: string[] })[]
  timeline?: TeamTimelineEvent[]
  phase?: TeamRecord['phase']
  git?: { repository: string; branch: string; head?: string }
  finalDelivery?: TeamRecord['finalDelivery']
  planRevision?: number
  retiredMembers?: { id: string; name: string; ticketId?: string; sessionId?: string; removedAt: string }[]
  members: TeamMemberView[]; handoffs: TeamRecord['handoffs']; error?: string
  deliveries: { memberId: string; name: string; record: DeliveryRecord }[]
  completion?: TeamCompletion
  model?: RoleModel
  workflow?: TeamWorkflow
  commanderSessionId?: string
  commander?: Pick<TeamMemberView, 'sessionId' | 'directory' | 'model' | 'running' | 'quotaWait' | 'tools'>
    & Partial<Pick<TeamMemberView, 'ticketId' | 'summary' | 'state' | 'retry' | 'events' | 'delivery' | 'attention' | 'branch'>>
  sourceTicketId?: string
}
