# 慢聊小记首版上线候选验收记录（2026-09-27）

执行安排：`docs/tasks/cursor-launch-delivery-brief.md`。验收依据：本分支 `docs/RELEASE_TEST_CHECKLIST.md`。本文是本次候选唯一验收记录；未运行的门写 NOT_RUN/PENDING，不写 PASS。

## 候选身份

| 项 | 值 |
| --- | --- |
| 集成分支 | `codex/launch-integration-20260927`（worktree `/Users/yuanyuanyuan/projects/xinqing-launch-rc-20260927`，未设置 upstream） |
| 集成基线 | `origin/main` = `3819b86`（2026-09-03 合并 PR #37；GitHub CI `launch-checks` 在 head `79d41d0` 上为 SUCCESS，属历史证据） |
| 源码指纹 | `package-lock.json` `e72423cb…a652d2c3`；`package.json` `bd76e8ce…f7559fd5`；`prisma/schema.prisma` `0fbd4596…ebafc75` |
| 工具 | Node `v22.23.3`（与 CI 主版本一致）、npm `10.9.9`、Prisma CLI `6.19.3`、PostgreSQL `16.14` |
| 状态 | 集成基线（本地必跑门未运行，尚不是发布候选） |

## 阶段 1：集成基线

冻结：Outcome 为以最新可验证主线建立可复现集成基线并证明原工作区无须另行吸收的发布代码；Acceptance 为干净 checkout + `npm ci`、迁移一致性、全新建库、旧生产 schema 升级及代表性读写/删除回归；Non-goals 为功能修改、必跑门、生产操作、V2/Composer；修复预算每门两轮。

### 版本关系（2026-09-27 刷新）

- `git fetch origin` 后 `origin/main` 从本地缓存 `00a3301` 前进到 `3819b86`。
- 原工作区分支 `codex/planner-handoff-migration`，HEAD `890a030`，是 `origin/main` 的祖先，落后 69 个提交、领先 0 个；工作区 92 个 tracked 修改、68 个 untracked 路径（`-uall` 展开后 258 个路径）。
- `DEPLOYMENT.md` 记录生产为 `9750adc`（源码 `f66e0bd`，Build ID `DB_RiEeWMmtZ2woWGJhii`，21 个 migration）。2026-09-27 只读请求 `https://manliaoxiaoji.com/` 返回同一 Build ID，`/api/health` 为 production / database connected。该观察与记录一致，但健康接口不暴露 commit。
- `9750adc..3819b86` 仅改动 `DEPLOYMENT.md`、`WECHAT_REVIEW_MATERIALS.md`、`docs/evals/wechat-release-candidate-20260831.md` 与 `scripts/production-env-audit-check.mjs`（测试夹具隔离）；运行时源码与生产记录版本一致。

### 原工作区处置（逐文件按内容比对 `origin/main`）

| 类别 | 数量 | 处置 |
| --- | --- | --- |
| 与 `origin/main` 字节一致 | 177 | 已整合，不重复搬运 |
| 等于 main 历史某提交的旧快照（`aadc62d` 24 个、`df1a6f4` 4 个） | 28 | 已被后续 main 提交取代 |
| 与 main 历史均不一致的中间版本 | 24 | 逐项比对后均为 main 已取代的旧实现，见下 |
| main 不存在 | 29 | 28 个设计/预览 PNG 不属于发布代码；任务书已复制入本分支 |

中间版本要点：注销路由为内联旧实现（main 已收敛到 `accountCancellationService` 并以微信身份优先）；小程序 `utils/auth.js` 缺少 main 的身份切换回滚、草稿归属与游客资料；上传走公开 `/uploads/notes`（main 为私有令牌存储）；观察页无 consent token（main 已有）；`package.json` 缺少 main 的 6 个必跑门与依赖安全覆盖。唯一语义差异是 `services/ai/proactiveGreeting.ts` 把主动问候质量判定与重复文本降为 advisory；`docs/tasks/p0-current-baseline-manifest.md` 记录用户授权将其恢复为 hard，main 维持 hard，因此不吸收。

文档冲突说明：原工作区的 `docs/RELEASE_TEST_CHECKLIST.md` 是旧版本。本分支版本新增 `check:profile-avatar-e2e`、`check:profile-completion-gate-e2e`、`check:profile-avatar-mini-client`、`check:wechat-phone-login-e2e`、`check:unified-auth-flow`、`check:production-env-audit` 六个必跑门，并写明当前候选短信登录延后。以本分支清单为准；短信门是否适用在阶段 2/5 按注销依赖核实，不在此豁免。

### 迁移与数据库证据

隔离实例：独立数据目录 `~/.xq-rc-pg/data`，`localhost:55439`，仅本次使用；与 `.env` 中的开发库 `xinqing_dev` 无关。本分支 worktree 的 `.env` 为空文件（与 CI 一致）。

| 门 | 证据 | 状态 |
| --- | --- | --- |
| 迁移内容一致 | `git diff 9750adc 3819b86 -- prisma/` 为空；`5625262→3819b86` 只新增 `20260828190000`、`20260831000100`，无既有迁移修改 | PASS |
| 全新建库 | `xq_rc_fresh_test_20260927`：`prisma migrate deploy` exit 0，21/21 finished、0 rolled back，`migrate status` up to date | PASS |
| 旧生产 schema 升级 | `xq_rc_upgrade_test_20260927`：按 `5625262` 部署 19 个迁移并写入合成用户/会话/消息/小记/上传/反馈，再部署候选：只应用 2 个新迁移，6 表行数前后均为 `3/2/3/2/1/1`；资料完善回填只标记昵称与头像均非空者；旧上传 `purpose=NOTE_MEDIA` | PASS |
| 校验和 | 全新与升级库 21 个 migration checksum 完全一致 | PASS |
| 升级库代表性读写/删除 | `check:account-cancel-e2e`、`check:profile-completion-gate-e2e`、`check:wechat-phone-login-e2e`、`check:profile-avatar-e2e` 均 exit 0；合成遗留用户与小记未被删除 | PASS |
| schema 与迁移漂移 | `prisma migrate diff --from-url <db> --to-schema-datamodel` 在全新与升级库结果相同：6 处索引/外键名因 PostgreSQL 63 字符截断不同；`Note.requestHash` 仅在 schema 声明 `@default("")`、数据库无默认值 | 既有漂移，见 Remaining |

### Remaining（阶段 1 发现，不在本阶段修改）

- schema/migration 命名与 `Note.requestHash` 默认值漂移：生产 `prisma/` 与候选相同，属既有状态；Prisma Client 写入时注入默认值，现有创建路径均通过。若今后执行 `prisma migrate dev` 会生成修正迁移，需单独切片处理。

## 阶段 2：功能缺口

冻结：Outcome 为小程序观察补齐撤回授权并修复 403/401 后加载卡死，明确授权与派生数据边界；Acceptance 为 `check:miniapp-insights` 覆盖正常、空数据、7/30/90、游客、网络失败重试、403 重新授权、401、撤回（含在途请求）、跨账号与晚到响应并纳入唯一必跑入口；Allowed scope 为 `miniprogram-project/pages/insights/*`、该检查脚本、`package.json` 必跑入口、清单与本记录；Non-goals 为服务端持久化同意、Web 页面、统计口径。

### 在基线上复核的结论

- 任务书“小程序观察仍是固定数组”来自旧工作区；基线上小程序已调用 `/api/insights`，使用服务端签名、绑定 userId、30 天有效的 consent token，并以请求序号丢弃晚到响应。Web 同样使用该接口。
- 退出（`clearAuth`）、注销（`clearCancelledAccount`）与 401（`utils/request.js` 调用 `clearAuth`）均清除本机观察授权；切换账号时授权按 userId 校验，B 无法使用 A 的授权，服务端 `assertInsightsConsent` 同样校验 userId。
- 实际缺口 1：授权后没有撤回入口（隐私政策写明可撤回授权，`上线待办.md` 亦列为待办）。
- 实际缺口 2（已复现）：服务端拒绝授权（403）时 `catch` 先删除本机授权，`finally` 以“授权仍为当前”为条件复位 `isLoading`，导致 `isLoading` 永久为真；重新授权后 `loadInsights` 因 `isLoading` 直接返回，页面卡在“正在整理”。401 清除登录后同样不复位，并在授权视图中保留空状态。

### 修改

- `miniprogram-project/pages/insights/insights.js`：新增 `syncIdentity`（按当前登录与授权重置页面、作废在途请求）与 `revokeAuthorization`（删除本机授权后同步）；加载失败时 403 与身份变化统一走 `syncIdentity`，`finally` 仅按请求序号复位加载态；授权请求遇到 401 时同步为未登录状态。
- `insights.wxml/wxss`：授权视图底部新增“撤回观察授权”按钮（复用全局 `secondary-button`）。
- `scripts/miniapp-insights-release-check.mjs`：新增范围、空数据、游客、网络重试、403 重新授权、加载与授权两处 401、撤回及撤回后在途响应用例。
- `package.json`：`check:release:required` 在 `check:account-cancel-mini-client` 后加入 `check:miniapp-insights`；清单 §2.1 同步。

### 授权与派生数据边界（按现有实现记录，未新增持久化同意）

- 授权凭据只存在于客户端：小程序本机存储 `xinqingInsightsAuthorization:v1`（30 天，绑定 userId）；Web 只在页面内存中，离开或刷新即失效。服务端不保存同意记录，签名凭据在有效期内无法由服务端单独作废。
- 撤回 = 删除本机凭据并作废在途请求；退出、注销、401 同样删除。观察结果按请求实时统计、不落库，因此没有需要清理的派生数据。
- 待确认产品决定（不阻断本阶段）：若用户在多台设备分别授权，一台设备撤回不影响另一台设备在 30 天内继续查看本人观察。如需跨设备即时撤回，需要服务端持久化同意，属于新产品决定。

### 证据

| 门 | 证据 | 状态 |
| --- | --- | --- |
| 缺陷复现 | 新用例在基线页面上于“403 后 isLoading 应为 false”断言失败（exit 1） | 已复现 |
| `check:miniapp-insights` | 修复后 exit 0 | PASS |
| 相关小程序窄门 | `check:miniapp-js`（35 文件）、`check:account-cancel-mini-client`、`check:account-cancel-client-storage`、`check:unified-auth-flow`、`check:profile-avatar-mini-client`、`check:miniapp-login`、`check:miniapp-chat`、`check:miniapp-note`、`check:miniapp-real-device` 均 exit 0 | PASS |

### 短信延后与注销依赖核实

- 现行依据：本分支清单 §5.2/§5.3 与 `WECHAT_REVIEW_MATERIALS.md` 写明当前候选短信登录延后；生产审计允许短信配置全缺失（`check:production-env-audit`）。
- 登录路径：小程序统一登录页不展示短信入口（`check:unified-auth-flow`）；Web `app/me/page.tsx` 没有任何进入 `phone` 模式的入口；`APP_ENV=production` 且缺少短信配置时 `/api/auth/code` 返回 `SMS_CONFIG_MISSING`，无开发码。
- 注销路径：有 `wechatOpenid` 的账号用微信重新验证注销；微信手机号登录同时写入 `wechatOpenid` 与手机号，因此当前候选新建账号都不依赖短信注销。只有“有手机号、无 wechatOpenid”的历史账号需要短信验证码注销。
- 结论：短信门对当前候选登录路径不适用；注销依赖取决于生产库是否存在上述历史账号。该事实只能通过一次生产只读聚合计数核实（不读取明文），未获授权前为 PENDING；计数为 0 则短信门不适用，大于 0 则这些账号的注销为 BLOCKED，需要产品决定。

### Remaining（阶段 2 发现，不在本阶段修改）

- Web 观察页 `authorizeInsights` 未处理 POST 失败（未捕获的 Promise 拒绝，页面停留在授权视图，可重试）；体验问题，无数据泄漏。
- 小程序观察页文案称“不会调用 AI”，隐私政策称可选内容观察的文字“可能由 AI 技术服务处理”；当前实现不调用 AI。文案一致性由产品确认。

## 阶段 3–6

NOT_RUN。
