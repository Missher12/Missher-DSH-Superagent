import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createMcpHttpHandler } from '../src/mcp/http.ts'
import { endpointUrl } from '../src/mcp/bridge.ts'
import { checkMcpConnection } from '../src/mcp/check.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined, client: Client | undefined
const servers: Server[] = [], handlers: ReturnType<typeof createMcpHttpHandler>[] = []
afterEach(async () => {
  await client?.close(); client = undefined
  for (const handler of handlers.splice(0)) await handler.close()
  for (const server of servers.splice(0)) {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
  await host?.stop(); host = undefined
})
it('rejects endpoint files that could send a connection token outside the local MCP endpoint', () => {
  for (const url of ['https://example.com/superagent/mcp', 'http://127.0.0.1:1234/other', 'http://user@127.0.0.1:1234/superagent/mcp',
    'http://127.0.0.1:1234/superagent/mcp?token=x']) expect(() => endpointUrl({ url })).toThrow()
  expect(endpointUrl({ url: 'http://127.0.0.1:1234/superagent/mcp' }).port).toBe('1234')
})
it('serves a desktop MCP client over stdio and reconnects after the DSH endpoint changes', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const project = join(host.directory, 'project'); mkdirSync(project)
  const ctx = host.ctx
  ctx.workspaceRegistry.list = () => [{ id: 'project', title: 'Project', path: project }] as ReturnType<typeof ctx.workspaceRegistry.list>
  const connection = await host.runtime.mcp!.createClient({ name: 'Desktop editor', workspaceIds: ['project'] })
  async function listen() {
    const handler = createMcpHttpHandler(host!.runtime.mcp!); handlers.push(handler)
    const server = createServer((req, res) => { void handler.handle(req, res) }); servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    writeFileSync(join(host!.directory, 'mcp-endpoint.json'), JSON.stringify({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/superagent/mcp` }))
  }
  await listen()
  expect(await checkMcpConnection({ command: process.execPath,
    args: ['--experimental-transform-types', 'src/mcp-bridge.ts', '--state-dir', host.directory],
    env: { DSH_SUPERAGENT_TOKEN: connection.token } })).toMatchObject({ tools: 7, workspaces: 1 })
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--experimental-transform-types', 'src/mcp-bridge.ts', '--state-dir', host.directory],
    cwd: process.cwd(), env: { DSH_SUPERAGENT_TOKEN: connection.token }, stderr: 'pipe' })
  client = new Client({ name: 'desktop-stdio-test', version: '1.0.0' })
  await client.connect(transport)
  expect((await client.listTools()).tools).toHaveLength(7)
  expect((await client.callTool({ name: 'workspace_list', arguments: {} })).structuredContent).toMatchObject({ items: [{ id: 'project' }] })
  const request = { requestId: 'stdio-task', workspaceId: 'project', instructions: 'Read README.' }
  const task = await client.callTool({ name: 'task_create', arguments: request })
  expect(task.isError).not.toBe(true)
  const ticketId = (task.structuredContent as { ticketId: string }).ticketId
  await listen()
  expect((await client.callTool({ name: 'task_get', arguments: { ticketId } })).structuredContent).toMatchObject({ ticketId })
  expect((await client.callTool({ name: 'task_create', arguments: request })).structuredContent).toMatchObject({ ticketId })
  expect(host.runtime.store.tickets.list()).toHaveLength(1)
}, 15000)
