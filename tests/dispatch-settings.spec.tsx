// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { usePanel, mount, remount, all, find, click, type, field, text, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'
import type { SourceView } from '../src/client/api.ts'
import { zh } from '../src/client/locales.ts'

usePanel()
const source = (id: string, title: string): SourceView => ({ id, kind: id, title: { zh: title, en: title },
  description: { zh: '', en: '' }, installed: true, state: 'ready', value: { enabled: true, config: {} }, revision: 0,
  restarts: [], fields: [], facts: {}, labels: {} })
async function open() {
  server.setup = { ...server.setup, mode: 'local', accounts: null }; at({ page: 'settings' })
  await mount(); await click(zh.localConnections); await click(zh.localExternalPolicy)
}
it('discovers another registered source in connections and saves its own dispatch identities', async () => {
  server.additionalSources = [{ ...source('support', '工单系统'), policy: { explicit: { zh: '授权账号的直接派单', en: 'Authorized requests' },
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '允许派单的用户', en: 'Allowed users' }, columns: [
      { key: 'id', type: 'text', label: { zh: '账号', en: 'Account' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true },
    ] }] } }]
  await open()
  await click(find('工单系统', '.dt-source-policy-nav button'))
  await click(find(zh.addRow, '.dt-part button'))
  await type(field<HTMLInputElement>('账号'), 'support-alice')
  await type(field<HTMLInputElement>('名字'), 'Alice')
  await click(zh.save)
  expect(server.settings.policy.sources.support?.allowed).toEqual([{ id: 'support-alice', name: 'Alice' }])
  await click(find('工单系统', '.dt-connections-nav button'))
  expect(find('工单系统', '.dt-connections-nav button')).toBeDefined()
})
it('lists multiple MCP applications and edits one workspace grant without changing the others', async () => {
  server.additionalSources = [source('mcp', 'MCP 外部派单')]
  server.workspaceChoices = [{ id: 'a', title: '项目 A', directory: '/tmp/a' }, { id: 'b', title: '项目 B', directory: '/tmp/b' }]
  server.mcp = { url: 'http://127.0.0.1:3082/superagent/mcp', enabled: true, clients: [
    { id: 'e7723f90-c954-4fcf-b623-326f5eca9ce7', name: '研发助手', enabled: true, credentialConfigured: true, lastUsedAt: null,
      projects: [{ id: 'a', title: '项目 A', directory: '/tmp/a' }] },
    { id: '7284e7ab-48b2-4efb-afca-ec2ea749b959', name: '文档助手', enabled: false, credentialConfigured: true, lastUsedAt: null,
      projects: [{ id: 'b', title: '项目 B', directory: '/tmp/b' }] },
  ] }
  await open(); await click(find('MCP', '.dt-source-policy-nav button'))
  expect(text()).toContain('研发助手'); expect(text()).toContain('文档助手')
  const first = all('.dt-mcp-connection').find(row => row.textContent?.includes('研发助手'))!
  await click(first.querySelector('button')!)
  await click(document.querySelector<HTMLInputElement>('.dt-mcp-workspaces label[title="/tmp/b"] input')!)
  await click(find(zh.save, '[role="dialog"] button'))
  expect(server.mcp.clients[0]!.projects.map(project => project.id)).toEqual(['a', 'b'])
  expect(server.mcp.clients[1]).toMatchObject({ name: '文档助手', enabled: false, projects: [{ id: 'b' }] })
  expect(server.requests.some(request => request.path === 'settings/policy' && request.method === 'PUT')).toBe(false)
})
it('edits an automatic rule in a focused form and retains it when switching source permissions', async () => {
  await open(); await click('自动规则'); await click(zh.addRule)
  await type(field<HTMLInputElement>(zh.ruleName), '文档巡检')
  await type(field<HTMLTextAreaElement>(zh.ruleInstruction), '仅检查已授权项目中的失效链接')
  await click('完成')
  expect(all('[role="dialog"]')).toHaveLength(0)
  await click('来源权限'); await click('自动规则')
  expect(text()).toContain('文档巡检')
  await click(zh.save)
  expect(server.settings.policy.rules.at(-1)).toMatchObject({ name: '文档巡检', instruction: '仅检查已授权项目中的失效链接' })
})
it('keeps assessment settings independent from MCP grants and restores its draft across remounts', async () => {
  server.settings.eval.mode = 'off'
  await open(); await click('研判设置')
  await type(field<HTMLSelectElement>(zh.acceptMode), 'observe')
  await click('来源权限'); await click('研判设置')
  expect(field<HTMLSelectElement>(zh.acceptMode).value).toBe('observe')
  await remount(); await click(zh.localConnections); await click(zh.localExternalPolicy); await click('研判设置')
  expect(field<HTMLSelectElement>(zh.acceptMode).value).toBe('observe')
  await click(zh.save)
  expect(server.settings.eval.mode).toBe('observe')
  expect(server.requests.filter(request => request.method === 'PUT').map(request => request.path)).toEqual(['settings/eval'])
})
it('reopens an unfinished rule on save and submits only after the missing condition is filled', async () => {
  await open(); await click('自动规则'); await click(zh.addRule)
  await type(field<HTMLInputElement>(zh.ruleName), '未完成规则')
  await click(find(zh.close, '[role="dialog"] button'))
  await click('来源权限')
  await click(zh.save)
  expect(field<HTMLInputElement>(zh.ruleName).value).toBe('未完成规则')
  expect(server.requests.some(request => request.method === 'PUT')).toBe(false)
  await type(field<HTMLTextAreaElement>(zh.ruleInstruction), '仅处理文档更新')
  await click('完成'); await click(zh.save)
  expect(server.settings.policy.rules.at(-1)).toMatchObject({ name: '未完成规则', instruction: '仅处理文档更新' })
})
