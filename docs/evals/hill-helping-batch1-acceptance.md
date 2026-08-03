# Hill Helping Batch 1 Acceptance

状态：2026-08-01 技术验收通过；未进入批次 1.5

日期：2026-08-01

范围：类型化 Hill 合同、当前会话输入构建、结构化 Shadow 决策、严格校验、失败
语义、独立 trace、功能开关和架构/回归验收。没有修改用户可见回复，没有启用
`CommittedHelpingMove`，没有进入普通聊天交接或用户可见 Hill 能力。

## Acceptance Conclusion

结论：**通过批次 1 技术验收**。

所有冻结硬门均通过；未发现双重 Hill 决定、Safety 旁路调用、Shadow 结果进入
`ResponsePlan` / Surface / 正式状态、提前写入 `CommittedHelpingMove`，或提前实现
批次 1.5、2、3 的路径。批次 1 只建立可信的结构化 Shadow 决策基础，不宣称当前
用户可见聊天体验已经改善。

## Completed

### 1. Approved runtime position implemented

普通非 Safety 路径现在可以在开关开启时执行：

```text
Safety
  -> Context Assembly
  -> Turn Interpretation
  -> Dialogue / Interaction State
  -> Build HillHelpingInput
  -> Helping Logic Shadow
  -> existing Response Planner
  -> unchanged one ResponsePlan
  -> unchanged Surface / Validator / commit
```

Safety 命中时不构建或调用普通 Helping 决策。Helping 只有一个调用点，位于最终
Planner 之前；Planner、Surface、Validator 都没有调用或选择 Hill 目标与技术。

### 2. Frozen Hill contract implemented

新增合同覆盖：

- `applicable / uncertain / not_applicable`；
- 探索、领悟、行动三类流动目标；
- 产品合同冻结的全部意图和技术枚举；
- readiness、关系优先级、反应候选、预期反应、重新评估条件；
- Helper Self Check；
- `invalid_input / invalid_plan / provider_failure / timeout`；
- 当前会话内的 `CommittedHelpingMove` 类型，但批次 1 不加载、不写入。

严格校验拒绝未知字段、缺失必填字段、目标—意图—技术不一致、修复与其他目标并行、
以及与 `no_advice / no_analysis / no_questions / pause / stop` 冲突的计划。

### 3. Context-sensitive fast boundary implemented

- 没有已建立话题的单字、数字、表情或碎片：`uncertain`；
- 没有已建立助人话题的确定性身份、能力和词义问题：`not_applicable`；
- 一旦存在已提交 Assistant Move、回答框架、较早共同材料或助人行动候选，短输入
  不再按表面形式快速路由，而是进入完整领域判断；
- Helping Logic 不输出普通聊天动作。

### 4. Shadow isolation implemented

`HILL_HELPING_SHADOW` 默认 `false`。开启后允许的新增内容只有：

- 独立 `HillHelpingShadowTrace`；
- 至多一次结构化 provider 调用及其耗时、token 和显式失败记录。

Shadow 结果不进入：

- `ResponsePlan`；
- Surface prompt；
- `DialogueState` 或正式 State Update；
- Assistant 消息的 interaction metadata；
- `CommittedHelpingMove`；
- Memory。

## Evidence

### Batch 1专项检查

`npm run check:hill-helping-batch1`：通过。

结果：

- 6 个合法合同族：6/6；
- 无效合同反例：24/24 被拒绝；
- 同一表面形式、不同上下文配对：20 组、40 个话轮全部通过；
- held-out 配对：`啊 / 哦 / 哈 / 7 / 9` 全部通过；
- 用户边界冲突反例：5/5 被拒绝；
- Safety 下 Helping provider 调用：0；
- `invalid_input / invalid_plan / provider_failure / timeout` 均保持显式失败，未伪装成
  `not_applicable`；
- Shadow 开/关的 `ResponsePlan`、`DialogueState`、正式 State Update、Surface prompt
  和可见回复完全相同；
- Helping provider 每个非快速话轮只调用一次。

### Architecture and regression evidence

以下已单独通过：

```text
npx tsc --noEmit
npx eslint services/helping services/ai/chatOrchestrationService.ts \
  services/ai/debugTrace.ts services/ai/types.ts \
  scripts/hill-helping-batch1-check.ts
npm run check:ai-orchestration
npm run check:architecture-v1
npm run check:conversation-os-control
npm run check:conversation-os-architecture
git diff --check
```

第一次完整 `npm run check:launch` 在 `check:conversation-os-architecture` 停止，因为
旧检查把聊天模型调用硬编码为仅 Turn Interpretation 和 Surface。根据已批准架构，
检查已更新为只额外允许 Helping Logic 的一个结构化调用点，并新增“Helping 不得
规划或生成文案”的反向断言。第二次完整检查暴露了新增架构检查对 prompt 原句的
字面匹配；检查已改为验证 JSON-only、禁写最终文案等语义锚点，没有因此放宽运行时
合同。第三次完整 `npm run check:launch` 退出码为 0，包含全部专项/回归检查、Prisma
schema 与 migration 状态校验、miniapp JS 语法检查和 Next.js 生产构建。

### Real provider contract evidence

`npm run eval:hill-helping-batch1-shadow` 使用 qwen / `qwen3.7-max` 对 5 个受控
测试话轮运行真实结构化 Helping provider，未写数据库、未提交 Assistant 消息。

最终结果：

| case | applicability | goal | input tokens | output tokens |
| --- | --- | --- | ---: | ---: |
| exploration-share | applicable | exploration | 841 | 321 |
| action-request | applicable | action | 961 | 359 |
| insight-readiness | applicable | insight | 937 | 319 |
| no-advice-boundary | applicable | exploration | 920 | 316 |
| no-analysis-boundary | applicable | exploration | 873 | 333 |

2026-08-01 验收复跑的真实 provider 结果 5/5 通过合同与预期目标族；input P95=961、output P95=359，
低于冻结的 1136/390。

第一次真实调用暴露了模型漏字段、错误数组类型和虚假
`previousMoveAssessment`；严格校验将其拒绝为 `invalid_plan`。实现没有放宽合同，
而是明确结构形状。随后一次压缩尝试又暴露 `ready` 非法枚举和 insight
目标搭配 exploration 技术；仍由严格校验拒绝。最终通过压缩证据投影并恢复必要的
目标—意图—技术映射，同时满足质量与 token 门。

### Official-entrypoint Shadow performance

`npm run eval:hill-helping-batch1-shadow:official` 通过正式 `createChatReply` 入口运行
相同 5 个测试话轮，不落库、不提交消息：

- 5/5 Helping 决定通过；
- 最大 provider 调用数：3；
- Helping input P95：978，门限 1136；
- Helping output P95：355，门限 390；
- 端到端 P50：11169ms；
- 端到端 P95：11513ms，Shadow 内部评估门限 15779ms。

首次正式入口测量还暴露：没有上一 Assistant 话轮时，“别分析我”被上游关系信号
误投影成修复证据。输入构建现已要求真实的既往 Assistant 话轮，首轮显式边界只保留
为 `no_analysis`，不伪造 AI—用户关系破裂。修复后同组正式入口评估通过。

P50 11169ms 不是未来用户可见能力的可接受生产目标；本次只满足已冻结的 Batch 1
Shadow 内部评估门。批次 3 前仍必须满足更严格的 7849/9911ms P50/P95 门。

## Remaining

- 尚未进入批次 1.5；
- `uncertain` 后的普通聊天功能性移动仍是当前基线行为；
- 没有正式 `CommittedHelpingMove`、跨轮反应闭环或用户可见 Hill 技术；
- 没有生产 canary、灰度或部署；
- 小记、长期记忆和用户隔离仍在独立待办范围。

## Blocking Reason

没有批次 1 代码阻塞。根据阶段边界，本报告不自动开始批次 1.5。

## Recommended Next Step

在用户明确要求继续后，只进入批次 1.5 的普通聊天交接实现。
