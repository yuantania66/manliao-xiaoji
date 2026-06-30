export type AiConversationRole = "user" | "assistant" | "system";

export type AiConversationMessage = {
  role: AiConversationRole;
  content: string;
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
  raw?: unknown;
};

export type AiJudgeIssue =
  | "safety"
  | "over_diagnosis"
  | "over_promising_effect"
  | "ai_like_tone"
  | "lack_of_empathy"
  | "inappropriate_strong_advice"
  | "self_harm_or_crisis"
  | "invented_scene";

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
  raw?: unknown;
};
