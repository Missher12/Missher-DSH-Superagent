import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsSchema } from '../src/policy.ts'
import { feishuKind } from '../src/sources/feishu.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { createFeishuConnector, type FeishuConnectionIO } from '../src/app/feishu-connect.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-connect-')); directories.push(directory)
  let revision = 3
  let settings = SettingsSchema.parse({ sources: { feishu: { enabled: true, config: { cli: '/existing/bot',
    workspaceDirectory: directory, chats: [{ chatId: 'oc_test', listen: 'mentions' }], directMessages: false } } } })
  const sources = new SourceRegistry(() => settings); sources.register(feishuKind)
  const save = vi.fn(async (_block: string, value: unknown, from: number) => {
    expect(from).toBe(revision)
    settings = SettingsSchema.parse({ ...settings, sources: { ...settings.sources, feishu: value } }); revision++
    return { restarting: true }
  })
  const io: FeishuConnectionIO = { verify: vi.fn(async () => ({ cli: '', appId: 'cli_test', brand: 'feishu' as const, botId: 'ou_bot', name: '测试机器人' })),
    save: vi.fn(async () => ({ cli: '', appId: 'cli_test', brand: 'feishu' as const, credential: 'dsh-superagent/feishu-' + 'a'.repeat(32) })),
    remove: vi.fn(async () => {}), resolve: vi.fn(async config => ({ cli: config.cli,
      appId: 'cli_test', brand: 'feishu' as const, botId: 'ou_bot', name: '测试机器人' })) }
  const active = vi.fn(() => 0)
  const connect = createFeishuConnector({ machine: { stateDir: directory }, store: { settings: () => settings, blockRevision: () => revision },
    sources, settings: { save }, active, signal: new AbortController().signal }, io)
  return { connect, io, save, active, value: () => settings.sources.feishu!, stale: () => revision++ }
}
it('validates credentials before storing them in DSH and retains only a reference in settings', async () => {
  const f = fixture(), secret = 'new-secret-sentinel'
  const result = await f.connect({ revision: 3, appId: 'cli_test', appSecret: secret, value: f.value() })
  expect(f.io.verify).toHaveBeenCalledWith('cli_test', secret, 'feishu')
  expect(f.io.save).toHaveBeenCalledWith('cli_test', secret, 'feishu')
  expect(f.value().config).toMatchObject({ chats: [{ chatId: 'oc_test', listen: 'mentions' }], directMessages: false,
    cli: '', credential: 'dsh-superagent/feishu-' + 'a'.repeat(32) })
  expect(JSON.stringify(f.value())).not.toContain(secret)
  expect(result).toMatchObject({ restarting: true, appId: 'cli_test', botId: 'ou_bot' })
  expect(JSON.stringify(result)).not.toContain(secret)
})
it('keeps the working connection unchanged and sanitizes a failed credential check', async () => {
  const f = fixture(), before = structuredClone(f.value())
  vi.mocked(f.io.verify).mockRejectedValue(new Error('remote echoed secret-sentinel'))
  await expect(f.connect({ revision: 3, appId: 'cli_test', appSecret: 'secret-sentinel', value: f.value() }))
    .rejects.toThrow('App ID 或 App Secret 验证失败')
  expect(f.io.save).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled()
  expect(f.value()).toEqual(before)
})
it('reuses an existing secret only for its actual app identity', async () => {
  const f = fixture()
  await expect(f.connect({ revision: 3, appId: 'cli_other', value: f.value() })).rejects.toThrow('更换 App ID 时需要填写 App Secret')
  expect(f.save).not.toHaveBeenCalled()
  await f.connect({ revision: 3, appId: 'cli_test', value: f.value() })
  expect(f.io.verify).not.toHaveBeenCalled(); expect(f.io.save).not.toHaveBeenCalled()
  expect(f.value().config.cli).toBe('/existing/bot')
})
it('refuses a stale form or an active task before changing credentials', async () => {
  const f = fixture()
  await expect(f.connect({ revision: 2, appId: 'cli_test', appSecret: 'secret', value: f.value() })).rejects.toThrow('配置已更新')
  f.active.mockReturnValue(1)
  await expect(f.connect({ revision: 3, appId: 'cli_test', appSecret: 'secret', value: f.value() })).rejects.toThrow('任务执行结束后')
  expect(f.io.verify).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled()
})
it('rechecks the source revision after verification before storing credentials', async () => {
  const f = fixture()
  vi.mocked(f.io.verify).mockImplementation(async () => { f.stale(); return { cli: '', appId: 'cli_test', brand: 'feishu', botId: 'ou_bot', name: 'Bot' } })
  await expect(f.connect({ revision: 3, appId: 'cli_test', appSecret: 'secret', value: f.value() })).rejects.toThrow('配置已更新')
  expect(f.io.save).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled()
})

it('removes a newly stored credential if the source changes before it can be committed', async () => {
  const f = fixture()
  vi.mocked(f.io.save).mockImplementation(async () => { f.stale(); return { cli: '', appId: 'cli_test', credential: 'dsh-superagent/feishu-' + 'a'.repeat(32) } })
  await expect(f.connect({ revision: 3, appId: 'cli_test', appSecret: 'secret', value: f.value() })).rejects.toThrow('配置已更新')
  expect(f.io.remove).toHaveBeenCalledWith('dsh-superagent/feishu-' + 'a'.repeat(32))
  expect(f.save).not.toHaveBeenCalled()
})
