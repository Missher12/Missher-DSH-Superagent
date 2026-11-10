import { afterEach, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { PROJECT_OPS_READ_TOOLS, PROJECT_OPS_OTHER_TOOLS } from '../src/app/plugin-tools.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('provides lossless JSON schemas when another plugin enumerates member tools', async () => {
  const require = createRequire(import.meta.url)
  const { snapshotJsonValue } = require(require.resolve('@deepseek-ai/dsh-util-values', {
    paths: [require.resolve('@deepseek-ai/dsh-tools')],
  }))
  host = await startRuntime(undefined, { mode: 'local' })
  await host.runtime.local!.create({ requestId: 'schema-check', title: '工具兼容检查', instructions: '读取项目能力' })
  await host.runtime.idle()
  const definitions = [...host.tools.values()].flatMap(tools => [...tools.values()]).map(definition => ({
    name: definition.name, parameters: 'parameters' in definition ? definition.parameters : undefined,
  }))
  definitions.push(host.ctx.tools.get('superagent_task')!)
  expect(definitions.length).toBeGreaterThan(5)
  for (const definition of definitions) expect(snapshotJsonValue(definition.parameters), definition.name).toBeDefined()
})

it('exposes only registered read-only Project Ops tools to a worker and reports other tools as restricted', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  for (const name of [...PROJECT_OPS_READ_TOOLS, ...PROJECT_OPS_OTHER_TOOLS]) host.ctx.tools.register({ name,
    description: 'Test host tool', parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: '{}' }] },
    execute: async () => ({}) })
  const task = await host.runtime.local!.create({ requestId: 'project-tools', title: '只读插件检查', instructions: '读取项目能力' })
  await host.runtime.idle()
  expect(host.agents.get(task.sessionId)!.ctx.tools.restrict).toHaveBeenCalledWith({ allow: [...PROJECT_OPS_READ_TOOLS] })
  const response = await host.api('GET', 'local/capabilities')
  expect(response.status).toBe(200)
  const capabilities = host.runtime.sessions.capabilities()
  expect(capabilities.tools.filter(tool => tool.registered && tool.worker).map(tool => tool.name)).toEqual([...PROJECT_OPS_READ_TOOLS])
  expect(capabilities.tools.filter(tool => !tool.worker).map(tool => tool.name)).toEqual([...PROJECT_OPS_OTHER_TOOLS])
})

it('does not advertise an uninstalled plugin as a callable worker tool', async () => {
  host = await startRuntime(undefined, { mode: 'local' })
  expect(host.runtime.sessions.capabilities().tools.every(tool => !tool.registered)).toBe(true)
})
