import { expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { createRequire } from 'node:module'
import { FeishuGateway, gatewayCredential } from '../src/infra/feishu-gateway.ts'

const sdk = vi.hoisted(() => ({ request: vi.fn(), options: undefined as any, handler: undefined as any, close: vi.fn(), start: vi.fn() }))
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class { request = sdk.request },
  WSClient: class { constructor(options: unknown) { sdk.options = options } close = sdk.close; start = sdk.start },
  EventDispatcher: class { register(handlers: unknown) { sdk.handler = handlers; return this } },
}))
function fixture() {
  sdk.request.mockReset(); sdk.start.mockReset(); sdk.close.mockReset()
  const credential = gatewayCredential('state', 'cli_test')
  const readRecord = vi.fn(async () => ({ kind: 'api-key' as const, key: 'private-sentinel' }))
  const gateway = new FeishuGateway({ readRecord } as unknown as CredentialProvider)
  const bot = { cli: '', appId: 'cli_test', brand: 'feishu' as const, name: 'Bot', botId: 'ou_bot', credential }
  return { gateway, bot, readRecord }
}
it('uses only a scoped DSH credential, and reads it again for each API operation', async () => {
  const f = fixture(), signal = new AbortController().signal
  sdk.request.mockResolvedValue({ code: 0, data: { items: [] } })
  await f.gateway.execute(f.bot, ['api', 'GET', '/open-apis/im/v1/messages', '--params', '{"container_id":"oc_test"}'], signal)
  await f.gateway.execute(f.bot, ['api', 'GET', '/open-apis/im/v1/messages', '--params', '{}'], signal)
  expect(f.readRecord).toHaveBeenCalledTimes(2)
  const args = sdk.request.mock.calls[0]![0]
  expect(args).toMatchObject({ url: '/open-apis/im/v1/messages', method: 'GET', params: { container_id: 'oc_test' } })
  expect(JSON.stringify(args)).not.toContain('private-sentinel')
  await expect(f.gateway.execute({ ...f.bot, credential: 'other-plugin/account' }, ['im', '+chat-list'], signal)).rejects.toThrow('凭据')
  expect(f.readRecord).toHaveBeenCalledTimes(2)
})
it('keeps pagination complete and refuses repeated cursors instead of showing a partial group list', async () => {
  const f = fixture(), signal = new AbortController().signal
  sdk.request.mockResolvedValueOnce({ code: 0, data: { items: [{ chat_id: 'oc_a', name: 'A' }], has_more: true, page_token: 'next' } })
    .mockResolvedValueOnce({ code: 0, data: { items: [{ chat_id: 'oc_b', name: 'B' }], has_more: false } })
  expect(await f.gateway.execute(f.bot, ['im', '+chat-list'], signal)).toMatchObject({ chats: [{ chat_id: 'oc_a' }, { chat_id: 'oc_b' }] })
  expect(sdk.request.mock.calls[1]![0].params.page_token).toBe('next')
  sdk.request.mockResolvedValue({ code: 0, data: { items: [], has_more: true, page_token: 'same' } })
  await expect(f.gateway.execute(f.bot, ['im', '+chat-list'], signal)).rejects.toThrow('分页')
})
it('encodes message IDs as repeated query values accepted by Feishu and retains the source context', async () => {
  const f = fixture(), require = createRequire(import.meta.url)
  const axios = createRequire(require.resolve('@larksuiteoapi/node-sdk'))('axios')
  sdk.request.mockImplementationOnce(async options => {
    const url = new URL(axios.getUri(options), 'https://open.feishu.cn')
    expect(url.searchParams.getAll('message_ids')).toEqual(['om_source'])
    return { code: 0, data: { items: [{ message_id: 'om_source', chat_id: 'oc_test', parent_id: 'om_parent',
      msg_type: 'text', sender: { id: 'ou_user', sender_type: 'user' }, create_time: '1794456000000', body: { content: '{"text":"hello"}' } }] } }
  })
  expect(await f.gateway.execute(f.bot, ['im', '+messages-mget', '--message-ids', 'om_source'], new AbortController().signal))
    .toMatchObject({ messages: [{ content: 'hello', chat_id: 'oc_test', parent_id: 'om_parent' }] })
})
it('preserves threaded replies and their idempotency key, and never turns API failure into success', async () => {
  const f = fixture(), signal = new AbortController().signal
  sdk.request.mockResolvedValueOnce({ code: 0, data: { message_id: 'om_sent' } })
  await f.gateway.execute(f.bot, ['im', '+messages-reply', '--message-id', 'om_test', '--markdown', 'Done', '--reply-in-thread', '--idempotency-key', 'stable-id'], signal)
  expect(sdk.request.mock.calls[0]![0]).toMatchObject({ url: '/open-apis/im/v1/messages/om_test/reply', method: 'POST',
    data: { msg_type: 'post', reply_in_thread: true, uuid: 'stable-id' } })
  sdk.request.mockResolvedValueOnce({ code: 230011, msg: 'message recalled' })
  await expect(f.gateway.execute(f.bot, ['im', '+messages-reply', '--message-id', 'om_test'], signal)).rejects.toMatchObject({ code: 230011 })
})
it('reports ready only after a real handshake and closes on abort, retaining normalized message identity', async () => {
  const f = fixture(), controller = new AbortController(), events: unknown[] = [], states: string[] = []
  sdk.start.mockResolvedValue(undefined)
  const watching = f.gateway.watch(f.bot, controller.signal, event => { events.push(event); return Promise.resolve() }, state => { states.push(state) })
  await vi.waitFor(() => expect(sdk.start).toHaveBeenCalledOnce())
  expect(states).not.toContain('ready')
  sdk.options.onReady(); expect(states).toContain('ready')
  await sdk.handler['im.message.receive_v1']({ sender: { sender_type: 'user', sender_id: { open_id: 'ou_user' } }, message: {
    chat_type: 'group', chat_id: 'oc_test', message_id: 'om_test', message_type: 'text', content: '{"text":"do this"}',
    create_time: '1794456000000', parent_id: 'om_parent', mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' } }] } })
  expect(events).toEqual([expect.objectContaining({ sender_id: 'ou_user', content: 'do this', parent_id: 'om_parent', mentions: [expect.objectContaining({ id: 'ou_bot' })] })])
  sdk.options.onReconnecting(); expect(states.at(-1)).toBe('starting')
  controller.abort(); await watching
  expect(sdk.close).toHaveBeenCalled()
})
