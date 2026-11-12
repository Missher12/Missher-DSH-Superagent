/** In-process Feishu transport. Credentials stay in DSH; no CLI or child service is started. */
import { credentialKey, parseCredentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { key } from '../core/index.ts'
import type { FeishuBot } from '../deployment.ts'
import { historyText } from '../sources/feishu-trigger.ts'
import type { Health } from '../sources/host.ts'
import type { Client } from '@larksuiteoapi/node-sdk'

type Credentials = Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>
type Params = Record<string, unknown>
const quiet = { trace() {}, debug() {}, info() {}, warn() {}, error() {} }
export const gatewayCredential = (stateDir: string, identity: string): string => credentialKey('dsh-superagent', `feishu-${key(stateDir, identity)}`)
const credential = (reference: string) => {
  if (!/^dsh-superagent\/feishu-[a-f0-9]{32}$/.test(reference)) throw new Error('飞书凭据引用无效')
  return parseCredentialKey(reference)
}
export class FeishuGatewayError extends Error { constructor(message: string, readonly code?: number) { super(message) } }
const domain = (brand: 'feishu' | 'lark') => `https://open.${brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}`
const field = (args: string[], flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1] }
const id = (value: string | undefined) => { if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('飞书资源 ID 无效'); return value }
function normalized(message: any) {
  const mentions = (message.mentions ?? []).map((mention: any) => ({ ...mention, id: typeof mention.id === 'string' ? mention.id : mention.id?.open_id ?? mention.id?.app_id ?? '' }))
  return { ...message, mentions, content: historyText({ ...message, body: message.body ?? { content: message.content ?? '' } }),
    msg_type: message.msg_type ?? message.message_type }
}
export class FeishuGateway {
  constructor(private readonly credentials?: Credentials) {}
  private store(): Credentials { if (!this.credentials) throw new Error('DSH 凭据存储不可用，暂时无法连接飞书'); return this.credentials }
  async save(reference: string, secret: string): Promise<void> {
    await this.store().modifyRecord(credential(reference), async () => ({ kind: 'api-key', key: secret }))
  }
  async remove(reference: string): Promise<void> { await this.store().deleteRecord(credential(reference)) }
  private async secret(reference: string): Promise<string> {
    const record = await this.store().readRecord(credential(reference))
    if (record?.kind !== 'api-key' || !record.key) throw new Error('飞书凭据未保存，请重新填写 App Secret')
    return record.key
  }
  private async client(appId: string, secret: string, brand: 'feishu' | 'lark') {
    const sdk = await import('@larksuiteoapi/node-sdk')
    return new sdk.Client({ appId, appSecret: secret, domain: domain(brand), logger: quiet })
  }
  private async request(client: Client, signal: AbortSignal, method: string, url: string, params?: Params, data?: Params): Promise<any> {
    signal.throwIfAborted()
    if (!/^\/open-apis\/(?:im\/v1\/|bot\/v3\/info$)/.test(url) || /[?#]|\.\./.test(url)) throw new Error('飞书接口地址无效')
    let result: any
    try { result = await client.request({ method, url, params, data, paramsSerializer: { indexes: null }, signal, timeout: 20_000, maxContentLength: 20 << 20 }) }
    catch (error) {
      signal.throwIfAborted()
      // SDK / Axios errors can carry request headers and credentials. Only explicit API diagnostics cross this boundary.
      const failure = (error as { response?: { data?: { code?: number; msg?: string } } }).response?.data
      throw new FeishuGatewayError(failure?.code ? `飞书接口拒绝请求 (${failure.code})` : '飞书连接失败，请检查网络或应用权限', failure?.code)
    }
    if (result.code !== 0) throw new FeishuGatewayError(`${String(result.msg ?? '飞书接口请求失败').slice(0, 500)} (${result.code})`, result.code)
    return result.data ?? result
  }
  async verify(appId: string, secret: string, brand: 'feishu' | 'lark', signal: AbortSignal): Promise<Omit<FeishuBot, 'cli'>> {
    const client = await this.client(appId, secret, brand)
    const result = await this.request(client, signal, 'GET', '/open-apis/bot/v3/info')
    if (!/^ou_[A-Za-z0-9]+$/.test(result.bot?.open_id ?? '')) throw new Error('请先在飞书平台启用机器人并发布应用')
    return { appId, brand, botId: result.bot.open_id, name: String(result.bot.app_name ?? '') }
  }
  async resolve(config: { appId?: string; brand?: 'feishu' | 'lark'; credential?: string }, signal: AbortSignal): Promise<FeishuBot> {
    if (!config.appId || !config.credential) throw new Error('请填写飞书 App ID 和 App Secret')
    const identity = await this.verify(config.appId, await this.secret(config.credential), config.brand ?? 'feishu', signal)
    return { ...identity, cli: '', credential: config.credential }
  }
  /** Keeps the existing source operations at one transport boundary, including full pagination and stable reply IDs. */
  async execute(bot: FeishuBot, args: string[], signal: AbortSignal, cwd?: string): Promise<unknown> {
    const client = await this.client(bot.appId, await this.secret(bot.credential ?? ''), bot.brand)
    const request = (method: string, url: string, params?: Params, data?: Params) => this.request(client, signal, method, url, params, data)
    const all = async (url: string, params: Params = {}) => {
      const items: unknown[] = [], pages = new Set<string>(); let cursor: string | undefined
      do {
        const page = await request('GET', url, { ...params, page_size: 100, ...(cursor ? { page_token: cursor } : {}) })
        if (!Array.isArray(page.items)) throw new Error('飞书返回了不完整的列表')
        items.push(...page.items)
        if (!page.has_more) return items
        if (!page.page_token || pages.has(page.page_token)) throw new Error('飞书分页未推进，列表不完整')
        cursor = page.page_token; pages.add(cursor!)
      } while (pages.size < 1000)
      throw new Error('飞书列表过长，请缩小范围')
    }
    if (args[0] === 'api' && args[1] === 'GET') return request('GET', args[2]!, JSON.parse(field(args, '--params') ?? '{}'))
    if (args[0] !== 'im') throw new Error('此飞书操作尚未接通')
    switch (args[1]) {
      case '+chat-list': return { chats: await all('/open-apis/im/v1/chats') }
      case '+chat-members-list': return { users: await all(`/open-apis/im/v1/chats/${id(field(args, '--chat-id'))}/members`, { member_id_type: 'open_id' }), has_more: false }
      case '+messages-mget': {
        const messageId = id(field(args, '--message-ids'))
        const result = await request('GET', '/open-apis/im/v1/messages/mget', { message_ids: [messageId] })
        return { messages: (result.items ?? []).map(normalized) }
      }
      case '+threads-messages-list': {
        const thread = id(field(args, '--thread'))
        const result = await request('GET', '/open-apis/im/v1/messages', { container_id_type: 'thread', container_id: thread,
          sort_type: field(args, '--order') === 'desc' ? 'ByCreateTimeDesc' : 'ByCreateTimeAsc', page_size: Number(field(args, '--page-size') ?? 20),
          ...field(args, '--page-token') ? { page_token: field(args, '--page-token') } : {} })
        return { messages: (result.items ?? []).map(normalized), thread_id: thread, has_more: !!result.has_more, page_token: result.page_token }
      }
      case '+messages-reply': return request('POST', `/open-apis/im/v1/messages/${id(field(args, '--message-id'))}/reply`, undefined, {
        msg_type: 'post', content: JSON.stringify({ zh_cn: { title: '', content: [[{ tag: 'md', text: field(args, '--markdown') ?? '' }]] } }),
        reply_in_thread: true, uuid: field(args, '--idempotency-key'),
      })
      case '+messages-resources-download': {
        if (!cwd || field(args, '--type') !== 'image') throw new Error('需要有效的图片下载目录')
        const target = resolve(cwd, field(args, '--output') ?? './image')
        if (dirname(target) !== resolve(cwd)) throw new Error('图片下载目录无效')
        let buffer: Buffer
        try { buffer = Buffer.from(await client.request({ method: 'GET',
          url: `/open-apis/im/v1/messages/${id(field(args, '--message-id'))}/resources/${id(field(args, '--file-key'))}`,
          params: { type: 'image' }, responseType: 'arraybuffer', signal, timeout: 20_000, maxContentLength: 20 << 20 })) }
        catch { signal.throwIfAborted(); throw new Error('飞书图片下载失败，请检查权限或原消息') }
        const extension = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? '.png'
          : buffer[0] === 255 && buffer[1] === 216 ? '.jpg' : buffer.subarray(0,3).toString() === 'GIF' ? '.gif'
            : buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP' ? '.webp' : undefined
        if (!extension) throw new Error('飞书没有返回有效图片')
        const path = join(dirname(target), `image${extension}`)
        await writeFile(path, buffer, { flag: 'wx', mode: 0o600, signal }); return { saved_path: path }
      }
      default: throw new Error('此飞书操作尚未接通')
    }
  }
  async watch(bot: FeishuBot, signal: AbortSignal, receive: (event: unknown) => Promise<void>, report: (state: Health['state']) => void): Promise<void> {
    signal.throwIfAborted()
    const secret = await this.secret(bot.credential ?? ''), sdk = await import('@larksuiteoapi/node-sdk')
    signal.throwIfAborted()
    let chain = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined
    let stop!: () => void, client: InstanceType<typeof sdk.WSClient> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = () => { if (!signal.aborted) { clearTimeout(timer); report('ready') } }
        stop = () => { clearTimeout(timer); client?.close({ force: true }); resolve() }
        client = new sdk.WSClient({ appId: bot.appId, appSecret: secret, domain: domain(bot.brand), logger: quiet,
          handshakeTimeoutMs: 15_000, onReady: ready, onReconnected: ready,
          onReconnecting: () => { if (!signal.aborted) report('starting') }, onError: () => reject(new Error('飞书长连接失败，请检查网络、事件订阅与应用权限')) })
        signal.addEventListener('abort', stop, { once: true })
        timer = setTimeout(() => reject(new Error('飞书长连接未能在 45 秒内接通')), 45_000)
        const dispatcher = new sdk.EventDispatcher({ logger: quiet }).register({ 'im.message.receive_v1': (data: any) => {
          chain = chain.then(async () => {
            if (signal.aborted) return
            const message = normalized(data.message), sender = data.sender
            await receive({ ...message, sender_id: sender.sender_id?.open_id ?? sender.sender_id?.app_id ?? '',
              sender_type: sender.sender_type === 'user' ? 'user' : 'bot' })
            if (!signal.aborted) report('ready')
          }).catch(() => { if (!signal.aborted) report('error') })
          return chain
        } })
        void client.start({ eventDispatcher: dispatcher }).catch(() => reject(new Error('飞书长连接启动失败')))
      })
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); client?.close({ force: true }); await chain }
  }
}
