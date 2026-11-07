# Superagent 完整工作能力

目标是可持续使用的 DSH 插件。原有 1.0.1 界面、配置与任务继续保留；实现和验收未完成前，不以“接口已预留”或测试替身代表实接成功。不自动提交、推送或发布，不委派子代理。

参考 [公开原型](https://github.com/deepseek-ai/dsh-superagent-prototype) 及其引用的 [Super-agent 设计文章](https://x.com/i/article/2116829218935857152)。原文目前通过网页工具读取返回 403，不能据转载声称文章全部能力已验证；先以可读取的原型源码和编号设计文档作为实现依据。

## 实现顺序

- [x] **统一工作区执行边界**：扩展 `src/sources/kind.ts`、`registry.ts`，在 `executor/dsh.ts` 与 `app/sessions.ts` 复用来源绑定的真实目录和具名权限。新增 `executor/workspace.ts` 保存已授权任务的执行绑定。两项集成测试覆盖消息元数据不能覆盖配置、跨来源同目录串行及已接单任务不随新配置改换目录或扩大权限；原有本地任务和并发测试仍通过。已随 MCP 版本安装，并用于 GitHub 实测。
- [x] **MCP 外部派单**（用户已明确的重点）：官方 MCP SDK、按应用分配令牌与工作区、创建/查询/补充/停止/失败重试、幂等请求、持久化回复、stdio 与 Streamable HTTP 已实现。日用 DSH 已安装 1.1.1；真实外部客户端派单后，DSH 模型完成时长格式化代码，既有 4 项测试由执行会话与 Codex 分别运行通过；同任务补充要求和正式回复回传、插件重载后结果恢复均有实际记录。开发测试另覆盖未授权工作区、跨客户端隔离、令牌轮换/停用、人工停止限制、排队目录失效及端口变化。MCP 入口限本机，不等于开放公网，也不把给 Worker 添加任意外部工具作为本次完成前提。
- [x] **Git / GitHub**：已接通本地工作区、原生配置和独立账号 CLI。用户授权创建私有测试库及仅限该库、7 天过期的测试令牌，令牌由 GitHub CLI 存入 macOS 钥匙串。真实 Actions bot 创建 Issue 后，独立 DSH 实例接单、实现 clamp、保留原测试、提交并推送新分支、创建 PR，push / PR 两次 Actions 均成功，原 Issue 收到正式结果。Codex 独立复跑 3 项测试通过，并用 `git ls-remote` 核对远端分支 SHA。插件重载后同一任务、会话、报告和派工次数保留；通过本地 Git 保留历史地合并测试 PR 后，插件自动把任务收尾为 ended。日常实例不绑定测试仓库。
- [ ] **飞书**：在同一任务系统中配置机器人、允许的用户与会话、目标项目；保留去重、上下文、断线恢复与原会话回传，验证跨入口跟进同一任务。
- [ ] **持续运行与恢复**：核对队列、执行器、结果投递、模型故障及宿主重启的恢复行为；补齐有明确依据的监控和恢复缺口。桌面宿主离线时不能继续工作；常驻模式需有实际运行环境，不能仅靠桌面插件承诺离线执行。
- [ ] **整条链路验收与使用说明**：分别记录真实本地、MCP、GitHub、飞书结果；检查任务归属、权限、重复调用、停止后不重启、来源断开与重启后的结果回传。只安装通过相应检查的版本，保持既有数据。

## 需要实际连接时再补齐

GitHub 与 MCP 的测试目标、授权及真实派单已有证据。飞书已准备官方 CLI，并打开官方扫码登录页；用户选择「先完成 GitHub，飞书稍后」，因此没有创建飞书机器人或群，也没有把模拟测试记作实接成功。常驻运行仍依赖实际在线宿主。

## 当前证据

- 日用端已安装 1.2.2，主会话、并发数 3、原有 8 条结束任务保留，原生 GitHub 项目 / CLI / 事件配置表单已实际查看；未配置账号的组件保持暂停。查看后 GitHub 组件恢复禁用，MCP 测试连接仍停用，未把日常实例绑定测试库。
- 本地开发链路已真实完成派单、改文件、运行测试、结果回传和打开执行会话。
- MCP 实测任务 `7e442ac8cd43d36bda2384f094355c17`，工作区 `/Users/missher/Documents/Codex-File/Deepseek-Corids/superagent-mcp-demo`。忽略目录 `.local-artifacts/mcp-native-acceptance.json` 保存不含令牌的运行记录。一次直接 HTTP 读取中断后，重新连接读回正式回复；宿主没有退出，未能复现该次断连，不能称网络故障已定位或修复。
- 同版本同路径覆盖 tgz 被 pnpm 视为无需更新，实机证明旧客户端仍在；改用新的 1.1.1 包后弹窗调整实际生效。
- GitHub 测试库：[DSH-Superagent-Integration-Lab-20261107](https://github.com/Missher12/DSH-Superagent-Integration-Lab-20261107)（私有）；[Issue #1](https://github.com/Missher12/DSH-Superagent-Integration-Lab-20261107/issues/1)、[PR #2](https://github.com/Missher12/DSH-Superagent-Integration-Lab-20261107/pull/2)、[PR CI](https://github.com/Missher12/DSH-Superagent-Integration-Lab-20261107/actions/runs/42371856710)。工作区 `/Users/missher/Documents/Codex-File/Deepseek-Corids/superagent-github-lab-20261107`；任务 `bbfc589165db3cc6d413ecc1a4a91f2b`，记录在忽略目录 `.local-artifacts/github-native-acceptance.json`。
- CI 精细令牌限制已实测：Checks REST 和 GraphQL 对象均不可访问，不能靠增加 `checks:read` 解决；插件改读 Actions 作业和提交状态，明确标出覆盖范围，没有结果不再显示通过。既有经典令牌 / GitHub App 的 Checks 读取保留。CLI 的间歇 EOF 没有证据足够确定根因；独立测试包装器仅对读取请求做有限重试，写请求不重放。
- 1.2.2 另修复可选 GitHub 组件尚无账号时错误轮询的问题，并禁止路由模型更改 MCP 客户端的工作区授权。独立测试宿主正常退出后，用官方 DSH CLI 以新版本重新启动，端口从 51961 变为 55345，同一 GitHub 任务、会话、报告及 ended 状态均恢复；此项是独立真实宿主的冷启动验收，没有重启用户的日常 DSH。测试结束后已关闭测试来源监听及测试宿主，数据和私有仓库保留。飞书按用户要求暂缓，完整目标尚未完成。
