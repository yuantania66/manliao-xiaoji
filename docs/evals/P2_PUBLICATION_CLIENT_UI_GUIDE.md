# P2 Publication — Client Provisional UI + Real Model Streaming Guide

## Scope（PM-authorized：接真模型流式）

在 **opt-in / eval / p2-preview** 路径上：

1. 用真实 **Qwen 流式**产出文本
2. 按句段（或 soft-max 最小流式单位）写入 **provisional**（UI：**临时内容，确认后才会保留**）
3. Hard Guard 通过后 **commit**（UI：**已确认**）
4. 同一 `clientTurnId` 重试 **不产生第二 winner**（publication 五态 + lease）

Defaults unchanged:

| Constraint | Rule |
|---|---|
| Site writer | Still **V1** |
| Flag | Do **not** set site-wide `P2_PUBLICATION_ENABLED` default ON |
| UI gate | Markers appear **only** on opt-in / preview path |
| Non-goals | Full-site P2 · cohort expansion · prod DB migration · P3 · Day2 BUDGET · 替换全部 V1 Planner |

## Safety depth（诚实披露）

当前输出安全深度：

```text
stream_output_safety_v1+hard_guard+hard_facts: input crisis gate; streaming segment Output Safety (deterministic); final Hard Guard; hard facts + Memory untrusted labeling on prompt; LLM Safety judge not mounted
```

含义：

- **会做**：危机输入走 Safety-owned 同排 commit；流式句段经 Output Safety 后才 provisional；输出命中拒绝模式时 **不** 标成「已确认」
- **未做**：LLM Safety 裁判；正式 `[SLO-FIRST-SAFE]` 时序冻结

## Opt-in path（推荐专用路由）

**首选（无查询参数）：**

```text
http://127.0.0.1:3017/chat/p2-preview
```

页面顶部应出现绿色提示条：「P2 预览模式…」。没有这条 = 仍在普通 V1。

备用查询串（部分浏览器会把 `=` 编成 `%3D`，可能失效）：

```text
/chat?p2Publication
/chat?p2=1
/chat?p2Publication=1
```

### 受控进程显式 ENABLE（不是全站默认提交）

```bash
export P2_PUBLICATION_ENABLED=1
export P2_PUBLICATION_STORE=file
export QWEN_API_KEY=...          # 或 DASHSCOPE_API_KEY
# optional:
# export QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# export P2_PUBLICATION_MODEL=qwen3.7-max
```

然后：

```bash
cd /private/tmp/xinqing-p2-publication-impl
npx next dev -p 3017
```

打开 `/chat/p2-preview` 发送消息：

- 流式文本出现时助手气泡带 **临时内容，确认后才会保留**
- 结束后标记变为 **已确认**
- 客户端调用：`POST /api/chat/p2-publication/eval` · `op=generate_stream`（NDJSON）

### 助手称呼（产品冻结）

- **产品名**：慢聊小记（不是助手自称）
- **默认助手名**：小慢
- **可自定义**：用户可改称呼（如「小猪」）；改名后该用户后续轮次须沿用，不得事后改口自称「心晴」等
- **隔离**：按登录 `userId` 隔离；游客按 `sessionId` 隔离（互不影响）

### 意图（S1）

预览流式在调模型前解析本轮意图（含对话关系：如对上一轮收束邀请的轻应和），把 **intent kind + posture** 注入系统提示；**不**用禁词/案例清单堆回复规则。

`GET /api/chat/p2-publication/eval` 可查看 flag、`safetyDepth`、Qwen 是否 configured。

### 缺密钥时的行为

若缺少 `QWEN_API_KEY` / `DASHSCOPE_API_KEY`：

- 不会伪造「真模型」终稿
- 不会把 unchecked raw 标成 **已确认**
- API/UI 报 `QWEN_NOT_CONFIGURED` 并列出 missing env

### 普通 `/chat`

无 opt-in 仍走 V1，**无**临时/终稿标记。

opt-in 开了但服务端 flag 关：显示明确错误，不会在 V1 回复上伪造临时标。

## Narrow checks

```bash
cd /private/tmp/xinqing-p2-publication-impl
npm run check:p2-publication-stream
npm run check:p2-publication-client-ui
npm run check:p2-publication
npm run check:p2-publication-trial
```

## Manual acceptance checklist（请产品经理目测）

- [ ] `/chat`（无 opt-in）：无「临时内容」/「已确认」
- [ ] `/chat/p2-preview` + flag ON + Qwen key：真模型流式文本先临时再已确认
- [ ] 同 turn 重试不出现第二条 winner
- [ ] flag 默认仍 OFF；预览需显式 `P2_PUBLICATION_ENABLED=1`
- [ ] 无生产共享库强制 migration；无扩受控人群全员；无 P3 默认热路径

## STOP

Delivery Lead stops here. **请产品经理目测真模型流式观感**后再决定是否扩受控人群或加深 Safety。
