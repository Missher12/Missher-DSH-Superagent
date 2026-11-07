import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHttpHandler } from '../src/mcp/http.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined, http: Server | undefined, bridge: ReturnType<typeof createMcpHttpHandler> | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {})
  await bridge?.close(); bridge = undefined
  if (http) { http.closeAllConnections(); await new Promise<void>(resolve => http!.close(() => resolve())); http = undefined }
  await host?.stop(); host = undefined
})
it('serves real MCP discovery and task calls over loopback HTTP with client-scoped access', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  const project = join(host.directory, 'project'); mkdirSync(project)
  const ctx = host.ctx
  ctx.workspaceRegistry.list = () => [{ id: 'project', title: 'Project', path: project }] as ReturnType<typeof ctx.workspaceRegistry.list>
  const connection = await host.runtime.mcp!.createClient({ name: 'HTTP editor', workspaceIds: ['project'] })
  bridge = createMcpHttpHandler(host.runtime.mcp!)
  http = createServer((req, res) => { void bridge!.handle(req, res) })
  await new Promise<void>(resolve => http!.listen(0, '127.0.0.1', resolve))
  const url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/superagent/mcp`)
  expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401)
  expect((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, origin: 'https://example.invalid' }, body: '{}' })).status).toBe(403)
  const client = new Client({ name: 'superagent-http-test', version: '1.0.0' }); clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${connection.token}` } } }))
  const tools = await client.listTools()
  expect(tools.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['workspace_list', 'task_create', 'task_get', 'task_followup', 'task_stop', 'task_retry', 'task_list']))
  expect((await client.callTool({ name: 'workspace_list', arguments: {} })).structuredContent).toMatchObject({ items: [{ id: 'project' }] })
  const request = { requestId: 'http-task', workspaceId: 'project', instructions: 'Read README without changing files.' }
  const created = await client.callTool({ name: 'task_create', arguments: request })
  const id = (created.structuredContent as { ticketId: string }).ticketId
  expect((await client.callTool({ name: 'task_create', arguments: request })).structuredContent).toMatchObject({ ticketId: id })
  await host.runtime.idle()
  await host.runTool(`worker-${id}`, 'orchestrator_report', { state: 'ready', summary: 'README checked over MCP.' })
  await host.runtime.idle()
  expect((await client.callTool({ name: 'task_get', arguments: { ticketId: id } })).structuredContent).toMatchObject({ ticketId: id, summary: 'README checked over MCP.' })
  const refused = await client.callTool({ name: 'task_create', arguments: { ...request, requestId: 'ungranted', workspaceId: 'private' } })
  expect(refused.isError).toBe(true)
  expect(host.runtime.store.tickets.list()).toHaveLength(1)
})
