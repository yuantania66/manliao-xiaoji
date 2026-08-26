# Hill 助人过程第三阶段计划验收报告

状态：通过

日期：2026-07-31

验收对象：

- [第三阶段架构迁移与分批实施计划 v1](../HILL_HELPING_PROCESS_ARCHITECTURE_MIGRATION_PLAN_V1.md)
- [第二阶段产品契约](../HILL_HELPING_PROCESS_PRODUCT_CONTRACT_V1.md)
- [第二阶段验收报告](./hill-helping-phase2-acceptance.md)

本报告验收的是架构迁移与分批实施计划，不表示运行代码已经实现 Hill 助人能力。

## 1. 验收结论

第三阶段计划通过。

计划已经能够在现有五层架构内实现第二阶段产品契约，并满足：

1. Helping Logic 在最终 Planner 之前完成 Hill 领域判断；
2. Response Planner 继续汇总唯一 `ResponsePlan`；
3. Shadow、旧兼容路径和正式 Hill 路径不会在同一轮形成双重行为来源；
4. 只有实际执行且成功发送的 Hill 回复才进入正式跨轮状态；
5. 反应评估可以定位相关的历史行动，不依赖物理相邻或“最后一条”；
6. Safety、直接义务、Grounding、用户边界和原子提交继续作为硬边界；
7. 探索、行动和领悟按风险分批启用，每批独立验收；
8. 生产 canary、灰度和部署仍需用户单独授权。

第三阶段通过后，下一步只允许进入“批次 0：文档与基线冻结”。

## 2. 首轮未通过项与修正

### 2.1 Shadow 失败与正式路径失败混用

观察：

- 原计划规定 Helping 失败终止普通生成，但批次 1—2 同时要求 Shadow 不改变
  基线回复。

风险：

- Shadow provider 失败会影响用户体验，导致 Shadow 不再是只读评估。

修正：

- 正式 Hill 行为来源失败时，仍终止当前普通生成且禁止静默 fallback；
- Shadow 失败只以 `status=failed` 写入独立 trace；
- Shadow 失败不改变当前已选定的普通或旧兼容回复。

结果：通过。

### 2.2 Shadow 计划可能污染正式助人状态

观察：

- 原批次 2 同时要求 Shadow 不改变回复，却要求提交
  `CommittedHelpingMove`。

风险：

- 系统可能记录一个从未真正执行的 Hill 技术，并在下一轮评估虚假的用户反应。

修正：

- Shadow trace 与正式行动状态完全分离；
- Shadow 或旧路径回复不得写入 `CommittedHelpingMove`；
- 正式提交从批次 3 开始，只记录实际由 `hill_helping` 控制并成功发送的回复。

结果：通过。

### 2.3 只保留最后一次行动无法支持真实语义关联

观察：

- 原输入只有 `lastCommittedHelpingMove`；
- 计划又要求用户显式回应较早行动时能够正确关联。

风险：

- 用户插入一个新话题后再回应较早建议，系统会把反应错配到最后一条回复。

修正：

- 输入改为有界的 `recentCommittedHelpingMoves`；
- 用户显式指向的较早行动必须进入候选，即使它不在普通最近窗口内；
- Helping Logic 负责判断语义相关性，Context Assembly 不预判技术效果。

结果：通过。

### 2.4 输入证据类型过宽

观察：

- `currentUserMaterial` 原为 `unknown`；
- 直接义务、用户边界和关系证据原为无来源字符串。

风险：

- 实现可以绕开证据合同，传入任意摘要或丢失用户话轮来源。

修正：

- 当前材料改为带来源、原文、语义证据、明确命题和直接问题的结构；
- 直接义务使用现有 `AnswerObligation`；
- 用户边界与关系证据必须保留来源话轮、原文和 evidence。

结果：通过。

### 2.5 “部分流量”可能被误解为生产授权

观察：

- 批次 3 原计划写“部分流量的用户可见行为来源”。

风险：

- 实施者可能把计划批准解释为允许生产 canary 或灰度。

修正：

- 能力批次默认仅在本地、测试或评估环境启用；
- 任何生产 canary、灰度或部署都需要用户单独授权。

结果：通过。

## 3. 架构硬门

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 五层边界 | 通过 | Helping 是现有 Clinical 层能力，不新增产品层 |
| 唯一最终计划 | 通过 | Planner 汇总一个 `ResponsePlan` |
| Hill 领域所有权 | 通过 | 适用性、反应、准备度、目标、意图和技术只由 Helping 决定 |
| Shadow 隔离 | 通过 | Shadow 不是行为来源，不进入 ResponsePlan 或正式状态 |
| 旧路径隔离 | 通过 | 同一轮禁止旧 Clinical 与 Hill 同时生效 |
| 失败语义 | 通过 | 正式失败终止；Shadow 失败只记录且不影响基线 |
| 状态真实性 | 通过 | 只有实际执行并成功发送的 Hill 行动可以提交 |
| 历史关联 | 通过 | 有界历史候选加显式较早目标，不局限最后一条 |
| 证据保真 | 通过 | 当前材料、义务、边界和关系证据均保留来源 |
| Safety | 通过 | Safety pre-gate 覆盖普通 Helping |
| 直接义务 | 通过 | Hill 计划不得删除或心理化明确问题 |
| Validator 边界 | 通过 | Validator 只能接受或拒绝，不能重规划 |
| 分批验收 | 通过 | 批次 0—7 均有目标、硬门和失败处理 |
| 领悟风险隔离 | 通过 | 准备度/提问与解释/差异拆为 5A、5B |
| 发布权限 | 通过 | 生产 canary、灰度和部署均需单独授权 |

## 4. 架构反例复核

计划中的 24 个旁路反例重新复核后全部在计划层得到唯一阻断点，包括：

- 快速 `not_applicable` 忽略当前助人话题；
- Safety 与普通 Helping 同时运行；
- 正式 Helping 失败后静默生成安慰话术；
- Shadow 失败改变基线回复；
- Shadow 计划写入正式状态；
- Planner、Surface 或 Validator 偷换 Hill 技术；
- 回复发送失败仍写入助人行动；
- 重试或并发生成重复行动；
- 话题切换被误判为技术效果；
- 较早相关行动被“只取最后一条”丢失；
- 用户否定的假设从普通 Planner 动作重新进入；
- 旧 Clinical 与 Hill 同轮生效；
- 功能开关关闭后旧元数据不可读；
- 质量通过但性能不达标仍直接发布。

这些是跨场景架构不变量，不是针对某句话增加的特殊逻辑。

## 5. 基线证据

第三阶段验收沿用并复核以下当前架构证据：

```text
npm run check:architecture-v1
npm run check:conversation-os-architecture
npm run check:conversation-os-control
npm run check:clinical-logic
npm run check:conversation-trajectories
```

结果：

- 全部通过；
- 当前生产普通聊天仍只有一个 Planner 和一个 `ResponsePlan`；
- Validator 不重规划；
- Conversation OS control 的 20 个既有反例通过；
- 当前 Clinical 仍是 Rogers/ResponseGoal 基线，证明 Hill 运行能力尚未实现；
- 当前 trajectory 检查只验证既有轨迹基础设施，不被误写成 Hill 体验已经通过。

文档链接、代码围栏、尾随空白检查通过。

## 6. 本阶段没有授权的内容

- 不授权运行代码修改；
- 不授权模型或 Prompt 改写；
- 不授权生产 canary、灰度或部署；
- 不授权小记、长期记忆和用户隔离改造；
- 不授权跨批次实施。

## 7. 阶段门结论

第三阶段没有剩余计划阻塞，验收通过。

允许的下一步只有：

> 执行批次 0，统一冲突文档、冻结现有聊天与性能基线，并提交批次 0 验收。

批次 0 通过之前，不允许进入批次 1 的运行代码实现。
