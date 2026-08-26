# Batch 1.5 Causal Ablation 离线实验框架

状态：已实现离线框架；未运行真实模型实验，未生成人工归因结论。

## 边界

本框架只负责 Batch 1.5 已批准的五臂因果实验：配置管理、冻结数据选择、离线运行、
原始结果记录和人工盲审数据打包。

它不修改或调用线上入口，不修改 Planner、生产 Prompt、Surface、Validator 或现有
Batch 1.5 评测合同。真实实验的生产计划、人工 oracle 计划、生产 Prompt 快照、诊断
Prompt 和有限 Surface 候选必须先写入一个独立冻结输入包；runner 不在运行时生成、
补写或修正这些实验变量。

## 五臂

配置冻结在
`clinical-evals/hill-helping-batch1-5-causal-ablation.json`：

- `C`：冻结生产计划、冻结生产 Prompt、自由文本 Surface、temperature 0.75；
- `P`：只替换为冻结 oracle 计划及其冻结 Prompt 投影；
- `Q`：只替换为冻结诊断 Prompt；
- `S`：只把 temperature 改为 0；当前 provider adapter 不支持 seed，因此记录为 null；
- `A`：使用冻结的有限候选选择 Prompt，模型只返回候选 id，runner 确定性投影为候选文本。

每臂、每场景重复 5 次，共 6 × 5 × 5 = 150 条。正式盲审只接受 150 条全部完成的结果。

## 冻结输入包

输入包为 JSON，必须包含：

```text
schemaVersion, experimentVersion, configSha256, sourceDatasetSha256,
provider, model, createdAt,
cases[]: {
  scenarioId,
  productionPlan,
  oraclePlan,
  planProjections: { production, oracle },
  prompts: { production, oracle_plan, diagnostic, surface_control },
  surfaceCandidates[]: { id, text }
}
```

loader 会验证实验配置承诺、原 20 场景 preservation 数据 SHA、6 个固定场景、四种
Prompt 快照、两种计划快照以及有限候选完整性。输入包不是生产配置，不能被线上代码读取。
其中两个计划投影必须分别等于生产 `formatResponsePlanForPrompt(plan)` 的确定性结果；
`oracle_plan` Prompt 必须严格等于 production Prompt 的一次完整计划块替换。诊断
Prompt 和 Surface 对照 Prompt 必须保留 production 计划投影，避免把 H1 与 H2 混合。

## 运行

真实 provider 离线运行：

```bash
npm run experiment:hill-helping-batch1-5-causal -- \
  --input=/absolute/path/input-pack.json \
  --output=/absolute/path/result.json \
  --source-id=approved-run-id
```

可用完整 fixture 做无网络复现：

```bash
npm run experiment:hill-helping-batch1-5-causal -- \
  --input=/absolute/path/input-pack.json \
  --fixture=/absolute/path/fixture.json \
  --output=/absolute/path/result.json \
  --source-id=fixture-run-id
```

150 个 `场景 × arm × 重复` cell 在调用前使用系统随机源打乱，避免时间漂移、限流或
provider 状态与固定 arm 位置混淆。输出逐条记录 arm、重复编号、计划/Prompt 哈希、
sampling 参数、未经裁剪的原始模型输出、最终可见
文本、有限候选 id、token/延迟和错误。runner 不执行 Validator，也不再生成，以免反馈
回路混淆因果变量。

## 人工盲审格式

```bash
npm run experiment:hill-helping-batch1-5-causal:blind-pack -- \
  --result=/absolute/path/result.json \
  --review=/absolute/path/blind-review.json \
  --key=/absolute/path/blind-key.json \
  --adjudication=/absolute/path/adjudication-template.json
```

`blind-review.json` 只包含随机后的可见上下文、用户消息和单条 Assistant 回复，不包含
场景 id、arm、重复编号、模型、Prompt、计划或结果 id。`blind-key.json` 单独保存映射，
其 SHA-256 写入 review 与 adjudication template。人工必须先完成全部评分、把
`reviewedBeforeKeyRead` 改为 true 并冻结文件，之后才能读取 key。

盲审格式沿用已批准的功能通过、适当结果、愿意继续三个指标，并记录已批准实验设计中
的失败类别；不改变原 preservation gate 的阈值或判定。

## 自检

```bash
npm run check:hill-helping-batch1-5-causal-ablation
```

自检使用临时 fixture 覆盖完整 150 条运行、五臂数量、计划/Prompt 隔离、有限候选投影、
结果完整性、盲化、承诺不匹配和无效 Surface 选择拒绝，不调用外部模型。
