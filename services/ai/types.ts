export type AiConversationRole = "user" | "assistant" | "system";

export type AiConversationMessage = {
  role: AiConversationRole;
  content: string;
  promptVersion?: string | null;
  aiGenerationId?: string | null;
};

export type AiMemoryContext = {
  source: "note" | "chat";
  layer: "user_confirmed_memory" | "raw_conversation";
  trust: "user_confirmed" | "observed";
  text: string;
  date?: string;
};

export type AiUnderstandingPromptMeta = {
  recentMemoryCount: number;
  similarMemoryCount: number;
  coreEventCount: number;
  activeHypothesisCount: number;
  counterEvidenceCount: number;
  professionalGuidanceCount: number;
  userFeedbackCount: number;
  retrievalReason?: string;
};

export type AiModelRole = "developer" | "user" | "assistant";

export type AiModelMessage = {
  role: AiModelRole;
  content: string;
};

export type AiGenerationResult = {
  text: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  tokenInput?: number;
  tokenOutput?: number;
  promptMeta?: AiPromptMeta;
  providerReasoning?: AiProviderReasoningMeta;
  raw?: unknown;
};

export type AiPromptMeta = {
  mode: "base_product";
  promptVersion: string;
  receivedHistoryCount: number;
  includedHistoryCount: number;
  filteredHistoryCount: number;
  memoryIncluded: boolean;
  memorySource?: AiMemoryContext["source"];
  memoryLayer?: AiMemoryContext["layer"];
  memoryTrust?: AiMemoryContext["trust"];
  understandingIncluded: boolean;
  understanding?: AiUnderstandingPromptMeta;
  filteredHistory: {
    role: AiConversationRole;
    reason: string;
    promptVersion?: string | null;
    preview: string;
  }[];
  modelMessageRoles: AiModelRole[];
};

export type AiProviderReasoningMeta = {
  available: boolean;
  source: string;
  characters?: number;
};

export type AiJudgeIssue =
  | "safety"
  | "over_diagnosis"
  | "over_promising_effect"
  | "ai_like_tone"
  | "lack_of_empathy"
  | "inappropriate_strong_advice"
  | "self_harm_or_crisis"
  | "invented_scene"
  | "dismissive_rest_advice"
  | "repetitive_reassurance"
  | "unhelpful_abstract_prompt"
  | "leading_interpretation"
  | "sensory_mismatch"
  | "reasks_known_information"
  | "flippant_tone"
  | "missed_user_correction"
  | "closed_conversation"
  | "mechanical_micro_entry"
  | "low_information_echo";

export type AiRiskLevel = "low" | "medium" | "high" | "crisis";

export type AiJudgeResult = {
  passed: boolean;
  riskLevel: AiRiskLevel;
  issues: AiJudgeIssue[];
  rewriteRequired: boolean;
  reason: string;
  raw?: unknown;
};

export type AiProviderResponse = {
  text: string;
  model: string;
  latencyMs: number;
  tokenInput?: number;
  tokenOutput?: number;
  providerReasoning?: AiProviderReasoningMeta;
  raw?: unknown;
};

export type AiDebugTrace = {
  visibleSteps: string[];
  thinkingLayers: {
    title: string;
    body: string;
    evidence: string[];
  }[];
  prompt: {
    mode: "base_product" | "fallback" | "safety";
    promptVersion: string;
    receivedHistoryCount: number;
    includedHistoryCount: number;
    filteredHistoryCount: number;
    memoryIncluded: boolean;
    memorySource?: AiMemoryContext["source"];
    memoryLayer?: AiMemoryContext["layer"];
    memoryTrust?: AiMemoryContext["trust"];
    understandingIncluded: boolean;
    understanding?: AiUnderstandingPromptMeta;
    filteredHistory: AiPromptMeta["filteredHistory"];
    modelMessageRoles: AiModelRole[];
  };
  generation: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    tokenInput?: number;
    tokenOutput?: number;
    providerReasoning?: AiProviderReasoningMeta;
  };
  judge: {
    passed: boolean;
    riskLevel: AiRiskLevel;
    issues: AiJudgeIssue[];
    rewriteRequired: boolean;
    reason: string;
    judgeModel?: string;
  };
  route: {
    finalSource: "base_model" | "fallback" | "safety";
    fallbackUsed: boolean;
    rewriteAttempted: boolean;
    safetyUsed?: boolean;
  };
};
