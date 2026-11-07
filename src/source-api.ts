/** Supported adapter boundary. Register a real Source kind before enabling its intake. */
import type { SourceHost } from './sources/host.ts'
declare module '@deepseek-ai/cordis' { interface Context { orchestrator: SourceHost } }
export type { SourceKind, SourceChannel, SourcePolicyPart, SourceInstance, TriggerContext, WorkspaceBinding } from './sources/kind.ts'
export type { SourceHost, SourceContext, Health } from './sources/host.ts'
export { sourceContext } from './sources/host.ts'
export { family, record } from './kv.ts'
export { key, threadKey } from './core/index.ts'
export type { Trigger, OutboundMessage, ChannelRef, ActorRef } from './core/index.ts'
