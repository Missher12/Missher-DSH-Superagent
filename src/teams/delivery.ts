/** Actual workspace files and persisted delivery reports, linked to real shell calls. */
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import type { Ticket } from '../core/index.ts'
import { workerSessionId } from '../executor/dsh.ts'
import { family } from '../kv.ts'
import type { Store } from '../app/store.ts'
import type { DeliveryInput, DeliveryRecord } from './contracts.ts'

const deliveries = family<DeliveryRecord>('local-delivery:')
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep)

export function workspaceFile(directory: string, value: string) {
  const root = realpathSync(directory), path = resolve(root, value)
  if (!inside(root, path)) throw new Error('交付文件必须位于当前任务目录中')
  let parent = path
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent)
  if (!inside(root, realpathSync(parent))) throw new Error('交付文件不能通过链接访问任务目录之外的文件')
  if (!existsSync(path)) return { path, exists: false }
  const canonical = realpathSync(path)
  if (!inside(root, canonical)) throw new Error('交付文件必须位于当前任务目录中')
  const stat = statSync(canonical)
  if (!stat.isFile()) throw new Error('请报告具体文件，不要把目录作为交付文件')
  return { path: canonical, exists: true, size: stat.size }
}

export function recordDelivery(store: Store, ticket: Ticket, input: DeliveryInput,
  evidence: (session: string, command: string, since: string) => { id: string; state: string } | undefined, state = 'progress'): void {
  const assignment = ticket.assignments.at(-1), directory = ticket.execution?.directory
  if (!assignment?.startedAt || !directory) throw new Error('当前任务还没有可记录交付的执行会话')
  const sessionId = workerSessionId(ticket.id)
  const files = input.files.map(file => ({ ...workspaceFile(directory, file.path), summary: file.summary }))
  if (state === 'ready' && files.some(file => !file.exists)) throw new Error('交付文件尚不存在，不能把它作为完成结果；请先生成文件或明确记录为未验证事项')
  const checks = input.checks.map(check => {
    if (check.outcome === 'not-run') return check
    const call = evidence(sessionId, check.command, assignment.startedAt!)
    if (!call || !['done', 'error'].includes(call.state)) throw new Error('检查结果需要对应本轮真实执行结束的命令；无法核对的检查请放入未验证事项')
    if (check.outcome === 'passed' && call.state === 'error') throw new Error('执行出错的命令不能报告为检查通过')
    return { ...check, toolCallId: call.id }
  })
  store.set(deliveries(`${ticket.id}:${assignment.id}`), { ticketId: ticket.id, assignmentId: assignment.id, sessionId,
    at: new Date().toISOString(), files, checks, unverified: input.unverified })
}

export function latestDelivery(store: Store, ticket: Ticket | undefined): DeliveryRecord | undefined {
  const assignment = ticket?.assignments.at(-1)
  return ticket && assignment ? store.get(deliveries(`${ticket.id}:${assignment.id}`)) : undefined
}

export function previewDeliveryFile(directory: string, value: string, allowed: string[]) {
  const file = workspaceFile(directory, value)
  if (!allowed.includes(file.path)) throw new Error('只能查看该团队实际报告的交付文件')
  if (!file.exists) throw new Error('这个交付文件目前不存在，请在执行会话中确认')
  const fd = openSync(file.path, 'r'), buffer = Buffer.alloc(Math.min(file.size!, 128_000))
  let bytes: number
  try { bytes = readSync(fd, buffer, 0, buffer.length, 0) } finally { closeSync(fd) }
  const body = buffer.subarray(0, bytes), text = new TextDecoder().decode(body, { stream: bytes < file.size! })
  const binary = body.includes(0) || text.includes('\uFFFD')
  return { path: file.path, relative: relative(directory, file.path), size: file.size!, binary,
    text: binary ? undefined : text, truncated: bytes < file.size! }
}
