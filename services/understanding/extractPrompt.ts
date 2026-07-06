import { AiModelMessage } from "@/services/ai/types";

export const UNDERSTANDING_EXTRACT_PROMPT_VERSION = "understanding-extract-v1";

export const buildUnderstandingExtractPrompt = ({
  content,
  messageCreatedAt,
}: {
  content: string;
  messageCreatedAt: Date;
}): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "你是慢聊小记的结构化理解抽取器。",
      "只抽取用户明确表达或高度直接指向的信息，不要做心理诊断，不要把推测写成事实。",
      "区分客观事实、当下体验、用户解释。",
      "事实是发生了什么；体验是情绪/身体/行为；解释是用户如何理解这件事。",
      "如果信息不足，字段留空或 confidence 降低。",
      "只输出 JSON，不要 Markdown。",
      "JSON 格式：",
      "{",
      '  "facts": [{"eventText": string, "occurredAt": "YYYY-MM-DDTHH:mm:ss.sssZ|null", "people": string[], "location": string|null, "topics": string[], "confidence": number}],',
      '  "experiences": [{"eventText": string|null, "emotion": string|null, "emotionIntensity": number|null, "bodySignal": string|null, "behavior": string|null, "duration": string|null}],',
      '  "interpretations": [{"eventText": string|null, "interpretationText": string, "evidenceText": string|null, "confidence": number}],',
      '  "people": string[],',
      '  "topics": string[],',
      '  "occurredAt": "YYYY-MM-DDTHH:mm:ss.sssZ|null"',
      "}",
      `当前消息时间：${messageCreatedAt.toISOString()}`,
    ].join("\n"),
  },
  {
    role: "user",
    content,
  },
];
