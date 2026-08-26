# 批次 1.5 第二阶段：组合式 Validator 与普通修复子类型本地验收

日期：2026-08-03
状态：本地验收通过；尚未申请候选 4 的 60 轮外部模型测试

## 范围

本阶段只实现并验收：

1. 情绪支持正向功能的组合式 Validator；
2. 普通修复 `interaction_move_withdrawal` 的五类目标子类型；
3. 对候选 2、候选 3 冻结归因的本地重放；
4. 新增独立反例与完整本地回归。

本阶段未修改 Hill 技术选择，未运行 Qwen/DashScope，未进入批次 2，也未针对单个候选文案增加专用分支。

## 实现结论

### 组合式 Validator

情绪支持功能不再由单一固定动词决定，而是分别检查：

- 用户控制权；
- 所选功能对象（焦点、表达负担、表达量或当前关系影响）；
- 动作范围。

自然语序中的“说、讲、聊、谈、提、表达”等等价实现可以完成同一功能。功能完成判断与真实边界判断彼此独立：已经完成焦点控制的回复，仍可因泛化安慰、无证据强化、虚构事件、主动暂停或切换话题被拒绝，同时不再错误报告缺失功能。

### 普通修复子类型

`interaction_move_withdrawal` 现在由 Planner 根据当前用户纠正和相邻 Assistant 目标文本记录以下一种子类型：

- `unsolicited_advice`
- `pressure_question`
- `generic_listening`
- `moralizing`
- `topic_switch`

无文本证据的 `irrelevant_answer` 不再兜底推断为 `topic_switch`。Surface 收到具体子类型；Validator 要求承担并功能性否定该动作，但不要求固定出现“停止”或“撤回”。事实修复接受“道歉＋无歧义助手错误动词＋替代事实”的自然省略主语形式。

## 独立验收结果

命令：`npm run check:hill-helping-batch1-5-stage2`

- 冻结场景计划：20/20 通过 preflight；
- 修复子类型：5/5 覆盖；
- 新增独立反例：68；
  - 情绪支持：40；
  - 普通修复：28；
  - 应接受：34/34；
  - 应拒绝：34/34；
- 候选 3 冻结最终失败：10/10 按新合同修正；
- 候选 3 冻结再生成审计：13/13；
  - 两次尝试合计：26；
  - 应接受：10/10；
  - 应拒绝：16/16；
- 冻结数据 SHA-256 保持：`12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`。

## 保留门

命令：`npm run check:hill-helping-batch1-5-preservation`

- 候选 2 的 25 条冻结归因全部保持；
- `surface_failure`：18/18 继续拒绝；
- `validator_false_positive`：6/6 改为接受；
- `both`：1/1 因真实 Surface 原因继续拒绝；
- 20 个冻结场景 Planner/preflight：20/20；
- 10 个普通修复场景的修复大类与子类型：10/10。

## 完整本地回归

命令：`npm run check:launch`

结果：退出码 0。

完整门包含 lint、架构边界、Safety、直接回答、暂停、Grounding、当前话题、普通交接、消息提交边界、对话轨迹、Memory V2、本地 PostgreSQL/Prisma、miniapp 语法和 Next.js 生产构建。PostgreSQL 的 12 个迁移均已应用，生产构建成功。

已知但不阻断的既有警告：

- ESLint：`services/memory/projection/projectionRegistry.ts` 有 1 个未使用变量警告；
- prelaunch audit：miniapp media test/seed guard 各有 1 个识别警告。

这些警告不属于本阶段改动，完整门仍通过。

## 结论

第二阶段的独立本地验收标准已经满足。下一步只能在用户批准后，使用同一冻结合成数据申请候选 4 的 60 轮质量保留测试；本报告本身不构成外部数据发送授权。
