/** Open a DSH Session in the workspace after ensuring the session catalog is loaded. */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Thrown by `openKnownSession` when the host Session catalog is not ready or does not list the target Session.
 * The management panel catches it to display a localized error message.
 */
export class SessionNavigationError extends Error {
  constructor(readonly code: 'not-ready' | 'not-listed') { super(code) }
}

/** Select `id` in the workspace once the catalog lists it, unless aborted first. */
export async function openKnownSession(sessions: Pick<ISessions, 'list' | 'refresh'>, id: SessionId, open: (id: SessionId) => void, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  if (sessions.list.getSnapshot().phase !== 'ready' || !sessions.list.getSnapshot().byId[id]) await sessions.refresh()
  if (signal.aborted) return false
  const list = sessions.list.getSnapshot()
  if (list.phase !== 'ready') throw new SessionNavigationError('not-ready')
  if (!list.byId[id]) throw new SessionNavigationError('not-listed')
  open(id)
  return true
}

/** Embedded transcripts need the same catalog hydration as workspace navigation before retaining a Session. */
export async function retainKnownSession(sessions: Pick<ISessions, 'list' | 'refresh' | 'retain'>, id: SessionId, signal: AbortSignal): Promise<SessionReference | undefined> {
  let reference: SessionReference | undefined
  await openKnownSession(sessions, id, () => { reference = sessions.retain(id, { source: 'superagent', signal }) }, signal)
  if (!reference) return
  try {
    await reference.ready
    if (signal.aborted) { reference.release(); return }
    return reference
  } catch (error) { reference.release(); throw error }
}

interface DirectoryPickerScope { __DSH_DIRECTORY_PICKER__?: { pick: () => Promise<string | null> } }
/** Match DSH's native directory-flow driver: Desktop uses its preload bridge; web uses the Host picker. */
export function pickWorkspaceDirectory(hostPick: () => Promise<string | null>, scope: DirectoryPickerScope = globalThis as DirectoryPickerScope) {
  return scope.__DSH_DIRECTORY_PICKER__ ? scope.__DSH_DIRECTORY_PICKER__.pick() : hostPick()
}
