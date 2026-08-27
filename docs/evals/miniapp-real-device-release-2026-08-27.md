# 小程序真机问题修复验收（2026-08-27）

## Outcome

针对 7 张真机截图，修复机械回复、小笺内容与短屏布局、微信隐私登录、登录态证据、设置/注销身份展示，以及观察页静态演示数据。

## Completed locally

- 小笺只使用用户刚写下的原话；仅图片记录使用不带心理推断的说明。重新生成只切换版式。
- 小笺弹层使用安全区内纵向滚动，删除无行为的“分享给朋友”假入口，保留全宽保存图片。
- 微信登录在 `wx.login` 前执行微信原生隐私授权；同时保留产品隐私政策确认。
- “我的”页显示“微信账号已连接 · 云端同步已开启”，设置页按 authenticated / guest / none 展示真实账号状态。
- 游客和未登录用户不显示退出登录或账号注销；注销页对无账号访问 fail closed。
- 观察页删除全部演示数字，登录且明确授权后才请求 `/api/insights`；授权凭证由服务端签名并绑定当前用户，退出或切换账号即失效，未经授权的直接 GET 返回 403。服务端只读取同一用户自己的小记和 USER 聊天消息，返回真实词频和来源条数。空数据、网络失败和登录失效均不回退到假数据，切换 7/30/90 天时不再残留上一范围的词频。
- “我的”页在登录校验失败后同步更新连接状态，避免同时显示游客模式和“微信已连接”；纯图片小笺按实际图片数量表述。
- 机械收条、纯在场话术、虚构“正在等你”及非承担性关系修复被确定性拒绝；主动能力事实区分“打开聊天页面可先问候”和“关闭小程序后不能后台推送”。
- 低信息问候由 Planner 正式选择 `offer_neutral_conversation_entry`：最多允许一个轻量选择问题，仍禁止要求解释、索取细节和连续盘问。
- 游客首次打开空聊天时调用既有 `/api/chat/guest/greeting`；成功后把 `promptVersion` 与 `interactionMoveEnvelope` 一并保存在本地。重复进入、请求并发或用户已先发送消息都不会重复插入问候。

## Evidence

- `check:natural-chat-control`: PASS
- `check:assistant-grounding`: PASS
- `check:miniapp-real-device`: PASS
- `check:miniapp-chat`: PASS（空聊天单次问候、重复进入去重、用户先发消息时迟到问候丢弃）
- 执行前校验要求 reciprocal handoff 必须携带 `offer_neutral_conversation_entry`；输出后确定性与语义校验共同拒绝泛化“想聊什么”、原因/细节盘问、任意指定话题、第二个问题、机械收条、假装在线与虚构等待。
- 修复后真实 Qwen 合成回放：游客开场问候成功；3 次独立低信息“你好”全部 `committed`，每条恰好 1 个轻量选择问题，得到 2 个不同回复哈希；Prompt version `chat-response-plan-v27`。回放直接复用产品内的轻量选择结构判定，而不是另写关键词检查；泛化开放问、空缺选项、指定话题和残缺选择 4 类伪二选一均被硬拒绝。过程未输出密钥、Base URL 或真实用户数据。
- `check:miniapp-insights`: PASS（A 授权、退出、B 登录时 0 次观察请求；跨用户、缺失、篡改、过期服务端凭证均拒绝）
- `check:miniapp-login`: PASS
- `check:miniapp-note`: PASS
- `check:miniapp-js`: PASS（29 files）
- TypeScript: PASS
- focused ESLint: PASS（0 warnings）
- production build: PASS；`/api/insights` included
- WeChat DevTools preview compile: PASS（159.8 KB）

## Current release gate

本地计划、Prompt、确定性 Validator 与语义 Validator 已对齐；本切片真实 Qwen 合成回放已通过。生产发布、真实用户流量及关闭小程序后的后台推送不属于本切片，仍不得据此宣称已经完成。

## Boundaries

未读取真实用户数据，未写生产数据库，未部署，未合入；未改 Composer 三日延迟采样。
