/** Mount the authenticated endpoint on DSH's existing loopback server; no separate listener. */
import type { Context } from '@deepseek-ai/cordis'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpTasks } from '../sources/mcp.ts'
import { MCP_ENDPOINT_FILE, MCP_PATH } from './contract.ts'
import { createMcpHttpHandler } from './http.ts'

export function mountMcp(ctx: Context, intake: McpTasks, stateDir: string): () => void {
  const handler = createMcpHttpHandler(intake)
  const unregister = ctx.webServer.register({ kind: 'prefix', path: MCP_PATH, handler: handler.handle })
  const file = join(stateDir, MCP_ENDPOINT_FILE), temporary = `${file}.${process.pid}.tmp`
  let disposed = false
  let offReady = () => {}
  const publish = () => {
    if (disposed || !ctx.webServer.port) return
    try {
      writeFileSync(temporary, JSON.stringify({ url: `http://127.0.0.1:${ctx.webServer.port}${MCP_PATH}` }), { mode: 0o600 })
      renameSync(temporary, file)
      offReady()
    } finally { rmSync(temporary, { force: true }) }
  }
  // WebServer is provided before its async listen finishes. Publish when its fiber becomes active.
  offReady = ctx.on('internal/status', publish)
  publish()
  return () => { disposed = true; offReady(); unregister(); void handler.close(); rmSync(file, { force: true }) }
}
