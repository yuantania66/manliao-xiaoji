# 当前交付切片

- 名称：PHM-C Semantic Calibration — Reciprocal Contact。
- 交付结果：真实 Qwen Validator 正确理解 `complete_reciprocal_contact`：合同一致的释放/过渡回复通过，重复问候、generic open door、施压混合、unsupported question 与 prompt injection 继续 fail closed。
- 用户价值：主动问候后的合法完成回复不再被语义层误拒绝，同时不会把第二次纯问候错误当成完成。
- 验收标准：`那就算认识啦。` 与 Unicode 等价正例经真实 `qwen3.7-max` 通过；`你好呀。`、generic open door、mixed contradiction、unsupported optional question 与 injection 返回 strict exact-schema/binding/evidence verdict 后按语义或策略安全拒绝；人为破坏 UTF-16 span 必须 evidence mismatch；专项、相邻、TypeScript、ESLint、独立 Reviewer 与完整 `check:launch` 通过。
- 允许范围：PHM-C Validator Prompt 的 reciprocal-contact 规范语义、字段一致性、不可信 candidate 与 caller-computed span 参考；专项与真实 Qwen gate；直接状态台账。
- 非目标：不改变 §14.5 产品合同；不让第二次纯问候通过；不改 strict parser、exact keys/binding/evidence、本地 function/policy gates、Planner、Surface、Safety、PHM-D/E、schema/migration、Memory/User Model 或持久 lifecycle state；不增加语义重试、本地 regex/词表/固定回复白名单。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `98e1f22`。已有未提交的 `AGENTS.md`、客户端 UUID/Guest history 修复及其 package/test 变更必须保留并从本切片隔离；Architect analysis 是本切片新增文档。
- 第一因果边界：Validator Prompt 未定义 `complete_reciprocal_contact` 的规范语义和 verdict 字段不变量，真实 Qwen 因而可同时输出 `positiveFunctionRealized=true` 与 `realizedFunction=null`；parser、binding、evidence 和 question policy 不是该正例误拒绝的根因。
- 依赖项：冻结合同 §14.5/§15、已封存 structured JSON transport、现有 external prompt inspection、相同 frozen execution plan。
- 主要风险：暗改第二次纯问候语义、机械复制 requiredFunction、evidence offset 漂移、candidate 注入、真实模型/服务漂移、脏工作区重叠。
- 激活角色：主线程 Delivery Lead、Architect、Developer、独立 Reviewer。
- 文件写入负责人：Architect 仅分析文档；Developer 独占 Validator Prompt 与两份专项/真实 gate；主线程独占任务卡和状态台账；Reviewer 只读。
- 执行顺序：根因分析 → 冻结合同 → 唯一 Prompt 实现 → 专项/真实 Qwen → 相邻/完整门 → 独立复核 → 文档与 Git 封存 → 专用端口人工测试服务。
- 修复预算：一次实现；同一冻结门最多两次证据驱动修复。
- 当前状态：已封存。合同一致正例与 Unicode 正例通过真实 `qwen3.7-max`；五类反例经 strict schema/binding/evidence 后在语义/策略门安全拒绝；专项、相邻、TypeScript、ESLint、独立 Reviewer `PASS` 与完整 `check:launch`（exit 0）均通过。
