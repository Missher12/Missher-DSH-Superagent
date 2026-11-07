/** One MCP tool contract shared by the HTTP endpoint and the local stdio bridge. */
import { McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { MCP_SERVER_INFO, McpCreateRequest, McpFollowupRequest, TaskId, TaskGet, TaskList, TaskRetry } from './contract.ts'
export { TaskId, TaskGet, TaskList, TaskRetry } from './contract.ts'

const tools = {
  workspace_list: { schema: z.object({}).strict(), readOnly: true, description: 'List the workspaces granted to this connection. Use their IDs when creating a task.' },
  task_create: { schema: McpCreateRequest, readOnly: false, description: 'Dispatch an explicitly requested task in a granted workspace. Reuse requestId for retries of the same request. Returns immediately; use task_get for progress and results. It may modify files as instructed.' },
  task_get: { schema: TaskGet, readOnly: true, description: 'Read your task, its actual worker report, questions and durable replies. Optionally wait up to 30 seconds while work runs. Check the returned stage; dispatching is not completion.' },
  task_list: { schema: TaskList, readOnly: true, description: 'List this connection’s tasks and results. Other clients’ tasks are never included.' },
  task_followup: { schema: McpFollowupRequest, readOnly: false, description: 'Send a new requirement or answer to your task. Reuse requestId for the same message. A task stopped by a person needs a new explicit task.' },
  task_stop: { schema: TaskId, readOnly: false, description: 'Stop your task and its background work. Files already written are retained. Stopped work will not automatically resume.' },
  task_retry: { schema: TaskRetry, readOnly: false, description: 'Explicitly retry your failed task without creating a different ticket. Reuse requestId if the response is lost. Human-stopped tasks cannot be retried.' },
} as const
export type TaskTool = keyof typeof tools
export type TaskInvoker = (tool: TaskTool, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>

export function createTaskServer(invoke: TaskInvoker): McpServer {
  const server = new McpServer(MCP_SERVER_INFO)
  for (const [name, definition] of Object.entries(tools)) {
    server.registerTool(name, { description: definition.description, inputSchema: definition.schema,
      annotations: { readOnlyHint: definition.readOnly, idempotentHint: true } },
    async (args: unknown, context: ServerContext) => invoke(name as TaskTool, args as Record<string, unknown>, context.mcpReq.signal))
  }
  return server
}
