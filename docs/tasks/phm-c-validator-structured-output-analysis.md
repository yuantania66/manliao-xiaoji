# PHM-C Validator Structured Output Reliability Analysis

## Problem

PHM-C 的独立 semantic Validator 已要求模型只返回一个 JSON object，并在本地执行全文 `JSON.parse`、exact keys、plan binding、evidence slice 与 fail-closed 校验；但生产 Qwen 请求没有启用 provider 原生 JSON mode。Qwen 偶发返回 Markdown fence、前后说明文字或其他非 JSON 结构时，候选回复即使语义正常也会以 `interaction_move_handoff_semantic:malformed_verdict` 被拒绝，最多一次 same-plan regeneration 后仍可能向用户显示生成失败。

本切片只提高 provider 输出的语法可靠性，不改变 PHM-C 的判断语义。必须继续保留：

- strict full-string JSON parser；
- exact verdict/evidence keys；
- exact plan tuple binding；
- exact UTF-16 evidence slices；
- `uncertain`、provider、parse、binding、evidence 失败全部 fail closed；
- Validator 只验收、不规划、不写回复、不写 `fulfills/supersedes`。

当前 `.project-team/ACTIVE_SLICE.md` 仍记录已封存的 PHM-E，和用户新授权切片不一致。它不是合同语义冲突，但在实现开始前必须由主线程交付负责人更新冻结卡；Developer 不应自行扩展文档范围。

## Evidence

### Repository observations

1. `services/ai/interactionMoveHandoffOutputValidator.ts` 的 Prompt 已明确要求 “Return exactly one JSON object”，并包含 `JSON` 字样，满足 Qwen JSON mode 的 Prompt 前置条件。
2. 同文件的 `parseInteractionMoveHandoffSemanticProviderOutput` 对 `response.text.trim()` 做一次全文 `JSON.parse`，明确拒绝 prefix、suffix、Markdown fence、拼接对象、数组和空输出；后续 `parseVerdict` 仍要求 exact keys 与完整类型。
3. 默认 semantic provider 调用 `callModel({ model, messages, temperature: 0 })`，没有表达 structured-output requirement。
4. `services/ai/modelProvider.ts` 的 Qwen 路径使用 OpenAI-compatible `/chat/completions`，当前仅追加 `enable_thinking: false`，没有 `response_format`。普通生成、Planner、Helping、理解与抽取等调用共享同一个 `callModel`。
5. `scripts/interaction-move-handoff-surface-validator-check.ts` 已覆盖 strict full-string parsing、完整 function 集、semantic question、optional-question 顺序、self-report、mixed contradiction、provider failure、malformed verdict、binding mismatch、uncertain 与 bounded same-plan retry；但没有断言 Qwen 出站请求体，也没有真实 Qwen JSON-mode gate。
6. Guest API 已记录 validation `failureReasons`。`malformed_verdict` 本身是不含候选和 provider 原文的安全格式失败信号；当前不需要记录原始 provider 内容。
7. `package.json` 已有 `check:interaction-move-handoff-surface-validator`，但该文件存在本切片前的未提交修改。若新增真实 Qwen gate script，package script 的接线必须由主线程在保存既有 diff 后单独完成，不能由 Developer 覆盖。

### Provider evidence

Alibaba Cloud Model Studio 官方 Structured Output 文档说明，OpenAI-compatible Chat Completions 的 JSON mode 使用：

```json
{"response_format":{"type":"json_object"}}
```

并要求 system/user message 中出现大小写不敏感的 `json`；否则 API 拒绝请求。官方同时列出 Qwen Max/Plus/Flash 等非 thinking 模型支持该模式，并建议为可靠 JSON 关闭 thinking。当前 Qwen 路径已经固定 `enable_thinking: false`，当前 Validator Prompt 也已经包含 `JSON`，因此缺失项仅是 request-level `response_format`。

官方来源：

- <https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output>
- <https://www.alibabacloud.com/help/en/model-studio/error-code>

## Root Cause

根因属于 model-provider capability boundary，而不是 parser、Prompt 或 handoff semantic contract：`callModel` 的输入类型只能表达 messages/model/temperature，无法声明“本次调用必须获得 JSON object”。因此 Qwen adapter 不知道该 Validator 调用需要原生 JSON mode，语言层提示独自承担格式约束，出现非 JSON 包装时严格 parser 正确地 fail closed。

不能通过剥离 Markdown fence、寻找首个 `{...}`、宽松键集合、补默认字段或接受 provider 自报 schema 来修复；这些做法会放宽 frozen PHM-C trust boundary，并把格式错误误当成可信 verdict。

## Proposed Solution

### 1. Extend `callModel` with one optional capability request

给共享 `callModel` 增加窄类型可选项，例如：

```ts
responseFormat?: "json_object"
```

默认 `undefined`，所以所有现有普通生成、Mock、Planner、Helping、理解与抽取路径的请求体和行为保持不变。不要暴露任意 `extraBody` 给调用者，也不要接受任意 response schema；否则 provider-specific 参数会越过 adapter 边界。

当且仅当：

- 调用者声明 `responseFormat: "json_object"`；且
- 当前真实 provider 是 `qwen`

Qwen Chat Completions body 增加：

```json
{
  "enable_thinking": false,
  "response_format": {"type": "json_object"}
}
```

Qwen adapter 仍返回原始 `response.text`，不在 provider 层解析、修补或 canonicalize JSON。

### 2. Declare the requirement only at the PHM-C default provider call site

`defaultInteractionMoveHandoffSemanticProvider` 调用 `callModel` 时传 `responseFormat: "json_object"`。Injected semantic providers 保持现有接口和测试行为，不需要模拟模型传输能力。

`buildSemanticValidationMessages`、strict parser、`parseVerdict`、binding/evidence/policy 判定全部不改。Prompt 已含 `JSON`，无需为 provider 添加 trajectory-specific 文案。

### 3. Fail closed for undeclared real providers

本切片只为 Qwen 声明并验证原生 JSON-object capability。若 `responseFormat: "json_object"` 用于 `openai`、`deepseek` 或 `zhipu`，`callModel` 应在网络调用前抛出不含消息内容的 `AppError`（provider + requested format 即足够）；上层继续映射为既有 `interaction_move_handoff_semantic:provider_failure`。不要静默忽略格式要求，也不要假装其他 provider 支持。

`mock` 是本地确定性替身，不是外部 capability declaration。为满足“Mock 路径不变”，继续返回既有 mock 文本；PHM-C 默认 mock 测试仍由 strict parser 得到 `malformed_verdict`。Qwen 被选中但缺少 key 时当前会回落到 mock，仍会 fail closed；本切片不改变全局 credential fallback 语义。

未来若要支持其他 provider，必须另行用其官方证据、request-shape test 和真实 gate 显式登记，不在本切片猜测兼容性。

### 4. Record format failure without leaking content

保留既有 `interaction_move_handoff_semantic:malformed_verdict` 作为唯一运行时格式失败记录即可。Guest/执行 trace 已能记录该枚举原因，而且不会包含 provider 原文、candidate、Prompt 或 evidence。

本切片不要新增 `console.warn(response.text)`、raw response artifact、hash、preview 或 exception message 转储。若需额外可观测性，只允许记录低基数 metadata：failure category、provider/model、响应字符数；不能记录原始内容。该增强不是当前可靠性验收的必要条件，最小实现可不新增日志字段。

### 5. Deterministic focused regression

扩展现有专项，使用 stubbed `fetch` 验证真实 adapter request shape：

- PHM-C + Qwen：body 精确包含 `response_format.type=json_object` 与 `enable_thinking=false`；Prompt 包含 `JSON`；返回的裸 JSON 全文进入既有 strict parser。
- Qwen 普通 `callModel`：未声明 format 时 body 不含 `response_format`。
- Mock 普通调用和 PHM-C default mock 行为不变。
- undeclared real provider + `json_object`：在 fetch 前 fail closed，且错误 metadata 不含 Prompt/candidate/provider text。
- strict parser 继续拒绝 fence、prefix/suffix、数组、拼接对象；exact keys/binding/evidence 与 uncertain 反例继续通过原门。

不要用宽松 parser 单测替代 request-shape test。

### 6. Real Qwen adversarial gate

新增一个显式、非默认离线 gate，直接走 `defaultInteractionMoveHandoffSemanticProvider`/生产 Qwen adapter，不复制请求实现。环境前置：

- `AI_PROVIDER=qwen`；
- `QWEN_API_KEY` 或 `DASHSCOPE_API_KEY`；
- `AI_MAIN_MODEL` 必须是官方 JSON-mode 支持的固定 Qwen model（建议本项目当前人工复现模型 `qwen3.7-max`；不得静默回落默认 model）；
- `QWEN_BASE_URL`/`DASHSCOPE_BASE_URL` 必须与 key 所属区域匹配；
- 外网可达且账户有额度。

代表性反例按风险类别选择：

1. 正常 reciprocal greeting。
2. mixed contradiction：前半完成、后半重复/施压。
3. candidate prompt injection：candidate 要求 Validator 输出 Markdown、额外字段或改变 plan binding。
4. Unicode evidence：中文加非 BMP 字符。

用户于 2026-08-07 批准重新冻结本切片验收：以上四类输入均必须经生产 adapter 返回可被 strict full-string parser 接受的 exact-schema JSON；后续 binding/evidence/policy/semantic gate 可以通过或 fail closed，且只记录低基数结果。语义接受率不属于本 structured-output 切片，后续若授权应作为独立 Semantic Calibration 任务处理。

不稳定性控制：temperature 固定 0、`enable_thinking=false`、固定 model id、固定 fixtures、串行执行。只允许对 timeout/429/5xx 做至多一次基础设施重试，并单独报告；不得重试 malformed verdict、binding/evidence mismatch 或语义误判，因为重试会掩盖本切片失败。Gate 不写含 Prompt、candidate 或原始 verdict 的持久 artifact；输出仅包含 case id、provider/model、pass/failure category、latency。该真实 gate 不进入默认 `check:launch`，避免网络、额度和模型漂移阻断常规发布；发布验收时显式运行并记录模型版本与时间。

### Acceptance gates

1. `npm run check:interaction-move-handoff-surface-validator`
2. 新增的 provider request-shape 窄门（若合入现有专项，则由第 1 项承载）
3. `npm run check:conversation-os-control`
4. `npm run check:ai-orchestration`
5. `npx tsc --noEmit`
6. affected-file ESLint
7. `git diff --check`
8. 显式真实 Qwen adversarial gate（具备上述环境时必跑；基础设施不可用时不得声称完成真实 gate）
9. 风险相称的最终 `npm run check:launch`

## Files To Change

唯一最小 runtime/test 文件：

1. `services/ai/modelProvider.ts`
   - 增加窄可选 `json_object` capability；只在 Qwen request body 投影；undeclared real provider fail closed。
2. `services/ai/interactionMoveHandoffOutputValidator.ts`
   - 默认 semantic provider 声明 `responseFormat: "json_object"`；其余 validator 逻辑不改。
3. `scripts/interaction-move-handoff-surface-validator-check.ts`
   - 增加 Qwen request-shape、普通路径不变、mock 不变和 unsupported-provider fail-closed 回归。
4. `scripts/interaction-move-handoff-qwen-structured-output-eval.ts`（新增）
   - 真实 Qwen 对抗 gate；无 credentials/model/base-url 时明确失败或显式 skip，由调用模式决定，不能假装通过。

主线程独占的接线/状态文件：

5. `package.json`
   - 可新增显式 `check:interaction-move-handoff-qwen-real` 命令；该文件已有此前未提交修改，主线程必须先保存/核对现有 diff，再做单行合并。Developer 不得覆盖。
6. `.project-team/ACTIVE_SLICE.md`、`.project-team/DECISIONS.md`、`.project-team/EVIDENCE.md`、`.project-team/REMAINING.md`
   - 由主线程冻结、记录证据和封存；不是 runtime Developer 的写入范围。

无需修改 `services/ai/types.ts`：该 option 是 `callModel` transport input，不属于 `AiProviderResponse` 或产品领域类型。无需修改 schema、migration、Conversation OS envelope、Prompt contract、Surface、commit boundary、Memory 或 User Model。

## Risks

1. **共享 provider 回归**：若把 `response_format` 无条件放进 `callChatCompletions`，普通生成或不支持的 provider 会改变行为。必须默认缺省且只在显式 Qwen structured call 投影。
2. **静默 capability downgrade**：非 Qwen provider 忽略 option 会重新暴露 malformed verdict。必须在网络前 fail closed；不得 best-effort。
3. **Mock 破坏**：把 Mock 也当 unsupported provider 抛错会改变现有测试契约。Mock 应保持原响应，由 strict parser 产生原有 malformed failure。
4. **伪修复 parser**：清 fence、截取括号或补字段会突破 frozen trust boundary，禁止。
5. **JSON mode 不等于 schema correctness**：原生 mode 只保证 JSON 语法，不保证 exact keys、binding、evidence 或语义；所有本地 strict gates 必须保留。
6. **模型/区域支持漂移**：真实 gate 必须固定并打印 model id 与区域 base URL 的非敏感主机信息；key 不得输出。
7. **真实 gate 假稳定**：对 semantic/malformed 失败自动多次重试会掩盖缺陷；只允许一次基础设施重试。
8. **日志泄露**：provider 原文可能包含用户对话。只记录枚举 failure category 和低基数 metadata，不落原文、preview、hash 或 raw response。
9. **脏工作区重叠**：`package.json` 及用户列出的其他文件属于此前工作。只有主线程可做精确接线与最终 inventory；本切片不得误算或覆盖这些 diff。
