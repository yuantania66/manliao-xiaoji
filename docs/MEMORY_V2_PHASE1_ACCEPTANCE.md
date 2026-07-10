# Memory V2 Phase 1 Acceptance

## 1. Scope

本文档用于验收 Memory V2 Phase 1 最小闭环。

Phase 1 已建立：

```text
Chat / Note
  -> RawMemory
  -> RefinementJob
  -> RAW_CAPTURED worker
  -> RAW_TO_SEGMENTATION worker
  -> Evidence
  -> MemoryEvidenceLink
  -> SemanticMemory
  -> SemanticMemoryVersion
  -> currentVersionId
  -> V2 Retrieval
  -> StructuredRagContext adapter
  -> Response Context feature flag
```

Phase 1 不包含：

- TimelineEvent 生成。
- Relationship 生成。
- Understanding Continuity 版本化理解生成。
- Report。
- Assessment。
- LLM 语义提取。
- 默认开启 V2 response context。

## 2. Completed Capabilities

### 2.1 Conversation Capture

Status: 已完成

已将现有 ChatMessage 创建流程接入 RawMemory 写入：

- 用户聊天消息创建成功后写入 `RawMemory`。
- 助手回复消息创建成功后写入 `RawMemory`。
- 主动问候消息创建成功后写入 `RawMemory`。
- RawMemory 写入失败不阻断原聊天流程。

Notes 创建流程也已接入 RawMemory：

- 非草稿 Note 创建成功后写入 `RawMemory`。
- Draft Note 不进入 RawMemory。
- RawMemory 写入失败不阻断原 Note 创建流程。

### 2.2 Raw Data

Status: 已完成

已实现 Phase 1 RawMemory append-only 地基：

- `RawMemory` 正常业务只创建，不更新、不删除。
- `RawMemoryEvent` 记录生命周期事件。
- 删除、隐藏、脱敏通过 `RawMemoryEvent.TOMBSTONE` / `RawMemoryEvent.REDACTION` 表达。
- `userId + sourceType + sourceId + sourceRevision` 保证 ChatMessage / Note 到 RawMemory 的幂等写入。
- `RawMemory` 创建成功后幂等创建 `RefinementJob(RAW_CAPTURED)`。

注意：append-only 约束当前依赖服务层约束与验证脚本，数据库层尚未禁止所有直接 update/delete。

### 2.3 Async Semantic Refinement

Status: 部分完成

已实现异步 refinement 最小链路：

- `RAW_CAPTURED` job claim。
- `RAW_CAPTURED` worker 校验 RawMemory 存在。
- `RAW_CAPTURED` succeeded 后幂等创建 `RAW_TO_SEGMENTATION` job。
- `RAW_TO_SEGMENTATION` worker 读取 `RawMemory.payload`。
- 生成 deterministic segmentation metadata。
- 基于 segmentation metadata 创建 `Evidence(type=RAW_SEGMENTATION)`。
- 创建 `MemoryEvidenceLink`。
- 创建 `SemanticMemory(kind=RAW_SEGMENT)`。
- 创建 `SemanticMemoryVersion(version=1)`。
- 设置 `SemanticMemory.currentVersionId`。
- 所有这些步骤均不调用 LLM。

已实现 worker claim 语义：

- 只有 `status=PENDING` 的 job 可以被 claim 为 `RUNNING`。
- 同一个 pending job 连续 claim 两次只有一次成功。
- `SUCCEEDED` / `FAILED` 不重跑。
- `RUNNING` stale job 暂不自动重试。

未完成：

- Entity Extraction。
- Emotion Extraction。
- Event Extraction。
- Relationship Update。
- Timeline Update。
- Understanding Update。
- Index 独立构建。
- LLM 或规则化语义提取。

### 2.4 Evidence System

Status: 已完成 Phase 1 最小能力

已实现：

- `Evidence` 作为一等对象。
- `Evidence.sourceKind=RAW_MEMORY`。
- `Evidence.rawMemoryId` 指向 RawMemory。
- `Evidence.evidenceType=RAW_SEGMENTATION`。
- `MemoryEvidenceLink` 支持 `targetType`、`targetId`、`evidenceId`、`role`。
- Evidence 可链接到：
  - `RAW_SEGMENTATION`
  - `SEMANTIC_MEMORY`
  - `SEMANTIC_MEMORY_VERSION`
- `listEvidenceForTarget` 可通过 target 反查 Evidence。
- 同一 `rawMemoryId + evidenceType` 不重复创建 Evidence。
- 同一 `evidenceId + targetType + targetId + role` 不重复创建 Link。

### 2.5 SemanticMemory + Version

Status: 已完成 Phase 1 最小能力

已实现：

- 从 `RAW_SEGMENTATION` Evidence 创建 `SemanticMemory(kind=RAW_SEGMENT)`。
- `SemanticMemory.content` 来自 segmentation metadata。
- `SemanticMemory.confidence` 使用 deterministic 默认值。
- 创建 `SemanticMemoryVersion(version=1)`。
- `SemanticMemory.currentVersionId` 指向当前 version。
- SemanticMemory 和 SemanticMemoryVersion 均通过 `MemoryEvidenceLink` 关联 Evidence。
- `projectionEvidenceId` 保证同一个 evidenceId 不重复创建同一条 SemanticMemory 投影。

未完成：

- v2+ version 演进。
- 用户修正。
- 冲突证据。
- 置信度修正。
- VersionHistory 写入。

### 2.6 V2 Retrieval + Response Context Adapter

Status: 已完成，默认关闭

已实现：

- `retrieveMemoryV2ContextForUser`。
- `mapSemanticMemoryToStructuredRagContext`。
- 只读取：
  - `SemanticMemory.kind=RAW_SEGMENT`
  - `status in ACTIVE / USER_CORRECTED`
  - `currentVersionId != null`
- 映射到现有 `StructuredRagContext.recentMemories`。
- 使用 `currentVersionRecord.content`。
- V1/V2 去重规则：
  - 同一 `sourceType + sourceId` 优先 V2。
  - V2 有 Evidence 的优先级高于 V1 summary。
  - 有 currentVersion 的 V2 优先。

Response context 接入：

- `MEMORY_V2_RESPONSE_CONTEXT_ENABLED=false` 默认关闭。
- flag 关闭时不调用 V2 retrieval。
- flag 开启时将 V2 context 合并到 V1 `StructuredRagContext`。
- 不改 prompt 主结构。
- 不改 Clinical Logic。
- 不改 Safety。

## 3. PRD Phase 1 Roadmap Acceptance

| Roadmap Area | Status | Acceptance Notes |
|---|---|---|
| Conversation | 已完成 | ChatMessage / assistant message / proactive greeting / Note 已接入 RawMemory。实时回复仍走既有链路；V2 response context 默认关闭。 |
| Raw Data | 已完成 | RawMemory + RawMemoryEvent 已落地；Chat/Note 到 RawMemory 幂等；TOMBSTONE / REDACTION 事件可追加。 |
| Async Semantic Refinement | 部分完成 | 已跑通 RawMemory -> Job -> Segmentation -> Evidence -> SemanticMemoryVersion。尚未做 Entity / Emotion / Event / Relationship / Timeline / Understanding update。 |
| Timeline | 未完成 | Schema 已存在，但 Phase 1 未创建 TimelineEvent，也未建立 Timeline eligibility 或事件轴写入服务。下一阶段进入。 |
| Understanding Continuity | 未完成 | Schema 已存在，但 Phase 1 未创建 Understanding / UnderstandingVersion，也未实现理解修正、alternative hypothesis、history 演进。下一阶段进入。 |

## 4. Current Complete Data Flow

### 4.1 Chat Flow

```text
ChatMessage created
  -> createRawMemoryFromChatMessage
  -> RawMemory(kind=CONVERSATION_MESSAGE, sourceType=CHAT_MESSAGE)
  -> RawMemoryEvent(CREATED)
  -> RefinementJob(step=RAW_CAPTURED, status=PENDING)
  -> processPendingRefinementJobs / processRawCapturedJob
  -> claimPendingRefinementJob
  -> RAW_CAPTURED RUNNING
  -> validate RawMemory exists
  -> create RefinementJob(step=RAW_TO_SEGMENTATION, status=PENDING)
  -> RAW_CAPTURED SUCCEEDED
  -> processRawToSegmentationJob
  -> claimPendingRefinementJob
  -> RAW_TO_SEGMENTATION RUNNING
  -> read RawMemory.payload
  -> deterministic segmentation metadata
  -> Evidence(type=RAW_SEGMENTATION, sourceKind=RAW_MEMORY)
  -> MemoryEvidenceLink(targetType=RAW_SEGMENTATION)
  -> SemanticMemory(kind=RAW_SEGMENT)
  -> SemanticMemoryVersion(version=1)
  -> SemanticMemory.currentVersionId = SemanticMemoryVersion.id
  -> MemoryEvidenceLink(targetType=SEMANTIC_MEMORY)
  -> MemoryEvidenceLink(targetType=SEMANTIC_MEMORY_VERSION)
  -> RAW_TO_SEGMENTATION SUCCEEDED
  -> retrieveMemoryV2ContextForUser
  -> mapSemanticMemoryToStructuredRagContext
  -> maybeMergeMemoryV2ResponseContext
  -> StructuredRagContext when feature flag is enabled
```

### 4.2 Note Flow

```text
Note created with isDraft=false
  -> createRawMemoryFromNote
  -> RawMemory(kind=NOTE, sourceType=NOTE)
  -> RawMemoryEvent(CREATED)
  -> RefinementJob(step=RAW_CAPTURED, status=PENDING)
  -> same refinement chain as Chat Flow
```

Draft notes:

```text
Note(isDraft=true)
  -> no RawMemory
```

### 4.3 Response Context Flow

```text
buildStructuredRagContext
  -> V1 StructuredRagContext
  -> maybeMergeMemoryV2ResponseContext
      -> if MEMORY_V2_RESPONSE_CONTEXT_ENABLED != "true":
           return V1 context unchanged
      -> if MEMORY_V2_RESPONSE_CONTEXT_ENABLED == "true":
           retrieveMemoryV2ContextForUser
           map SemanticMemory current versions to StructuredRagContext
           dedupe V1/V2 by sourceType + sourceId
           return merged context
  -> createReviewedChatReply
```

## 5. Feature Flags

### MEMORY_V2_RESPONSE_CONTEXT_ENABLED

Default: `false`

Defined in:

- `.env.example`
- `services/memory/responseContextService.ts`

Behavior:

- `false` / unset: V2 retrieval is not called and V2 context is not injected.
- `true`: V2 retrieval is called and merged into V1 `StructuredRagContext`.

Current production safety posture:

- Default closed.
- Existing response behavior remains V1 unless explicitly enabled.

## 6. Verification Commands and Results

Last verification run:

```text
npx prisma validate
Result: passed

npx prisma generate
Result: passed

npm run check:memory-v2-raw
Result: passed

npm run check:memory-v2-refinement-job
Result: passed

npm run check:memory-v2-raw-worker
Result: passed

npm run check:memory-v2-retrieval
Result: passed

npm run check:memory-v2-response-context
Result: passed

npm run check:ai-base
Result: passed

npm run check:prisma
Result: passed

npx prisma migrate status
Result: database schema is up to date
```

Memory V2 check coverage:

- `check:memory-v2-raw`
  - ChatMessage -> RawMemory
  - Note -> RawMemory
  - duplicate RawMemory prevention
  - TOMBSTONE / REDACTION event append
- `check:memory-v2-refinement-job`
  - RawMemory -> RefinementJob
  - duplicate job prevention
  - claim semantics
  - succeeded / failed claim rejection
- `check:memory-v2-raw-worker`
  - pending RAW_CAPTURED -> succeeded
  - RAW_CAPTURED -> RAW_TO_SEGMENTATION
  - segmentation succeeded
  - Evidence creation
  - Evidence Link creation
  - SemanticMemory creation
  - SemanticMemoryVersion creation
  - currentVersionId correctness
  - duplicate Evidence / Link / SemanticMemory / Version prevention
  - missing RawMemory -> failed
  - RUNNING stale job skipped
- `check:memory-v2-retrieval`
  - SemanticMemory retrieval
  - StructuredRagContext mapping
  - currentVersion content use
  - V1/V2 dedupe
- `check:memory-v2-response-context`
  - flag=false does not call V2 retrieval
  - flag=false does not inject V2 context
  - flag=true injects V2 recentMemories
  - V1/V2 dedupe applies in response context

## 7. Known Risks

### 7.1 migrate dev shadow DB

`npx prisma migrate dev` fails in the current local database environment because the configured database user cannot create a shadow database.

Observed error:

```text
P3014: Prisma Migrate could not create the shadow database.
ERROR: permission denied to create database
```

Current workaround:

- Generate migration SQL with `npx prisma migrate diff`.
- Apply with `npx prisma migrate deploy`.

Risk:

- Developer workflow differs from standard `migrate dev`.
- Future migrations should either fix shadow DB permissions or continue documenting the diff/deploy workflow.

### 7.2 RUNNING stale job

Worker claim semantics are implemented, but stale `RUNNING` jobs are not automatically retried.

Current behavior:

- `PENDING` can be claimed.
- `SUCCEEDED` / `FAILED` are skipped.
- `RUNNING` is skipped.

Risk:

- If a worker crashes after claim and before terminal status, the job remains `RUNNING`.

Required future work:

- Add lease / heartbeat / timeout retry policy.
- Decide retry limits and failure escalation.

### 7.3 append-only relies on service layer

RawMemory and version rows are intended append-only.

Current protection:

- Business services only create RawMemory.
- Delete/redaction represented via RawMemoryEvent.
- Version rows are created as new records.
- Validation scripts cover normal service behavior.

Risk:

- Database does not yet prevent all direct update/delete paths.
- Prisma client can still update/delete rows if called outside approved services.

Required future work:

- Add stricter service boundaries.
- Consider database-level triggers, restricted grants, or audit checks before production hardening.

### 7.4 V2 context default closed

V2 response context is behind `MEMORY_V2_RESPONSE_CONTEXT_ENABLED=false`.

Risk:

- Phase 1 retrieval is verified but not active in default online behavior.
- Bugs may remain hidden until flag is enabled in a controlled environment.

Required future work:

- Enable in local/staging with trace comparison.
- Add prompt snapshot checks for flag=true before production rollout.

### 7.5 promptBuilder/chatSafety/aiService contain other uncommitted changes

The working tree contains unrelated uncommitted changes in:

- `services/ai/promptBuilder.ts`
- `services/ai/chatSafety.ts`
- `services/ai/aiService.ts`

These changes are outside the Memory V2 Phase 1 acceptance scope.

Risk:

- Chat behavior comparisons may be affected by those separate changes.
- Memory V2 feature flag validation should not be used as a full regression verdict for those files.

Current mitigation:

- `npm run check:ai-base` passes.
- Memory V2 response context integration does not modify prompt structure, Clinical Logic, or Safety.

## 8. Phase 1 Acceptance Summary

Phase 1 minimum closed loop is accepted as established:

```text
Chat / Note
  -> RawMemory
  -> RefinementJob
  -> Segmentation
  -> Evidence
  -> SemanticMemoryVersion
  -> V2 Retrieval
  -> Response Context behind feature flag
```

Acceptance status:

- Conversation: accepted.
- Raw Data: accepted.
- Async Semantic Refinement: accepted for deterministic minimal path; not accepted for full semantic pipeline.
- Timeline: not accepted; next phase.
- Understanding Continuity: not accepted; next phase.

## 9. Next Phase Boundary

Next phase should enter:

- Timeline.
- Understanding Continuity.

Next phase should not enter yet:

- Report.
- Assessment.

Recommended next engineering focus:

1. Define deterministic TimelineEvent eligibility.
2. Implement TimelineEvent write service with Evidence links and version rows.
3. Implement minimal Understanding + UnderstandingVersion service.
4. Connect Timeline / Understanding to V2 retrieval only after Evidence and currentVersion rules are enforced.
5. Keep Report and Assessment deferred until Timeline and Understanding Continuity are stable.
