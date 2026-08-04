# 当前交付切片

- 名称：PHM-C — Surface Handoff Realization and Same-Plan Semantic Validation。
- 交付结果：将已通过 PHM-B preflight 的 `interactionMoveHandoffPlan` 结构化投影给 Surface，并在每个候选进入既有 bounded same-plan regeneration/acceptance 流程前，用独立语义证据验证同一 target、relation、required function、completion intent 与 question policy。
- 用户价值：让 Planner 的 reciprocal-contact 决策真正约束生成和验收，拒绝重复 greeting、receipt、echo、presence confirmation 或 generic open door，进入自然交流阶段。
- 验收标准：Surface 精确接收 handoff tuple 与当前 relation evidence，不读取 `promptVersion` 决定 handoff；v1 history 以 `sourceAssistantMoveId` 为边界；所有正向 required function 有明确实现义务；`defer` 不宣称完成；独立 semantic verdict 严格绑定同一 `planId`/tuple，malformed、missing、mismatched、uncertain verdict fail closed；`questionPolicy=none` 拒绝无问号的语义索取，`optional_after_completion` 只允许在正向函数已完成且 ordinary plan 独立支持时最多一个问题；Surface 自报内部标签不能证明完成；专项、TypeScript、ESLint、相邻门、独立验收与 `check:launch` 通过。
- 允许范围：`services/ai/promptBuilder.ts`、一个独立 handoff semantic validator adapter、`services/ai/responsePlanValidator.ts`、`services/ai/chatOrchestrationService.ts`、PHM-C 专项脚本、package gate 以及直接相关合同/架构/台账。允许为测试注入 typed semantic provider，但默认生产路径必须 fail closed。完整门证明现有 LLM 调用白名单尚未表达已冻结的 Output Validation provider，因此修复轮 1 额外允许只更新 `scripts/conversation-os-architecture-check.ts` 的该治理断言，并要求 validator 外发 prompt 经过现有 inspection boundary。独立验收同时证明同一可变 plan 引用可在生成后漂移，因此同一修复轮必须在首次 Surface 前建立深拷贝、递归冻结的 execution-plan snapshot，并让两次生成和验证共享该唯一 snapshot。新增 inspection stage 导致三个既有 eval/baseline 脚本的窄类型不再覆盖真实 union，允许仅在 `assistant-grounding-eval.ts`、`conversation-grounding-leak-ablation.ts`、`conversation-os-control-baseline.ts` 做类型扩宽，不改行为。
- 非目标：不改 PHM-B mapping/priority/preflight authority；不改 PHM-A target/relation；不写 `fulfills`、Safety `supersedes` 或任何 committed envelope edge；不改 API/client、Memory、User Model、Batch 2、schema、persistence 或部署；不新增 persistent lifecycle state、关键词/regex/固定话术 whitelist/trajectory case patch；不把 Validation success 当成 committed completion。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `bc9922a`；工作区仅有用户的独立 `AGENTS.md` 修改，必须保留且不得纳入本切片；已复现 plan 进入 orchestration 但不进入 Surface/Validator 的 NO-OP 边界。
- 依赖项：Interaction Move Handoff Contract v1 §§7-9、PHM-B/AUTH checkpoint `bc9922a`、唯一 `formatResponsePlanForPrompt`、`enforceResponsePlan` 与 bounded regeneration。
- 主要风险：把语义验证退化为词表；verdict 未绑定原 plan；model/parser failure 被误接受；Surface 通过自报 function id 欺骗；历史裁剪仍依赖 `promptVersion`；越界实现 committed edge。
- 激活角色：项目经理、产品/临床合同审查、技术架构师、开发工程师、测试工程师。
- 待命角色：UX 设计师、UI 设计师、运维工程师。
- 文件写入负责人：开发工程师独占 runtime/专项脚本；主线程项目经理独占文档与台账；审查与测试角色只读。
- 执行顺序：冻结任务卡 → typed semantic verdict contract → Surface tuple/history projection → async same-plan semantic gate → bounded regeneration wiring → semantic/adversarial regressions → 相邻/完整门 → 独立验收 → PHM-C 本地 checkpoint。
- 修复预算：一次实现；同一冻结门最多两次证据驱动修复。
- 当前状态：PHM-C 与修复轮 1 已通过专项、相邻、TypeScript、ESLint、独立对抗复验和完整 `check:launch`；准备以 `bc9922a` 为回滚锚点封存。
