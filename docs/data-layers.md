# 慢聊小记数据分层

这份分层只约束数据使用边界，不引入新的 AI 推理架构。

## L0 原始对话 raw_conversation

- 来源：`ChatMessage`
- 信任级别：observed
- 用途：当前会话上下文、短期连续性
- 限制：不能沉淀成人格画像，不能当作用户稳定事实

## L1 用户确认记忆 user_confirmed_memory

- 来源：用户保存过的 `Note`
- 信任级别：user_confirmed
- 用途：轻量长期记忆，可进入 prompt
- 限制：只能引用原文范围内的信息，不能补充动机、创伤、性格标签

## L2 派生草稿 derived_draft

- 来源：AI 生成的小记草稿
- 信任级别：derived
- 用途：展示给用户，让用户决定是否保存
- 限制：保存前不能进入长期记忆，不能作为事实来源

## L3 生成审计 generation_audit

- 来源：`AiGeneration`、`AiJudgeResult`、debug trace、fallback 记录
- 信任级别：system
- 用途：排查质量、安全、成本、延迟
- 限制：不进入陪伴记忆，不参与用户画像

## L4 安全信号 safety_signal

- 来源：危机词/语义匹配、安全路由
- 信任级别：system
- 用途：当轮安全处理
- 限制：默认不做长期画像；后续如需沉淀，必须单独做隐私和同意设计

## Prompt 使用原则

- 当前用户输入和短期聊天：可以作为当轮上下文。
- 用户保存的小记：可以作为轻量长期记忆。
- 旧聊天线索：只能轻参考，并标明未确认。
- AI 草稿、debug、judge、fallback、安全信号：不能当作用户事实或记忆。
