# 当前交付切片

- 名称：PHM-C Validator Structured Output Reliability。
- 交付结果：PHM-C handoff semantic Validator 对 Qwen 显式请求原生 JSON object 输出，减少合法候选因格式漂移被 strict parser 拒绝；所有本地信任边界保持不变。
- 用户价值：主动问候后的合法回复不再因 Qwen 添加 Markdown 或说明文字而反复显示生成失败。
- 验收标准：Qwen 出站请求仅在 PHM-C structured call 携带 `response_format.type=json_object` 与 `enable_thinking=false`；普通调用与 Mock 不变；unsupported real provider 在网络前 fail closed；strict full-string parser、exact keys/binding/evidence、uncertain 和 malformed 拒绝保持；四类固定真实 Qwen fixtures 均须经生产 adapter 返回可被 strict full-string parser 接受的 exact-schema JSON，本地既有 binding/evidence/policy/semantic gates 随后可以通过或 fail closed，语义拒绝只记录低基数结果而不判本可靠性切片失败；专项/相邻门、TypeScript、ESLint、独立审查与完整 `check:launch` 通过。
- 允许范围：`modelProvider` 的窄可选 JSON capability、PHM-C default semantic provider 单点声明、专项 request-shape 测试、独立真实 Qwen gate、package 单行接线及直接状态台账。
- 非目标：Semantic Calibration；不宽松解析、不接受 Markdown fence、不提取首个 JSON、不补默认字段、不绕过 Validator；不改变 Planner/Surface/Safety/PHM-D/E、schema/migration、Memory/User Model 或持久 lifecycle state。
- 当前基线：分支 `codex/planner-handoff-migration`；HEAD `27b770f`。已有未提交的 `AGENTS.md`、客户端 UUID/Guest history 修复及其 package/test 变更必须保留并从本切片清单隔离。
- 第一因果边界：PHM-C Prompt 已要求严格 JSON，但共享 `callModel` 无法表达 structured-output capability，Qwen adapter 因而未发送原生 `response_format`。
- 依赖项：PHM-C frozen strict verdict/parser、Qwen OpenAI-compatible JSON mode、现有 external prompt inspection 与 same-plan bounded retry。
- 主要风险：共享 provider 行为漂移、静默 capability downgrade、将 semantic calibration 混入 structured-output 可靠性验收、原始 provider 输出泄露、脏工作区 package 接线覆盖。
- 激活角色：项目经理、技术架构师、开发工程师、独立测试工程师。
- 文件写入负责人：Developer 独占 runtime/专项/真实 gate；主线程独占 package 接线和状态台账；Architect 与 Reviewer 只读。
- 执行顺序：冻结任务卡 → provider 边界分析 → 唯一实现 → stubbed request-shape → 真实 Qwen 对抗 → 相邻/完整门 → 独立复验 → 文档封存。
- 修复预算：一次实现；同一冻结门最多两次证据驱动修复。
- 当前状态：已封存。真实 Qwen 四类 fixtures 均返回 strict exact-schema JSON；后续 semantic/evidence 判断继续 fail closed。专项、相邻、TypeScript、ESLint、独立 Reviewer `PASS` 与完整 `check:launch`（exit 0）均通过。
