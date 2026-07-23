import type { ClinicalPlan } from "@/services/clinical/clinicalTypes";

import type { AiGenerationResult } from "./types";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

export type SemanticEvidenceFailureReason =
  | "unsupported_meaning:testing_or_probing"
  | "unsupported_meaning:scoring_or_counting"
  | "unsupported_meaning:direction_inference"
  | "unsupported_meaning:emotion_inference"
  | "unsupported_meaning:rhythm_continuation"
  | "unsupported_meaning:casual_input_inference";

export type SemanticEvidenceReplyInspection = {
  applies: boolean;
  hasUnsupportedMeaning: boolean;
  failureReasons: SemanticEvidenceFailureReason[];
};

export type SemanticEvidenceFinalSource = "llm" | "llm_regenerate" | "constraint_failure";

/**
 * System-status hard failure after two constrained generations failed.
 * Must not interpolate user input or pretend to understand the turn.
 */
export const SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY =
  "本轮回复未通过内容约束，暂时无法安全生成。这不是对你内容的理解或回应。";

const UNSUPPORTED_MEANING_CHECKS: Array<{
  pattern: RegExp;
  reason: SemanticEvidenceFailureReason;
}> = [
  {
    pattern: /(?:你|这个|这条|数字|表情).{0,12}(?:测试|试探|评分|打分|数数|计数|选择)/,
    reason: "unsupported_meaning:testing_or_probing",
  },
  {
    pattern: /(?:测试|试探).{0,8}(?:我|系统|回复|反应)/,
    reason: "unsupported_meaning:testing_or_probing",
  },
  {
    pattern: /(?:接着|继续|开始|正在|还在).{0,8}(?:数数|计数|打分|评分)/,
    reason: "unsupported_meaning:scoring_or_counting",
  },
  {
    pattern: /(?:\d+|[一二三四五六七八九十])\s*分(?:数|[，。！？!?]|$)/,
    reason: "unsupported_meaning:scoring_or_counting",
  },
  {
    pattern: /(?:\d+|[一二三四五六七八九十]).{0,4}(?:点钟)?方向/,
    reason: "unsupported_meaning:direction_inference",
  },
  {
    pattern:
      /(?:你|看起来|听起来|像是|好像|似乎|可能|大概|感觉|还在).{0,12}(?:松口气|放松|难过|开心|焦虑|害怕|生气|崩溃|疲惫|无奈|委屈|孤独|压抑)/,
    reason: "unsupported_meaning:emotion_inference",
  },
  {
    pattern: /(?:跟着|顺着|延续).{0,8}(?:节奏|数字).{0,8}(?:聊|继续)?/,
    reason: "unsupported_meaning:rhythm_continuation",
  },
  {
    pattern: /(?:随手|随便).{0,6}(?:敲|发|输入).{0,6}(?:数字|字符|内容)?/,
    reason: "unsupported_meaning:casual_input_inference",
  },
];

export const containsUnsupportedMeaning = (reply: string) =>
  UNSUPPORTED_MEANING_CHECKS.some(({ pattern }) => pattern.test(normalize(reply)));

export const collectUnsupportedMeaningFailureReasons = (reply: string): SemanticEvidenceFailureReason[] => {
  const normalized = normalize(reply);
  const reasons = new Set<SemanticEvidenceFailureReason>();
  for (const check of UNSUPPORTED_MEANING_CHECKS) {
    if (check.pattern.test(normalized)) reasons.add(check.reason);
  }
  return Array.from(reasons);
};

export const shouldApplySemanticEvidenceReplyContract = ({
  clinicalPlan,
}: {
  clinicalPlan: ClinicalPlan;
}) =>
  clinicalPlan.responseGoal === "clarify" &&
  ((clinicalPlan.responseIntent === "receive" && clinicalPlan.questionFunction === "none") ||
    (clinicalPlan.responseIntent === "clarify" && clinicalPlan.questionFunction === "clarify_meaning"));

export const inspectSemanticEvidenceReplyContract = ({
  clinicalPlan,
  reply,
}: {
  clinicalPlan: ClinicalPlan;
  reply: string;
}): SemanticEvidenceReplyInspection => {
  const applies = shouldApplySemanticEvidenceReplyContract({ clinicalPlan });
  if (!applies) {
    return { applies: false, hasUnsupportedMeaning: false, failureReasons: [] };
  }

  const failureReasons = collectUnsupportedMeaningFailureReasons(reply);
  return {
    applies: true,
    hasUnsupportedMeaning: failureReasons.length > 0,
    failureReasons,
  };
};

export const formatSemanticEvidenceRegenerateConstraint = (
  failureReasons: SemanticEvidenceFailureReason[]
) =>
  [
    "A previous draft failed the semantic groundedness constraint and was rejected.",
    "Do not assign unsupported meaning from message form or repetition.",
    "Structured failure reasons from the rejected draft:",
    ...failureReasons.map((reason) => `- ${reason}`),
    "Remain at observation. Do not invent testing, probing, scoring, counting, direction, emotion, activity, or conversational purpose.",
    "Do not output fixed clarification templates. Do not quote or echo the user input as a system announcement.",
  ].join("\n");

export const createConstraintFailureGeneration = (
  previous: AiGenerationResult,
  failureReasons: SemanticEvidenceFailureReason[]
): AiGenerationResult => ({
  ...previous,
  text: SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY,
  rawLLMOutput: previous.rawLLMOutput ?? previous.text,
  postProcessSteps: [
    ...(previous.postProcessSteps ?? []),
    {
      layer: "semantic_evidence_reply_contract",
      before: previous.text,
      after: SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY,
      reason: `Semantic evidence constraint failed twice (${failureReasons.join(", ") || "unsupported_meaning"}); return system constraint_failure status without authoring chat copy.`,
    },
  ],
  finalReplySource: "constraint_failure",
});

const withRegenerateSource = (
  generation: AiGenerationResult,
  stepReason: string
): AiGenerationResult => ({
  ...generation,
  finalReplySource: "llm_regenerate",
  postProcessSteps: [
    ...(generation.postProcessSteps ?? []),
    {
      layer: "semantic_evidence_reply_contract",
      before: generation.text,
      after: generation.text,
      reason: stepReason,
    },
  ],
});

/**
 * Enforce the semantic-evidence reply contract without the guard authoring chat copy.
 * At most one controlled regenerate. Second failure becomes constraint_failure.
 */
export const enforceSemanticEvidenceReplyContract = async ({
  clinicalPlan,
  generate,
}: {
  clinicalPlan: ClinicalPlan;
  generate: (input: {
    attempt: 1 | 2;
    failureReasons: SemanticEvidenceFailureReason[];
  }) => Promise<AiGenerationResult>;
}): Promise<{
  generation: AiGenerationResult;
  finalSource: SemanticEvidenceFinalSource;
  regenerateAttempted: boolean;
  modelCallCount: number;
  failureReasons: SemanticEvidenceFailureReason[];
}> => {
  const first = await generate({ attempt: 1, failureReasons: [] });
  let modelCallCount = 1;
  const firstInspection = inspectSemanticEvidenceReplyContract({
    clinicalPlan,
    reply: first.text,
  });

  if (!firstInspection.hasUnsupportedMeaning) {
    return {
      generation: {
        ...first,
        finalReplySource: first.finalReplySource === "mock" ? "mock" : "llm",
      },
      finalSource: "llm",
      regenerateAttempted: false,
      modelCallCount,
      failureReasons: [],
    };
  }

  const regenerateReasons = firstInspection.failureReasons;
  const second = await generate({ attempt: 2, failureReasons: regenerateReasons });
  modelCallCount += 1;
  if (modelCallCount > 2) {
    throw new Error("Semantic evidence contract exceeded the one-regenerate limit.");
  }

  const secondInspection = inspectSemanticEvidenceReplyContract({
    clinicalPlan,
    reply: second.text,
  });

  if (!secondInspection.hasUnsupportedMeaning) {
    return {
      generation: withRegenerateSource(
        {
          ...second,
          rawLLMOutput: second.rawLLMOutput ?? second.text,
          postProcessSteps: [
            ...(first.postProcessSteps ?? []),
            {
              layer: "semantic_evidence_reply_contract",
              before: first.text,
              after: second.text,
              reason: `First generation failed semantic evidence (${regenerateReasons.join(", ")}); controlled regenerate passed.`,
            },
            ...(second.postProcessSteps ?? []),
          ],
        },
        "Semantic evidence contract passed after one controlled regenerate; guard did not author the reply."
      ),
      finalSource: "llm_regenerate",
      regenerateAttempted: true,
      modelCallCount,
      failureReasons: regenerateReasons,
    };
  }

  const mergedReasons = Array.from(
    new Set([...regenerateReasons, ...secondInspection.failureReasons])
  ) as SemanticEvidenceFailureReason[];

  return {
    generation: createConstraintFailureGeneration(
      {
        ...second,
        rawLLMOutput: first.rawLLMOutput ?? first.text,
        postProcessSteps: [
          ...(first.postProcessSteps ?? []),
          {
            layer: "semantic_evidence_reply_contract",
            before: first.text,
            after: second.text,
            reason: `First generation failed semantic evidence (${regenerateReasons.join(", ")}); controlled regenerate still failed.`,
          },
          ...(second.postProcessSteps ?? []),
        ],
      },
      mergedReasons
    ),
    finalSource: "constraint_failure",
    regenerateAttempted: true,
    modelCallCount,
    failureReasons: mergedReasons,
  };
};
