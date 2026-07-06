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
  const memoryIncluded = promptMeta?.memoryIncluded ?? false;
  const memorySource = promptMeta?.memorySource;
  const memoryLayer = promptMeta?.memoryLayer;
  const memoryTrust = promptMeta?.memoryTrust;
  const memoryLabel = memoryIncluded
    ? [memorySource, memoryLayer, memoryTrust].filter(Boolean).join(" / ")
    : "none";
  const understandingIncluded = promptMeta?.understandingIncluded ?? false;
  const understanding = promptMeta?.understanding;
  const filteredHistory = promptMeta?.filteredHistory ?? [];
  const modelMessageRoles = promptMeta?.modelMessageRoles ?? [];
  const thinkingLayers = [
    {
      title: "1. 路由",
      body:
        finalSource === "base_model"
          ? "产品底座 prompt + 基模直出；没有本地分析、规划、短路或二次改写参与回复。"
          : finalSource === "safety"
            ? "安全闸门命中，普通聊天模型未调用。"
            : "模型调用失败后走 fallback；没有二次改写。",
      evidence: [
        `路线：${finalSource}`,
        `rewrite=${rewriteAttempted}`,
        `fallback=${fallbackUsed}`,
        `safety=${finalSource === "safety"}`,
      ],
    },
    {
      title: "2. Prompt",
      body:
        finalSource === "safety"
          ? "安全回复不构造普通聊天 prompt。"
          : `收到 ${receivedHistoryCount} 条历史，送入 ${includedHistoryCount} 条，过滤 ${filteredHistoryCount} 条历史。`,
      evidence: [
        `promptVersion：${promptVersion}`,
        `memory=${memoryLabel}`,
        understandingIncluded
          ? `understanding=recent:${understanding?.recentMemoryCount ?? 0}, similar:${understanding?.similarMemoryCount ?? 0}, hypotheses:${understanding?.activeHypothesisCount ?? 0}, counter:${understanding?.counterEvidenceCount ?? 0}`
          : "understanding=none",
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
      mode: promptMeta?.mode ?? (finalSource === "fallback" ? "fallback" : finalSource === "safety" ? "safety" : "base_product"),
      promptVersion,
      receivedHistoryCount,
      includedHistoryCount,
      filteredHistoryCount,
      memoryIncluded,
      memorySource,
      memoryLayer,
      memoryTrust,
      understandingIncluded,
      understanding,
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
      safetyUsed: finalSource === "safety",
    },
  };
};
