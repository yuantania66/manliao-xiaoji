# P0 Current Baseline Provenance Manifest

## Source snapshot

- manifestVersion: `p0-current-baseline-manifest-v2`
- sourceHead: `890a030ee6047aab7e8cf515aa837fd35f6ab8f0`
- sourceBranch: `codex/planner-handoff-migration`
- trackedModifiedPaths: `67`
- untrackedLeafFiles: `43`
- totalLeafChanges: `110`
- trackedAdditions: `8646`
- trackedDeletions: `1398`
- sourceStatusHash: `d1fb818575bfeb6f48fb72651f956a3e55fbe4e8c2a538d377e925fd39c57879`
- sourceTrackedBinaryDiffHash: `01db55eb2c030d9f5c6d81bf28cc3db59e769b8026566dad74903b8d25680edc`
- candidateBranch: `codex/p0-current-baseline-20260824`
- candidateWorktree: `/private/tmp/xinqing-p0-current-baseline-20260824`

本 manifest 与 `.project-team/ACTIVE_SLICE.md` 的 P0 mission-card 是 snapshot 后治理元数据，不属于上面的 payload hash。原工作树不得 reset、checkout、stash、clean 或批量重写。

## Classification rules

- `sealed/include`：有最终 gate 与独立复核证据；仅在依赖闭包完整时进入候选。
- `failed_open/exclude`：历史失败或仍开放；不进入候选。
- `unknown/exclude`：缺少最终封存证据或 whole-file 同时表达已冻结目标与未实现 runtime；保守排除，不删除也不否定未来权威。
- 共享 tracked 文件必须细分到 hunk/dependency group；不得因为文件内存在 sealed 工作而整文件纳入。

## Whole-file groups

| Path / group | Slice | Status | Selection | Evidence / dependency |
|---|---|---|---|---|
| `lib/chat-turn-result-authority.ts`; `scripts/chat-turn-result-authority-check.ts` | Chat Turn-scoped Execution Authority | sealed | include | `.project-team/EVIDENCE.md` turn-scoped closure；仍需 client integration hunks |
| `lib/client-turn-id.ts`; `scripts/client-turn-id-check.ts` | Chat Turn-scoped Execution Authority | sealed | include | 同上；仍需 client integration hunks |
| `scripts/late-contradiction-authority.ts`; `scripts/late-contradiction-authority-check.ts` | Late-Contradiction Authority v1 | sealed | include | `.project-team/EVIDENCE.md` Sealed；eval-only group |
| `services/ai/plannedFunctionSemanticValidator.ts`; `scripts/planned-function-semantic-validator-check.ts`; `scripts/planned-function-semantic-qwen-eval.ts` | Planned Function + Guest Validator Authority | sealed | include | 41/41 + Independent Reviewer PASS；仍需 production integration hunks |
| `scripts/chat-safety-semantic-check.ts`; `scripts/safety-semantic-qwen-eval.ts` | Safety Subject-Ownership Closure | sealed | include | 22/22 + engineering/Safety reviews；仍需 `chatSafety` group |
| `services/memory/episodeSummaryService.ts`; `scripts/conversation-episode-memory-loop-check.ts`; Episode migration | Conversation Episode Memory Loop | sealed | include only as atomic dependency group | 必须连同 schema、Context、Planner、orchestration hunks |
| `docs/HOT_COLD_PATH_V1_CONTRACT.md`; `docs/composer-shadow-v1.md` | Hot/Cold + Composer Shadow contract freeze | sealed contract-only | include | 合同封存，不表示 P1 runtime 已实现 |
| `docs/CONVERSATION_PURPOSE_CONTRACT_V1.md`; `docs/tasks/conversation-purpose-implementation-analysis.md` | Conversation Purpose | unknown / runtime unimplemented | exclude | 当前切片 Non-goal；合同目标保留在来源树与 Remaining，不升级为本次 current baseline |
| `codex-skills/`; `docs/AGENCY_AGENTS_ADAPTATION.md` | Team tooling/adaptation | unknown | exclude | 无产品 baseline 封存 gate |
| `miniprogram-project/config/api.js` | Mini Program environment default | unknown | exclude | develop 默认 LAN 变更无切片归属 |

## Pending shared-hunk groups

以下路径不得整文件导入，必须在继续前完成 hunk ownership 与依赖闭包：

- `conversation-os/control/responsePlanner.ts`
- `conversation-os/control/types.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/responsePlanValidator.ts`
- `services/ai/chatOrchestrationService.ts`
- `services/ai/chatExecutionLifecycle.ts`
- `services/ai/chatSafety.ts`
- `services/ai/interactionMoveHandoffOutputValidator.ts`
- `app/chat/chat-client.tsx`
- `prisma/schema.prisma`
- `package.json`
- `.project-team/*` 与跨切片架构文档

候选构造顺序为：whole-file sealed exclusive artifacts → shared hunk provenance → dependency audit → narrow gates → static/build → launch → existing real gates → independent review。

## Current stop boundary

候选已从 exact `890a030` 建立，并只机械加入六个无共享依赖的 sealed exclusive 文件：turn-result authority、client turn id 与 Late-Contradiction eval-only authority 的实现/专项 checks。尚未提交、未运行候选 release gate，也未导入任何 shared hunk。

第一处不可由工程侧自行裁定的 shared dependency 是 Ordinary Chat Quality Hard/Advisory 组：

- `services/ai/responsePlanValidator.ts` 同一 winner-selection flow 同时包含 sealed canonical Planned Function 接入和未独立封存的 advisory-only commit eligibility；
- `conversation-os/control/types.ts` 的 severity ABI 同时被 sealed Guest preservation 与 unknown broad reclassification 消费；
- `conversation-os/interactionMoveEnvelope.ts` 的 advisory result 会改变 committed `fulfills` edge 是否存在；
- `services/ai/proactiveGreeting.ts` 把 sealed structured greeting 与未独立封存的 proactive advisory acceptance 混在同一 attempt flow。

`docs/tasks/ordinary-chat-quality-gate-reclassification-analysis.md` 仍是 proposed solution，没有对应的最终独立 seal。把该组直接纳入会升级未知 winner policy；直接拆除又会改变已封存能力的依赖与提交语义。按 P0 Stop Condition，下一步必须单独授权依赖解耦，或由产品权威确认整组已封存；在此之前不得继续导入 shared hunks。

### Authorized dependency decoupling result

用户授权选择依赖解耦。候选保留 canonical Planned Function 与精确 continuation advisory preservation，但把 broad deterministic quality reasons、proactive semantic quality 与 duplicate-text acceptance恢复为 hard；`complete_reciprocal_contact` 不再进入 advisory envelope omission。对应 Natural Chat 回归已改为证明这些 unknown quality reasons 不具备 winner authority。

通过：Planned Function semantic、handoff Surface、Proactive structured、Safety semantic、turn/client authority、Natural Chat、TypeScript no-emit、diff check。Episode 专项仅因 `localhost:5432` 不可达未运行完成。

完整 launch 首轮在 stale Clinical source assertion 处失败；该断言改为识别已 sealed Plan Preflight Recovery 的 `const plan = createResponsePlan` 后专项通过。第二轮 launch 到达 `check:hill-helping-batch1` 后停止。该 Helping preservation assertion 在来源工作树和候选均复现 provider call `0 !== 1`；候选针对同一门的两轮输入/上下文 repair 仍为 0，失败改动已恢复到来源原样。按 round budget 不再改变此 gate。

用户已裁决以当前 deterministic fast-boundary 为新合同，不修改 Helping runtime。候选 `hill-helping-batch1-check` 现按 version `hill_helping_fast_boundary_preservation_v1` / SHA-256 `179982abcdfe97480f763b9754397798d4217e9fe1260468197c7dc171532691` 验证：fast-boundary turn provider/prompt 均为 0；20 个相同短输入在 established Helping frame 中逐案 provider exact 1；Safety 仍 0，Planner/Surface/Validator 不取得 Helping ownership，Shadow on/off 的 plan/state/prompt/reply 等价。

完整 launch 曾越过重冻后的 Batch 1，随后暴露一组来源树也存在的旧 fixture 漂移。候选只做依赖兼容迁移：Batch 1.5 的 ordinary orchestration fixtures 显式注入 strict no-risk Safety provider；普通质量 preservation 改为 hard reject；execution lifecycle 不再把 hard failure 包装成 advisory winner；envelope advisory fixture 改用仍获授权的 `continue_user_introduced_content`；架构门显式登记并约束已封存的 Safety Semantic 与 Episode Summary 唯一模型调用点。未修改 Helping、Safety、Planner、Validator、Episode runtime 或产品合同。

隔离数据库 `/private/tmp/xinqing-night-pgdata-20260825` 使用本地 PostgreSQL 16 和合成库 `xinqing_night_test`；13 个现有迁移全部应用。完整发布链的所有组成门均已通过，包含 lifecycle、Memory V2、Prisma schema/migration status、Miniapp syntax 与 Next production build；`check:conversation-episode-memory-loop` 也在同一隔离库 PASS。仅保留既有 lint warning `projectionRegistry.ts:createStubProjection`，无 lint error。

既有真实 Qwen 外门均已运行：Planned Function 41/41、Safety 22/22、Handoff Turn Interpretation 10/10、Handoff Surface、Proactive Move 与 Handoff structured-output 均 PASS。structured-output 首轮 `mixed_pressure` 以 `binding_mismatch` fail closed，完全相同冻结输入复验返回预期 function/policy rejection 并整门 PASS；未修改 Prompt、case 或 Validator。Independent Reviewer 对候选范围、Hard/Advisory、fixture compatibility、架构白名单和本地门给出 PASS。

P0 现在只待用户明确授权后的精确 Git stage/commit。候选未跟踪 `node_modules` 必须排除，不得使用无选择的 `git add -A`；提交前再次执行 staged path audit 与 `git diff --cached --check`。完成前不得描述为最终 Git seal。
