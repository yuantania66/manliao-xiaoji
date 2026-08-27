# 小程序真机问题修复验收（2026-08-27）

## Outcome

针对两轮真机截图，修复机械回复、聊天首屏与发送状态、小笺内容与短屏布局、微信隐私登录、登录态证据、设置/注销身份展示，以及观察页数据质量。

## Completed locally

- 小笺在本机依据用户刚写下的内容生成一条非诊断、非因果推断的反思提示；原始小记仍按原文保存，派生提示不写入 Note 或 RawMemory，游客正文不会为此上传。仅图片记录使用观察细节提示。重新生成只切换版式。
- 小笺弹层使用安全区内纵向滚动，删除无行为的“分享给朋友”假入口，保留全宽保存图片。
- 微信登录在 `wx.login` 前执行微信原生隐私授权；同时保留产品隐私政策确认。
- “我的”页显示“微信账号已连接 · 云端同步已开启”，设置页按 authenticated / guest / none 展示真实账号状态。
- 游客和未登录用户不显示退出登录或账号注销；注销页对无账号访问 fail closed。
- 观察页删除全部演示数字，登录且明确授权后才请求 `/api/insights`；授权凭证由服务端签名并绑定当前用户，退出或切换账号即失效，未经授权的直接 GET 返回 403。服务端只读取同一用户自己的小记和 USER 聊天消息，返回真实词频和来源条数。空数据、网络失败和登录失效均不回退到假数据，切换 7/30/90 天时不再残留上一范围的词频。
- “我的”页在登录校验失败后同步更新连接状态，避免同时显示游客模式和“微信已连接”；纯图片小笺按实际图片数量表述。
- 机械收条、纯在场话术、虚构“正在等你”及非承担性关系修复被确定性拒绝；主动能力事实区分“打开聊天页面可先问候”和“关闭小程序后不能后台推送”。
- 低信息问候由 Planner 正式选择 `offer_neutral_conversation_entry`：最多允许一个轻量选择问题，仍禁止要求解释、索取细节和连续盘问。
- 游客首次打开空聊天时调用既有 `/api/chat/guest/greeting`；成功后把 `promptVersion` 与 `interactionMoveEnvelope` 一并保存在本地。重复进入、请求并发或用户已先发送消息都不会重复插入问候。
- 登录用户首次进入且没有会话时会创建唯一会话并立即拉取已提交的欢迎语；发送消息后先显示用户气泡，再等待 AI 回复。
- 聊天接口返回可恢复失败时按 `status` 分支处理，不再读取不存在的 `assistantMessage`；原始 JavaScript 异常不会出现在页面顶部，安全提示显示在对话底部。
- 聊天失败提示现在以同一 `turnId` 对应的 SYSTEM 消息幂等保存；刷新、重复请求和重新进入页面都会读取同一条记录，不再用另一段内容替换或令其消失。游客模式使用同样的本机持久化规则。SYSTEM 消息不进入后续 AI 对话上下文，也不改变主动问候的用户历史判断。
- 只有执行轨迹明确为 Safety 分诊服务不可用时，才显示中性、可重试的“安全检查暂时无法完成，请重试。”；它不会附带急救号码。真实风险决定和其他 Safety 阻断继续保留危机帮助信息。
- 空聊天不再强制显示滚动条或滚到底部；欢迎语加载时显示轻量等待状态，消息出现后才启用正常滚动。
- 每个无草稿的小记页面都会生成新的 `clientRequestId`，草稿恢复和同请求重试仍复用原 ID，因此连续创建小记不再误报“该保存请求已用于另一份小记”。
- 小笺弹层明确限制为屏幕宽度减去左右边距，修复保存后右移和整体放大的横向溢出；“+记一下”使用微信胶囊安全位置。
- 观察页只展示至少重复两次的内容词，并排除问候、应答、代词、疑问、否定和连接类低信息片段；没有合格词时诚实显示空态，不补心理标签。

## Evidence

- `check:natural-chat-control`: PASS
- `check:assistant-grounding`: PASS
- `check:miniapp-real-device`: PASS
- `check:miniapp-chat`: PASS（空聊天单次问候、重复进入去重、用户先发消息时迟到问候丢弃）
- `check:chat-execution-lifecycle`: PASS（SYSTEM 状态重复保存仅一条，tenant/session/role 绑定，且不影响主动问候）
- 执行前校验要求 reciprocal handoff 必须携带 `offer_neutral_conversation_entry`；输出后确定性与语义校验共同拒绝泛化“想聊什么”、原因/细节盘问、任意指定话题、第二个问题、机械收条、假装在线与虚构等待。
- 修复后真实 Qwen 合成回放：游客开场问候成功；3 次独立低信息“你好”全部 `committed`，每条恰好 1 个轻量选择问题，得到 2 个不同回复哈希；Prompt version `chat-response-plan-v27`。回放直接复用产品内的轻量选择结构判定，而不是另写关键词检查；泛化开放问、空缺选项、指定话题和残缺选择 4 类伪二选一均被硬拒绝。过程未输出密钥、Base URL 或真实用户数据。
- `check:miniapp-insights`: PASS（A 授权、退出、B 登录时 0 次观察请求；跨用户、缺失、篡改、过期服务端凭证均拒绝）
- `check:miniapp-login`: PASS
- `check:miniapp-note`: PASS
- `check:miniapp-js`: PASS（30 files）
- TypeScript: PASS
- focused ESLint: PASS（0 warnings）
- production build: PASS；`/api/insights` included
- Prisma schema / 19 migrations consistency: PASS（fresh isolated PostgreSQL）
- WeChat DevTools preview compile: PASS（168.8 KB；2026-08-27 18:35 生成包含聊天一致性与 Safety 提示修复的新体验二维码）

## Current release gate

本地计划、Prompt、确定性 Validator 与语义 Validator 已对齐；本切片真实 Qwen 合成回放已通过。此前 PR #33 与生产版本 `dcb5515` 的线上检查保持为历史证据；本次第二轮真机修复仍仅位于本地发布工作树，已生成新的体验二维码，但尚未合入或部署。关闭小程序后的后台推送仍不属于当前能力，不得据此宣称已经完成。

## Boundaries

发布验证未读取真实用户内容；线上聊天仅使用合成“你好”，输出检查不记录回复正文。Composer 三日延迟采样保持独立，当前仍按批准方案 pending。
