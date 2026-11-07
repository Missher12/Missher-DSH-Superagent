/** Existing-workspace bindings are captured when a task is accepted, rather than reselected at every worker launch. */
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Ticket } from '../core/index.ts'
import { family } from '../kv.ts'
import type { Store } from '../app/store.ts'
import type { WorkspaceBinding } from '../sources/kind.ts'

export const workspaceBindings = family<WorkspaceBinding>('workspace-binding:')
/** A workspace cannot be used safely; show the reason and wait for operator correction. */
export class WorkspaceError extends Error {}

export function canonicalWorkspace(binding: WorkspaceBinding): WorkspaceBinding {
  if (!binding.permissionPreset || binding.permissionPreset === 'custom') throw new WorkspaceError('请选择具名权限预设；插件不会自行扩大权限')
  if (!isAbsolute(binding.directory)) throw new WorkspaceError('工作区需要使用绝对路径')
  let directory: string
  try {
    directory = realpathSync(binding.directory)
    if (!statSync(directory).isDirectory()) throw new Error('Not a directory')
  } catch { throw new WorkspaceError('工作区不存在或不是目录') }
  return { directory, permissionPreset: binding.permissionPreset }
}

/** Legacy local tasks already carry their accepted directory and permission in their original trigger. */
export function workspaceOf(store: Pick<Store, 'get' | 'triggers'>, ticket: Ticket): WorkspaceBinding | undefined {
  const saved = store.get(workspaceBindings(ticket.id))
  if (saved) return saved
  const origin = store.triggers.get(ticket.origin.triggerId)
  if (origin?.source !== 'local' || typeof origin.meta.directory !== 'string' || typeof origin.meta.permissionPreset !== 'string') return undefined
  return { directory: ticket.execution?.directory ?? origin.meta.directory, permissionPreset: origin.meta.permissionPreset }
}
