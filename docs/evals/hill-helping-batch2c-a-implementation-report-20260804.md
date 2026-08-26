# Batch 2C-A Implementation Report

日期：2026-08-04
基线：`batch-2c-reaction-contract` / `88f1504482a70782079ce0e7d09f4c2feb20b578`
Gate：`B2-Reaction-Shadow`

## 1. 结论

Batch 2C-A fixture-only Reaction Shadow evaluator 已实现并通过完整工程门。

实现严格保持：

- reaction-only；
- observation-only；
- `mode=shadow`、`source=fixture`；
- zero production consumer；
- zero user-visible behavior change；
- zero downstream integration；
- zero formal reaction state。

本批次没有执行 Batch 2D。

## 2. 实现范围

### 2.1 Reaction schema parser

`services/helping/reactionAssessmentFixture.ts` 定义并严格解析：

- `ReactionEvidenceV1`；
- `ReactionCandidateV1`；
- `Batch2CReactionAssessmentV1`；
- fixture association envelope。

顶层与嵌套对象使用 exact-key 校验，拒绝 unknown field、unknown enum、空 identity、
空 evidence、非有限 confidence 与 `[0,1]` 之外的 confidence。任一 candidate 无效时，
整份 assessment fail closed，不静默删除坏项。

### 2.2 Binding 与 provenance

Evaluator 仅消费 Batch 2B 加载得到的 `LoadedFormalHelpingMove`，并要求：

1. session、message identity 与 `move.assistantTurnId` 唯一匹配；
2. association 的 target 与 formal target 一致；
3. associated plan id 与 formal move plan id 一致；
4. candidate、所有 evidence 与 provenance 都绑定 current user turn；
5. candidate、所有 evidence 与 provenance 都绑定同一 target Assistant turn；
6. candidate evidence 必须逐项存在于冻结 provenance allowlist；
7. relation/reaction 必须符合冻结兼容表。

纠正、拒绝、关系压力、暂停和要求不同帮助只能进入 `rejects_move`，不能由
`direct_response` 接受。纠正 assessment 不修改历史 `CommittedHelpingMove`。

### 2.3 Known derivation

- `reactionEvidenceKnown=true` 只来自当前 user turn 的 target-bound
  `supports_reaction | supports_impact` evidence；
- `impactKnown=true` 还必须存在 `supports_impact`；
- 任一 `counterevidence` 将 `impactKnown` 固定为 `false`；
- `topic_shift` 只能得到 `observed_non_impact`，`impactKnown=false`；
- `unclear` 两个 known 均为 `false`；
- known 不表示客观因果、技术成功或长期用户属性。

### 2.4 Fail-closed envelope

无 association、非唯一/跨 session/malformed formal target、source/target/relation 冲突、
未验证 provenance、坏 schema 或 evaluator failure 均输出：

```text
status = not_evaluable | invalid | failed
reactionCandidates = []
reactionEvidenceKnown = false
impactKnown = false
reasons.length > 0
```

## 3. Regression evidence

`npm run check:hill-helping-batch2c-a`：通过。

| 维度 | 结果 |
|---|---:|
| Semantic fixtures | 10 / 10 |
| Fail-closed counterexamples | 24 / 24 |
| Formal target binding | pass |
| Source user turn binding | pass |
| Evidence provenance | pass |
| `impactKnown` derivation | pass |
| Production downstream consumers | 0 |
| User-visible behavior changes | 0 |

Semantic fixtures 覆盖明确接受、行动结果、负面压力、用户纠正、明确无归因、新觉察、
因果反证、topic shift、unclear 与多个互补 reaction。

Fail-closed cases 覆盖 exact keys、nested evidence、confidence、formal target
session/identity/plan/uniqueness、source/target/provenance、association relation、
relation/reaction compatibility、空 candidate/provenance、counterevidence-only、
non-impact source 与 malformed input。

## 4. Independent review and repair

独立只读复核发现初始兼容表错误地允许纠正类 reaction 使用 `direct_response`，导致
两条 fixture false-green。一次局部修复完成：

- 收紧 `direct_response` 为探索、觉察、行动、结果和接受类 reaction；
- 将无归因纠正改为 `rejects_move`；
- 将多 candidate fixture 改为非冲突互补 reaction；
- 新增 direct-response correction fail-closed regression。

修复后窄门、TypeScript、ESLint 与完整工程门全部通过。

## 5. Baseline preservation

以下检查通过：

- `npx tsc --noEmit`；
- targeted ESLint：0 error / 0 warning；
- `git diff --check`；
- Batch 2A contract gate；
- Batch 2B fixture association gate；
- Conversation OS architecture；
- natural chat control；
- `npm run check:launch`。

完整门包含 Batch 1 / 1.5 preservation、AI orchestration、Conversation OS、Memory V2、
12 个 Prisma migrations、27 个 Miniapp JS 文件和 39-page production build，全部 exit 0。
全仓 lint 仅保留一条既有 `projectionRegistry.ts` unused warning，不属于本批次修改。

## 6. Isolation proof

- Evaluator 未从 `services/helping/index.ts` 导出；
- production TypeScript consumers = 0；
- 未导入或调用 Memory、User Model、Planner、Initiative、Prompt、Surface、Validator；
- 未使用 Prisma、database writer 或 `ChatMessage.interactionMetadata`；
- 未创建 production writer、formal reaction metadata 或 persistence path；
- package 只新增 regression check，并将其纳入 `check:launch`。

## 7. Remaining

Production Reaction Assessment runtime、formal reaction state、database persistence、
downstream integration、Atomic Boundary 与 Batch 2D 均未实现，也不在本批次授权范围内。
