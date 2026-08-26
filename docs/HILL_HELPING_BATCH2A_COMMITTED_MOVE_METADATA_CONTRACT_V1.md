# Batch 2A Committed Helping Move Metadata Contract v1

状态：`B2-Contract` 已冻结；仅授权 infrastructure-only，不启用用户可见 Hill 行为

日期：2026-08-04

## 1. 目的与范围

本合同冻结 `ChatMessage.interactionMetadata` 中可选 Helping action record 的 v1
结构、严格读写边界，以及 formal committed state 与 Hill Shadow trace 的隔离规则。

本切片只负责合同与 parser。它不实现历史 move loader、跨轮语义关联、
`impactKnown`、正式 Hill 生产写入或原子提交验收；这些仍分别属于 Batch 2B—2D。

## 2. 权威结构

现有 ordinary `CommittedAssistantMove` 字段保持不变。只有正式 Helping action
record 需要以下带版本的可选 metadata：

```ts
type FormalCommittedHelpingMoveMetadataV1 = {
  schemaVersion: 1
  state: "formal"
  move: CommittedHelpingMove
}

type CommittedAssistantMoveMetadata = CommittedAssistantMove & {
  helping?: FormalCommittedHelpingMoveMetadataV1
}
```

`CommittedHelpingMove` 继续使用产品合同冻结的字段：

```ts
type CommittedHelpingMove = {
  assistantTurnId: string
  planId: string
  primaryGoal?: "exploration" | "insight" | "action"
  supportingGoal?: "exploration" | "insight" | "action"
  relationshipPriority: "none" | "repair" | "process_current_relationship"
  intention: HillIntention
  primarySkill: HillSkill
  supportingSkill?: HillSkill
  assumptions: string[]
  evidence: string[]
  expectedUserResponse: string[]
  stopOrReassessWhen: string[]
}
```

v1 使用嵌套版本而不是改变现有 ordinary move 的字段布局，因此既有 JSON 字段和
当前会话生命周期仍可复用，不需要数据库迁移。

## 3. 严格 parser 合同

`parseCommittedAssistantMoveMetadata(value)` 只返回三类结果：

| 结果 | 条件 | 决策输入规则 |
|---|---|---|
| `absent` | `null` 或 `undefined` | 不产生 committed move |
| `valid / legacy_ordinary` | 严格符合既有 ordinary move，且没有 `helping` | 只投影 ordinary move；Helping 必须为 `null` |
| `valid / formal_v1` | ordinary move 与 v1 formal Helping metadata 均严格有效 | ordinary move 与 Helping move 分离返回 |
| `invalid` | 其他全部输入 | fail closed；不进入 Dialogue State 或 Helping 决策 |

严格校验包括：

- 顶层与每个嵌套对象拒绝未知字段；
- 拒绝未知 `schemaVersion`、未知 enum、错误类型和空 identity；
- formal Helping move 必须有非空 evidence、expected response 与 stop/reassess 条件；
- goal/intention/skill 必须与既有 Hill contract 相容；
- `relationshipPriority=repair` 时必须暂停 goal selection，并使用 repair intention/skill；
- serializer 必须先校验再 clone，不能靠 JSON 序列化静默删除未知字段；
- parser 的 `status/source/reasons` 是本边界的结构化 parse trace；调用者不得把
  invalid 结果降级伪装成 legacy 或 formal state。

## 4. Formal / Shadow 隔离

| 输入来源或形态 | 可成为 `formal_v1` | 可进入下一轮 Helping 决策 |
|---|---:|---:|
| 成功提交的正式 Hill action（未来 Batch 2C 受控路径） | 是 | 只有通过后续 loader/association gate 才可 |
| ordinary committed move | 否；只可为 `legacy_ordinary` | 否 |
| legacy compatibility reply | 否 | 否 |
| `HillHelpingShadowTrace` / `mode="shadow"` | 否 | 否 |
| `state="shadow"` 或 Shadow 字段伪装在 move 内 | 否 | 否 |
| unknown version / unknown fields / bad types | 否 | 否 |
| Validator rejected、failed、unsent 或 retry loser | 本切片不写入；Batch 2C 必须证明为 0 | 否 |

`state="formal"` 只能由 serializer 固定写出，调用方不能传入任意 state。Shadow trace
继续保存在独立 debug trace，不能复用本 metadata envelope。

## 5. 当前运行时边界

聊天历史装配已用严格 parser 替换对 `interactionMetadata` 的类型断言：

- valid ordinary projection 可继续进入现有 Conversation OS；
- absent/invalid metadata 被忽略；
- 即使读到合法 `formal_v1`，Batch 2A 也只把 ordinary projection 交给现有
  Conversation OS，不把 `parsed.helping` 接入当前决策；
- 当前 production writer 仍只写 ordinary metadata，正式 Helping 写入保持为 0。

因此本切片不改变 Planner、Prompt、Surface、Validator、Memory、用户可见文本或
feature-flag 默认值。

## 6. Batch 2A 验收门

`B2-Contract` 需要同时证明：

1. v1 formal metadata JSON round-trip；
2. legacy ordinary 可严格读取但不能携带 Helping state；
3. unknown version/field、坏类型、空关键字段和合同不相容组合 fail closed；
4. Shadow trace、Shadow state 与伪装字段不能解析为 formal；
5. parser 只向现有运行时投影 ordinary move，不注入 Helping 决策状态；
6. 相关 Conversation OS、Hill Shadow、Chat lifecycle 与架构回归通过。

通过 Batch 2A 只授权进入 Batch 2B Fixture Load and Association Gate；不自动授权
正式生产写入、Batch 3、默认开启、部署或 User Model 接入。
