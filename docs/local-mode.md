# DSH 本地任务版

本项目基于 DeepSeek Harness 团队的 MIT 研究原型适配。保留原型的工单、授权、执行器、持久化投递及恢复机制；默认仅启用 DSH 本地派单。

## 使用

在 DSH 插件管理器安装本项目的 `.tgz` 后，打开侧栏 **Superagent → 任务 → 新建任务**，填写任务要求，选择已有 DSH 工作区或填写已有项目的绝对路径。标题可留空自动生成，未派出的草稿在当前浏览器会话内保留。也可在现有 DSH 会话中明确要求“把这个任务交给 Superagent 后台执行”，由 `superagent_task` 工具派单。

聊天派单继承来源会话的具名权限预设，面板派单使用当前 DSH 默认权限。无法继承的自定义权限会明确拒绝派单，不会自行扩大权限。默认同时执行一个任务；普通开发请求仍由当前会话直接处理。在“设置”中可以选择新任务的模型及并发数，同一目录始终依次执行。

每个任务有独立执行会话，在所选的现有工作区中操作。任务会读取项目的 `AGENTS.md`，保留无关改动。只有任务明确要求时才提交、推送、发布或创建子代理。

面板只有“任务、设置、使用帮助”三个页面。可在任务页补充要求、查看最新结果、复制结果、重试失败任务或停止任务；完整执行过程可在任务会话中查看，原始要求和历史记录折叠保留。聊天派单的结果也回到来源会话。已完成的任务可以补充下一步要求继续执行。手动停止的任务不会被自动恢复；“重新派单”先填好草稿，由你明确发送。DSH 关闭后不继续运行，重启后恢复任务记录和未完成的执行。

本地模式不要求 GitHub 或飞书账号，不修改进程级 PATH、Git 配置或账号凭据。不需要额外安装 DSH CLI、GitHub CLI 或 tmux。

## 预留 Git / MCP 入口

`@missher/dsh-superagent/sources` 导出 `SourceKind`、`SourceHost`、`SourceContext`、`Trigger`、`OutboundMessage` 以及持久化键工具。其他 DSH 插件可以：

1. 注入 `orchestrator` 服务。
2. 通过 `ctx.orchestrator.sources.register(kind)` 注册实际实现的任务来源。
3. 用 `ctx.orchestrator.context(kind).receive(trigger)` 投递事件，按原生来源身份配置授权，使用稳定事件 ID 防止重复派单。
4. 实现 SourceKind 的 `channel.send` 回传结果，使用 `scope`、`policy` 和 `threadContext` 分别提供接收范围、授权及上下文。

Git 仓库事件或 MCP 工具调用都可以转换为同一 Trigger。MCP 服务的连接、身份校验和工具暴露由其适配器负责；仅有正文不能授予执行权限。

适配插件可直接导入公开入口；它同时声明 `ctx.orchestrator` 的服务类型：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { SourceKind } from '@missher/dsh-superagent/sources'

export const inject = ['orchestrator']
export function registerSource(ctx: Context, source: SourceKind) {
  return ctx.orchestrator.sources.register(source)
}
```

上游 GitHub、飞书适配代码保留，默认禁用。启用完整上游 GitHub 部署需要切换插件 `mode` 为 `github` 并按上游文档配置独立运行环境。首版本地包没有启动外部 MCP 服务，也没有自动监听 Git 事件。

## 开发与验证

目标宿主 DSH `0.2.1-rc.4`，Node `24`。运行 `pnpm check` 检查类型、测试、构建及独立适配插件的类型导入，`pnpm pack --pack-destination dist` 生成安装包。开发构建可使用标准 Node；宿主加载仍需另用 DSH 的签名运行时检查。

上游的 `docs/000` 至 `008` 说明原始 GitHub 部署及通用引擎；本地使用方式以本页为准。
