# Batch 2B Implementation Report

日期：2026-08-04

状态：`B2-Association` 与 `B2-Initiative-Isolation` 在 fixture-only 范围通过

## 1. Delivered outcome

Batch 2B 实现了独立、纯内存、fixture 驱动的 formal `CommittedHelpingMove` 加载与
目标绑定关联边界。实现不查询数据库，不接入 production orchestration，也不改变
Planner、Prompt、Surface、Validator、Memory、Initiative 或用户可见回复。

Batch 2A Contract 保持原样；Batch 2B 只消费其冻结的 serializer/parser 和
`formal_v1` 结果。

## 2. Implementation

### 2.1 Formal fixture loader

`loadFormalCommittedHelpingMoveFixtures` 接收带 `sessionId`、Assistant message id、
明确 `committedOrder` 和 opaque `interactionMetadata` 的 fixture records，并固定：

- 只读取当前 session；
- 只读取 Assistant records；
- 只接受 Batch 2A parser 返回的 `formal_v1`；
- 要求 metadata 中 `assistantTurnId` 与承载它的 Assistant message id 一致；
- 对 message id 或 committed order 冲突 fail closed；
- 按 `committedOrder` 排序，不用 opaque id 或输入数组顺序充当时间；
- 普通窗口最多 8 条；
- 显式指向的较早 formal target 不在最近窗口时，为它保留一个位置并保持总数最多
  8 条；
- 返回逐 record load trace，区分 formal loaded、ordinary、Shadow/invalid、跨
  session、非 Assistant、identity mismatch 和窗口外记录。

### 2.2 Association lookup

`lookupAssociatedCommittedHelpingMove` 不读取用户文本，也不执行关键词或模型抽取。
调用方必须提供当前 user turn 绑定的结构化证据：

```ts
type HelpingAssociationSemanticEvidence = {
  sourceUserTurnId: string
  targetAssistantTurnId: string
  relation:
    | "direct_response"
    | "continues_move"
    | "rejects_move"
    | "topic_shift"
    | "unclear"
  evidence: string[]
}
```

关联规则：

- reply target / correction target 只能命中已加载 formal move；
- 显式 target 仍必须有同一当前 user turn 的 target-bound semantic evidence；
- correction target 只接受 `rejects_move`；
- 无显式 target 时，只有唯一 formal target 和唯一 associating relation 才能关联；
- 多 target、多 relation、stale evidence、unknown target 或空 evidence 全部 fail closed；
- `topic_shift` 与 `unclear` 永远返回 `not_associated`；
- 不以消息邻接、最新 move、文本长度、用户继续聊天或 initiative state 代替语义关系。

本切片不生成 reaction candidates 或 `impactKnown`，也不将关联结果交给 Hill decision。

## 3. Fixture and isolation evidence

Batch 2B regression 使用 17 条 fixture records，覆盖：

- 10 条当前 session 主序列中可 round-trip/load 的 formal v1 moves；
- legacy ordinary metadata；
- `state="shadow"`；
- 完整 `HillHelpingShadowTrace`；
- unknown schema version；
- User record 携带 formal metadata；
- Assistant message / `assistantTurnId` mismatch；
- cross-session record；
- duplicate message id / committed order；
- absent metadata 与 invalid order。

结果：

| Gate | Result |
|---|---|
| 默认 formal window | 8/8，按 committed order |
| 显式较早 target | 成功补入，窗口仍为 8 |
| formal round-trip/load | pass |
| direct / continue / correction association | 3/3 pass |
| Shadow loaded | 0 |
| ordinary loaded as Helping | 0 |
| cross-session / bad identity loaded | 0 |
| production integration detected | 0 |

## 4. Regression evidence

以下命令均 exit 0：

- `npm run check:hill-helping-batch2a`
- `npm run check:hill-helping-batch2b`
- `npm run check:hill-helping-batch1`
- `npm run check:hill-helping-batch1-5`
- `npm run check:hill-helping-batch1-5-preservation`
- `npm run check:conversation-os-control`
- `npm run check:conversation-os-architecture`
- `npm run check:ai-orchestration`
- `npm run check:natural-chat-control`
- `npm run check:proactive-greeting-control`
- `npm run check:launch`

完整工程门同时确认：12 个 Prisma migrations 已同步、27 个 Miniapp JS 文件通过，
39 个页面的 production build 成功。

Batch 1 Shadow equivalence 继续证明 ResponsePlan、Dialogue State、formal state update、
Surface prompt 和 visible reply 等价；Batch 1.5 继续证明 production
`committedHelpingMoveWritten=false`。

## 5. Scope verification

本切片没有修改：

- Batch 2A Contract；
- production writer / ChatMessage transaction；
- `buildHillHelpingInput` 的 production 调用；
- Planner、Prompt、Surface、Validator；
- Memory retrieval、User Model、Initiative/proactive behavior；
- LLM provider 或 extraction；
- feature flags 或用户可见文案。

## 6. Remaining

- production/current-session DB loader 未实现；
- reaction candidates 与 `impactKnown` 未实现；
- atomic formal-write、retry/concurrency/delete lifecycle proof 未实现；
- Batch 2C 未创建或执行。

Batch 2B 通过只证明 fixture load/association 与隔离边界，不授权 production formal
Helping 写入、用户可见 Hill 行为、Batch 3、部署或 User Model 接入。
