/** Compile alone after build, so project-wide Context declarations cannot hide a broken public adapter entry. */
import type { Context } from '@deepseek-ai/cordis'
import type { SourceKind, SourceHost } from '../../lib/sources.js'

export function registerAdapter(ctx: Context, kind: SourceKind) {
  const host: SourceHost = ctx.orchestrator
  host.sources.register(kind)
  return host.context(kind)
}
