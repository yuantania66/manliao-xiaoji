# Batch 2D Atomic Boundary Contract v1

状态：`B2-Formal-Atomic-Commit` 已完成 **docs-only 合同冻结**；writer、runtime、schema、
migration、production/DB loader 与 formal Helping production write 均未实现、未授权

日期：2026-08-05

## 1. 目的、权威名称与实现状态

本合同冻结未来 formal `CommittedHelpingMove` write 获得单独实施授权后必须满足的
authority、identity、atomicity、winner、retry、rollback 和 Guest/Auth parity 边界。
它建立在 Batch 2A strict formal metadata、Batch 2B fixture-only association 和 Batch
2C-A fixture-only Reaction Shadow evidence 之上，但不把任何一项接入 production。

本切片的权威名称是：

> **Batch 2D — Atomic Boundary Contract v1**

验收门标识是：

```text
B2-Formal-Atomic-Commit
```

本次通过只表示合同已冻结。它不表示 atomic writer 已实现或通过 executable gate，也不
授权 formal production write。早期 Batch 2A 中“未来 Batch 2C 受控路径”的前瞻编号已被
后续 Batch 2C Reaction Assessment 决定 supersede；历史文件保持不改写，Atomic Boundary
现在由本合同权威命名为 Batch 2D。

## 2. 权威 detached 输入与 formal-write 资格

未来 writer 只能接受同一话轮的 detached、不可变、最终 validated preflight bundle。
该 bundle 必须由 orchestration 的最终权威对象派生，API、client 或 serializer caller
不得自由拼装完整 `CommittedHelpingMove`。它至少精确绑定：

- authenticated `sessionId + userId`，或 Guest client-scoped conversation identity；
- current User turn id，且与 execution `turnId` 和 reply target 相同；
- final `ResponsePlan`，且 `behaviorSource` 精确为 `hill_helping`；
- phase 为 `VALIDATED` 的 final execution，以及该 plan、该 turn 的 final winner attempt；
- 最终 Surface 实际执行的 frozen Hill decision/plan projection；
- ordinary `CommittedAssistantMove`、最终 reply content 与成功状态；
- generation、request 与 attempt identities。

`planId` 必须同时等于 frozen plan 和 execution 的 plan id。formal move 必须在 commit
boundary 内从该 bundle 投影，并通过 Batch 2A strict serializer 复核。caller 不能提交
任意完整 formal move，尤其不能预先声称尚未创建的 Assistant message id。

以下输入一律不具备 formal-write 资格，写入为 0：Safety、ordinary、Shadow、legacy、
null/deferred Hill plan、rejected、failed、unsent、非 final attempt，以及没有额外权威
provenance 能证明仍为原 validated Hill plan realization 的 fallback。

## 3. Authenticated winner-only 原子事件

authenticated 路径中，只有真实 transaction winner 可以提交 formal event。一个数据库
transaction 必须不可分割地完成：

1. 竞争并确认 current User turn 的唯一 Assistant reply winner；
2. 创建或确认该 winner 的真实 Assistant message id；
3. 在 transaction 内用该真实 id 投影 `CommittedHelpingMove`，使
   `move.assistantTurnId` 与 message id 精确相等；
4. strict serialize ordinary + formal Helping metadata，并固定到同一 Assistant message；
5. 将同一 generation/execution 标记为 `COMMITTED`，绑定同一 committed message id；
6. 更新既有 session last-message projection。

本合同不预选“插入后更新”或“预生成 id”等具体实现。无论实现机制为何，真实 id 绑定、
metadata、execution 和 session projection 必须处在同一 transaction 内。

任一步失败必须整体 rollback：不得留下新 Assistant message、formal metadata、committed
execution 或 session projection。不得新增 `HelpingLifecycle`、session aggregate、reaction
row、Memory、User Model、tombstone 或长期画像。权威 lifecycle 只能从 session-scoped
Assistant committed event 及其 strict formal metadata 纯查询重建；session 删除沿用既有
cascade，使该 event 不可再加载。

## 4. Winner、loser、幂等与并发

- winner key 以同一 current User turn 的唯一 Assistant reply 为根；同一 turn 最多一个
  committed Assistant event，因而最多一个 formal Helping move。
- 只有实际创建并完成整个 transaction 的 contender 是 writer winner。唯一键竞争后读取
  existing message 的 contender 是 loser，不能附着、覆盖、补写或改变 winner metadata。
- exact commit identity 的网络重放可以幂等返回原 winner，但返回前必须精确核对 turn、
  session、user、message、plan、generation、request/attempt 与已存 formal metadata。
- `planId` 相同不能替代 exact attempt/winner identity。不同 plan、generation、attempt、
  晚到 retry 或并发 candidate 均不得 mutation 已提交历史。
- serializer failure、unknown field、invalid Hill combination、identity mismatch 或不能确认
  exact winner 时，整个 formal commit 必须 fail closed。

禁止把 formal commit 失败静默降级成 successful ordinary commit。是否允许任何显式
ordinary fallback 是新的产品决策，不在本合同内，也不由本冻结授权。

## 5. Guest/Auth 逻辑同构边界

Guest 与 authenticated 必须共享相同的资格、projection、strict serialization、
winner/loser、exact identity 和 fail-closed 语义。差异只允许存在于 durability mechanism：

- authenticated 使用数据库 transaction；
- Guest 使用现有 client-scoped committed event stream 与 turn-level singleflight。

Guest formal event 只有在 validated winner 完成且与同一响应一起发布时才存在，并必须
携带与 Auth 同构的 v1 formal metadata，供 client history round-trip。失败 Promise 必须
清除；retry loser 不得产生第二个 event。客户端未确认或未保存该 event 时，下一请求不得
把它作为 authoritative formal target。

本合同只要求 Guest **client-scoped logical atomic publication**，不声称数据库原子性、
跨进程、跨设备或持久 durability 与 authenticated 相等。

## 6. Post-commit loader、association 与 reaction 边界

formal committed event 完成后，后续能力仍保持只读、分门授权：

- 本 gate 不授权 production/DB loader；
- Batch 2B loader/association 只能在 commit 成功后的后续 User turn 读取 immutable strict
  `formal_v1` target，不得参与当前 write authority、选择 winner 或修补 metadata；
- Batch 2C-A Reaction Assessment 只能引用已加载、已关联 target；不得与 move 同事务写入，
  不得修改 move，也不得成为下一 plan 或 formal-write authority；
- reaction accepted、`impactKnown` 或 technique success 均不是 commit 成功前置条件；没有
  reaction 的 newly committed move 仍是完整 immutable event。

production association、production Reaction runtime、formal reaction persistence 与任何
downstream consumption 都必须分别冻结并授权。

## 7. Fail-closed 分类矩阵

| 风险类 | 必须证明的反例 | 冻结结果 |
|---|---|---|
| 资格 | ordinary、Safety、Shadow、legacy、null/deferred、rejected、failed、unsent、non-final attempt、错误 behavior source | formal write 为 0 |
| identity | turn/session/user/message/plan/generation/request/attempt 任一错绑或空值 | 整体 abort；message id 必须等于 `move.assistantTurnId` |
| 并发 | 同 turn 同 identity 重放；同 turn 不同 plan/generation/attempt 并发 | exactly one winner；loser 对 winner 零 mutation |
| rollback | message insert 后 serializer、metadata、execution 或 session update 任一点故障 | 全部新状态为 0 |
| strict schema | unknown version/field、Shadow marker、非法 goal/intention/skill、空 evidence/expected/stop 条件 | 整体 abort |
| 删除 | session 删除后再次加载 target | formal event 不可加载，无独立残留 |
| Guest/Auth | 相同逻辑 bundle 与并发/retry fixture | metadata 同构、exactly one winner；Guest 仅证明 client-scoped publication |
| 隔离 | writer/loader/reaction/downstream runtime 搜索与变更清单 | production integration 为 0，用户可见回复与 flags 不变 |

未来实现 gate 必须按上述不同风险分类提供可执行证据，不以任意固定数量替代覆盖。

## 8. 本 docs-only freeze 的验收

`B2-Formal-Atomic-Commit` 当前 docs-only freeze 只需证明：

1. authority、exact-key、transaction 与 fail-closed matrix 内部一致；
2. 与 Batch 2A、2B、2C、Architecture v1 和 Hill 产品合同静态一致；
3. Batch 2A 的旧 Batch 2C 前瞻标签被明确 supersede，但历史文件未被改写；
4. 变更清单仅包含本合同和批准的直接状态台账；
5. `git diff --check` 通过。

不得用本次文档检查声称 writer、production loader、reaction runtime、formal persistence
或任何用户可见能力已经实现。

## 9. 明确不授权

本冻结不授权：runtime、schema、migration；production formal Helping write；production/DB
loader；production Reaction evaluator 或 formal reaction state；Planner、Prompt、Surface、
Validator、Initiative、Memory、Understanding、Relationship、User Model 接入；用户可见 Hill
行为；feature flag 默认开启；Batch 3；canary、部署或数据回填。

任何实现必须作为新的独立切片重新冻结 baseline、affected files 与 executable gates；
不得从本 docs-only 合同继承写入或上线授权。
