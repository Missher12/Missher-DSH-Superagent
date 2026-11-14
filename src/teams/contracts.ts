/** Explicit, persisted team plans and worker-owned delivery evidence. */
import { z } from 'zod'
import { RoleModelSchema, type RoleModel } from '../policy.ts'

export const TeamMemberSchema = z.object({
  id: z.string().regex(/^[\w-]{1,60}$/).refine(id => id !== 'coordinator', '成员标识不能使用 coordinator'),
  name: z.string().trim().min(1).max(60), instructions: z.string().trim().min(1).max(4000),
  dependencies: z.array(z.string()).max(11).default([]), model: RoleModelSchema.optional(),
  parentId: z.string().min(1).max(60).optional(),
  responsibility: z.enum(['manager', 'implementer', 'reviewer']).optional(),
}).strict()
export const TeamRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(80).optional(), instructions: z.string().trim().min(1).max(24000),
  directory: z.string().min(1).optional(), model: RoleModelSchema.optional(),
  permissionPreset: z.string().trim().min(1).max(200).optional(),
  coordinatorName: z.string().trim().min(1).max(60).default('协调'),
  members: z.array(TeamMemberSchema).min(2).max(12),
  workflow: z.object({ maxRounds: z.number().int().min(1).max(8).default(3) }).strict().optional(),
}).strict().superRefine((request, context) => {
  const ids = new Set(request.members.map(member => member.id))
  if (ids.size !== request.members.length) context.addIssue({ code: 'custom', path: ['members'], message: '成员标识不能重复' })
  const done = new Set<string>()
  for (let pass = 0; pass < request.members.length; pass++) for (const member of request.members) {
    if (member.dependencies.every(id => done.has(id))) done.add(member.id)
  }
  request.members.forEach((member, index) => {
    if (new Set(member.dependencies).size !== member.dependencies.length || member.dependencies.some(id => !ids.has(id) || id === member.id)) {
      context.addIssue({ code: 'custom', path: ['members', index, 'dependencies'], message: '请选择其他已存在的成员，且不要重复' })
    }
    const seen = new Set([member.id])
    let parent = member.parentId ?? 'coordinator'
    while (parent !== 'coordinator') {
      const owner = request.members.find(member => member.id === parent)
      if (!owner || seen.has(parent) || owner.responsibility !== 'manager') {
        context.addIssue({ code: 'custom', path: ['members', index, 'parentId'], message: '上级必须是已有管理成员，上下级不能形成循环' }); break
      }
      seen.add(parent); parent = owner.parentId ?? 'coordinator'
    }
  })
  if (done.size !== ids.size) context.addIssue({ code: 'custom', path: ['members'], message: '成员交付依赖不能形成循环' })
})
export type TeamRequest = z.infer<typeof TeamRequestSchema>
export type TeamMember = z.infer<typeof TeamMemberSchema>
export const TeamPlanPatchSchema = z.object({
  planVersion: z.number().int().positive(),
  changes: z.array(TeamMemberSchema.pick({ id: true, instructions: true, dependencies: true, parentId: true }).partial().required({ id: true })).min(1).max(12),
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
  changedMembers?: string[]
}
export type TeamState = 'planning' | 'working' | 'waiting' | 'attention' | 'failed' | 'completed' | 'stopped'
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
  id: string; request: TeamRequest; encoded: string; createdAt: string; updatedAt: string
  phase: 'creating' | 'planning' | 'working' | 'reviewing' | 'integrating' | 'completed'
  coordinatorTicketId?: string; directory?: string; permissionPreset?: string
  members: { plan: TeamMember; ticketId?: string; dependencyVersion?: string; pendingRound?: string }[]
  handoffs: { id: string; from: string; to: string; ticketId: string; at: string; version: string }[]
  finalVersion?: string; finalBaseline?: string; finalAssignment?: string
  continuations?: Record<string, { cycle: string; attempts: number; version: string }>
  stoppedAt?: string; error?: string
  workflow?: TeamWorkflow
  sourceTicketId?: string
  sourceInputs?: Record<string, string>
  sourceResult?: string
}

/** Public views intentionally distinguish planned roles, ended member runs, and completed team goals. */
export interface TeamMemberView {
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
  members: boolean; finalReview: boolean; evidence: boolean; issues: string[]
  checks: { passed: number; failed: number; notRun: number }; unverified: string[]
}
export interface TeamIndex {
  id: string; name: string; title: string; instructions: string; directory?: string; state: TeamState
  coordinatorTicketId?: string; createdAt: string; updatedAt: string; completedMembers: number; memberCount: number; summary: string
  activeMembers?: number; currentAction?: string
}
export interface TeamView extends TeamIndex {
  members: TeamMemberView[]; handoffs: TeamRecord['handoffs']; error?: string
  deliveries: { memberId: string; name: string; record: DeliveryRecord }[]
  completion?: TeamCompletion
  model?: RoleModel
  workflow?: TeamWorkflow
  commanderSessionId?: string
  sourceTicketId?: string
}
