import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Setup } from '../src/app/setup.ts'
import { SettingsSchema } from '../src/policy.ts'
import { testMachine } from './fixtures/deployment.ts'
import { FeishuGateway } from '../src/infra/feishu-gateway.ts'

describe('local desktop setup', () => {
  it('recovers a temporary account failure without restarting the host and stops retrying on disposal', async () => {
    vi.useFakeTimers()
    const directory = mkdtempSync(join(tmpdir(), 'superagent-setup-recovery-')), controller = new AbortController(), restart = vi.fn()
    const resolve = vi.spyOn(FeishuGateway.prototype, 'resolve').mockRejectedValueOnce(new Error('飞书连接失败，请检查网络或应用权限'))
      .mockResolvedValue({ appId: 'cli_test', botId: 'ou_test', name: 'Test', brand: 'feishu', cli: '' })
    const setup = new Setup({ context: new Context(), machine: { ...testMachine({ stateDir: directory }), mode: 'local' }, lifetime: controller.signal, restart })
    try {
      const settings = SettingsSchema.parse({ sources: { feishu: { enabled: true, config: { workspaceDirectory: directory, appId: 'cli_test', credential: 'dsh-superagent/feishu-' + '0'.repeat(32) } } } })
      expect(await setup.run(settings)).toBe(true)
      expect(setup.feishuProblem?.code).toBe('feishuGatewayFailed')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(setup.deployment.feishu?.botId).toBe('ou_test')
      expect(setup.feishuProblem).toBeUndefined()
      expect(restart).not.toHaveBeenCalled()
      resolve.mockRejectedValue(new Error('飞书连接失败，请检查网络或应用权限'))
      await setup.run(settings)
      const calls = resolve.mock.calls.length
      controller.abort(); setup.restore()
      await vi.advanceTimersByTimeAsync(180_000)
      expect(resolve).toHaveBeenCalledTimes(calls)
    } finally { controller.abort(); setup.restore(); vi.useRealTimers(); resolve.mockRestore(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('keeps local tasks available when optional external sources have invalid projects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'superagent-optional-source-'))
    const ctx = new Context()
    ctx.reflect.provide('subprocess', { spawn: () => { throw new Error('Must validate the workspace before accessing an account') } })
    const setup = new Setup({ context: ctx, machine: { ...testMachine({ stateDir: directory }), mode: 'local' },
      lifetime: new AbortController().signal, restart: () => {} })
    try {
      expect(await setup.run(SettingsSchema.parse({ sources: {
        github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh', workspaceDirectory: join(directory, 'missing') } },
        feishu: { enabled: true, config: { cli: 'lark-cli', workspaceDirectory: join(directory, 'also-missing') } },
      } }))).toBe(true)
      expect(setup.configured()).toBe(true)
      expect(setup.problem).toBeUndefined()
      expect(setup.githubProblem?.code).toBe('githubWorkspaceInvalid')
      expect(setup.feishuProblem?.code).toBe('feishuWorkspaceInvalid')
      expect(setup.deployment.github).toBeUndefined()
      expect(setup.deployment.feishu).toBeUndefined()
      expect(setup.commandEnvironment).toEqual({})
    } finally { setup.restore(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('starts without GitHub credentials and leaves the desktop process environment alone', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'superagent-local-setup-'))
    const before = { ...process.env }
    const ctx = new Context()
    ctx.reflect.provide('subprocess', { spawn: () => { throw new Error('Local startup must not invoke an account CLI') } })
    const setup = new Setup({ context: ctx, machine: { ...testMachine({ stateDir: directory }), mode: 'local' } as never,
      lifetime: new AbortController().signal, restart: () => {} })
    try {
      expect(await setup.run(SettingsSchema.parse({}))).toBe(true)
      expect(setup.configured()).toBe(true)
      expect(setup.deployment.github).toBeUndefined()
      expect(setup.commandEnvironment).toEqual({})
      expect(process.env).toEqual(before)
      expect(existsSync(join(directory, 'worker-bin'))).toBe(false)
      expect(existsSync(join(directory, 'worker-gitconfig'))).toBe(false)
    } finally { setup.restore(); rmSync(directory, { recursive: true, force: true }) }
  })
})
