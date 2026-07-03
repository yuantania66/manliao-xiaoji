import {
  AiConversationMessage,
  AiDebugTrace,
  AiGenerationResult,
  AiJudgeResult,
} from "./types";
import { FALLBACK_PROMPT_VERSION } from "./promptBuilder";

export const buildAiDebugTrace = ({
  recentMessages,
  generation,
  judge,
  finalSource,
  fallbackUsed,
  rewriteAttempted,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  generation: AiGenerationResult;
  judge: AiJudgeResult & { judgeModel?: string };
  finalSource: AiDebugTrace["route"]["finalSource"];
  fallbackUsed: boolean;
  rewriteAttempted: boolean;
}): AiDebugTrace => {
  const promptMeta = generation.promptMeta;
  const providerReasoningLabel = generation.providerReasoning?.available
    ? `模型返回了隐藏推理字段（${generation.providerReasoning.characters ?? 0} 字），这里只展示安全摘要。`
    : "模型未暴露隐藏推理。";
  const promptVersion = promptMeta?.promptVersion ?? generation.promptVersion ?? FALLBACK_PROMPT_VERSION;
  const receivedHistoryCount = promptMeta?.receivedHistoryCount ?? recentMessages.length;
  const includedHistoryCount = promptMeta?.includedHistoryCount ?? recentMessages.slice(-8).length;
  const filteredHistoryCount = promptMeta?.filteredHistoryCount ?? 0;
  const filteredHistory = promptMeta?.filteredHistory ?? [];
  const modelMessageRoles = promptMeta?.modelMessageRoles ?? [];
  const thinkingLayers = [
    {
      title: "1. 路由",
      body:
        finalSource === "base_model"
          ? "产品底座 prompt + 基模直出；没有本地分析、规划、短路或二次改写参与回复。"
          : "模型调用失败后走 fallback；没有二次改写。",
      evidence: [
        `路线：${finalSource}`,
        `rewrite=${rewriteAttempted}`,
        `fallback=${fallbackUsed}`,
      ],
    },
    {
      title: "2. Prompt",
      body: `收到 ${receivedHistoryCount} 条历史，送入 ${includedHistoryCount} 条，过滤 ${filteredHistoryCount} 条旧架构历史。`,
      evidence: [
        `promptVersion：${promptVersion}`,
        `messages：${modelMessageRoles.join(" -> ") || "无"}`,
        ...filteredHistory.map((item) => `过滤 ${item.role}: ${item.reason} / ${item.preview}`),
      ],
    },
    {
      title: "3. Provider",
      body: `${generation.model} / ${generation.latencyMs}ms`,
      evidence: [
        providerReasoningLabel,
        `tokenInput=${generation.tokenInput ?? "unknown"}`,
        `tokenOutput=${generation.tokenOutput ?? "unknown"}`,
      ],
    },
  ];

  return {
    visibleSteps: thinkingLayers.map((layer) => `${layer.title}：${layer.body}`),
    thinkingLayers,
    prompt: {
      mode: promptMeta?.mode ?? (finalSource === "fallback" ? "fallback" : "base_product"),
      promptVersion,
      receivedHistoryCount,
      includedHistoryCount,
      filteredHistoryCount,
      filteredHistory,
      modelMessageRoles,
    },
    generation: {
      model: generation.model,
      promptVersion: generation.promptVersion,
      latencyMs: generation.latencyMs,
      tokenInput: generation.tokenInput,
      tokenOutput: generation.tokenOutput,
      providerReasoning: generation.providerReasoning,
    },
    judge: {
      passed: judge.passed,
      riskLevel: judge.riskLevel,
      issues: judge.issues,
      rewriteRequired: judge.rewriteRequired,
      reason: judge.reason,
      judgeModel: judge.judgeModel,
    },
    route: {
      finalSource,
      fallbackUsed,
      rewriteAttempted,
    },
  };
};
