/** Explicit, persisted team plans and worker-owned delivery evidence. */
import { z } from 'zod'
import { RoleModelSchema, type RoleModel } from '../policy.ts'

export const TeamMemberSchema = z.object({
  id: z.string().regex(/^[\w-]{1,60}$/).refine(id => id !== 'coordinator', '成员标识不能使用 coordinator'),
  name: z.string().trim().min(1).max(60), instructions: z.string().trim().min(1).max(4000),
  dependencies: z.array(z.string()).max(5).default([]), model: RoleModelSchema.optional(),
}).strict()
export const TeamRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(80).optional(), instructions: z.string().trim().min(1).max(24000),
  directory: z.string().min(1).optional(), model: RoleModelSchema.optional(),
  coordinatorName: z.string().trim().min(1).max(60).default('协调'),
  members: z.array(TeamMemberSchema).min(2).max(6),
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
  })
  if (done.size !== ids.size) context.addIssue({ code: 'custom', path: ['members'], message: '成员交付依赖不能形成循环' })
})
export type TeamRequest = z.infer<typeof TeamRequestSchema>
export type TeamMember = z.infer<typeof TeamMemberSchema>
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
  checks: (DeliveryInput['checks'][number] & { toolCallId?: string })[]
}
export interface TeamRecord {
  id: string; request: TeamRequest; encoded: string; createdAt: string; updatedAt: string
  phase: 'creating' | 'planning' | 'working' | 'integrating' | 'completed'
  coordinatorTicketId?: string; directory?: string; permissionPreset?: string
  members: { plan: TeamMember; ticketId?: string; dependencyVersion?: string }[]
  handoffs: { id: string; from: string; to: string; ticketId: string; at: string; version: string }[]
  finalVersion?: string; finalBaseline?: string; finalAssignment?: string
  stoppedAt?: string; error?: string
}

/** Public views intentionally distinguish planned roles, ended member runs, and completed team goals. */
export interface TeamMemberView {
  id: string; name: string; instructions: string; dependencies: string[]; role: 'coordinator' | 'member'
  state: MemberState; ticketId?: string; sessionId?: string; directory?: string; model?: RoleModel | null
  summary: string; attention?: string; retry: boolean
  tools: { id: string; name: string; at: string; state: 'running' | 'done' | 'error' | 'interrupted'; detail?: string }[]
  events: { id: string; at: string; state: string; summary: string }[]
  delivery?: DeliveryRecord
}
export interface TeamIndex {
  id: string; name: string; title: string; instructions: string; directory?: string; state: TeamState
  coordinatorTicketId?: string; createdAt: string; updatedAt: string; completedMembers: number; memberCount: number; summary: string
}
export interface TeamView extends TeamIndex {
  members: TeamMemberView[]; handoffs: TeamRecord['handoffs']; error?: string
  deliveries: { memberId: string; name: string; record: DeliveryRecord }[]
}
