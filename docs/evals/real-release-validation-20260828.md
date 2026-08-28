# 真实环境发布验收记录 — 2026-08-28

## 发布判定

**NO-GO**

本轮已经执行可安全运行的真实 Qwen 门、公开生产 Smoke 和微信开发者工具预览。`interaction-move-handoff-turn-interpretation` 首轮真实模型门失败后，已修正冲突 Prompt 并完整重跑 10 个冻结案例通过。Safety 重试边界也已收紧并完整复跑 22 个冻结案例通过，全部在第一次调用成功。生产服务器环境审计和真实微信 `code2Session` 登录现已通过，但当前候选缺少生产已经应用的 6 个迁移且不是生产主线之上的可复现 commit，因此保持 `NO-GO`，不是 `GO`。短信及双端完整真机流程仍未完成；Clinical 模型评审、多轮轨迹、Chat Gate 和人工盲评也尚未执行。

## 基线身份

- 日期：2026-08-28（Asia/Shanghai）
- 分支：`codex/planner-handoff-migration`
- HEAD：`890a030`
- 工作区：包含既有大量未提交改动；本轮未回退或覆盖无关修改
- Provider：Qwen
- Model：`qwen3.7-max`
- 数据：仅使用仓库冻结的合成 fixtures；未使用真实聊天、小记或生产用户数据
- 证据收口时间：`2026-08-28T19:46:27+08:00`
- 受测真实门脚本及直接 provider/validator 源码组合 SHA-256：`6f0b6019b7fe1484f91ba6fa84b1c94d7e068bf6c13c824870aa387df455638c`
- 当前 tracked diff SHA-256：`6e6de9b86d3701a515f3c2582e3c099e7980995f59698070c36df5d259639dca`

工作区包含 untracked 文件，单独的 HEAD 和 tracked diff 不能唯一复现全部内容；上述受测源码组合指纹显式包含本轮六个真实门脚本及其直接 provider/validator 文件。每条命令的精确启动时间未在运行前保存，因此本记录可证明当前 `NO-GO`，但不能作为完整 release-grade PASS 签字。

源码组合指纹按下列精确顺序和命令生成：

```bash
shasum -a 256 \
  scripts/safety-semantic-qwen-eval.ts \
  scripts/planned-function-semantic-qwen-eval.ts \
  scripts/interaction-move-handoff-surface-qwen-eval.ts \
  scripts/interaction-move-handoff-qwen-structured-output-eval.ts \
  scripts/interaction-move-handoff-turn-interpretation-qwen-eval.ts \
  scripts/proactive-move-structured-qwen-eval.ts \
  services/ai/chatSafety.ts \
  services/ai/plannedFunctionSemanticValidator.ts \
  services/ai/interactionMoveHandoffOutputValidator.ts \
  services/ai/turnInterpretationAdapter.ts \
  services/ai/proactiveGreeting.ts \
  services/ai/modelProvider.ts | shasum -a 256
```

## 真实模型门

| 门 | 结果 | 证据 |
| --- | --- | --- |
| `check:safety-semantic-qwen-real` | **PASS（修复后）** | 完整复跑 22/22；所有案例均为 `attempts=1`，脱敏 `attemptTrace` 只含成功类别，未发生基础设施重试或语义失败重试 |
| `check:planned-function-semantic-qwen-real` | **PASS** | 41/41；`failures=[]`；覆盖首次接触、身份延续、情绪支持、修复、双合同和对抗输入 |
| `check:interaction-move-handoff-surface-qwen-real` | **PASS** | 正反例、混合话题及已提交主张权威通过；最终 gate 状态 `passed` |
| `check:interaction-move-handoff-qwen-real` | **PASS** | 7/7；严格结构化输出、Unicode 证据绑定、施压、无依据追问和提示注入通过 |
| `check:interaction-move-handoff-turn-interpretation-qwen-real` | **PASS（修复后）** | 首轮 `concrete_continuation_ambiguity` 漏掉 `acknowledges_previous_move` 并退出 1；Prompt 最小修复后完整重跑 10/10，最终 gate=`passed`、退出码 0 |
| `check:proactive-move-structured-qwen-real` | **PASS** | 15/15；正例、空洞引子、义务转嫁、提示注入、伪深刻、杜撰经历和重复话题均符合预期 |

Clinical 模型评审、三次多轮轨迹、Chat Gate 样本生成及人工盲评尚未执行。它们不是 PASS。

### 命令运行账本

| 命令 | 可判定执行次数 | 退出码 | 脱敏证据 |
| --- | ---: | ---: | --- |
| `npm run check:safety-semantic-qwen-real` | 2 | 0 / 0 | 首轮 22/22 但 `friend_quote_only` 为 2 attempts，因缺少首轮失败类别仅作为问题证据；收紧 retry allowlist 并加入脱敏 trace 后完整复跑 22/22，所有案例均 `attempts=1`，最终退出码 0 |
| `npm run check:planned-function-semantic-qwen-real` | 1 | 0 | 汇总输出 `cases=41`、六类 category totals、`failures=[]` |
| `npm run check:interaction-move-handoff-surface-qwen-real` | 1 | 0 | 逐 `caseId` 输出 pass/reject 分类，最终 gate=`passed` |
| `npm run check:interaction-move-handoff-qwen-real` | 1 | 0 | 逐 `caseId` 输出分类和延迟，最终 gate=`passed` |
| `npm run check:interaction-move-handoff-turn-interpretation-qwen-real` | 2 | 1 / 0 | 首轮第五案 `concrete_continuation_ambiguity` 语义失败且未重试；修复 Prompt 后完整重跑 10 个冻结案例，最终 gate=`passed` |
| `npm run check:proactive-move-structured-qwen-real` | 1 | 0 | 15 个 `caseId` 均输出 `result=pass` 与延迟 |

本轮没有把完整模型 `rawOutput`、Prompt、密钥或真实内容写入仓库。逐案结果只保留上述脱敏汇总和固定 fixture 源码指纹。Safety 生产路径现仅允许 timeout、429、provider 5xx 做一次基础设施重试；malformed、binding/evidence、语义不一致、provider 4xx 与未知异常首次失败即阻断。运行 trace 只保留 attempt、结果类别和是否可重试，不包含 provider 原始错误或用户原文。

### 修复后本地回归账本

| 命令 | 执行次数 | 退出码 | 证明边界 |
| --- | ---: | ---: | --- |
| `npm run check:chat-safety-semantic` | 1 | 0 | retry allowlist、首次即阻断、最多两次调用及脱敏 trace 的确定性反例通过 |
| `npm run check:ai-orchestration` | 1 | 0 | 登录与 Guest 继续共用唯一聊天编排入口，Safety 仍位于普通规划之前 |
| `npx tsc --noEmit` | 1 | 0 | 当前 TypeScript 工作区通过类型检查 |
| `git diff --check` | 3 | 0 / 0 / 0 | 文档同步前后及最终报告收口时均无 tracked diff 空白错误 |

## 生产等价与微信工具链

| 门 | 结果 | 证据或原因 |
| --- | --- | --- |
| `audit:prod-env` | **PASS（生产服务器）** | 使用当前候选审计脚本只读检查 PM2 实际生产环境文件，退出码 0；保留两条 WARN：`AI_JUDGE_MODE=local`、短信生产配置不完整。本地默认 `.env` 仍是开发配置，不能作为生产证据 |
| `smoke:prod` | **PASS（仅 3 项）** | 公开生产域名 health 通过、匿名 notes 返回 401、空微信 body 返回 400 |
| 微信开发者工具登录 | **PASS** | CLI 返回 `login:true` |
| 微信小程序编译/预览 | **PASS** | 当前项目原始预览包约 130.1 KB；获用户明确授权后另生成强制生产 HTTPS 的临时验收包约 129.8 KB。验收完成后两个二维码、info 文件和临时副本均已删除 |
| 真实微信扫码 / `code2Session` | **PASS** | 测试者在强制生产 HTTPS 的临时预览中退出旧缓存并重新登录；生产 Nginx 脱敏访问记录显示 `2026-08-28 21:18:49 +08:00 POST /api/auth/wechat` 返回 200。未记录微信 code、openid、token 或请求体 |
| 真实短信 | **BLOCKED** | 当前环境没有完整短信配置，也未提供获授权的测试 SIM |
| 生产媒体/CDN | **PASS（合成文件链路）** | 在生产共享 POSIX 上传目录创建唯一合成 1px 图片，HTTPS 返回 200 且字节一致；物理删除后返回 404。测试文件、临时脚本和测试创建的空目录均已清理；尚未替代登录用户的 API ownership 验收 |
| iOS / Android 真机 | **BLOCKED** | 未提供两端测试设备及脱敏测试环境 |

`smoke:prod` 覆盖面很窄，不能替代真实微信、短信、模型、媒体、数据库 migration、跨用户隔离或注销主链路。

### 生产与微信命令账本

| 命令 | 执行次数 | 外层退出码 | 结果边界 |
| --- | ---: | ---: | --- |
| `npm run audit:prod-env`（默认读取本地 `.env`） | 1 | 1 | 只证明本地文件是开发配置，不再用于生产判定 |
| 当前候选 `production-env-audit.mjs` + 服务器生产 env | 1 | 0 | `2026-08-28T20:57:09+08:00` 完成；当前候选规则 PASS，保留 AI Judge local 与 SMS incomplete 两条 WARN，未输出任何值 |
| `npm run smoke:prod`（脚本默认公开生产域名） | 2 | 0 / 0 | 最终带时间账本的执行为 `21:08:35`—`21:08:38`，固定 3/3 通过；第一次沙箱 DNS 失败不计生产结果，获准网络重跑通过 |
| 合成生产媒体 roundtrip | 1 个有效运行 | 0 | `21:04:17` 完成；应用默认目录/文件权限下 create→HTTPS 200 exact bytes→unlink→404；两次权限不代表生产代码的预跑已全部回滚，不计有效证据 |
| `wechat-cli islogin --project <workspace>/miniprogram-project --lang zh` | 2 | 0 / 0 | 最新返回 `login:true`；报告不记录 AppID |
| `wechat-cli preview --project <workspace>/miniprogram-project --qr-format image ...` | 4 | 0 / 0 / 0 / 0 | 当前原始预览约 130.1 KB；生产 HTTPS 临时验收副本约 129.8 KB，用户已明确同意上传。早期首次二维码路径错误不计功能 PASS |
| 强制生产 HTTPS 预览重新登录 | 1 | HTTP 200 | `2026-08-28 21:18:49 +08:00`，生产 `/api/auth/wechat` 成功；只核对时间、路径与状态码，不记录 code、openid、token 或请求体 |
| `wechat-cli quit --lang zh` | 2 | 0 / 0 | 本轮启动的开发者工具已关闭 |

所有 preview 二维码、info 文件和临时强制-production 小程序副本已在微信门完成后删除。`<workspace>` 只是报告中的脱敏占位，实际执行目标为本仓库的小程序目录；报告不保存 AppID 或登录标识。

### 2026-08-28 授权生产续验

- `check:release:required` 在全新隔离 PostgreSQL 16 上从 `20:56:17` 运行到 `21:01:43`，整体退出码 0。13 个候选迁移、账号注销、Memory、Safety、Chat、Miniapp、Prisma 与 40-page production build 全部通过；临时数据库目录已删除。
- 公开 `/api/health` 返回 `environment=production`、`database=connected`。生产 PM2 应用与 Nginx 均在线。
- 当前生产运行 release 是 commit `5625262`，而本工作区 HEAD 是其祖先 `890a030` 并叠加大量未提交变化；当前工作区相对生产有 215 个 tracked path 变化。`2026-08-28T21:16:34+08:00` 统计有 136 个 untracked path；不能把生产 Smoke 当成当前候选已经部署。
- 更关键的是，生产 release 含 19 个迁移目录，当前候选只有 13 个，缺少生产已存在的 6 个 2026-08-25/26 迁移。当前候选不得直接部署，必须先完成基线合并与迁移历史一致性修复。
- 生产 Web 首页在浏览器真实运行中仍记录 React hydration `#418`；仓库工作区已有确定首屏修复，但尚未部署。脱敏控制台证据：`docs/evals/prod-web-runtime-20260828.json`；截图只证明对应页面视觉状态，不单独承担控制台错误证明：`docs/evals/screenshots/prod-home-runtime-20260828.png`。
- 生产微信闭环已通过：测试者清除同 AppID 的旧本机登录缓存后重新登录，生产 `/api/auth/wechat` 返回 200。首次扫码仅复用本机缓存、未访问生产，不计作登录证据。

## 证据保护

- 未记录或提交 API key、数据库 DSN、微信 code/openid/session key、手机号、OTP、Cookie 或 token。
- 未把真实用户内容发送给模型；所有真实模型输入均为冻结合成案例。
- 所有微信预览二维码、info 文件与临时验收项目均已永久删除，不写入仓库或报告正文。
- 未部署、未修改凭据、未访问生产用户数据。

## 下一步

先把当前候选与生产主线 `5625262` 之后的迁移历史安全合并，形成一个可复现 commit，再重新执行本地发布门并部署候选；在此之前即使微信当前预览流程通过，整体仍保持 `NO-GO`。
