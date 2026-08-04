import type { ResponsePlan } from "@/conversation-os/control";
import type { ProactiveGreetingHandoffFunction } from "@/conversation-os/interactionMoveEnvelope";

import { callModel, getDefaultAiModel } from "./modelProvider";
import { inspectPromptBeforeExternalCall } from "./externalPromptInspection";
import type { AiModelMessage } from "./types";

export type InteractionMoveHandoffSemanticContext = {
  targetAssistantText: string;
  currentUserText: string;
};

export type InteractionMoveHandoffSemanticProviderInput = {
  planId: string;
  planBinding: NonNullable<ResponsePlan["interactionMoveHandoffPlan"]>;
  targetAssistantText: string;
  currentUserText: string;
  candidateReply: string;
  ordinaryQuestionIndependentlySupported: boolean;
};

export type InteractionMoveHandoffSemanticProvider = (
  input: InteractionMoveHandoffSemanticProviderInput
) => Promise<unknown>;

export type InteractionMoveHandoffValidationPromptInspector = (input: {
  stage: "interaction_move_handoff_validation";
  messages: AiModelMessage[];
}) => void | Promise<void>;

type SemanticEvidenceSpan = {
  start: number;
  end: number;
  text: string;
  reason: string;
};

export type InteractionMoveHandoffSemanticVerdict = {
  schemaVersion: 1;
  planId: string;
  sourceAssistantMoveId: string;
  sourceUserTurnId: string;
  selectedRelation: NonNullable<ResponsePlan["interactionMoveHandoffPlan"]>["selectedRelation"];
  requiredFunction: NonNullable<ResponsePlan["interactionMoveHandoffPlan"]>["requiredFunction"];
  completionIntent: NonNullable<ResponsePlan["interactionMoveHandoffPlan"]>["completionIntent"];
  questionPolicy: NonNullable<ResponsePlan["interactionMoveHandoffPlan"]>["questionPolicy"];
  status: "satisfied" | "not_satisfied" | "uncertain";
  realizedFunction: ProactiveGreetingHandoffFunction | null;
  targetAddressed: boolean;
  relationAddressed: boolean;
  positiveFunctionRealized: boolean;
  containsContradictoryMove: boolean;
  handoffCompletionClaimed: boolean;
  semanticQuestionCount: number;
  ordinaryQuestionIndependentlySupported: boolean;
  optionalQuestionAfterPositiveFunction: boolean;
  evidence: SemanticEvidenceSpan[];
};

const VERDICT_KEYS = [
  "schemaVersion", "planId", "sourceAssistantMoveId", "sourceUserTurnId",
  "selectedRelation", "requiredFunction", "completionIntent", "questionPolicy",
  "status", "realizedFunction", "targetAddressed", "relationAddressed",
  "positiveFunctionRealized", "containsContradictoryMove", "handoffCompletionClaimed",
  "semanticQuestionCount", "ordinaryQuestionIndependentlySupported",
  "optionalQuestionAfterPositiveFunction", "evidence",
] as const;
const EVIDENCE_KEYS = ["start", "end", "text", "reason"] as const;
const REALIZED_FUNCTIONS = new Set<unknown>([
  "complete_reciprocal_contact",
  "continue_from_user_answer",
  "continue_user_introduced_content",
  "answer_current_obligation",
  "withdraw_or_repair_targeted_move",
  "respect_user_boundary",
]);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
};

export const parseInteractionMoveHandoffSemanticProviderOutput = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parseVerdict = (value: unknown): InteractionMoveHandoffSemanticVerdict | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!hasExactKeys(record, VERDICT_KEYS)) return null;
  if (
    record.schemaVersion !== 1 ||
    typeof record.planId !== "string" ||
    typeof record.sourceAssistantMoveId !== "string" ||
    typeof record.sourceUserTurnId !== "string" ||
    typeof record.selectedRelation !== "string" ||
    typeof record.requiredFunction !== "string" ||
    (record.completionIntent !== "fulfill" && record.completionIntent !== "defer") ||
    (record.questionPolicy !== "none" && record.questionPolicy !== "optional_after_completion") ||
    !["satisfied", "not_satisfied", "uncertain"].includes(String(record.status)) ||
    !(record.realizedFunction === null || REALIZED_FUNCTIONS.has(record.realizedFunction)) ||
    typeof record.targetAddressed !== "boolean" ||
    typeof record.relationAddressed !== "boolean" ||
    typeof record.positiveFunctionRealized !== "boolean" ||
    typeof record.containsContradictoryMove !== "boolean" ||
    typeof record.handoffCompletionClaimed !== "boolean" ||
    !Number.isInteger(record.semanticQuestionCount) ||
    Number(record.semanticQuestionCount) < 0 ||
    typeof record.ordinaryQuestionIndependentlySupported !== "boolean" ||
    typeof record.optionalQuestionAfterPositiveFunction !== "boolean" ||
    !Array.isArray(record.evidence)
  ) return null;
  const evidence = record.evidence as unknown[];
  if (evidence.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const span = item as Record<string, unknown>;
    return !hasExactKeys(span, EVIDENCE_KEYS) ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      Number(span.start) < 0 ||
      Number(span.end) <= Number(span.start) ||
      typeof span.text !== "string" ||
      typeof span.reason !== "string" ||
      !span.reason.trim();
  })) return null;
  return record as InteractionMoveHandoffSemanticVerdict;
};

const buildSemanticValidationMessages = (
  input: InteractionMoveHandoffSemanticProviderInput
): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "You are an independent same-plan semantic verifier, not a response writer.",
      "Judge meaning and conversational function in context. Do not use punctuation, phrase membership, keyword matching, or a Surface self-reported label as proof.",
      "A mixed reply fails when a later move contradicts, repeats, defends, pressures, or functionally undoes the required function.",
      "handoffCompletionClaimed must be false. A reply must never self-report that an internal handoff, function, plan, or validation completed.",
      "semanticQuestionCount counts semantic requests for a User response even without question punctuation.",
      "When one optional question exists, optionalQuestionAfterPositiveFunction is true only if the required positive function is fully realized before that question begins.",
      "Evidence spans must quote exact UTF-16 slices of candidateReply that support the verdict.",
      "Return exactly one JSON object with every field in the supplied schema and no extra fields.",
    ].join("\n"),
  },
  {
    role: "user",
    content: JSON.stringify({
      planId: input.planId,
      planBinding: input.planBinding,
      targetAssistantText: input.targetAssistantText,
      currentUserText: input.currentUserText,
      candidateReply: input.candidateReply,
      ordinaryQuestionIndependentlySupported: input.ordinaryQuestionIndependentlySupported,
      outputSchema: {
        schemaVersion: 1,
        planId: "exact ResponsePlan planId supplied by caller",
        sourceAssistantMoveId: "exact plan binding",
        sourceUserTurnId: "exact plan binding",
        selectedRelation: "exact plan binding",
        requiredFunction: "exact plan binding",
        completionIntent: "exact plan binding",
        questionPolicy: "exact plan binding",
        status: "satisfied | not_satisfied | uncertain",
        realizedFunction: "one handoff function or null",
        targetAddressed: "boolean",
        relationAddressed: "boolean",
        positiveFunctionRealized: "boolean",
        containsContradictoryMove: "boolean",
        handoffCompletionClaimed: "boolean",
        semanticQuestionCount: "non-negative integer",
        ordinaryQuestionIndependentlySupported: "boolean",
        optionalQuestionAfterPositiveFunction: "boolean",
        evidence: [{ start: "integer", end: "integer", text: "exact slice", reason: "semantic reason" }],
      },
    }),
  },
];

export const defaultInteractionMoveHandoffSemanticProvider = async (
  input: InteractionMoveHandoffSemanticProviderInput,
  inspectExternalPrompt?: InteractionMoveHandoffValidationPromptInspector
) => {
  const messages = buildSemanticValidationMessages(input);
  await inspectPromptBeforeExternalCall(inspectExternalPrompt, {
    stage: "interaction_move_handoff_validation" as const,
    messages,
  });
  const response = await callModel({
    model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    messages,
    temperature: 0,
  });
  return parseInteractionMoveHandoffSemanticProviderOutput(response.text);
};

const ordinaryQuestionSupportedByPlan = (plan: ResponsePlan) =>
  plan.questionPolicy.mode !== "none" &&
  plan.responseActions.some((action) =>
    action === "take_light_topic_initiative" ||
    action === "invite_low_pressure_calibration"
  );

export const validateInteractionMoveHandoffOutput = async ({
  plan,
  reply,
  semanticContext,
  provider,
  inspectExternalPrompt,
}: {
  plan: ResponsePlan;
  reply: string;
  semanticContext?: InteractionMoveHandoffSemanticContext;
  provider?: InteractionMoveHandoffSemanticProvider;
  inspectExternalPrompt?: InteractionMoveHandoffValidationPromptInspector;
}): Promise<{ passed: boolean; failureReasons: string[]; verdict: InteractionMoveHandoffSemanticVerdict | null }> => {
  const handoff = plan.interactionMoveHandoffPlan;
  if (!handoff) return { passed: true, failureReasons: [], verdict: null };
  if (!semanticContext) {
    return {
      passed: false,
      failureReasons: ["interaction_move_handoff_semantic:missing_context"],
      verdict: null,
    };
  }
  const ordinaryQuestionSupported = ordinaryQuestionSupportedByPlan(plan);
  let rawVerdict: unknown;
  try {
    const providerInput: InteractionMoveHandoffSemanticProviderInput = {
      planId: plan.planId,
      planBinding: structuredClone(handoff),
      targetAssistantText: semanticContext.targetAssistantText,
      currentUserText: semanticContext.currentUserText,
      candidateReply: reply,
      ordinaryQuestionIndependentlySupported: ordinaryQuestionSupported,
    };
    rawVerdict = provider
      ? await provider(providerInput)
      : await defaultInteractionMoveHandoffSemanticProvider(providerInput, inspectExternalPrompt);
  } catch {
    return {
      passed: false,
      failureReasons: ["interaction_move_handoff_semantic:provider_failure"],
      verdict: null,
    };
  }
  const verdict = parseVerdict(rawVerdict);
  if (!verdict) {
    return {
      passed: false,
      failureReasons: ["interaction_move_handoff_semantic:malformed_verdict"],
      verdict: null,
    };
  }
  const bindingMatches =
    verdict.planId === plan.planId &&
    verdict.sourceAssistantMoveId === handoff.sourceAssistantMoveId &&
    verdict.sourceUserTurnId === handoff.sourceUserTurnId &&
    verdict.selectedRelation === handoff.selectedRelation &&
    verdict.requiredFunction === handoff.requiredFunction &&
    verdict.completionIntent === handoff.completionIntent &&
    verdict.questionPolicy === handoff.questionPolicy;
  if (!bindingMatches) {
    return {
      passed: false,
      failureReasons: ["interaction_move_handoff_semantic:binding_mismatch"],
      verdict,
    };
  }
  const evidenceValid = verdict.evidence.every((span) =>
    span.end <= reply.length &&
    reply.slice(span.start, span.end) === span.text
  );
  if (!evidenceValid) {
    return {
      passed: false,
      failureReasons: ["interaction_move_handoff_semantic:evidence_mismatch"],
      verdict,
    };
  }
  if (verdict.status === "uncertain") {
    return {
      passed: false,
      failureReasons: ["interaction_move_handoff_semantic:uncertain"],
      verdict,
    };
  }
  const commonSatisfied = verdict.status === "satisfied" &&
    verdict.targetAddressed &&
    verdict.relationAddressed &&
    !verdict.containsContradictoryMove &&
    !verdict.handoffCompletionClaimed;
  const functionSatisfied = handoff.completionIntent === "defer"
    ? verdict.realizedFunction === null &&
      !verdict.positiveFunctionRealized &&
      !verdict.handoffCompletionClaimed
    : verdict.realizedFunction === handoff.requiredFunction &&
      verdict.positiveFunctionRealized &&
      verdict.evidence.length > 0;
  const questionSatisfied = handoff.questionPolicy === "none"
    ? verdict.semanticQuestionCount === 0
    : verdict.semanticQuestionCount <= 1 &&
      (
        verdict.semanticQuestionCount === 0 ||
        (
          ordinaryQuestionSupported &&
          verdict.ordinaryQuestionIndependentlySupported &&
          verdict.optionalQuestionAfterPositiveFunction &&
          verdict.positiveFunctionRealized
        )
      );
  const passed = commonSatisfied && functionSatisfied && questionSatisfied;
  return {
    passed,
    failureReasons: passed
      ? []
      : ["interaction_move_handoff_semantic:function_or_policy_not_satisfied"],
    verdict,
  };
};
