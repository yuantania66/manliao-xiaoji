# Hill Helping Batch 0 Acceptance

状态：用户验收通过，停止在批次 0；未进入批次 1

日期：2026-07-31

范围：文档对齐、迁移前源码与真实运行基线、评估门冻结。没有修改运行代码、
Prompt、数据库、UI、生产配置或部署状态。

验收复核：2026-07-31 重新核对全部退出条件，复算原始基线，逐文件比较冻结源码，
重跑 24 个治理反例、文档完整性和完整 `check:launch`；结果全部通过。

## Completed

### 1. Product and architecture documents aligned

| Document | Batch 0 decision |
| --- | --- |
| `PRD_V1.md` | 明确慢聊是聊天、小记是记录；Hill 只属于慢聊聊天；每个普通非 Safety 话轮经过 Helping Logic |
| `ARCHITECTURE_V1_FINAL.md` | Helping Logic 拥有 Hill 领域决定；Response Planner 仍是唯一最终计划汇总者 |
| `CLINICAL_LOGIC_LAYER.md` | Hill 是批准目标；旧 Rogers、ResponseGoal 和 ClinicalPlan 仅是迁移兼容清单 |
| `RESPONSE_STRATEGY_ENGINE.md` | 退役为历史 UX 边界材料；禁止新增 Need Resolution 或并行计划系统 |
| `CONVERSATION_TRAJECTORY_EVAL_SPEC.md` | Hill 多轮轨迹成为过程质量主证据；Shadow 与正式状态隔离 |
| `CLINICAL_GOLDEN_DATASET_SPEC.md` | v1 冻结为 pre-Hill 单轮兼容证据，不作为 Hill 验收合同 |

文档现在共同描述同一个目标链路：

```text
Safety
  -> Context
  -> Interpretation
  -> Dialogue / Interaction State
  -> Helping Logic / HillHelpingDecision
  -> Response Planner / one ResponsePlan
  -> Surface
  -> same-plan Validator
  -> atomic commit
```

当前实现仍是 pre-Hill 可选 Rogers 路径。文档把它标记为迁移基线，没有把目标
能力误写成已经上线。

### 2. Reproducible pre-Hill source baseline frozen

- Git HEAD:
  `3e34257c392cce79afbd12bfe36a5fbdbe84ab6c`
- allowlisted runtime files: 66
- runtime fingerprint:
  `sha256:f2eb975f7cf51aca9cb70f12aa7211ec9c5c90ff55b27ede4118a46b6abace41`
- [runtime source archive](./hill-helping-batch0-runtime-source-20260731.tar.gz)
- archive SHA-256:
  `4a6c4a93abab2c581875d0ee7a929b457ad0c5d78ed980b6436c99881259aef2`

The archive uses an explicit source allowlist and excludes `.env`, `.git`,
dependencies and build output. Every archived file was compared byte-for-byte
with the current allowlisted runtime after all Batch 0 tests; no difference
was found.

### 3. Real official-entrypoint baseline frozen

The [raw baseline artifact](./hill-helping-batch0-current-raw-20260731.json)
records:

- `POST /api/chat/guest`;
- qwen / `qwen3.7-max`;
- Prompt `chat-response-plan-v21`;
- 4 episodes, 3 repeats, 12 episode runs, 18 Assistant turns;
- 18 committed, 0 failed;
- no evaluation adapter and no history adapter;
- artifact SHA-256:
  `efb3337a9bbb5a27d3405320fc86cf4abb8c7f906166ba615a339efad27e8328`.

Observed latency:

| Population | N | P50 | P95 | Mean |
| --- | ---: | ---: | ---: | ---: |
| all turns | 18 | 6541 ms | 10589 ms | 6901 ms |
| warm, first compile excluded | 17 | 6541 ms | 8259 ms | 6684 ms |

Existing calls average two per turn: one Turn Interpretation call and one
Surface call. Per-turn provider P95 is 1136 input tokens and 390 output tokens.

The performance, added-call, token, blind-review and hard-gate thresholds are
frozen in
[Hill Helping Batch 0 Baseline](./hill-helping-batch0-baseline.md) before any
Hill candidate output is generated.

## Evidence

### Full relevant regression

`npm run check:launch` exited 0. It completed:

- lint and prelaunch audit;
- AI base and orchestration;
- architecture v1;
- all Clinical checks;
- semantic evidence;
- conversation state and interaction;
- Conversation OS control and relational state;
- chat execution lifecycle;
- natural-chat, proactive-greeting and assistant-grounding control;
- grounding-leak and trajectory checks;
- Conversation OS architecture;
- all Memory V2 checks;
- understanding and AI-system evaluation;
- Prisma validation, client generation and migration status;
- miniapp JavaScript syntax;
- optimized Next.js production build.

The full run had no error. It retained three pre-existing non-blocking warnings:

- one unused `createStubProjection` lint warning in
  `services/memory/projection/projectionRegistry.ts`;
- two prelaunch-audit warnings that miniapp media test/seed button guards were
  not recognized.

These warnings are outside Batch 0's documentation/baseline scope and did not
cause the corresponding checks to fail.

### New counterexamples

Twenty-four new governance counterexamples were checked against the aligned
documents and frozen baseline: 24/24 passed. They include document-authority
drift, dirty-worktree identity, stale/replay evidence, secret leakage,
provider/model mismatch, cold-start omission, movable thresholds, Shadow reply
or state pollution, false production authorization, Safety averaging and
unconfirmed human-review fields.

The first consistency-check attempt used three exact single-line string
matches against wrapped Markdown and reported three false negatives. The
checker was corrected to accept whitespace wrapping; the substantive document
rules were unchanged. The corrected run passed 24/24.

### Current quality observation

Batch 0 is not a claim that the chat experience is already good:

- numeric multi-turn produced `收到。` in 9/9 turns;
- numeric single-turn produced `收到。` in 3/3 turns;
- all three emotional-statement runs immediately moved to a question;
- all three direct-challenge runs reframed toward the user's feeling and asked
  the user to locate what the Assistant had missed.

Observation: the current chain remains weak on low-information movement,
relationship repair and action—reaction—next-intention responsiveness.

Interpretation: this is consistent with the verified absence of Hill
applicability, typed goal/intention/skill and committed helping-move semantics.

Conclusion: the baseline is valid for migration comparison, but the current
chat quality has not passed the future user-visible Hill gate.

After Batch 0 acceptance, the user completed a separately keyed
[human blind review](./hill-helping-batch0-human-blind-result-20260731.md).
Current H0 received 6/12 absolute passes and failed the applicable Gate v0
quality thresholds. This strengthens the recorded quality limitation; it does
not change the Batch 0 documentation-and-baseline acceptance or authorize
user-visible behavior.

## Remaining

- No Hill runtime type, decision service or Shadow trace has been implemented.
- No `CommittedHelpingMove` or cross-turn reaction assessment has been added.
- No user-visible Hill behavior is enabled.
- No production traffic or deployment is authorized.
- 小记、长期记忆和用户隔离 remain separate backlog items.

The next unimplemented scope is Batch 1 only: typed Hill contract and isolated
Shadow Helping Decision with baseline-equivalent user-visible output.

## Blocking Reason

无。批次 0 的验收门已满足。

## Recommended Next Step

等待用户明确指令后，只进入批次 1 的结构化合同与 Shadow Helping Decision，
不提前进入跨轮提交或用户可见能力。
