import { AppError } from "@/lib/errors";
import { callModel, getDefaultAiModel } from "@/services/ai/modelProvider";
import type { AiModelMessage, AiProviderResponse } from "@/services/ai/types";
import { inspectPromptBeforeExternalCall } from "@/services/ai/externalPromptInspection";

import type {
  HelperSelfCheck,
  HillGoalFamily,
  HillHelpingDecision,
  HillHelpingInput,
  HillHelpingPlan,
  HillHelpingShadowTrace,
  HillIntention,
  HillSkill,
} from "./hillHelpingTypes";

const GOALS = ["exploration", "insight", "action"] as const;
const EXPLORATION_INTENTIONS = [
  "offer_support",
  "facilitate_narrative_exploration",
  "facilitate_thought_exploration",
  "facilitate_feeling_exploration",
  "clarify_shared_understanding",
  "allow_pause_without_abandonment",
] as const;
const INSIGHT_INTENTIONS = [
  "assess_insight_readiness",
  "foster_awareness",
  "facilitate_collaborative_insight",
  "explore_supported_discrepancy",
  "process_current_helping_relationship",
] as const;
const ACTION_INTENTIONS = [
  "clarify_action_goal",
  "explore_options",
  "provide_relevant_information",
  "support_decision_making",
  "rehearse_behavior_or_wording",
  "plan_small_adjustable_step",
  "review_action_result",
  "support_low_risk_regulation_practice",
] as const;
const EXPLORATION_SKILLS = [
  "attending_and_support",
  "minimal_encourager",
  "supportive_pause",
  "restatement",
  "summary",
  "thought_question_or_probe",
  "feeling_question_or_probe",
  "feeling_reflection",
] as const;
const INSIGHT_SKILLS = [
  "awareness_challenge",
  "insight_question_or_probe",
  "tentative_interpretation",
  "current_relationship_processing",
] as const;
const ACTION_SKILLS = [
  "action_question_or_probe",
  "information_giving",
  "option_generation",
  "direct_guidance",
  "strategy_disclosure",
  "behavioral_rehearsal",
  "decision_support",
  "small_step_planning",
  "action_review",
  "low_risk_relaxation_or_mindfulness",
] as const;
const ALL_INTENTIONS = [
  ...EXPLORATION_INTENTIONS,
  ...INSIGHT_INTENTIONS,
  ...ACTION_INTENTIONS,
  "repair_current_helping_relationship",
] as const;
const ALL_SKILLS = [
  ...EXPLORATION_SKILLS,
  ...INSIGHT_SKILLS,
  ...ACTION_SKILLS,
  "relationship_repair",
] as const;
const PLAN_KEYS = new Set([
  "applicability",
  "primaryGoal",
  "supportingGoal",
  "readiness",
  "intention",
  "primarySkill",
  "supportingSkill",
  "relationshipPriority",
  "previousMoveAssessment",
  "expectedUserResponse",
  "stopOrReassessWhen",
  "prohibitedMoves",
  "helperSelfCheck",
  "evidence",
  "hypotheses",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && Boolean(item.trim()));

const isMember = <T extends readonly string[]>(value: unknown, members: T): value is T[number] =>
  typeof value === "string" && members.includes(value as T[number]);

const exactKeys = (value: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(value).every((key) => allowed.has(key));

const validateSelfCheck = (value: unknown): value is HelperSelfCheck => {
  if (!isRecord(value)) return false;
  const keys = new Set([
    "unsupportedAssumptions",
    "possibleCulturalAssumptions",
    "repeatedFailedMoves",
    "capabilityLimits",
    "userRejectedClaims",
    "pressureRisk",
  ]);
  return exactKeys(value, keys) &&
    isStringArray(value.unsupportedAssumptions) &&
    isStringArray(value.possibleCulturalAssumptions) &&
    isStringArray(value.repeatedFailedMoves) &&
    isStringArray(value.capabilityLimits) &&
    isStringArray(value.userRejectedClaims) &&
    isMember(value.pressureRisk, ["low", "medium", "high"] as const);
};

const intentionMatchesGoal = (goal: HillGoalFamily, intention: HillIntention) =>
  goal === "exploration"
    ? isMember(intention, EXPLORATION_INTENTIONS)
    : goal === "insight"
      ? isMember(intention, INSIGHT_INTENTIONS)
      : isMember(intention, ACTION_INTENTIONS);

const skillMatchesGoal = (goal: HillGoalFamily, skill: HillSkill) =>
  goal === "exploration"
    ? isMember(skill, EXPLORATION_SKILLS)
    : goal === "insight"
      ? isMember(skill, INSIGHT_SKILLS)
      : isMember(skill, ACTION_SKILLS);

const validateReadiness = (value: unknown) => {
  if (!isRecord(value)) return false;
  return exactKeys(value, new Set(["status", "evidence", "counterEvidence"])) &&
    isMember(value.status, ["supported", "uncertain", "not_supported"] as const) &&
    isStringArray(value.evidence) &&
    isStringArray(value.counterEvidence);
};

const validateCommonPlanFields = (value: Record<string, unknown>) =>
  exactKeys(value, PLAN_KEYS) &&
  isMember(value.relationshipPriority, ["none", "repair", "process_current_relationship"] as const) &&
  isStringArray(value.prohibitedMoves) && value.prohibitedMoves.length > 0 &&
  validateSelfCheck(value.helperSelfCheck) &&
  isStringArray(value.evidence) && value.evidence.length > 0 &&
  isStringArray(value.hypotheses);

export const validateHillHelpingPlan = (
  value: unknown
): { valid: true; plan: HillHelpingPlan } | { valid: false; reasons: string[] } => {
  const reasons: string[] = [];
  if (!isRecord(value)) return { valid: false, reasons: ["plan_not_object"] };
  if (!validateCommonPlanFields(value)) reasons.push("invalid_common_plan_fields");
  if (!isMember(value.applicability, ["applicable", "uncertain", "not_applicable"] as const)) {
    reasons.push("invalid_applicability");
    return { valid: false, reasons };
  }

  if (value.applicability !== "applicable") {
    for (const forbidden of [
      "primaryGoal",
      "supportingGoal",
      "readiness",
      "intention",
      "primarySkill",
      "supportingSkill",
      "previousMoveAssessment",
      "expectedUserResponse",
      "stopOrReassessWhen",
    ]) {
      if (value[forbidden] !== undefined) reasons.push(`${value.applicability}_contains_${forbidden}`);
    }
    if (value.relationshipPriority !== "none") reasons.push(`${value.applicability}_relationship_priority`);
    return reasons.length
      ? { valid: false, reasons }
      : { valid: true, plan: value as HillHelpingPlan };
  }

  if (!isMember(value.intention, ALL_INTENTIONS)) reasons.push("missing_or_invalid_intention");
  if (!isMember(value.primarySkill, ALL_SKILLS)) reasons.push("missing_or_invalid_primary_skill");
  if (!isStringArray(value.stopOrReassessWhen) || value.stopOrReassessWhen.length === 0) {
    reasons.push("missing_stop_or_reassess_conditions");
  }
  if (!isStringArray(value.expectedUserResponse) || value.expectedUserResponse.length === 0) {
    reasons.push("missing_expected_user_response");
  }

  if (value.relationshipPriority === "repair") {
    if (value.primaryGoal !== undefined || value.supportingGoal !== undefined || value.readiness !== undefined) {
      reasons.push("repair_must_pause_goal_selection");
    }
    if (value.intention !== "repair_current_helping_relationship") reasons.push("repair_intention_mismatch");
    if (value.primarySkill !== "relationship_repair") reasons.push("repair_skill_mismatch");
    if (value.supportingSkill !== undefined) reasons.push("repair_supporting_skill_forbidden");
  } else {
    if (!isMember(value.primaryGoal, GOALS)) reasons.push("missing_or_invalid_primary_goal");
    if (!validateReadiness(value.readiness)) reasons.push("missing_or_invalid_readiness");
    if (
      isMember(value.primaryGoal, GOALS) &&
      isMember(value.intention, ALL_INTENTIONS) &&
      !intentionMatchesGoal(value.primaryGoal, value.intention)
    ) reasons.push("goal_intention_mismatch");
    if (
      isMember(value.primaryGoal, GOALS) &&
      isMember(value.primarySkill, ALL_SKILLS) &&
      !skillMatchesGoal(value.primaryGoal, value.primarySkill)
    ) reasons.push("goal_skill_mismatch");
    if (value.supportingGoal !== undefined && !isMember(value.supportingGoal, GOALS)) {
      reasons.push("invalid_supporting_goal");
    }
    if (value.supportingSkill !== undefined && !isMember(value.supportingSkill, ALL_SKILLS)) {
      reasons.push("invalid_supporting_skill");
    }
    if (
      isMember(value.supportingGoal, GOALS) &&
      isMember(value.supportingSkill, ALL_SKILLS) &&
      !skillMatchesGoal(value.supportingGoal, value.supportingSkill)
    ) reasons.push("supporting_goal_skill_mismatch");
  }

  return reasons.length
    ? { valid: false, reasons }
    : { valid: true, plan: value as HillHelpingPlan };
};

const validatePlanAgainstInput = (plan: HillHelpingPlan, input: HillHelpingInput) => {
  const reasons: string[] = [];
  const boundaryKinds = new Set(input.userBoundaries.map((item) => item.kind));
  const relationshipEvidenceAvailable = input.currentRelationshipEvidence.length > 0;
  if (plan.applicability !== "applicable") return reasons;

  if (plan.relationshipPriority === "repair" && !relationshipEvidenceAvailable) {
    reasons.push("repair_without_current_relationship_evidence");
  }
  if (plan.relationshipPriority === "process_current_relationship") {
    if (!relationshipEvidenceAvailable) reasons.push("relationship_process_without_current_evidence");
    if (plan.primaryGoal !== "insight") reasons.push("relationship_process_goal_mismatch");
    if (plan.intention !== "process_current_helping_relationship") {
      reasons.push("relationship_process_intention_mismatch");
    }
    if (plan.primarySkill !== "current_relationship_processing") {
      reasons.push("relationship_process_skill_mismatch");
    }
  }
  if (boundaryKinds.has("no_advice") && plan.primaryGoal === "action") {
    reasons.push("action_conflicts_with_no_advice_boundary");
  }
  if (boundaryKinds.has("no_analysis") && plan.primaryGoal === "insight") {
    reasons.push("insight_conflicts_with_no_analysis_boundary");
  }
  if (
    boundaryKinds.has("no_questions") &&
    (plan.primarySkill?.includes("question_or_probe") || plan.supportingSkill?.includes("question_or_probe"))
  ) {
    reasons.push("question_skill_conflicts_with_no_questions_boundary");
  }
  if (boundaryKinds.has("pause") || boundaryKinds.has("stop")) {
    const respectsPause = plan.relationshipPriority === "none" &&
      plan.primaryGoal === "exploration" &&
      plan.intention === "allow_pause_without_abandonment" &&
      plan.primarySkill === "supportive_pause";
    if (!respectsPause) reasons.push("plan_conflicts_with_pause_or_stop_boundary");
  }
  return reasons;
};

const validateInput = (input: HillHelpingInput) => {
  const reasons: string[] = [];
  if (!input.userTurnId.trim()) reasons.push("missing_user_turn_id");
  if (input.currentUserMaterial.sourceTurnId !== input.userTurnId) reasons.push("material_source_mismatch");
  if (!input.currentUserMaterial.literalText.trim()) reasons.push("empty_user_material");
  if (input.directObligations.some((item) => item.sourceTurnId !== input.userTurnId)) {
    reasons.push("direct_obligation_source_mismatch");
  }
  if (input.userBoundaries.some((item) => !item.sourceTurnId || item.evidence.length === 0)) {
    reasons.push("untraceable_user_boundary");
  }
  if (input.currentRelationshipEvidence.some((item) => !item.sourceTurnId || item.evidence.length === 0)) {
    reasons.push("untraceable_relationship_evidence");
  }
  if (input.establishedConversationContext.some((item) => !item.sourceTurnId || item.evidence.length === 0)) {
    reasons.push("untraceable_established_context");
  }
  return reasons;
};

const undecidedPlan = ({
  applicability,
  evidence,
}: {
  applicability: "uncertain" | "not_applicable";
  evidence: string[];
}): HillHelpingPlan => ({
  applicability,
  relationshipPriority: "none",
  prohibitedMoves: [
    "Do not infer emotion, motive, diagnosis, or hidden meaning from message form.",
    "Do not select an insight or action technique without supporting evidence.",
    "Do not choose an ordinary conversation action inside Helping Logic.",
  ],
  helperSelfCheck: {
    unsupportedAssumptions: [],
    possibleCulturalAssumptions: [],
    repeatedFailedMoves: [],
    capabilityLimits: [],
    userRejectedClaims: [],
    pressureRisk: "low",
  },
  evidence,
  hypotheses: [],
});

const hasEstablishedContext = (input: HillHelpingInput) => {
  return Boolean(
    input.recentCommittedHelpingMoves.length ||
    input.establishedConversationContext.length ||
    input.currentRelationshipEvidence.length
  );
};

export const decideHillFastBoundary = (input: HillHelpingInput): HillHelpingDecision | null => {
  const contextualFrame = hasEstablishedContext(input);
  const fragmentary = input.turnInterpretation.interaction.contentAvailability === "fragmentary" ||
    input.turnInterpretation.interaction.contentAvailability === "unknown" ||
    input.currentUserMaterial.semanticEvidence.status === "insufficient";
  if (fragmentary && !contextualFrame) {
    return {
      status: "decided",
      plan: undecidedPlan({
        applicability: "uncertain",
        evidence: [
          "Current material is insufficient and no established conversation frame is available.",
          ...input.turnInterpretation.contentMeaning.contentAvailabilityEvidence,
        ],
      }),
    };
  }

  const ordinaryQuestionKinds = new Set([
    "identity",
    "ai_identity",
    "clinician_identity",
    "body_capability",
    "voice_input",
    "voice_output",
    "perception_capability",
    "time_capability",
    "memory_capability",
    "definition",
  ]);
  const directQuestions = input.currentUserMaterial.directQuestions;
  if (
    !contextualFrame &&
    directQuestions.length > 0 &&
    directQuestions.every((question) => ordinaryQuestionKinds.has(question.kind)) &&
    !input.currentRelationshipEvidence.length
  ) {
    return {
      status: "decided",
      plan: undecidedPlan({
        applicability: "not_applicable",
        evidence: directQuestions.flatMap((question) => [
          `Direct ordinary question kind=${question.kind}.`,
          ...question.evidence,
        ]),
      }),
    };
  }
  return null;
};

const extractJsonObject = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
};

const compactEvidence = (items: string[]) => items.slice(0, 1).map((item) => item.slice(0, 160));

const compactInput = (input: HillHelpingInput) => ({
  userTurnId: input.userTurnId,
  currentUserMaterial: {
    literalText: input.currentUserMaterial.literalText,
    semanticEvidence: input.currentUserMaterial.semanticEvidence,
    directQuestions: input.currentUserMaterial.directQuestions.map((question) => ({
      kind: question.kind,
      text: question.text,
      evidence: compactEvidence(question.evidence),
    })),
  },
  responseRelations: input.turnInterpretation.responseRelation.candidates.slice(0, 4).map((candidate) => ({
    relation: candidate.relation,
    confidence: candidate.confidence,
    targetTurnId: candidate.targetTurnId,
    evidence: compactEvidence(candidate.evidence),
  })),
  currentActivity: {
    primary: input.dialogueState.currentActivity.primary,
    concurrent: input.dialogueState.currentActivity.concurrent,
  },
  activeThread: input.dialogueState.activeThread
    ? {
        sourceTurnIds: input.dialogueState.activeThread.sourceTurnIds.slice(-4),
        status: input.dialogueState.activeThread.status,
      }
    : null,
  initiativeOwner: input.dialogueState.initiativeOwner,
  priorCommonGround: {
    confirmed: input.dialogueState.commonGround.confirmed
      .filter((item) => item.sourceTurnId !== input.userTurnId)
      .slice(-4)
      .map((item) => ({ text: item.text, sourceTurnId: item.sourceTurnId })),
    rejected: input.dialogueState.commonGround.rejected.slice(-4)
      .map((item) => ({ text: item.text, sourceTurnId: item.sourceTurnId })),
  },
  directObligations: input.directObligations.map((item) => ({
    kind: item.kind,
    question: item.question,
    evidence: compactEvidence(item.evidence),
  })),
  userBoundaries: input.userBoundaries.map((item) => ({
    kind: item.kind,
    text: item.text,
    evidence: compactEvidence(item.evidence),
  })),
  currentRelationshipEvidence: input.currentRelationshipEvidence.map((item) => ({
    kind: item.kind,
    text: item.text,
    evidence: compactEvidence(item.evidence),
  })),
  establishedConversationContext: input.establishedConversationContext,
  recentCommittedHelpingMoves: input.recentCommittedHelpingMoves,
});

export const buildHillHelpingMessages = (input: HillHelpingInput): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "Decide one HillHelpingPlan for a text AI using Hill Helping Skills 6e (2024). Output JSON only; never write final chat copy or ordinary conversation actions.",
      "Exploration, insight, action are fluid goals, not stages. Use only traceable session evidence; form/length/keyword/number/emoji/silence/adjacency alone prove no psychology.",
      "Never infer diagnosis, personality, trauma, attachment, unconscious motive or culture. Respect direct obligations and explicit boundaries.",
      "applicable non-repair requires: applicability, primaryGoal, readiness{status,evidence[],counterEvidence[]}, intention, primarySkill, relationshipPriority, expectedUserResponse[], stopOrReassessWhen[], prohibitedMoves[], helperSelfCheck, evidence[], hypotheses[]. readiness.status is exactly supported|uncertain|not_supported (never ready).",
      "repair is allowed only when currentRelationshipEvidence is nonempty; then use applicability=applicable, intention=repair_current_helping_relationship, primarySkill=relationship_repair, relationshipPriority=repair; omit goals/readiness and do not advance another goal.",
      "uncertain/not_applicable requires applicability, relationshipPriority=none, prohibitedMoves[], helperSelfCheck, evidence[], hypotheses[]; omit all goal/readiness/intention/skill/response/reassessment/previous-move fields.",
      "helperSelfCheck={unsupportedAssumptions:[],possibleCulturalAssumptions:[],repeatedFailedMoves:[],capabilityLimits:[],userRejectedClaims:[],pressureRisk:low|medium|high}.",
      "All [] fields are JSON arrays; readiness is an object. Use 1-2 short items per evidence-style array, at most 12 words each. hypotheses is usually [].",
      "Omit previousMoveAssessment unless a semantically related recentCommittedHelpingMove exists; never emit placeholder strings.",
      `Allowed goals: ${GOALS.join(", ")}.`,
      `exploration intentions=${EXPLORATION_INTENTIONS.join("|")}; skills=${EXPLORATION_SKILLS.join("|")}.`,
      `insight intentions=${INSIGHT_INTENTIONS.join("|")}; skills=${INSIGHT_SKILLS.join("|")}.`,
      `action intentions=${ACTION_INTENTIONS.join("|")}; skills=${ACTION_SKILLS.join("|")}.`,
      "relationshipPriority: none, repair, or process_current_relationship.",
      "Do not add keys outside the HillHelpingPlan contract.",
    ].join("\n"),
  },
  { role: "user", content: JSON.stringify(compactInput(input)) },
];

export type HillHelpingDecisionProvider = (input: {
  messages: AiModelMessage[];
  helpingInput: HillHelpingInput;
}) => Promise<AiProviderResponse>;

const defaultProvider: HillHelpingDecisionProvider = ({ messages }) => callModel({
  model: process.env.HILL_HELPING_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
  messages,
  temperature: 0.1,
});

export const isHillHelpingShadowEnabled = (value = process.env.HILL_HELPING_SHADOW) =>
  value?.trim().toLowerCase() === "true";

export const isHillHelpingOrdinaryHandoffEnabled = (
  value = process.env.HILL_HELPING_ORDINARY_HANDOFF
) => value?.trim().toLowerCase() === "true";

export const createSkippedHillHelpingTrace = (
  reason: "feature_disabled" | "safety_pre_gate"
): HillHelpingShadowTrace => ({
  mode: "shadow",
  enabled: false,
  skippedReason: reason,
  decision: null,
  provider: {
    attempted: false,
    used: false,
    reason: reason === "safety_pre_gate"
      ? "Safety pre-gate owns the turn; ordinary Helping Logic was not called."
      : "Hill Helping Shadow is disabled.",
  },
  inputEvidence: [],
});

export const runHillHelpingShadow = async ({
  input,
  enabled = isHillHelpingShadowEnabled(),
  fastBoundaryOnly = false,
  provider = defaultProvider,
  inspectHelpingPrompt,
}: {
  input: HillHelpingInput;
  enabled?: boolean;
  fastBoundaryOnly?: boolean;
  provider?: HillHelpingDecisionProvider;
  inspectHelpingPrompt?: (input: {
    stage: "helping_shadow";
    messages: AiModelMessage[];
  }) => void | Promise<void>;
}): Promise<HillHelpingShadowTrace> => {
  if (!enabled) return createSkippedHillHelpingTrace("feature_disabled");
  const inputEvidence = [
    `userTurnId=${input.userTurnId}`,
    `semanticEvidence=${input.currentUserMaterial.semanticEvidence.status}`,
    `currentActivity=${input.dialogueState.currentActivity.primary}`,
    `directObligations=${input.directObligations.length}`,
    `userBoundaries=${input.userBoundaries.map((item) => item.kind).join(",") || "none"}`,
  ];
  const inputFailures = validateInput(input);
  if (inputFailures.length) {
    return {
      mode: "shadow",
      enabled: true,
      decision: {
        status: "failed",
        failureCode: "invalid_input",
        retryable: false,
        evidence: inputFailures,
      },
      provider: {
        attempted: false,
        used: false,
        reason: "Input contract failed before any provider call.",
      },
      inputEvidence,
    };
  }

  const fastDecision = decideHillFastBoundary(input);
  if (fastDecision) {
    return {
      mode: "shadow",
      enabled: true,
      decision: fastDecision,
      provider: {
        attempted: false,
        used: false,
        reason: "A deterministic evidence boundary completed the applicability decision.",
      },
      inputEvidence,
    };
  }

  if (fastBoundaryOnly) {
    return {
      mode: "shadow",
      enabled: true,
      skippedReason: "ordinary_handoff_no_fast_boundary",
      decision: null,
      provider: {
        attempted: false,
        used: false,
        reason: "Batch 1.5 only needed the deterministic ordinary-handoff boundary; full Hill Shadow is disabled.",
      },
      inputEvidence,
    };
  }

  const messages = buildHillHelpingMessages(input);
  await inspectPromptBeforeExternalCall(inspectHelpingPrompt, {
    stage: "helping_shadow" as const,
    messages,
  });
  try {
    const response = await provider({ messages, helpingInput: input });
    const parsed = extractJsonObject(response.text);
    const validated = validateHillHelpingPlan(parsed);
    const inputPlanFailures = validated.valid
      ? validatePlanAgainstInput(validated.plan, input)
      : [];
    const accepted = validated.valid && inputPlanFailures.length === 0;
    const decision: HillHelpingDecision = accepted
      ? { status: "decided", plan: validated.plan }
      : {
          status: "failed",
          failureCode: "invalid_plan",
          retryable: true,
          evidence: validated.valid ? inputPlanFailures : validated.reasons,
        };
    return {
      mode: "shadow",
      enabled: true,
      decision,
      provider: {
        attempted: true,
        used: accepted,
        reason: accepted
          ? "Provider output passed the frozen HillHelpingPlan contract."
          : "Provider output failed the frozen HillHelpingPlan contract.",
        model: response.model,
        latencyMs: response.latencyMs,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        rawOutput: response.text,
      },
      inputEvidence,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "ExternalPromptRejectedError") throw error;
    const timeout = error instanceof AppError
      ? error.status === 504
      : error instanceof Error && /timeout|超时/iu.test(error.message);
    return {
      mode: "shadow",
      enabled: true,
      decision: {
        status: "failed",
        failureCode: timeout ? "timeout" : "provider_failure",
        retryable: true,
        evidence: [error instanceof Error ? error.message : "Unknown Helping provider failure."],
      },
      provider: {
        attempted: true,
        used: false,
        reason: timeout ? "Helping provider timed out." : "Helping provider failed.",
        error: error instanceof Error ? error.message : "Unknown Helping provider failure.",
      },
      inputEvidence,
    };
  }
};
