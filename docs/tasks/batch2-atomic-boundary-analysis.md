# Batch 2 Atomic Boundary v1 — Architecture Analysis

## Problem

Batch 2A 已冻结 formal `CommittedHelpingMove` 的严格 metadata schema 与 parser，Batch
2B 已在 fixture-only 范围证明有界加载和 target-bound association，Batch 2C-A 已在
fixture-only、Shadow-only 范围证明 Reaction Assessment。生产普通流仍只提交 ordinary
Assistant metadata；不存在获授权的 formal Helping writer、production/DB loader、formal
reaction state 或 downstream consumer。

本切片需要单独冻结一个 docs-only **Batch 2D — Atomic Boundary Contract v1**，定义未来
formal Helping write 如果获批时必须满足的提交合同，但不得以合同冻结为由实现或启用该
write。合同必须回答：权威输入从哪里来；Assistant message、formal metadata 与 committed
execution 如何成为一个 winner-only 原子事件；retry/concurrency/rollback 如何 fail closed；
Guest 与 authenticated 如何保持逻辑同构；association/reaction 在 committed event 之后的
只读边界是什么。

## Evidence

- `PROJECT_TEAM.md` 的 Decisions/Remaining 明确：Batch 2A、2B、2C-A 已完成；production/DB
  loading、Atomic Boundary proof 和 formal Helping writes 均未实现，且没有当前授权。
- `HILL_HELPING_BATCH2A_COMMITTED_MOVE_METADATA_CONTRACT_V1.md` 固定
  `{schemaVersion: 1, state: "formal", move}`、严格 serializer/parser、formal/Shadow
  隔离，并规定 rejected、failed、unsent、retry loser 不得写入。当前 production writer
  仍只写 ordinary metadata。
- `hill-helping-batch2b-implementation-report-20260804.md` 证明 loader/association 仅为
  fixture、纯内存模块：要求 session/role/`assistantTurnId` identity 一致、唯一 committed
  order、唯一 target/relation；它没有 production consumer。
- `HILL_HELPING_BATCH2C_REACTION_ASSESSMENT_CONTRACT_V1.md` 固定 Reaction Assessment 为
  reaction-only、Shadow-only、fixture-only、zero downstream integration。Assessment 只能
  引用 immutable formal target，不得改写 `CommittedHelpingMove`，也不得进入
  `interactionMetadata`、formal persistence 或下一轮 Helping decision。
- `ARCHITECTURE_V1_FINAL.md` 规定 Interaction/Dialogue State 从 committed conversation
  events 和 committed Assistant metadata 重建；只有 successfully sent `hill_helping` reply
  可原子增加 `CommittedHelpingMove`，Shadow、legacy、rejected、failed、unsent 均不可。
- `HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md` 将 `CommittedHelpingMove` 定义为当前
  session 内 Assistant 实际执行并成功提交的助人行动记录；删除 session 时随会话失效，
  且不是 Memory 或 User Model。
- 当前 authenticated commit boundary `commitValidatedAssistantMessage` 以
  `replyToMessageId @unique` 和 `createMany(...skipDuplicates)` 竞争唯一 winner，并在同一
  Prisma transaction 中写 Assistant message、session summary 和 committed execution
  trace。它当前接收的 `interactionMetadata` 仍是 ordinary move，且 message id 只有插入后
  才确定，因此不能直接把 caller 构造的 formal move 当作已绑定 committed event。
- 当前 Guest boundary 以 `turnId -> Promise` 做进程内去重，成功后产生稳定
  `guest-ai-${turnId}` client-scoped committed event；它没有数据库 durability，也没有
  formal Helping metadata round-trip。Guest/Auth 目前只能要求逻辑语义对等，不能虚构
  durability 对等。
- 文档不存在阻塞性矛盾。Batch 2A 中“未来 Batch 2C 受控路径”是 2026-08-04 的旧前瞻
  编号；较新的 Batch 2C 合同和迁移计划明确把 Batch 2C 固定为 Reaction Assessment，并
  明示 Atomic Boundary 的编号应由独立决定冻结。因此该旧标签应在新合同中标注为已被
  Batch 2C 决定 supersede，而不改写历史文件。

## Root Cause

现有三个 Batch 2 子门分别证明了 **shape**、**fixture association** 和 **Shadow
reaction semantics**，但没有冻结从已验证 Hill plan 到唯一 committed formal event 的
authority chain。若直接接 production writer，会留下四个结构性缺口：

1. caller 可以在真实 Assistant message id 产生前提供任意 `CommittedHelpingMove`，造成
   `assistantTurnId`、plan、execution、final attempt 或用户轮错绑；
2. `replyToMessageId` 并发 loser 可能把自己的 formal metadata 归到另一个 winner，或在
   retry 时覆盖已提交历史；
3. message、formal metadata、execution `COMMITTED` 与 session update 若不在同一原子
   边界，会形成幽灵 move 或无 metadata 的半提交；
4. fixture association/reaction 若被提前接入同一提交路径，会把观察性 Shadow 结果误当
   成 write authority 或 formal lifecycle state。

因此 owning layer 是既有 Application/State Update commit boundary，而不是 Helping
decision、Reaction evaluator、Memory 或 Planner。需要先冻结 write contract，再另行授权
实现。

## Proposed Solution

冻结 `Batch 2D — Atomic Boundary Contract v1`，gate id 建议为
`B2-Formal-Atomic-Commit`。本次仅冻结合同与验收，不创建 writer。

### 1. 权威输入与资格

未来 writer 只可接受一个 detached、不可变、同轮 preflight bundle；它必须由现有
orchestration 的最终权威对象派生，而非由 API/client/serializer caller 自由拼装：

- authenticated `sessionId + userId`，或 Guest 的 client-scoped conversation identity；
- current User turn id，且等于 execution `turnId`/reply target；
- final `ResponsePlan`，其 `behaviorSource` 必须精确为 `hill_helping`；
- 对应的 final validated execution，phase 为 `VALIDATED`，final attempt 也是该 plan、该
  turn 的最终 winner attempt；
- 被最终 Surface 实际执行的 frozen Hill decision/plan projection；
- ordinary `CommittedAssistantMove` 与最终 reply content/status；
- generation/request/attempt identities。

`CommittedHelpingMove` 必须在 commit boundary 内从该 bundle 投影并经 Batch 2A
serializer 复核；caller 不得提交任意完整 formal move。`planId` 必须等于 frozen plan 与
execution plan id；`assistantTurnId` 必须绑定事务中真实创建/保留的 Assistant message
id。任何 Safety、ordinary、Shadow、legacy、fallback（除非未来合同另行证明它仍是原
Hill plan 的 validated realization）、null/deferred Hill plan、rejected/failed/unsent 或
非最终 attempt 均不具备 formal-write 资格。

### 2. 原子事务与 committed event

Authenticated winner 的一个数据库 transaction 必须形成不可分割事件：

1. 竞争并确认该 User turn 的唯一 Assistant reply winner；
2. 创建/确认真实 Assistant message id；
3. 用该 id 投影并严格序列化 ordinary + formal Helping metadata；
4. 将 metadata 固定到同一 Assistant message；
5. 把同一 generation/execution 标记为 `COMMITTED` 并绑定 committed message id；
6. 更新既有 session last-message projection。

任一步失败必须整体 rollback：message、formal metadata、committed execution、session
projection 全部为 0 个新状态。不得另建 `HelpingLifecycle`、session aggregate、Memory、
User Model 或 reaction row；权威 committed event 就是 session-scoped Assistant message
及其严格 formal metadata，生命周期由事件查询重建。删除 session 依靠既有 cascade
使 target 失效，不新增 tombstone/长期画像。

### 3. Winner、loser、幂等与并发

- winner key 继续以同一 current User turn 的唯一 Assistant reply 为根；同一 turn 最多
  一个 committed Assistant event，因而最多一个 formal Helping move。
- 只有实际插入并完成上述事务的 contender 是 writer winner。`skipDuplicates` 后读到
  existing message 的 contender 是 loser，绝不能把自己的 plan、generation、attempt 或
  formal metadata附着、覆盖或补写到 winner。
- 相同 commit identity 的网络重放可幂等返回原 winner；返回前必须精确核对 turn、session、
  user、message、plan、generation/attempt 和已存 formal metadata。任一不一致 fail closed，
  不把冲突伪装成成功。
- 同 plan id 不能替代 exact attempt/winner identity；不同 plan、不同 generation、晚到 retry
  或同时完成的 candidate 均不能 mutation 已提交历史。
- formal serializer failure、identity mismatch、unknown field、invalid Hill combination 或
  inability to establish exact winner 必须 abort 整个 formal commit，而不是降级为 ordinary
  successful commit。是否允许显式 ordinary fallback 是新的产品决策，不属于本合同。

### 4. Guest/Auth 边界

两条路径必须共享同一逻辑资格、projection、strict serialization、winner/loser、exact
identity 和 fail-closed 反例。差异只能是 durability mechanism：authenticated 使用 DB
transaction；Guest 使用当前 client-scoped committed event stream 与 turn-level singleflight。

Guest formal event 只有在 validated winner 完成且返回同一响应时才存在，并必须携带与
Auth 同构的 v1 formal metadata，供客户端历史 round-trip；失败 Promise 必须清除、retry
loser 不得产生第二 event。不得声称 Guest 有数据库原子性或跨进程 durability。若客户端
没有确认/保存该 event，则下一请求不能把它当作 authoritative formal target。

### 5. Loader、association 与 reaction 边界

- 本 gate 只定义 committed event 的 future write；不授权 production/DB loader。
- Batch 2B loader/association 只能在 commit 成功后的后续 User turn读取 strict
  `formal_v1` immutable target；不得参与当前 write 决策，也不得修补 metadata。
- Batch 2C-A Shadow assessment 只能引用已加载、已关联 target；它不能与 move 同事务
  写入，不能改变 move，不能成为下一 plan 或 formal-write authority。
- “reaction accepted/impact known”不是 commit 成功条件；没有 reaction 的 newly committed
  move 仍是完整 immutable event。
- production association、production Reaction runtime、formal reaction persistence 和任何
  downstream consumption 必须分别冻结并授权。

### 6. Fail-closed 反例与验收门

合同验收必须冻结一个小而按风险分类的 counterexample matrix，而非任意堆数量：

- **资格**：ordinary、Safety、Shadow、legacy、null/deferred、rejected、failed、unsent、
  non-final attempt、错误 behavior source 均写入 0；
- **identity**：turn/session/user/message/plan/generation/request/attempt 任一错绑或空值写入
  0；message id 必须与 `move.assistantTurnId` 精确相等；
- **并发**：同 turn 同 plan 重放仅一个 event；同 turn 不同 plan/generation/attempt 仅真实
  winner 存在，loser 对 winner 零 mutation；
- **rollback**：message insert 后 serializer、metadata update、execution update 或 session
  update 任一点故障，整个新 event 为 0；
- **strict schema**：unknown version/field、Shadow marker、非法 goal/intention/skill、空 evidence/
  expected/stop 条件均 abort；
- **删除**：session 删除后 formal event 不可再加载，不产生独立残留；
- **Guest/Auth**：相同逻辑 fixture 产生同构 metadata 和 exactly-one winner；Guest 明确只
  证明 client-scoped atomic publication；
- **隔离**：production writer/loader、reaction persistence、Planner/Prompt/Surface/Validator、
  Memory/User Model/Initiative 消费者仍为 0，用户可见回复与 flags 不变。

Docs-only freeze 的通过证据应包括：合同内部 exact-key/authority/transaction matrix 审查；
与 Batch 2A、2B、2C、Architecture v1、Product Contract 的静态一致性审查；变更清单只含
批准的文档；`git diff --check`。不得通过运行时测试声称 writer 已实现。

### 7. 明确不授权

本冻结不授权：runtime/schema/migration；production formal Helping write；production/DB
loader；production Reaction evaluator 或 formal reaction state；Planner、Prompt、Surface、
Validator、Initiative、Memory、Understanding、Relationship、User Model 接入；用户可见 Hill
行为；feature flag 默认开启；Batch 3；canary、部署或数据回填。

## Files To Change

合同冻结阶段唯一允许的权威合同文件：

- `docs/HILL_HELPING_BATCH2D_ATOMIC_BOUNDARY_CONTRACT_V1.md`（新增；唯一 normative
  contract）

为保持状态一致，可由后续 Developer 在同一 docs-only slice 最小更新以下直接台账；它们
不得复制完整合同或扩大授权：

- `PROJECT_TEAM.md`（active slice、decision、remaining、closure status）
- `docs/ARCHITECTURE_V1_FINAL.md`（Batch 2 状态直接段落与 State Update 边界）
- `docs/HILL_HELPING_PROCESS_ARCHITECTURE_MIGRATION_PLAN_V1.md`（Batch 2 当前状态、命名
  与未授权项）

分析阶段唯一写入为本文件。不得修改 `AGENTS.md`、PRD、产品合同、源码、tests、schema、
migrations 或 eval artifacts。若 Reviewer 认为台账无需同步，应缩小到合同文件，而不是新增
更多文档。

## Risks

- **术语误授权**：描述“formal production write contract”容易被误读成允许实施。合同首页、
  acceptance 与每个状态台账必须同时写明 docs-only、unimplemented、unauthorized。
- **旧编号漂移**：Batch 2A 的旧“future Batch 2C”标签可能误导。新合同应引用较新的显式
  supersession，不回写历史证据；Batch 2D 是本次独立冻结的新权威编号。
- **post-insert identity gap**：当前 message id 在插入后产生，而 formal move 要求预先携带
  `assistantTurnId`。未来实现必须在同一 transaction 内后绑定/更新或预生成真实 id；合同
  不应提前选择具体实现。
- **loser contamination**：当前 `skipDuplicates + find existing` 模式如果未经 exact identity
  区分，最容易让 loser 看起来 committed。实现门必须把 `created=false` 视为非 writer，只有
  exact idempotent replay 可读取 winner。
- **Guest durability overclaim**：进程内 Promise 去重不等于持久事务。逻辑同构可以冻结，
  跨进程/跨设备耐久性不能虚构；若产品要求该能力，需要另行架构决定。
- **fallback ambiguity**：现有 fallback status 可能来自原 plan 的降级 Surface，也可能不是
  Hill action。没有额外 provenance 前必须 fail closed；是否允许某类 fallback 写 formal 是
  后续产品/架构决定。
- **atomic scope creep**：judge records、Raw Memory 或 Reaction trace 不应被拉入 formal move
  原子事件。只有证明它们是 authoritative commit prerequisite 才可扩大事务；现有证据不支持。
- **contract/implementation drift**：当前 serializer 和 fixture loader可复用，但 production
  integration 明确不存在。冻结完成后仍必须停止；实现需由新切片重新冻结 baseline、affected
  files 和 executable gates。
