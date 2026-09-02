# 发布测试基线 — 2026-08-27

## 判定

**BLOCKED**

本地工程发布门已全部通过；真实模型、人工盲评、微信体验版、iOS/Android 真机和生产等价环境尚无本次证据，因此当前不能签发 `GO`。

本报告只记录当前工作区，不授权发布、部署、生产数据访问或使用真实用户数据。

## 基线身份

- 日期：2026-08-27（Asia/Shanghai）
- 分支：`codex/planner-handoff-migration`
- HEAD：`890a030`
- 工作区：包含既有大量未提交改动；本轮没有回退或覆盖无关修改
- Node：v23.11.1
- 数据库：本机专用隔离库 `xinqing_release_test`，无生产或开发数据
- 唯一发布入口：`npm run check:release:required`

## 本地发布门结果

`npm run check:release:required`：**PASS（exit 0）**。

运行时显式提供隔离数据库、主动消息 DDL 确认和注销专项数据库变量。13 个 Prisma migration 已全部应用，`migrate status` 显示 schema up to date。

通过范围包括：

- Safety 语义、回合权威结果、客户端幂等标识；
- Handoff、唯一 Planner、Surface/Validator、planned-function 与晚到矛盾权威；
- 主动消息结构化提交、失败零提交和事务回滚；
- Episode Memory 闭环、历史分页、Memory V2；
- Clinical、Hill Helping、Conversation OS、自然聊天与 Grounding；
- 账号物理删除、派生数据级联、旧 token 失效、他人隔离、受管媒体删除和重新注册；
- 小程序环境行为审计、27 个小程序 JS 文件；
- Prisma 校验/生成/migration status；
- Next.js 生产构建，39 个页面生成完成。

## 本轮修复摘要

1. **确定性合同**：修正 Handoff 合并、Clinical/Conversation OS 架构测试、Hill fast-boundary 与 hard-gate 迁移，并清理生命周期中仍把硬失败当 advisory 的旧断言。
2. **环境与发布入口**：开发版可用 LAN/本地 override；体验版、正式版及异常情况强制生产 HTTPS 并忽略历史 override。CI 改为唯一发布入口，并显式使用测试库。
3. **注销与隐私**：注销改为物理删除 User 并级联全部用户数据；受管媒体同步删除，未知或不安全媒体 fail closed；新增隔离库端到端发布门。

## 已知非阻断警告

- ESLint：3 个未使用变量 warning，0 error。
- 发布前审计：media test button guard 与 media seed guard 两条识别 warning；审计最终 PASS。
- 部分 DB/主动消息测试会故意触发唯一键、malformed output、validator rejection 和事务回滚日志；对应测试最终均 PASS。

## 未执行的外部门

以下状态均为 `BLOCKED` 或 `PENDING`，不是 `PASS`：

- 本次变更触发的真实 Qwen Safety、Handoff、planned-function、主动消息语义门；
- 人工盲评与分歧裁决；
- 微信开发者工具编译、体验版合法域名、真实 `code2Session`；
- iOS/Android 真机、弱网、重复发送和前后台恢复；
- 真实短信、对象存储/CDN、生产等价数据库与完整生产 smoke；
- 冻结合同要求的跨自然日稳定性证据。

## 结论边界

当前结论是“本地工程基线通过”，不是“可以发布”。只有按《发布测试清单》补齐所有被触发的真实模型和人工/真机证据后，状态才能由 `BLOCKED` 改为 `GO`。
