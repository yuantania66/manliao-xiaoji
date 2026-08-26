# 批次 1.5 第一段：情绪证据与 preflight 本地验收

状态：2026-08-03 第一段实现与本地验收完成；完整发布前回归通过。

## 范围

本段只实现候选 4 正向验收合同中的“唯一情绪证据合同”和 20 个冻结场景真实
Planner＋preflight 门。未修改组合式 Validator 的功能识别，未修改普通修复目标子类型，
未调用外部模型，未进入批次 2。

## 实现

- Conversation State 成为当前 turn 情绪／关系影响证据的唯一提取来源。
- 每个证据保留用户原文 span、UTF-16 起止位置、规范化类别、强度和作用对象。
- Turn Interpretation 直接消费同一组 span；Response Planner 不再维护独立连续字符串表，
  只为 span 附加当前 turn id 并形成正向功能合同。
- Surface Prompt 投影结构化 span；兼容词面字段仅由 span 派生，不再参与识别。
- preflight 检查证据非空、turn 一致、来源为当前用户消息、原文切片一致、元数据合法，
  并对兼容投影不一致给出专属失败码。
- 冻结 runner 记录真实 `planPreflightPassed` 与 `planPreflightFailures`，计划失败不再只能
  退化为 `missing_final_validation`。

## 定向证据

- 冻结数据 SHA-256：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`，未修改。
- 20 个冻结场景均执行真实 Planner 与 preflight：20/20 通过。
- `emotion-vague-blocked` 三次确定性重放：3/3 通过，失败原因均为空。
- 候选 2 的 25 条冻结归因重放保持不变：18 条 Surface failure 拒绝、6 条 Validator
  false positive 接受、1 条 both 因真实缺陷拒绝。
- 新增 44 个未照抄冻结样本的抽取反例：22 个程度副词、口语和句法变化正例，22 个
  否定、转述、词内碰撞和对抗反例。
- preflight 新增空 span、错误 turn 和无法回指原文三类失败测试。

## 完整回归

- `npx tsc --noEmit` 通过。
- `git diff --check` 通过。
- `npm run check:launch` 以退出码 0 通过，覆盖 Safety、直接回答、暂停、Grounding、
  当前话题、普通交接、批次 0/1/1.5、Conversation OS、Natural Chat 125 条反例、消息
  提交边界、Memory V2、Prisma 12 个迁移、Miniapp 语法及生产构建。
- lint 为 0 错误、1 个既有 Memory V2 未使用函数警告；prelaunch audit 保留 2 个既有
  miniapp guard 识别警告，audit 本身通过。
- Candidate 3 分层归因与 Candidate 4 正向合同 SHA-256 均与冻结值一致。

## 后续边界

本段已达到本地验收标准。下一段才可修改组合式 Validator 与普通修复目标子类型；
候选 4 的 60 轮外部运行仍需单独授权。
