import type { ResponsePlan, ResponseValidationResult } from "./control";
import type { CommittedAssistantMove } from "./types";

export const INTERACTION_MOVE_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const INTERACTION_MOVE_ENVELOPE_TRACE_KEY = "interactionMoveEnvelope" as const;

export type ProactiveGreetingMove =
  | "simple_greeting"
  | "open_statement"
  | "light_question";

export type ProactiveGreetingRequiredFunction =
  | "initiate_reciprocal_contact"
  | "offer_self_contained_conversation_entry"
  | "ask_one_bounded_low_burden_question";

export type ProactiveGreetingHandoffFunction =
  | "complete_reciprocal_contact"
  | "continue_from_user_answer"
  | "continue_user_introduced_content"
  | "answer_current_obligation"
  | "withdraw_or_repair_targeted_move"
  | "respect_user_boundary";

export type ProactiveGreetingCommittedMove = Omit<CommittedAssistantMove, "sourceTurnId"> & {
  sourceTurnId: null;
};

export type ProactiveGreetingOpenMetadata = {
  kind: "proactive_greeting";
  edge: "opens";
  greetingFunction: ProactiveGreetingRequiredFunction;
};

export type ProactiveGreetingFulfillmentMetadata = {
  kind: "proactive_greeting";
  edge: "fulfills";
  sourceAssistantMoveId: string;
  realizedFunction: ProactiveGreetingHandoffFunction;
};

export type ProactiveGreetingSupersessionMetadata = {
  kind: "proactive_greeting";
  edge: "supersedes";
  sourceAssistantMoveId: string;
  reason: "safety_override";
};

type EnvelopeBase = {
  schemaVersion: typeof INTERACTION_MOVE_ENVELOPE_SCHEMA_VERSION;
  assistantMoveId: string;
};

export type ProactiveGreetingAssistantMoveEnvelopeV1 = EnvelopeBase & {
  origin: {
    kind: "proactive_greeting";
    generationId: string;
  };
  committedMove: ProactiveGreetingCommittedMove;
  handoff: ProactiveGreetingOpenMetadata;
};

export type ResponsePlanAssistantMoveEnvelopeV1 = EnvelopeBase & {
  origin: {
    kind: "response_plan";
    planId: string;
    sourceUserTurnId: string;
  };
  committedMove: CommittedAssistantMove;
  handoff: ProactiveGreetingFulfillmentMetadata | null;
};

export type SafetyAssistantMoveEnvelopeV1 = EnvelopeBase & {
  origin: {
    kind: "safety_override";
    safetyTraceId: string;
    sourceUserTurnId: string;
  };
  committedMove: CommittedAssistantMove;
  handoff: ProactiveGreetingSupersessionMetadata;
};

export type CommittedAssistantMoveEnvelopeV1 =
  | ProactiveGreetingAssistantMoveEnvelopeV1
  | ResponsePlanAssistantMoveEnvelopeV1
  | SafetyAssistantMoveEnvelopeV1;

export type CommittedAssistantMoveEnvelopeParseResult =
  | { status: "absent" }
  | { status: "invalid"; reasons: string[] }
  | { status: "valid"; envelope: CommittedAssistantMoveEnvelopeV1 };

export type InteractionMoveHandoffCommitEvidence = {
  executionPhase: "VALIDATED";
  finalAttemptPhase: "GENERATED" | "VALIDATED" | "REJECTED" | "FAILED" | null;
  executionPlanId: string;
  executionTurnId: string;
  responsePlan: ResponsePlan;
  finalValidation: ResponseValidationResult | null;
};

const ENVELOPE_KEYS = new Set(["schemaVersion", "assistantMoveId", "origin", "committedMove", "handoff"]);
const PROACTIVE_ORIGIN_KEYS = new Set(["kind", "generationId"]);
const RESPONSE_ORIGIN_KEYS = new Set(["kind", "planId", "sourceUserTurnId"]);
const SAFETY_ORIGIN_KEYS = new Set(["kind", "safetyTraceId", "sourceUserTurnId"]);
const MOVE_KEYS = new Set([
  "purpose",
  "claims",
  "assumptions",
  "questionOrRequest",
  "expectedUserContribution",
  "userBurden",
  "sourceTurnId",
  "evidence",
]);
const CLAIM_KEYS = new Set(["text", "subject", "source", "provenance"]);
const ASSUMPTION_KEYS = new Set(["text", "status"]);
const QUESTION_KEYS = new Set(["kind", "text"]);
const OPEN_HANDOFF_KEYS = new Set(["kind", "edge", "greetingFunction"]);
const FULFILLS_HANDOFF_KEYS = new Set(["kind", "edge", "sourceAssistantMoveId", "realizedFunction"]);
const SUPERSEDES_HANDOFF_KEYS = new Set(["kind", "edge", "sourceAssistantMoveId", "reason"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  reasons: string[]
) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reasons.push(`${path}:unknown_key:${key}`);
  }
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const validateCommittedMove = (
  value: unknown,
  sourceKind: "ordinary" | "proactive",
  reasons: string[]
) => {
  if (!isRecord(value)) {
    reasons.push("committedMove:not_object");
    return;
  }
  hasExactKeys(value, MOVE_KEYS, "committedMove", reasons);
  if (!isStringArray(value.purpose)) reasons.push("committedMove:invalid_purpose");
  if (!isStringArray(value.evidence)) reasons.push("committedMove:invalid_evidence");
  if (!Array.isArray(value.claims)) {
    reasons.push("committedMove:invalid_claims");
  } else {
    for (const [index, claim] of value.claims.entries()) {
      if (!isRecord(claim)) {
        reasons.push(`committedMove.claims[${index}]:not_object`);
        continue;
      }
      hasExactKeys(claim, CLAIM_KEYS, `committedMove.claims[${index}]`, reasons);
      if (!isNonEmptyString(claim.text)) reasons.push(`committedMove.claims[${index}]:invalid_text`);
      if (!isStringArray(claim.provenance)) reasons.push(`committedMove.claims[${index}]:invalid_provenance`);
      if (
        claim.subject !== undefined &&
        !["user", "assistant", "system", "conversation"].includes(String(claim.subject))
      ) reasons.push(`committedMove.claims[${index}]:invalid_subject`);
      if (
        claim.source !== undefined &&
        !["current_turn", "adjacent_turn", "interaction_state", "system_truth", "safety"].includes(String(claim.source))
      ) reasons.push(`committedMove.claims[${index}]:invalid_source`);
    }
  }
  if (!Array.isArray(value.assumptions)) {
    reasons.push("committedMove:invalid_assumptions");
  } else {
    for (const [index, assumption] of value.assumptions.entries()) {
      if (!isRecord(assumption)) {
        reasons.push(`committedMove.assumptions[${index}]:not_object`);
        continue;
      }
      hasExactKeys(assumption, ASSUMPTION_KEYS, `committedMove.assumptions[${index}]`, reasons);
      if (!isNonEmptyString(assumption.text)) reasons.push(`committedMove.assumptions[${index}]:invalid_text`);
      if (assumption.status !== "hypothesized") reasons.push(`committedMove.assumptions[${index}]:invalid_status`);
    }
  }
  if (value.questionOrRequest !== null) {
    if (!isRecord(value.questionOrRequest)) {
      reasons.push("committedMove:invalid_question_or_request");
    } else {
      hasExactKeys(value.questionOrRequest, QUESTION_KEYS, "committedMove.questionOrRequest", reasons);
      if (!["question", "request"].includes(String(value.questionOrRequest.kind))) {
        reasons.push("committedMove.questionOrRequest:invalid_kind");
      }
      if (
        value.questionOrRequest.text !== undefined &&
        typeof value.questionOrRequest.text !== "string"
      ) reasons.push("committedMove.questionOrRequest:invalid_text");
    }
  }
  if (!["answer", "choose_topic", "share", "none"].includes(String(value.expectedUserContribution))) {
    reasons.push("committedMove:invalid_expected_user_contribution");
  }
  if (!["none", "low", "medium", "high"].includes(String(value.userBurden))) {
    reasons.push("committedMove:invalid_user_burden");
  }
  if (sourceKind === "proactive") {
    if (value.sourceTurnId !== null) reasons.push("committedMove:proactive_source_turn_must_be_null");
  } else if (!isNonEmptyString(value.sourceTurnId)) {
    reasons.push("committedMove:ordinary_source_turn_missing");
  }
};

const validateHandoff = (value: unknown, reasons: string[]) => {
  if (value === null) return;
  if (!isRecord(value)) {
    reasons.push("handoff:not_object");
    return;
  }
  if (value.kind !== "proactive_greeting") reasons.push("handoff:invalid_kind");
  if (value.edge === "opens") {
    hasExactKeys(value, OPEN_HANDOFF_KEYS, "handoff", reasons);
    if (![
      "initiate_reciprocal_contact",
      "offer_self_contained_conversation_entry",
      "ask_one_bounded_low_burden_question",
    ].includes(String(value.greetingFunction))) reasons.push("handoff:invalid_greeting_function");
    return;
  }
  if (value.edge === "fulfills") {
    hasExactKeys(value, FULFILLS_HANDOFF_KEYS, "handoff", reasons);
    if (!isNonEmptyString(value.sourceAssistantMoveId)) reasons.push("handoff:missing_source_assistant_move_id");
    if (![
      "complete_reciprocal_contact",
      "continue_from_user_answer",
      "continue_user_introduced_content",
      "answer_current_obligation",
      "withdraw_or_repair_targeted_move",
      "respect_user_boundary",
    ].includes(String(value.realizedFunction))) reasons.push("handoff:invalid_realized_function");
    return;
  }
  if (value.edge === "supersedes") {
    hasExactKeys(value, SUPERSEDES_HANDOFF_KEYS, "handoff", reasons);
    if (!isNonEmptyString(value.sourceAssistantMoveId)) reasons.push("handoff:missing_source_assistant_move_id");
    if (value.reason !== "safety_override") reasons.push("handoff:invalid_supersession_reason");
    return;
  }
  reasons.push("handoff:invalid_edge");
};

export const parseCommittedAssistantMoveEnvelope = (
  value: unknown
): CommittedAssistantMoveEnvelopeParseResult => {
  if (value === null || value === undefined) return { status: "absent" };
  const reasons: string[] = [];
  if (!isRecord(value)) return { status: "invalid", reasons: ["envelope:not_object"] };
  hasExactKeys(value, ENVELOPE_KEYS, "envelope", reasons);
  if (value.schemaVersion !== INTERACTION_MOVE_ENVELOPE_SCHEMA_VERSION) {
    reasons.push("envelope:invalid_schema_version");
  }
  if (!isNonEmptyString(value.assistantMoveId)) reasons.push("envelope:missing_assistant_move_id");
  if (!isRecord(value.origin)) {
    reasons.push("origin:not_object");
  } else if (value.origin.kind === "proactive_greeting") {
    hasExactKeys(value.origin, PROACTIVE_ORIGIN_KEYS, "origin", reasons);
    if (!isNonEmptyString(value.origin.generationId)) reasons.push("origin:missing_generation_id");
    validateCommittedMove(value.committedMove, "proactive", reasons);
    validateHandoff(value.handoff, reasons);
    if (!isRecord(value.handoff) || value.handoff.edge !== "opens") {
      reasons.push("envelope:proactive_origin_requires_open_edge");
    }
  } else if (value.origin.kind === "response_plan") {
    hasExactKeys(value.origin, RESPONSE_ORIGIN_KEYS, "origin", reasons);
    if (!isNonEmptyString(value.origin.planId)) reasons.push("origin:missing_plan_id");
    if (!isNonEmptyString(value.origin.sourceUserTurnId)) reasons.push("origin:missing_source_user_turn_id");
    validateCommittedMove(value.committedMove, "ordinary", reasons);
    validateHandoff(value.handoff, reasons);
    if (isRecord(value.handoff) && value.handoff.edge !== "fulfills") {
      reasons.push("envelope:response_origin_invalid_handoff_edge");
    }
    if (
      isRecord(value.committedMove) &&
      value.committedMove.sourceTurnId !== value.origin.sourceUserTurnId
    ) reasons.push("envelope:response_source_turn_mismatch");
  } else if (value.origin.kind === "safety_override") {
    hasExactKeys(value.origin, SAFETY_ORIGIN_KEYS, "origin", reasons);
    if (!isNonEmptyString(value.origin.safetyTraceId)) reasons.push("origin:missing_safety_trace_id");
    if (!isNonEmptyString(value.origin.sourceUserTurnId)) reasons.push("origin:missing_source_user_turn_id");
    validateCommittedMove(value.committedMove, "ordinary", reasons);
    validateHandoff(value.handoff, reasons);
    if (!isRecord(value.handoff) || value.handoff.edge !== "supersedes") {
      reasons.push("envelope:safety_origin_requires_supersedes_edge");
    }
    if (
      isRecord(value.committedMove) &&
      value.committedMove.sourceTurnId !== value.origin.sourceUserTurnId
    ) reasons.push("envelope:safety_source_turn_mismatch");
  } else {
    reasons.push("origin:invalid_kind");
    validateCommittedMove(value.committedMove, "ordinary", reasons);
    validateHandoff(value.handoff, reasons);
  }
  if (
    isRecord(value.handoff) &&
    isNonEmptyString(value.handoff.sourceAssistantMoveId) &&
    value.handoff.sourceAssistantMoveId === value.assistantMoveId
  ) reasons.push("handoff:self_target_forbidden");
  if (reasons.length > 0) return { status: "invalid", reasons: Array.from(new Set(reasons)) };
  return {
    status: "valid",
    envelope: JSON.parse(JSON.stringify(value)) as CommittedAssistantMoveEnvelopeV1,
  };
};

const requireValidEnvelope = (
  envelope: CommittedAssistantMoveEnvelopeV1
): CommittedAssistantMoveEnvelopeV1 => {
  const parsed = parseCommittedAssistantMoveEnvelope(envelope);
  if (parsed.status !== "valid") {
    throw new Error(`Invalid committed Assistant move envelope: ${parsed.status === "invalid" ? parsed.reasons.join(",") : "absent"}`);
  }
  return parsed.envelope;
};

export const proactiveGreetingRequiredFunctionFor = (
  move: ProactiveGreetingMove
): ProactiveGreetingRequiredFunction => {
  if (move === "simple_greeting") return "initiate_reciprocal_contact";
  if (move === "open_statement") return "offer_self_contained_conversation_entry";
  return "ask_one_bounded_low_burden_question";
};

export const buildProactiveGreetingAssistantMoveEnvelope = ({
  assistantMoveId,
  generationId,
  greetingMove,
}: {
  assistantMoveId: string;
  generationId: string;
  greetingMove: ProactiveGreetingMove;
}): ProactiveGreetingAssistantMoveEnvelopeV1 => {
  const greetingFunction = proactiveGreetingRequiredFunctionFor(greetingMove);
  const asksQuestion = greetingMove === "light_question";
  return requireValidEnvelope({
    schemaVersion: INTERACTION_MOVE_ENVELOPE_SCHEMA_VERSION,
    assistantMoveId,
    origin: { kind: "proactive_greeting", generationId },
    committedMove: {
      purpose: ["proactive_greeting", greetingMove, greetingFunction],
      claims: [],
      assumptions: [],
      questionOrRequest: asksQuestion ? { kind: "question" } : null,
      expectedUserContribution: asksQuestion ? "answer" : "none",
      userBurden: asksQuestion ? "low" : "none",
      sourceTurnId: null,
      evidence: [
        `proactiveGreetingMove=${greetingMove}`,
        `proactiveGreetingFunction=${greetingFunction}`,
        "Created only with the committed proactive Assistant event.",
      ],
    },
    handoff: {
      kind: "proactive_greeting",
      edge: "opens",
      greetingFunction,
    },
  }) as ProactiveGreetingAssistantMoveEnvelopeV1;
};

export const buildCommittedResponseMove = ({
  plan,
  replyText,
  sourceUserTurnId,
  planId,
  requestId,
}: {
  plan?: ResponsePlan | null;
  replyText: string;
  sourceUserTurnId: string;
  planId: string;
  requestId: string;
}): CommittedAssistantMove => {
  const question = Boolean(
    plan &&
    plan.questionPolicy.mode !== "none" &&
    /[？?]/u.test(replyText)
  );
  return {
    purpose: plan?.responseActions ?? [],
    claims: [
      ...(plan?.groundingFacts ?? []),
      ...(plan?.requiredDisclosure ?? []),
    ].map((text) => ({
      text,
      subject: plan?.requiredDisclosure.includes(text) ? "assistant" as const : "user" as const,
      source: plan?.relevanceProvenance.find((item) => item.planElement.endsWith(text))?.source,
      provenance: plan?.relevanceProvenance
        .filter((item) => item.planElement.endsWith(text))
        .flatMap((item) => item.evidence) ?? [],
    })),
    assumptions: [],
    questionOrRequest: question ? { kind: "question" } : null,
    expectedUserContribution: question
      ? plan?.responseActions.includes("take_light_topic_initiative")
        ? "share"
        : "answer"
      : "none",
    userBurden: question ? "low" : "none",
    sourceTurnId: sourceUserTurnId,
    evidence: [
      `planId=${planId}`,
      `requestId=${requestId}`,
      "Created only after the validated Assistant Message committed.",
    ],
  };
};

export const buildResponsePlanAssistantMoveEnvelope = ({
  assistantMoveId,
  planId,
  sourceUserTurnId,
  committedMove,
  handoffCommitEvidence,
}: {
  assistantMoveId: string;
  planId: string;
  sourceUserTurnId: string;
  committedMove: CommittedAssistantMove;
  handoffCommitEvidence?: InteractionMoveHandoffCommitEvidence | null;
}): ResponsePlanAssistantMoveEnvelopeV1 => requireValidEnvelope({
  schemaVersion: INTERACTION_MOVE_ENVELOPE_SCHEMA_VERSION,
  assistantMoveId,
  origin: {
    kind: "response_plan",
    planId,
    sourceUserTurnId,
  },
  committedMove,
  handoff: buildValidatedHandoffFulfillment({
    planId,
    sourceUserTurnId,
    evidence: handoffCommitEvidence ?? null,
  }),
}) as ResponsePlanAssistantMoveEnvelopeV1;

const buildValidatedHandoffFulfillment = ({
  planId,
  sourceUserTurnId,
  evidence,
}: {
  planId: string;
  sourceUserTurnId: string;
  evidence: InteractionMoveHandoffCommitEvidence | null;
}): ProactiveGreetingFulfillmentMetadata | null => {
  if (!evidence) return null;
  const { responsePlan, finalValidation } = evidence;
  const handoff = responsePlan.interactionMoveHandoffPlan;
  if (!handoff) return null;
  if (
    evidence.executionPhase !== "VALIDATED" ||
    evidence.finalAttemptPhase !== "VALIDATED" ||
    evidence.executionPlanId !== planId ||
    responsePlan.planId !== planId ||
    evidence.executionTurnId !== sourceUserTurnId ||
    responsePlan.disclosureScope.turnId !== sourceUserTurnId ||
    handoff.sourceUserTurnId !== sourceUserTurnId ||
    !finalValidation?.passed ||
    finalValidation.planChanged !== false ||
    finalValidation.checkedPlanId !== planId
  ) {
    throw new Error("Invalid validated interaction move handoff commit evidence.");
  }
  if (
    handoff.completionIntent === "defer" &&
    handoff.requiredFunction === "defer_handoff_completion"
  ) return null;
  if (
    handoff.completionIntent !== "fulfill" ||
    handoff.requiredFunction === "defer_handoff_completion"
  ) {
    throw new Error("Invalid interaction move handoff completion intent.");
  }
  return {
    kind: "proactive_greeting",
    edge: "fulfills",
    sourceAssistantMoveId: handoff.sourceAssistantMoveId,
    realizedFunction: handoff.requiredFunction,
  };
};

export const handoffCompleted = (
  sourceAssistantMoveId: string,
  committedEvents: readonly unknown[]
): boolean => {
  if (!isNonEmptyString(sourceAssistantMoveId)) return false;
  return committedEvents.some((event) => {
    const parsed = parseCommittedAssistantMoveEnvelope(event);
    return parsed.status === "valid" &&
      parsed.envelope.handoff?.edge === "fulfills" &&
      parsed.envelope.handoff.sourceAssistantMoveId === sourceAssistantMoveId;
  });
};

export const attachCommittedAssistantMoveEnvelope = (
  trace: unknown,
  envelope: CommittedAssistantMoveEnvelopeV1
): Record<string, unknown> => ({
  ...(isRecord(trace) ? trace : {}),
  [INTERACTION_MOVE_ENVELOPE_TRACE_KEY]: requireValidEnvelope(envelope),
});

export const extractCommittedAssistantMoveEnvelope = (
  trace: unknown
): CommittedAssistantMoveEnvelopeV1 | null => {
  if (!isRecord(trace)) return null;
  const parsed = parseCommittedAssistantMoveEnvelope(trace[INTERACTION_MOVE_ENVELOPE_TRACE_KEY]);
  return parsed.status === "valid" ? parsed.envelope : null;
};
