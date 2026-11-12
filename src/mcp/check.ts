/** Verify a generated connection with a real MCP handshake and read-only discovery. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'
import { MCP_SERVER_INFO } from './contract.ts'

export async function checkMcpConnection(config: { command: string; args: string[]; env: Record<string, string> }
  | { url: string; headers: Record<string, string> }) {
  const transport = 'command' in config ? new StdioClientTransport({ ...config, stderr: 'pipe' })
    : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
  const client = new Client({ name: 'superagent-connection-check', version: MCP_SERVER_INFO.version })
  const options = { timeout: 10_000, signal: AbortSignal.timeout(10_000) }
  try {
    await client.connect(transport, options)
    const server = client.getServerVersion()
    if (server?.name !== MCP_SERVER_INFO.name) throw new Error('连接目标不是 Superagent')
    const tools = await client.listTools({}, options)
    if (!['workspace_list', 'task_create', 'task_get'].every(name => tools.tools.some(tool => tool.name === name))) throw new Error('派单工具不可用')
    const result = await client.callTool({ name: 'workspace_list', arguments: {} }, options)
    if (result.isError) throw new Error('工作区授权不可用')
    const { items } = z.object({ items: z.array(z.object({ id: z.string() })) }).parse(result.structuredContent)
    return { version: server.version, tools: tools.tools.length, workspaces: items.length, checkedAt: new Date().toISOString() }
  } finally { await client.close().catch(() => {}) }
}
