/** Loopback MCP transport. Authentication and origin checks happen before parsing a request body. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { createMcpHandler, type CallToolResult } from '@modelcontextprotocol/server'
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { McpTasks, McpTaskError, McpCreateRequest, McpFollowupRequest, type McpPrincipal } from '../sources/mcp.ts'
import { WorkspaceError } from '../executor/workspace.ts'
import { UserError } from '../core/index.ts'
import { createTaskServer, TaskGet, TaskId, TaskList, TaskRetry, type TaskTool } from './server.ts'

function json(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    ...(status === 401 ? { 'www-authenticate': 'Bearer realm="Superagent"' } : {}) })
  res.end(JSON.stringify({ error: message }))
}
async function readBody(req: IncomingMessage) {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > 256 * 1024) throw new Error('body-too-large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
async function invoke(intake: McpTasks, principal: McpPrincipal, tool: TaskTool, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
  try {
    let value: unknown
    switch (tool) {
      case 'workspace_list': value = { items: intake.workspaces(principal) }; break
      case 'task_create': value = await intake.create(principal, McpCreateRequest.parse(args)); break
      case 'task_get': {
        const { ticketId, waitSeconds } = TaskGet.parse(args)
        const deadline = Date.now() + waitSeconds * 1000
        let result = intake.get(principal, ticketId)
        while (result.stage.stage === 'working' && !result.paused && Date.now() < deadline) {
          await delay(Math.min(1000, deadline - Date.now()), undefined, { signal })
          result = intake.get(principal, ticketId)
        }
        value = result; break
      }
      case 'task_list': { const { offset, limit } = TaskList.parse(args); value = intake.list(principal, offset, limit); break }
      case 'task_followup': value = await intake.followup(principal, McpFollowupRequest.parse(args)); break
      case 'task_stop': value = intake.stop(principal, TaskId.parse(args).ticketId); break
      case 'task_retry': { const { ticketId, requestId } = TaskRetry.parse(args); value = intake.retry(principal, ticketId, requestId); break }
    }
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }
  } catch (error) {
    if (signal.aborted) throw error
    const message = error instanceof McpTaskError || error instanceof WorkspaceError || error instanceof UserError ? error.message : '任务操作失败，请在 DSH 中检查任务状态'
    return { isError: true, content: [{ type: 'text', text: message }] }
  }
}

export function createMcpHttpHandler(intake: McpTasks) {
  const handler = createMcpHandler(({ authInfo }) => {
    if (!authInfo) throw new Error('Authenticated MCP context required')
    const principal = { clientId: authInfo.clientId, token: authInfo.token }
    return createTaskServer((tool, args, signal) => invoke(intake, principal, tool, args, signal))
  }, { responseMode: 'json' })
  const nodeHandler = toNodeHandler(handler)
  const validateHost = localhostHostValidation(), validateOrigin = localhostOriginValidation()
  return {
    close: () => handler.close(),
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!validateHost(req, res) || !validateOrigin(req, res)) return
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, 'MCP origin is not allowed'); return }
      const authorization = req.headers.authorization
      const token = typeof authorization === 'string' ? /^Bearer (\S+)$/.exec(authorization)?.[1] : undefined
      const principal = token && intake.authenticate(token)
      if (!principal) { json(res, 401, 'MCP access token required'); return }
      try {
        const body = req.method === 'POST' ? await readBody(req) : undefined
        intake.touch(principal)
        const authenticated = Object.assign(req, { auth: { clientId: principal.clientId, token: principal.token, scopes: ['tasks'] } })
        await nodeHandler(authenticated, res, body)
      } catch (error) {
        if (res.writableEnded || res.destroyed) return
        if (error instanceof SyntaxError) json(res, 400, 'Invalid MCP JSON request')
        else if (error instanceof McpTaskError) json(res, error.status, error.message)
        else if (error instanceof Error && error.message === 'body-too-large') json(res, 413, 'MCP request is too large')
        else json(res, 500, 'MCP request failed')
      }
    },
  }
}
