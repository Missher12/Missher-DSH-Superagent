/** Accepts app credentials once; settings and history contain only a DSH credential reference. */
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import { FeishuBotSchema, resolveFeishuBot, type FeishuBot } from '../deployment.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { Settings } from './settings.ts'
import type { Store } from './store.ts'
import { executionRoot } from './execution-environment.ts'
import { FeishuGateway, gatewayCredential } from '../infra/feishu-gateway.ts'

export const FeishuConnectSchema = z.object({ revision: z.number().int().nonnegative(),
  appId: z.string().trim().regex(/^cli_[A-Za-z0-9]+$/).max(120),
  appSecret: z.string().trim().min(1).max(2048).refine(value => !/[\r\n]/.test(value)).optional(),
  brand: z.enum(['feishu', 'lark']).default('feishu'),
  value: z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()) }).strict(),
}).strict()
export type FeishuConnectRequest = z.input<typeof FeishuConnectSchema>
export interface FeishuConnectResult { restarting: boolean; appId: string; botId: string; name: string }
export class FeishuConnectError extends Error { constructor(readonly status: 400 | 409 | 503, message: string) { super(message) } }
type Binding = z.infer<typeof FeishuBotSchema>
interface ConnectionHost {
  machine: { stateDir: string }; store: Pick<Store, 'settings' | 'blockRevision'>; sources: SourceRegistry
  settings: { save: (...args: Parameters<Settings['save']>) => Promise<{ restarting: boolean }> }
  credentials?: CredentialProvider
  active(): number; signal: AbortSignal
}
export interface FeishuConnectionIO {
  verify(appId: string, secret: string, brand: 'feishu' | 'lark'): Promise<FeishuBot>
  save(appId: string, secret: string, brand: 'feishu' | 'lark'): Promise<Binding>
  remove(reference: string): Promise<void>
  resolve(binding: Binding): Promise<FeishuBot | undefined>
}
function connectionIO(host: ConnectionHost): FeishuConnectionIO {
  const gateway = new FeishuGateway(host.credentials)
  return {
    verify: async (appId, secret, brand) => ({ ...await gateway.verify(appId, secret, brand, AbortSignal.any([host.signal, AbortSignal.timeout(20_000)])), cli: '' }),
    async save(appId, secret, brand) {
      const credential = gatewayCredential(host.machine.stateDir, `${appId}:${randomUUID()}`)
      await gateway.save(credential, secret)
      return { cli: '', appId, brand, credential }
    },
    remove: reference => gateway.remove(reference),
    resolve: binding => resolveFeishuBot(host.machine, binding, async () => { throw new Error('请填写 App Secret 以切换到内置连接') }, undefined, host.credentials, host.signal),
  }
}
/** Reject invalid credentials before writes; an optimistic revision check still guards the final source update. */
export function createFeishuConnector(host: ConnectionHost, io = connectionIO(host)) {
  let busy = false
  return async (request: FeishuConnectRequest): Promise<FeishuConnectResult> => {
    const input = FeishuConnectSchema.parse(request)
    const check = () => {
      if (host.signal.aborted) throw new FeishuConnectError(503, 'Superagent 正在重启，请稍后再试')
      if (host.store.blockRevision('source:feishu') !== input.revision) throw new FeishuConnectError(409, '配置已更新，请刷新后重试')
      if (host.active()) throw new FeishuConnectError(409, '请在任务执行结束后更换飞书接入')
    }
    check()
    if (busy) throw new FeishuConnectError(409, '正在连接飞书，请稍后再试')
    if (!host.sources.kind('feishu')) throw new FeishuConnectError(400, '请先启用飞书组件')
    const value = host.sources.validate('feishu', input.value)
    const directory = String(value.config.workspaceDirectory || executionRoot(host.store.settings(), host.machine.stateDir))
    if (!isAbsolute(directory)) throw new FeishuConnectError(400, '工作区需要使用绝对路径')
    busy = true
    let created: string | undefined, saved = false
    try {
      let binding: Binding, bot: FeishuBot | undefined
      if (input.appSecret) {
        try { bot = await io.verify(input.appId, input.appSecret, input.brand) }
        catch { throw new FeishuConnectError(400, 'App ID 或 App Secret 验证失败，请检查应用状态与网络') }
        check()
        try { binding = await io.save(input.appId, input.appSecret, input.brand); created = binding.credential }
        catch { throw new FeishuConnectError(503, 'DSH 凭据保存失败，请检查宿主凭据存储') }
      } else {
        binding = FeishuBotSchema.parse(host.store.settings().sources.feishu?.config ?? {})
        try { bot = await io.resolve(binding) }
        catch { throw new FeishuConnectError(400, '现有机器人验证失败，请重新填写 App Secret') }
      }
      if (!bot || bot.appId !== input.appId) throw new FeishuConnectError(400, '更换 App ID 时需要填写 App Secret')
      await mkdir(directory, { recursive: true })
      check()
      const { restarting } = await host.settings.save('source:feishu', { enabled: value.enabled,
        config: { ...value.config, ...binding, appId: bot.appId, workspaceDirectory: directory } }, input.revision, 'panel')
      saved = true
      return { restarting, appId: bot.appId, botId: bot.botId, name: bot.name }
    } finally {
      if (created && !saved) await io.remove(created).catch(() => {})
      busy = false
    }
  }
}
