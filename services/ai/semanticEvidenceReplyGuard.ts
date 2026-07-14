import type { ClinicalPlan } from "@/services/clinical/clinicalTypes";

import type { AiGenerationResult } from "./types";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const UNSUPPORTED_MEANING_PATTERNS = [
  /(?:你|这个|这条|数字|表情).{0,12}(?:测试|试探|评分|打分|数数|计数|选择)/,
  /(?:测试|试探).{0,8}(?:我|系统|回复|反应)/,
  /(?:接着|继续|开始|正在|还在).{0,8}(?:数数|计数|打分|评分)/,
  /(?:\d+|[一二三四五六七八九十])\s*分(?:数|[，。！？!?]|$)/,
  /(?:\d+|[一二三四五六七八九十]).{0,4}(?:点钟)?方向/,
  /(?:你|看起来|听起来|像是|好像|似乎|可能|大概|感觉|还在).{0,12}(?:松口气|放松|难过|开心|焦虑|害怕|生气|崩溃|疲惫|无奈|委屈|孤独|压抑)/,
  /(?:跟着|顺着|延续).{0,8}(?:节奏|数字).{0,8}(?:聊|继续)?/,
  /(?:随手|随便).{0,6}(?:敲|发|输入).{0,6}(?:数字|字符|内容)?/,
];

const containsUnsupportedMeaning = (reply: string) =>
  UNSUPPORTED_MEANING_PATTERNS.some((pattern) => pattern.test(normalize(reply)));

export class UnsupportedSemanticMeaningError extends Error {
  readonly code = "UNSUPPORTED_SEMANTIC_MEANING";
  readonly generation: AiGenerationResult;

  constructor(generation: AiGenerationResult) {
    super("Semantic evidence guard blocked unsupported meaning in the model reply.");
    this.name = "UnsupportedSemanticMeaningError";
    this.generation = generation;
  }
}

export const isUnsupportedSemanticMeaningError = (
  error: unknown
): error is UnsupportedSemanticMeaningError => error instanceof UnsupportedSemanticMeaningError;

export const shouldApplySemanticEvidenceReplyContract = ({
  clinicalPlan,
}: {
  clinicalPlan: ClinicalPlan;
}) =>
  clinicalPlan.responseGoal === "clarify" &&
  ((clinicalPlan.responseIntent === "receive" && clinicalPlan.questionFunction === "none") ||
    (clinicalPlan.responseIntent === "clarify" && clinicalPlan.questionFunction === "clarify_meaning"));

export const applySemanticEvidenceReplyContract = ({
  clinicalPlan,
  generation,
}: {
  clinicalPlan: ClinicalPlan;
  generation: AiGenerationResult;
}): AiGenerationResult => {
  if (!shouldApplySemanticEvidenceReplyContract({ clinicalPlan })) return generation;
  if (!containsUnsupportedMeaning(generation.text)) return generation;

  throw new UnsupportedSemanticMeaningError(generation);
};
