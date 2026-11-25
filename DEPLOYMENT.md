# 慢聊小记生产部署记录

## 当前生产服务器

- 云厂商：腾讯云 CVM
- 公网 IP：`106.54.21.202`
- 系统：Ubuntu 24.04.4 LTS
- SSH 用户：`ubuntu`
- 应用目录：`/var/www/manliaoxiaoji/app`
- 共享环境变量：`/var/www/manliaoxiaoji/shared/.env`
- 上传目录：`/var/www/manliaoxiaoji/uploads`
- PM2 进程：`manliaoxiaoji`
- 应用端口：`3100`
- Nginx：`manliaoxiaoji.com` / `www.manliaoxiaoji.com` 反代到 `127.0.0.1:3100`
- HTTPS 证书：Let's Encrypt，路径 `/etc/letsencrypt/live/manliaoxiaoji.com/`
- 数据库：本机 PostgreSQL，库名 `manliaoxiaoji`

## 2026-09-01 当前发布

- 生产版本：`4c0b72e`（GitHub 网络不可达时通过封存 tar 包直接部署；远端主分支同步待补）
- 当前目录：`/var/www/manliaoxiaoji/releases/4c0b72e`
- 回滚版本：`/var/www/manliaoxiaoji/releases/dc1d010`（另保留 `5625262`）
- Next.js Build ID：`MPfwT9EZZYHck-CnI_YRX`
- 生产数据库：21 个 migration 已应用，无待执行 migration
- 蓝绿状态：Nginx 当前代理到 `127.0.0.1:3102` 的 `manliaoxiaoji-authfix`（新版）；`dc1d010` 在 `3101`、`5625262` 在 `3100` 在线保留作即时回滚
- 健康检查：`/api/health` 返回 production / database connected
- 线上 smoke：基础 3/3 通过；真实 Qwen 合成游客欢迎语与“你好”聊天均成功提交
- 当前小程序预览：`/private/tmp/xinqing-preview-wechat-auth-fix-r1-20260901.png`，SHA-256 `c6384e92f42b2a77f97d78de9243451eaeaaf57c9be4a82a4fd514bd9a0b4513`
- 线上 smoke：健康检查、匿名鉴权、微信空参数、游客主动问候、真实 Qwen 合成“你好”均通过
- 微信登录诊断：新版本仅记录微信上游 operation、HTTP 状态和数字 errcode；等待最新二维码的一次真实登录以区分 AppSecret 与临时 code 问题
- 注销文件清理：`manliaoxiaoji-account-cancellation-cleanup.timer` 已启用，最近一次执行成功
- 数据库备份：`manliaoxiaoji-postgres-backup.timer` 已启用，每日执行；首份备份已通过 `pg_restore --list` 完整性检查
- 小程序预览：从生产同版本 `5625262` 的纯净归档编译通过，包体 168.8 KB

## 已完成

- [x] 独立生产目录已创建，不影响旧的 `xinqing.studio` 测试服务。
- [x] 生产 `.env` 已写入服务器受限目录，未进入 git。
- [x] 生产 PostgreSQL 账号和数据库已创建。
- [x] Prisma migration 已部署。
- [x] Next.js 生产构建通过。
- [x] PM2 进程 `manliaoxiaoji` 已启动并保存。
- [x] Nginx HTTP 站点已配置。
- [x] DNS / HTTPS 已恢复并复核，`https://manliaoxiaoji.com` 可访问。
- [x] HTTPS 证书已启用；线上 smoke 通过域名 HTTPS 完成。
- [x] 生产健康检查已复核，`/api/health` 返回 `database: connected`。
- [x] `/uploads/` 静态文件映射已验证。

## 待完成

- [x] 生产域名 `https://manliaoxiaoji.com` 已启用 HTTPS；微信公众平台合法域名仍需在提审前由管理员最终核对。
- [x] 已配置每日生产数据库备份与生成后完整性检查；当前不自动删除旧备份，保留周期另行确认。
- [x] 生产 AI Provider 已配置为 Qwen；不记录密钥或 Base URL。真实合成游客问候与聊天已通过。
- [x] 已运行 `npm run smoke:prod`，3/3 通过。
- [x] 已配置注销文件清理 secret 与 systemd timer。
- [x] 当前候选采用微信登录、微信手机号登录和游客模式；短信登录入口暂缓开放。生产审计允许短信配置全缺失，但部分配置仍视为失败；短信实现保留供后续独立候选启用。
- [ ] 后续启用短信登录前，完成腾讯云短信凭据、应用、签名、登录与注销模板配置及真实短信验证。
- [ ] 完成微信体验版真机人工验收并提交审核。
- [x] Composer 三自然日延迟门不再阻断上线；改为北京时间 17:00 固定窗口监控，异常趋势单独处理。

## 常用命令

```bash
ssh ubuntu@106.54.21.202

pm2 status
pm2 logs manliaoxiaoji --lines 100
pm2 restart manliaoxiaoji

curl http://127.0.0.1:3100/api/health
curl -H "Host: manliaoxiaoji.com" http://127.0.0.1/api/health
```

## 上线前自动化

本地代码侧发布检查：

```bash
npm run check:launch
npm run smoke:local-api
```

服务器生产环境变量审计：

```bash
PROD_ENV_FILE=/var/www/manliaoxiaoji/shared/.env npm run audit:prod-env
```

域名恢复后的生产 smoke：

```bash
npm run smoke:prod
```

`smoke:prod` 会检查生产健康检查、匿名鉴权和微信登录参数校验。2026-08-27 已在 `5625262` 上通过；另以纯合成数据验证了游客主动问候和真实 Qwen “你好”聊天链路，检查输出不含回复正文、密钥或 Base URL。

## 2026-11-25 数据库升级候选

### 正式线上只读核对

2026-11-25 通过正式域名的反代端口、应用进程目录和公开首页构建文件的 SHA-256 确认实际发布为 `9750adc`。运行目录的包清单、Prisma 模型和小记接口源文件均与本地 `9750adc` 对应文件的 SHA-256 一致。端口 `3100` 另有进程运行 `5625262`，这是上面隔离演练采用的历史版本。

由 `9750adc` 的数据库配置进入只读事务，查询 Prisma 迁移元数据。**21 条均成功，无未完成或已回滚记录**。21 个名称和 SQL 文件的 SHA-256 与本地 `9750adc` 完全一致。与当前候选 `aab536f` 对照，有 13 条一致，候选缺 8 条线上历史迁移，另有 5 条候选新迁移尚未执行。线上应用和数据库的升级起点均确定为 `9750adc` 对应的 21 条迁移。

此次核对只读取版本和迁移元数据。以核对结果创建本地分支 `codex/production-upgrade-9750adc`。

<details>
<summary>线上已成功执行的 21 条迁移</summary>

```text
20260608154611_init_backend
20260623061000_add_feedback
20260705090000_add_experience_layers
20260706000100_add_understanding_layers
20260706000200_add_ai_message_feedback
20260708000100_add_memory_v2_phase1_raw
20260708000200_add_memory_v2_refinement_raw_captured
20260708000300_add_memory_v2_raw_worker_nullable_raw
20260708000400_add_memory_v2_raw_to_segmentation_step
20260708000500_add_memory_v2_evidence_type_and_targets
20260708000600_add_memory_v2_semantic_raw_segment_projection
20260724000100_chat_execution_commit_boundary
20260810000100_add_episode_summary_memory_kind
20260825000100_add_assistant_publication_p2
20260825000200_add_p4_minimum_memory
20260825000300_add_p6_relationship_growth_cache
20260825000400_add_p5_governance_deletion
20260826000100_add_note_upload_integrity
20260826000200_add_account_cancellation_file_deletion
20260828190000_add_profile_avatar_upload_purpose
20260831000100_add_profile_completion_gate
```

</details>

### 隔离升级演练

升级分支保留了线上 21 条迁移及其内容，追加五条回复反馈、评价队列、复核和训练候选迁移，保留线上原有小记、媒体、账号注销及聊天发布入口。用锁定依赖、两个阶段的 Prisma Client 和仅监听本机的 PostgreSQL 做演练。旧库升到 26 条，21 条原有迁移名称与校验值未变，全新空库也能执行相同的 26 条迁移。Prisma 差异报告与升级前一致，仍含小记默认值和索引、外键别名的历史差异。

隔离回归使用 [小记升级检查](scripts/production-upgrade-note-check.ts)。给 `NOTE_UPGRADE_TEST_DATABASE_URL` 指定本机测试库，给 `NOTE_UPGRADE_FIXTURE_DIR` 指定本次独立测试目录。以原 21 条及原 Prisma Client 运行 `node --import tsx scripts/production-upgrade-note-check.ts seed` 写入虚构记录。追加五条后用 `read` 检查原 Client 读取和重试，生成新 Client 后用 `verify` 检查新建、编辑、隔离和删除。用 `pg_dump`／`pg_restore` 和单独复制的虚构图片目录，验证隔离库恢复后可读取原小记、原图及原聊天。旧反馈的时间戳保留，迁移未把旧聊天追加到凌晨评价队列。

完整本地发布检查 `npm run check:release:required` 通过，含生产构建。另通过回复反馈、评分、复核权限、后台队列和训练候选等六项专项，以及小程序小记、观察和聊天专项。账号注销与删除治理在本机 PostgreSQL 复验通过。 构建后的本机应用通过 8 项 HTTP 检查。聊天检查覆盖无模型时保留用户消息及返回失败状态，另用虚构已发布回复验证反馈入口。

该候选接入反馈、凌晨评价、内部复核、独立训练候选授权及观察页撤回，保留正式发布的观察授权校验。实时双线督导已接到本地候选的生成与提交边界，可以用隔离参数验收。实际聊天入口尚未启用。人工审核建议输入 Qwen 仍需要新版对话事实和来源字段。当前线上应用、数据和定时器均未随本地演练变动。

### 实时督导的本地验证

在原有理解、ResponsePlan 和预检上接入可单独开启的双线。模型生成与输入风险分类并行。普通结果跳过正文检查，危险或不确定结果检查完整正文，最多修正一次。分类异常、超时、二审不通过和未核实的具体联系方式都会扣留正文。提交再次检查候选、轮次、账号、来源和实际正文，普通放行不写入未经验证的互动承诺。并发删除时，提交需要在同一事务内锁定仍有效的来源。

`npm run check:chat-supervision-protocol` 和 `npm run check:chat-supervised-publication` 分别覆盖 13 类协议和 24 项发布流程，使用可控模型替身。并发删除可在隔离 PostgreSQL 设置 `CHAT_SUPERVISED_PUBLICATION_TEST_DATABASE_URL` 后运行 `npm run check:chat-supervised-publication-pg`。

正式入口仍走原流程。启用前需确认失败时显示和保存的内容、超时和重试参数，并完成朋友风险真实回复、已选历史数据的输入接线及 Web、小程序的发布回读验收。

### 人工审核建议的历史来源

本地候选可以在当前消息已保存且归属有效时，从同账号会话取回严格早于当前消息的历史用户原话。服务排除其他账号、归属不一致、已删除与已撤回的记录，返回前在同一数据库快照复核当前消息及选中的原话。返回的历史原话是待判定的资料。

在本机隔离 PostgreSQL 设置 `CHAT_RETRIEVAL_CONTEXT_TEST_DATABASE_URL` 后运行 `npm run check:chat-retrieval-context-pg`。合成库已复验同账号同会话及跨会话、伪造当前消息、读取过程中撤回原话，并验证匹配原话的建议仍须当前版本得到人工批准。普通聊天仍需接入新版解释和回复规划的来源校验，用它确认当轮是否确实引用该原话，以及是否有优先的当轮要求，再交给现有人工批准建议读取器。原话检索当前可以独立验证，尚未由公开聊天调用。

## 凌晨回复评价

发布候选包含独立的 [systemd 定时单元](ops/systemd/manliaoxiaoji-reply-evaluation.timer)
和 [后台进程单元](ops/systemd/manliaoxiaoji-reply-evaluation.service)。定时器按
`Asia/Shanghai` 每天 04:00 启动，关机错过的触发在恢复后补跑。队列在新增已发布回复和反馈实际变化时跟进，迁移不会主动加入旧对话。

启用前在目标环境核对 Node 路径及 `tsx` 依赖、应用目录、运行账户、实际环境配置和配套迁移。进程读取已配置的 Qwen，使用 `CHAT_REPLY_EVALUATION_ENABLED=true` 启用，单次上限由 `CHAT_REPLY_EVALUATION_BATCH_LIMIT` 配置，示例为 100。中断和暂时失败的任务保留在队列，后续批次继续处理。日志只含结果计数。

发布候选的无模型检查可运行 `CHAT_REPLY_EVALUATION_ENABLED=false node --import tsx scripts/chat-reply-evaluation-nightly.ts`。线上启用和真实审核员配置仍属发布操作。

指定审核员在 `/internal/chat-reply-reviews` 处理待审评价，名单由
`CHAT_REPLY_REVIEWER_USER_IDS` 配置。现有评价使用原始回复和关联反馈，上线前需确认真实对话用于后台评分的授权范围。

## HTTPS 证书命令

已执行：

```bash
sudo certbot --nginx -d manliaoxiaoji.com -d www.manliaoxiaoji.com
```
