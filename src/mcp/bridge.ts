/** Desktop MCP entry: forward requests to the running DSH instance, keeping tasks in DSH. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { MCP_ENDPOINT_FILE, MCP_PATH } from './contract.ts'
import { createTaskServer, type TaskInvoker } from './server.ts'

export function endpointUrl(value: unknown): URL {
  const raw = value && typeof value === 'object' && 'url' in value ? value.url : undefined
  if (typeof raw !== 'string') throw new Error('DSH endpoint unavailable')
  const url = new URL(raw)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== MCP_PATH
    || url.username || url.password || url.search || url.hash) throw new Error('Invalid local DSH endpoint')
  return url
}

export function createTaskBridge(stateDir: string, token: string) {
  let current: { url: string; client: Client } | undefined
  let opening: Promise<Client> | undefined
  let closed = false
  const connect = async () => {
    if (closed) throw new Error('Bridge closed')
    const url = endpointUrl(JSON.parse(readFileSync(join(stateDir, MCP_ENDPOINT_FILE), 'utf8')))
    if (current?.url === url.href) return current.client
    await current?.client.close(); current = undefined
    const client = new Client({ name: 'dsh-superagent-desktop-bridge', version: '1.3.3' })
    try {
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: {
        headers: { authorization: `Bearer ${token}` }, redirect: 'error',
      } }))
      if (closed) throw new Error('Bridge closed')
      current = { url: url.href, client }
      return client
    } catch (error) { await client.close().catch(() => {}); throw error }
  }
  const invoke: TaskInvoker = async (name, args, signal) => {
    let client: Client | undefined
    try {
      // Only initialization is shared; task calls retain their own cancellation and request IDs.
      client = await (opening ??= connect().finally(() => { opening = undefined }))
      return await client.callTool({ name, arguments: args }, { signal, timeout: 45000 })
    } catch (error) {
      if (client && current?.client === client) { current = undefined; await client.close().catch(() => {}) }
      if (signal.aborted) throw error
      return { isError: true, content: [{ type: 'text', text: '无法连接 DSH。请保持 DSH 和 Superagent 启用，并检查此连接的令牌和工作区授权。重试派单时沿用原 requestId。' }] }
    }
  }
  return { invoke, async close() { closed = true; await opening?.catch(() => {}); await current?.client.close(); current = undefined } }
}

export function startStdioBridge(stateDir: string, token: string) {
  const bridge = createTaskBridge(stateDir, token)
  const handle = serveStdio(() => createTaskServer(bridge.invoke))
  let closing: Promise<void> | undefined
  const close = () => closing ??= Promise.allSettled([handle.close(), bridge.close()]).then(() => {})
  process.stdin.once('end', () => { void close() })
  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })
  return { close }
}
