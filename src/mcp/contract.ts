/** Public input schemas and stable endpoint names, independent of the DSH runtime. */
import { z } from 'zod'
export const MCP_SERVER_INFO = { name: 'dsh-superagent', version: '1.2.2' }
export const MCP_PATH = '/superagent/mcp'
export const MCP_ENDPOINT_FILE = 'mcp-endpoint.json'
export const McpCreateRequest = z.object({ requestId: z.string().trim().min(1).max(200), workspaceId: z.string().min(1),
  title: z.string().trim().min(1).max(160).optional(), instructions: z.string().trim().min(1).max(64000) }).strict()
export const McpFollowupRequest = z.object({ ticketId: z.string().min(1), requestId: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(64000) }).strict()
export const TaskId = z.object({ ticketId: z.string().min(1) }).strict()
export const TaskGet = TaskId.extend({ waitSeconds: z.number().int().min(0).max(30).default(0) }).strict()
export const TaskList = z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict()
export const TaskRetry = TaskId.extend({ requestId: z.string().trim().min(1).max(200) }).strict()
