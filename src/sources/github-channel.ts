import { githubAccount } from '../deployment.ts'
/** GitHub outbound channel: posts issue/PR comments and review thread replies under the agent account. */
import { z } from 'zod'
import type { OutboundMessage } from '../core/index.ts'
import { CliError } from '../infra/commands.ts'
import { sameName } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { githubAddress, githubPage } from './github-trigger.ts'

const TEAM_REPLY = '该来源团队由总执行统一回传。请用 orchestrator_report 提交内部结果，插件负责回复原 Issue 或 PR。'
/** Managed teams publish source replies through the outbox. Match the direct CLI,
 * HTTP and scripting forms used in worker shells before the host starts them. */
export function githubTeamShellAdvice(raw: string): string | undefined {
  const command = raw.replace(/(?:\\|`|\^)\r?\n[ \t]*/g, ' ')
  const commentUrl = /(?:github\.com|\/repos\/|\bgithub_api_url\b)[^\s"'<>]*\/(?:issues|pulls)\/[^\s"'<>/]+\/comments\b/i.test(command)
  const httpWrite = /(?:^|\s)(?:-X\s*(?:POST|PATCH|PUT|DELETE)\b|--(?:request|method)[=\s]+(?:POST|PATCH|PUT|DELETE)\b|-Method\s+(?:Post|Patch|Put|Delete)\b|-d\s|--(?:data(?:-[\w-]+)?|json)(?:\s|=)|-Body\s)|\b(?:requests|session|client|axios|httpx)\s*\.\s*(?:post|patch|put|delete)\s*\(|\bmethod['"]?\s*[:=]\s*['"](?:POST|PATCH|PUT|DELETE)['"]/im.test(command)
  if (commentUrl && httpWrite || /\b(?:addComment|addPullRequestReviewComment)\s*\(/.test(command) && /graphql/i.test(command)) return TEAM_REPLY
  const invocation = /(?:^|[;&|\n])\s*(?:&\s+)?(?:[^\s;&|]+?=\S+\s+)*(?:["']?(?:[^\s;&|]*\/)?(?:gh(?:\.exe)?|github-agent)["']?|["']?\$[\w{}:]+["']?)\s+(?:(?:--repo|-R|--hostname)\s+\S+\s+)*/gi
  for (const match of command.matchAll(invocation)) {
    const rest = command.slice(match.index! + match[0].length).split(/\s*(?:&&|\|\||;|\n)/, 1)[0]!
    if (/^(?:issue|pr)\s+comment\b/i.test(rest) ||
        /^api\s/i.test(rest) && (/\b(?:issues|pulls)\/[^\s]+\/comments\b/i.test(rest) && /(?:--method[=\s]+POST|-X\s*POST|--(?:raw-)?field\b|--input\b|\s-[fF]\s)/i.test(rest) || /\baddComment\s*\(/.test(rest))) {
      return TEAM_REPLY
    }
    if (/^pr\s+checks\b|^pr\s+view\b.*\bstatusCheckRollup\b|^api\s+.*\/check-runs\b/i.test(rest)) {
      return '请用 orchestrator_read 读取 github/pulls/<实际编号>/checks。宿主会在 Checks 403 时改查同一提交的 Actions 和提交状态，并标出覆盖范围。'
    }
  }
  return undefined
}

const CommentSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), in_reply_to_id: z.number().nullish(), user: z.looseObject({ login: z.string() }).nullish(),
})
/** True when an issue is permanently deleted (410) or locked (403); 404 is retried because it can indicate temporary permission loss on a private repo. */
const gone = (error: unknown): boolean => error instanceof CliError
  && (error.code === 410 || (error.code === 403 && /locked/i.test(error.message)))
const missing = (error: unknown): boolean => error instanceof CliError && (error.code === 404 || error.code === 410)
/** Posts a comment or review-thread reply with an embedded HTML marker so retries do not create duplicate comments. */
export async function sendGithub(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const { commands } = host
  const { repository } = commands.deployment
  const github = githubAccount(commands.deployment)
  const number = Number(message.channel.address.number)
  if (!number) throw new Error('Missing GitHub reply target')
  try {
    // Retained trigger URLs also route replies queued before thread-aware delivery.
    const address = githubAddress(message.channel.address.url ?? '', repository)
    let rootId: number | undefined
    if (address?.pr && address.discussion && address.number === number) {
      // Fall back to a top-level PR comment if the target inline review comment was deleted.
      const source = await commands.api(CommentSchema, `pulls/comments/${address.discussion}`)
        .catch((error: unknown) => { if (missing(error)) return undefined; throw error })
      rootId = source ? source.in_reply_to_id ?? source.id : undefined
    }
    const path = rootId === undefined ? `issues/${number}/comments` : `pulls/${number}/comments`
    const marker = `<!-- dsh-superagent:${message.id} -->`
    const mine = (comment: z.infer<typeof CommentSchema>) => sameName(comment.user?.login ?? '', github.login)
      && (rootId === undefined || comment.in_reply_to_id === rootId) && (comment.body ?? '').includes(marker)
    if ((await commands.pages(CommentSchema, path)).some(mine)) return 'sent'
    const target = rootId === undefined ? path : `${path}/${rootId}/replies`
    await commands.api(z.unknown(), target, '--method', 'POST', '-f', `body=${message.text}\n\n${marker}`)
    return 'sent'
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
}
export function githubLink(address: Record<string, string>, links: ChannelLinks): ChannelLink {
  const number = address.number ?? ''
  const review = !!links.repository && !!githubAddress(address.url ?? '', links.repository)?.discussion
  return { url: address.url ?? (links.repository ? githubPage(links.repository, Number(number)) : ''),
    label: review ? { zh: `GitHub #${number} 的 review 讨论`, en: `Review discussion on GitHub #${number}` }
      : { zh: `GitHub #${number}`, en: `GitHub #${number}` } }
}
