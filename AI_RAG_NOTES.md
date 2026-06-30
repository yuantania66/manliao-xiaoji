# 慢聊小记 AI RAG 说明

当前 RAG 是轻量本地检索版，先不引入向量数据库。

## 当前做法

- 知识库位置：`services/ai/ragKnowledge.ts`
- 触发方式：根据用户本轮输入和最近 6 条对话做关键词打分
- 注入位置：`services/ai/promptBuilder.ts`
- 使用范围：主聊天回复和重写回复

## 当前知识类型

- 用户纠正或补充事实时的修复策略
- 用户短答或“不知道”时的少追问策略
- 禁止脑补天气、时间、窗外、月亮、云、场景或动作
- 避免连续追问
- 疲惫低能量场景
- 明确求建议时才给小建议
- 《助人技术》启发的探索-领悟-行动边界
- 专业研究启发的心理健康 AI 护栏和用户体验边界
- 非诊断边界
- 自伤危机处理

## 专业来源使用边界

RAG 不保存书籍或论文原文，只保存原创整理后的原则卡片，避免版权风险和“扮演心理咨询师”的定位风险。

当前参考方向：

- 《助人技术》：提炼探索、领悟、行动三阶段的助人边界；当前产品优先使用“探索”和“反映”，避免过早解释和建议。
- Nature / npj Digital Medicine / npj Mental Health Research 公开文章：提炼心理健康 AI 的安全护栏、用户体验、信任边界和评估意识。

已参考的公开来源：

- WHO Psychological First Aid: `https://www.who.int/publications/i/item/9789241548205`
- SAMHSA Trauma-Informed Approaches: `https://www.samhsa.gov/mental-health/trauma-violence/trauma-informed-approaches-programs`
- Nature Medicine, "Large language models could change the future of behavioral healthcare": `https://www.nature.com/articles/s41591-023-02366-9`
- npj Digital Medicine, "Conversational agents in mental health and well-being": `https://www.nature.com/articles/s41746-023-00979-5`
- npj Mental Health Research, "Potential risks from using generative artificial intelligence to deliver mental healthcare": `https://www.nature.com/articles/s44184-025-00152-4`
- npj Digital Medicine, "AI chatbots in digital mental health": `https://www.nature.com/articles/s41746-025-01575-7`

## 后续升级方向

- 把知识库拆成可编辑 JSON 或后台配置
- 加入 AI 质量测试集，自动验证 bad case
- 使用 embedding + vector database 做语义检索
- 加入用户授权后的偏好记忆，例如“不喜欢被追问”
- 结合真实反馈积累 good reply / bad reply 样本
