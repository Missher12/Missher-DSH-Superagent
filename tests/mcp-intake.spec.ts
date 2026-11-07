import { existsSync, mkdirSync, realpathSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })
async function setup() {
  host = await startRuntime(undefined, { mode: 'local' })
  const project = join(host.directory, 'project')
  const other = join(host.directory, 'other')
  mkdirSync(project); mkdirSync(other)
  const ctx = host.ctx
  ctx.workspaceRegistry.list = () => [
    { id: 'project', title: 'Project', path: project }, { id: 'other', title: 'Other', path: other },
  ] as ReturnType<typeof ctx.workspaceRegistry.list>
  return { mcp: host.runtime.mcp!, project, other }
}

it('accepts a configured MCP client once and refuses another workspace, identity or changed request', async () => {
  const { mcp, project } = await setup()
  expect(mcp.authenticate('invalid')).toBeUndefined()
  const first = await mcp.createClient({ name: 'Editor', workspaceIds: ['project'] })
  const second = await mcp.createClient({ name: 'Other editor', workspaceIds: ['other'] })
  const owner = mcp.authenticate(first.token)!
  const other = mcp.authenticate(second.token)!
  expect(owner.clientId).toBe(first.client.id)
  const request = { requestId: 'mcp-first', workspaceId: 'project', title: 'Inspect README', instructions: 'Read README only.' }
  const task = await mcp.create(owner, request)
  expect((await mcp.create(owner, request)).ticketId).toBe(task.ticketId)
  expect(host!.runtime.store.tickets.list()).toHaveLength(1)
  await expect(mcp.create(owner, { ...request, instructions: 'Change the whole project.' })).rejects.toThrow(/requestId/)
  await expect(mcp.create(owner, { ...request, requestId: 'another', workspaceId: 'other' })).rejects.toThrow(/工作区/)
  expect(() => mcp.get(other, task.ticketId)).toThrow(/任务/)
  await host!.runtime.idle()
  const ticket = host!.runtime.store.tickets.get(task.ticketId)!
  expect(ticket.execution?.directory).toBe(realpathSync(project))
  expect(host!.runtime.store.triggers.get(ticket.origin.triggerId)).toMatchObject({ source: 'mcp', actor: { id: owner.clientId } })
  const detail = await host!.api('GET', `tickets/${task.ticketId}`)
  expect(detail).toMatchObject({ status: 200, body: { local: true, directory: realpathSync(project) } })
})

it('keeps token material out of public settings and invalidates rotated or disabled credentials', async () => {
  const { mcp } = await setup()
  const created = await mcp.createClient({ name: 'Editor', workspaceIds: ['project'] })
  expect(JSON.stringify(host!.runtime.store.settings())).not.toContain(created.token)
  expect(JSON.stringify(mcp.view())).not.toContain(created.token)
  const fresh = mcp.rotateToken(created.client.id)
  expect(mcp.authenticate(created.token)).toBeUndefined()
  expect(mcp.authenticate(fresh.token)?.clientId).toBe(created.client.id)
  await mcp.setEnabled(created.client.id, false)
  expect(mcp.authenticate(fresh.token)).toBeUndefined()
  await mcp.setEnabled(created.client.id, true)
  expect(mcp.authenticate(fresh.token)?.clientId).toBe(created.client.id)
})

it('prevents the routing model from expanding an MCP client’s workspace grants', async () => {
  const { mcp, project, other } = await setup()
  const created = await mcp.createClient({ name: 'Editor', workspaceIds: ['project'] })
  const principal = mcp.authenticate(created.token)!
  const value = structuredClone(host!.runtime.store.settings().sources.mcp!)
  const clients = value.config.clients as { projects: { directory: string }[] }[]
  clients[0]!.projects[0]!.directory = other
  await expect(host!.runtime.settings.save('source:mcp', value, host!.runtime.store.blockRevision('source:mcp'), 'tool')).rejects.toThrow()
  expect(mcp.workspaces(principal)[0]!.directory).toBe(realpathSync(project))
})

it('returns real worker reports and delivered replies and prevents follow-up after a human stop', async () => {
  const { mcp } = await setup()
  const created = await mcp.createClient({ name: 'Editor', workspaceIds: ['project'] })
  const owner = mcp.authenticate(created.token)!
  const task = await mcp.create(owner, { requestId: 'result', workspaceId: 'project', instructions: 'Inspect README.' })
  await host!.runtime.idle()
  await host!.runTool(`worker-${task.ticketId}`, 'orchestrator_report', { state: 'ready', summary: 'README checked.' })
  await host!.runtime.idle()
  await host!.runTool(host!.runtime.masterId, 'orchestrator_reply', { ticket_id: task.ticketId, purpose: 'result', text: 'README checked. No files changed.' })
  await host!.runtime.idle()
  expect(mcp.get(owner, task.ticketId)).toMatchObject({ summary: 'README checked.', messages: [{ text: 'README checked. No files changed.' }] })
  await mcp.followup(owner, { ticketId: task.ticketId, requestId: 'next', text: 'Summarize it in three points.' })
  await mcp.followup(owner, { ticketId: task.ticketId, requestId: 'next', text: 'Summarize it in three points.' })
  await host!.runtime.idle()
  const continued = host!.runtime.store.tickets.get(task.ticketId)!
  expect(continued.inputs.filter(input => input.kind === 'trigger' && host!.runtime.store.triggers.get(input.triggerId)?.text === 'Summarize it in three points.')).toHaveLength(1)
  mcp.stop(owner, task.ticketId)
  await expect(mcp.followup(owner, { ticketId: task.ticketId, requestId: 'after-stop', text: 'Continue.' })).rejects.toThrow(/停止/)
  expect(host!.runtime.store.tickets.get(task.ticketId)!.ended?.by).toBe('human')
})

it('lets the DSH operator follow up on an external task without impersonating its MCP client', async () => {
  const { mcp } = await setup()
  const created = await mcp.createClient({ name: 'Editor', workspaceIds: ['project'] })
  const owner = mcp.authenticate(created.token)!
  const task = await mcp.create(owner, { requestId: 'operator', workspaceId: 'project', instructions: 'Inspect README.' })
  await host!.runtime.idle()
  expect(await host!.api('POST', `local/tasks/${task.ticketId}/followup`, { requestId: 'operator-note', text: 'Check the test command too.' }))
    .toMatchObject({ status: 200 })
  await host!.runtime.idle()
  const ticket = host!.runtime.store.tickets.get(task.ticketId)!
  const note = ticket.inputs.filter(input => input.kind === 'trigger').map(input => host!.runtime.store.triggers.get(input.triggerId))
    .find(trigger => trigger?.text === 'Check the test command too.')
  expect(note).toMatchObject({ source: 'local', actor: { source: 'local', id: 'desktop-user' } })
  expect(ticket.mandate.actor).toMatchObject({ source: 'mcp', id: owner.clientId })
})

it('manages per-application credentials and grants through the DSH management API', async () => {
  await setup()
  const created = await host!.api('POST', 'mcp/clients', { name: 'Editor', workspaceIds: ['project'] })
  expect(created.status).toBe(200)
  const id = (created.body.client as { id: string }).id, token = created.body.token as string
  const config = created.body.configuration as { stdio: { mcpServers: { superagent: { args: string[] } } } }
  expect(config.stdio.mcpServers.superagent.args[0]).toMatch(/lib\/mcp-bridge\.js$/)
  const view = await host!.api('GET', 'mcp')
  expect(JSON.stringify(view)).not.toContain(token)
  expect(view.body.clients).toMatchObject([{ id, credentialConfigured: true }])
  expect((await host!.api('PUT', `mcp/clients/${id}`, { name: 'Code editor', workspaceIds: ['other'] })).status).toBe(200)
  expect((await host!.api('POST', `mcp/clients/${id}/enabled`, { enabled: false })).status).toBe(200)
  expect(host!.runtime.mcp!.authenticate(token)).toBeUndefined()
  expect((await host!.api('DELETE', `mcp/clients/${id}`)).status).toBe(200)
  expect((await host!.api('GET', 'mcp')).body.clients).toEqual([])
})

it('keeps paused intake queued and refuses to recreate a granted workspace removed before execution', async () => {
  const { mcp, project } = await setup()
  await host!.api('POST', 'executor/pause', { paused: true })
  const created = await mcp.createClient({ name: 'Editor', workspaceIds: ['project'] })
  const owner = mcp.authenticate(created.token)!
  const task = await mcp.create(owner, { requestId: 'paused', workspaceId: 'project', instructions: 'Inspect README.' })
  expect(task.paused).toBe(true)
  expect(host!.agents.has(task.sessionId)).toBe(false)
  rmdirSync(project)
  await host!.api('POST', 'executor/pause', { paused: false })
  await host!.runtime.idle()
  expect(existsSync(project)).toBe(false)
  expect(host!.agents.has(task.sessionId)).toBe(false)
  expect(mcp.get(owner, task.ticketId).summary).toContain('工作区不存在')
})
