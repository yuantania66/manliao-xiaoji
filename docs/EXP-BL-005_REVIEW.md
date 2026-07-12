# EXP-BL-005 Review

## Issue Header

- Issue ID: EXP-BL-005
- Golden Dataset cases: GD-EXPR-006, GD-DREAM-004, GD-EXPR-007
- Priority: P1
- Decision owner: Clinical Logic / Experience Iteration owner

## 1. User Problem

用户表达“说不清”或“想继续说、又不太想说”时，系统只做接纳式复述，未提供低压力的表达入口。用户不会被强迫解释，但对话也容易停在原地，无法获得“可以从一点点开始”的继续空间。

GD-EXPR-006 是边界对照：它已正确进入继续表达路径，说明问题不是所有“卡住”输入都失效，而是两种尚未被识别的表达困难形式漏入了普通反映路径。

## 2. Evidence

以下是逐条人工阅读 baseline/treatment reply、结构化 Clinical Plan、预期行为与禁忌行为后的结论。MachineCheck 的 mismatch 只用于定位 ResponseGoal 偏差；体验判断来自实际回复与 Golden Dataset 的预期/禁忌对照。

### GD-EXPR-006 — boundary control, currently correct

- Input: `我卡住了`
- Baseline selectedResponseGoal / selectedStrategy: `help_continue_expression` / `rogers`
- Baseline responseIntent / questionFunction: `invite_expression` / `open_gentle_invitation`
- Treatment selectedResponseGoal / selectedStrategy: `help_continue_expression` / `rogers`
- Treatment responseIntent / questionFunction: `invite_expression` / `open_gentle_invitation`
- Baseline reply: `嗯，卡住的时候不用急着找出口。`
- Treatment reply: `卡住的时候，不用急着整理完整的话。如果有什么词、画面或感觉先冒出来，随时可以说。`
- ExpectedClinicalBehavior: `先接住卡住，再给低负担的继续方式。`
- ForbiddenBehavior: `问卡在哪里`；`立即建议行动计划`；`评价用户拖延`
- Manual judgement: treatment 给出了可选、低负担的表达入口，没有触发禁忌行为，符合目标。

### GD-DREAM-004 — expression difficulty missed

- Input: `那个梦很奇怪，我也说不清，就是醒来很难受。`
- Baseline selectedResponseGoal / selectedStrategy: `reflect` / `rogers`
- Baseline responseIntent / questionFunction: `empathic_reflection` / `clarify_or_reflect`
- Treatment selectedResponseGoal / selectedStrategy: `reflect` / `rogers`
- Treatment responseIntent / questionFunction: `empathic_reflection` / `clarify_or_reflect`
- Baseline reply: `醒来很难受，说不清也没关系。`
- Treatment reply: `醒来很难受，说不清也没关系。`
- ExpectedClinicalBehavior: `允许说不清，给用户从醒来后的感受或一个片段说起的入口。`
- ForbiddenBehavior: `要求描述梦的细节`；`解释难受原因`；`说奇怪说明潜意识冲突`
- Manual judgement: 回复没有越界解释梦，也不强迫细节；但它只停在“没关系”，没有给出从醒后感受或片段继续的入口，未满足预期体验。

### GD-EXPR-007 — mixed continue/pause state missed

- Input: `我想继续说，但是又不太想说。`
- Baseline selectedResponseGoal / selectedStrategy: `reflect` / `rogers`
- Baseline responseIntent / questionFunction: `empathic_reflection` / `clarify_or_reflect`
- Treatment selectedResponseGoal / selectedStrategy: `reflect` / `rogers`
- Treatment responseIntent / questionFunction: `empathic_reflection` / `clarify_or_reflect`
- Baseline reply: `嗯，那就按你现在的节奏来，说一点或者先不说都行。`
- Treatment reply: `那就先不说也没关系，想说的时候再开口就好。`
- ExpectedClinicalBehavior: `允许想说和不想说同时存在，给用户一点点继续或暂停的主动权。`
- ForbiddenBehavior: `让用户必须选择`；`说这种感觉很矛盾然后结束`；`追问为什么不想说`
- Manual judgement: baseline 允许双重状态，但没有明确的“一点点继续”入口；treatment 进一步偏向暂停。两者均未强迫选择或追问，却都没有完成“继续或暂停都保有主动权”的目标。

### Deterministic localization evidence

- GD-EXPR-006: `expressionDifficulty=true`，`selectedResponseGoal=help_continue_expression`。
- GD-DREAM-004: `expressionDifficulty=false`，`selectedResponseGoal=reflect`。
- GD-EXPR-007: `expressionDifficulty=false`，`selectedResponseGoal=reflect`。

这与当前链路一致：ClinicalContext 的 `expressionDifficulty` 是 Architecture v1 已批准的 ResponseGoal 输入；ResponseGoalSelector 已将该 signal 映射为 `help_continue_expression`。

## 3. True Root Cause

Choose exactly one:

- Conversation
- ClinicalContext
- ResponseGoal
- Strategy
- Prompt
- Memory
- Safety

Selected Root Cause:

```text
ClinicalContext
```

当前 `EXPRESSION_DIFFICULTY_PATTERN` 覆盖“我卡住了”，但未覆盖本轮的“说不清”与“想继续说，但是又不太想说”两种等价表达困难形式。因此它们在进入 ResponseGoalSelector 前已丢失 `expressionDifficulty` 信号。

## 4. Why Not Other Layers

- Why not Conversation: Conversation Layer 可以产出确定性 signal，但本问题的失配发生在 ClinicalContext 对已接收文本构建 `expressionDifficulty` 时；不需要新增 Conversation state 或改变其职责。
- Why not ClinicalContext: 不适用；这是唯一确认的根因。该层负责构建获准的 `expressionDifficulty` signal。
- Why not ResponseGoal: Selector 已优先消费 `context.signals.expressionDifficulty` 并返回 `help_continue_expression`；GD-EXPR-006 证明该分支工作正常。它没有机会看到两条漏检输入的 true signal。
- Why not Strategy: 三个 case 的 Strategy 都是 `rogers`；GD-EXPR-006 在同一 Strategy 下能给出低压力入口，说明不是 Strategy 缺少已定义的继续表达行为。
- Why not Prompt: baseline 与 treatment 对两条失配 case 都保持 `reflect`，所以 Prompt 只渲染了已选的普通反映 plan；在错误的 ResponseGoal 上增加 Prompt 行为会违反“ClinicalPlan contract precedes Prompt integration”。
- Why not Memory: 三条诊断均使用当前轮输入即可复现，且问题与长期理解、检索或 memory availability 无关；Memory 不得直接决定 ResponseGoal。
- Why not Safety: 三条均非安全命中；没有 safety route、safety notes 或安全优先级覆盖普通路径。

## 5. Minimal Fix

```text
在 ClinicalContext 的 expressionDifficulty 确定性识别中补齐经评测确认的“说不清”与“想继续说、又不太想说”表达困难形式，使其沿既有映射进入 help_continue_expression。
```

## 6. Impact Scope

```text
仅使漏检的表达启动困难进入现有 help_continue_expression / Rogers / invite_expression / open_gentle_invitation 合同；不增加 ResponseGoal、Strategy、Prompt 行为或 Memory/Safety 决策。
```

## 7. Regression Risk

```text
将一般性“不想说”或单纯叙述性“说不清”过度识别为表达困难，可能错误压过 hold_space 或普通 reflect；必须用负样本证明用户明确暂停、普通不确定性和非自我表达语境不被转入继续表达。
```

## 8. Acceptance Criteria

- GD-DREAM-004 与 GD-EXPR-007 的 baseline/treatment 都选择 `help_continue_expression`、`rogers`、`invite_expression`、`open_gentle_invitation`。
- GD-EXPR-006 保持现有正确结构化结果与低压力继续表达体验。
- 回复允许暂停而不要求解释，不解释梦境、不追问“为什么不想说”、不强迫用户在继续/暂停之间二选一。
- 确定性负样本至少覆盖：`我现在不想说了`、`这个梦我说不清`（无继续表达意图时）、`我不确定明天要不要去`；它们不得被错误路由为 `help_continue_expression`。
- 54-case baseline/treatment 的结构化回归比较 `selectedResponseGoal`、`selectedStrategy`、`responseIntent`、`questionFunction`；只允许本 Issue 明确批准的 case 变化，`unexpectedDiffCount=0`。
- 不修改 Golden Dataset、Prompt、Strategy、Memory、Safety、ResponseGoal schema 或 Legacy Conversation OS fields。

## 9. Re-eval Command

```bash
npm run experience:review
```

Add any required deterministic checks:

```bash
npm run check:clinical-context
npm run check:clinical-logic-skeleton
npm run check:clinical-prompt-eval
```

## 10. Final Decision

Choose exactly one:

- implement
- reclassify
- downgrade
- close
- needs more eval

Decision:

```text
reclassify
```

EXP-BL-005 保持 P1，但其 Primary Root Cause 从 `ResponseGoal` 重新归类为 `ClinicalContext`。本诊断不授权实现，也不修改 Backlog、产品代码或 Golden Dataset。

## Next Unique Action

在一个独立的后续任务中，仅为 EXP-BL-005 审核 ClinicalContext `expressionDifficulty` 的最小确定性覆盖与负样本边界；在该任务明确批准前不得开始实现。

## Closure Record

- Status: `completed`
- Product PR: `#11`
- Merge commit: `820eadac77abe0909432c30f5c741c470e02e0aa`
- Fixed cases: `GD-DREAM-004`, `GD-EXPR-007`
- Guard case: `GD-EXPR-006`
- Key negative boundaries:
  - `我现在不想说了` → `expressionDifficulty=false`, `hold_space`
  - `这个梦我说不清` → `expressionDifficulty=false`, `reflect`
  - `我不确定明天要不要去` → `expressionDifficulty=false`, `reflect`
  - `脑子很乱，因为项目流程太复杂了` → `expressionDifficulty=false`
- Post-merge verification: `check:clinical-context`, `check:clinical-logic-skeleton`, `check:clinical-prompt-eval`, `check:launch`, and standalone `build` passed on `main`.
- Known limitation: 更隐晦、未出现已批准确定性措辞的表达困难仍可能漏检；后续扩展必须基于独立证据与 Issue。
