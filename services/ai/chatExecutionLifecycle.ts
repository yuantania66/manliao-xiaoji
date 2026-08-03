import { randomUUID } from "node:crypto";

import type { ResponsePlan, ResponseValidationResult } from "@/conversation-os/control";
import { projectAffectEvidenceTerms } from "@/conversation-os/state";

import type { AiGenerationResult } from "./types";

export type ChatExecutionPhase =
  | "PLANNED"
  | "GENERATED"
  | "VALIDATED"
  | "REJECTED"
  | "RETRYING"
  | "COMMITTED"
  | "FAILED";

export type ChatExecutionFailureCode =
  | "PLAN_INVALID"
  | "GENERATION_NONCONFORMANT"
  | "SAFETY_BLOCKED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "PERSISTENCE_ERROR";

export type ChatExecutionAttempt = {
  attemptId: string;
  phase: "GENERATED" | "VALIDATED" | "REJECTED" | "FAILED";
  generation?: AiGenerationResult;
  validation?: ResponseValidationResult;
};

export type ChatExecutionTransition = {
  phase: ChatExecutionPhase;
  attemptId?: string;
  reason: string;
};

export type ChatExecutionTrace = {
  requestId: string;
  conversationId: string;
  turnId: string;
  planId: string;
  phase: ChatExecutionPhase;
  planPreflight: {
    passed: boolean;
    failureReasons: string[];
  };
  transitions: ChatExecutionTransition[];
  attempts: ChatExecutionAttempt[];
  failure?: {
    code: ChatExecutionFailureCode;
    reason: string;
    retryable: boolean;
  };
  committedMessageId?: string;
};

export type UserSafeExecutionStatus = {
  type: "system_status";
  code: ChatExecutionFailureCode;
  message: string;
  retryable: boolean;
  turnId: string;
};

export const createExecutionIdentity = ({
  requestId,
  turnId,
}: {
  requestId?: string;
  turnId?: string;
}) => ({
  requestId: requestId ?? randomUUID(),
  turnId: turnId ?? randomUUID(),
});

export const preflightResponsePlan = (plan: ResponsePlan) => {
  const failureReasons: string[] = [];
  if (!plan.planId.trim()) failureReasons.push("missing_plan_id");
  if (plan.decisionOwner !== "conversation_os.response_planner") {
    failureReasons.push("invalid_decision_owner");
  }
  if (!["ordinary_conversation", "legacy_compat"].includes(plan.behaviorSource)) {
    failureReasons.push("invalid_behavior_source");
  }
  if (
    plan.responseActions.some((action) => [
      "invite_low_pressure_calibration",
      "continue_established_frame",
      "continue_established_thread",
      "offer_neutral_conversation_entry",
    ].includes(action)) &&
    plan.behaviorSource !== "ordinary_conversation"
  ) {
    failureReasons.push("ordinary_handoff_requires_ordinary_behavior_source");
  }
  if (!plan.disclosureScope.conversationId || !plan.disclosureScope.turnId) {
    failureReasons.push("missing_disclosure_scope");
  }
  if (!["minimal", "standard", "deep"].includes(plan.planningDepth)) {
    failureReasons.push("invalid_planning_depth");
  }
  const positiveAction = plan.responseActions.find((action) =>
    action === "offer_emotional_support" || action === "repair_previous_wording"
  );
  if (positiveAction && plan.positiveFunctionContract?.action !== positiveAction) {
    failureReasons.push(`missing_or_mismatched_positive_function_contract:${positiveAction}`);
  }
  if (plan.positiveFunctionContract?.action === "offer_emotional_support") {
    const contract = plan.positiveFunctionContract;
    const spans = Array.isArray(contract.affectEvidenceSpans)
      ? contract.affectEvidenceSpans
      : [];
    if (spans.length === 0) {
      failureReasons.push("missing_emotional_support_evidence_spans");
    }
    if (contract.sourceTurnId !== plan.disclosureScope.turnId) {
      failureReasons.push("emotional_support_evidence_wrong_turn");
    }
    const validCategories = new Set([
      "unhappiness", "blocked_affect", "sadness", "grievance", "anger", "worry",
      "relational_impact", "embarrassment", "loneliness", "irritation", "fatigue",
      "distress", "fear", "anxiety", "panic", "despair", "overwhelm", "pressure", "guilt",
    ]);
    const validIntensities = new Set(["low", "moderate", "high", "unspecified"]);
    const validObjects = new Set([
      "self_experience", "assistant_relationship", "interpersonal_experience",
    ]);
    for (const span of spans) {
      if (span.sourceTurnId !== contract.sourceTurnId || span.source !== "current_user_message") {
        failureReasons.push("emotional_support_evidence_wrong_turn");
      }
      if (
        !Number.isInteger(span.start) ||
        !Number.isInteger(span.end) ||
        span.start < 0 ||
        span.end <= span.start ||
        contract.sourceText.slice(span.start, span.end) !== span.text
      ) {
        failureReasons.push("emotional_support_evidence_span_not_in_source_text");
      }
      if (
        !validCategories.has(span.category) ||
        !validIntensities.has(span.intensity) ||
        !validObjects.has(span.object)
      ) {
        failureReasons.push("invalid_emotional_support_evidence_metadata");
      }
    }
    const projectedTerms = projectAffectEvidenceTerms(spans);
    const compatibilityTerms = Array.isArray(contract.explicitAffectOrImpactTerms)
      ? contract.explicitAffectOrImpactTerms
      : [];
    if (
      projectedTerms.length !== compatibilityTerms.length ||
      projectedTerms.some((term, index) => term !== compatibilityTerms[index])
    ) {
      failureReasons.push("emotional_support_evidence_projection_mismatch");
    }
  }
  if (
    plan.positiveFunctionContract?.action === "repair_previous_wording" &&
    (!plan.positiveFunctionContract.targetTurnId || !plan.positiveFunctionContract.targetText.trim())
  ) {
    failureReasons.push("missing_repair_target");
  }
  if (
    plan.positiveFunctionContract?.action === "repair_previous_wording" &&
    plan.positiveFunctionContract.repairMode === "factual_replacement" &&
    !plan.positiveFunctionContract.replacementFact
  ) {
    failureReasons.push("missing_factual_replacement_in_contract");
  }
  if (
    plan.positiveFunctionContract?.action === "repair_previous_wording" &&
    plan.positiveFunctionContract.repairMode === "interaction_move_withdrawal" &&
    !plan.positiveFunctionContract.interactionMoveSubtype
  ) {
    failureReasons.push("missing_interaction_move_subtype_in_contract");
  }
  if (
    plan.positiveFunctionContract?.action === "repair_previous_wording" &&
    plan.positiveFunctionContract.repairMode !== "interaction_move_withdrawal" &&
    plan.positiveFunctionContract.interactionMoveSubtype
  ) {
    failureReasons.push("unexpected_interaction_move_subtype_in_contract");
  }
  if (!positiveAction && plan.positiveFunctionContract) {
    failureReasons.push("positive_function_contract_without_matching_action");
  }
  for (const action of plan.responseActions) {
    if (!plan.relevanceProvenance.some((item) => item.planElement === `responseAction:${action}`)) {
      failureReasons.push(`missing_relevance_provenance:${action}`);
    }
  }
  return {
    passed: failureReasons.length === 0,
    failureReasons: Array.from(new Set(failureReasons)),
  };
};

export const buildAttemptTransitions = ({
  attempts,
  validated,
}: {
  attempts: ChatExecutionAttempt[];
  validated: boolean;
}): ChatExecutionTransition[] => {
  const transitions: ChatExecutionTransition[] = [];
  for (const [index, attempt] of attempts.entries()) {
    transitions.push({
      phase: "GENERATED",
      attemptId: attempt.attemptId,
      reason: "Surface realization produced an internal candidate.",
    });
    if (attempt.validation?.passed) {
      transitions.push({
        phase: "VALIDATED",
        attemptId: attempt.attemptId,
        reason: "The candidate conformed to the unchanged ResponsePlan.",
      });
    } else if (attempt.validation) {
      transitions.push({
        phase: "REJECTED",
        attemptId: attempt.attemptId,
        reason: attempt.validation.failureReasons.join(", ") || "Output Validation rejected the candidate.",
      });
      if (index < attempts.length - 1) {
        transitions.push({
          phase: "RETRYING",
          reason: "Retrying the same conversationId, turnId and ResponsePlan with a fresh attemptId.",
        });
      }
    }
  }
  if (!validated) {
    transitions.push({
      phase: "FAILED",
      reason: "No candidate reached the commit boundary.",
    });
  }
  return transitions;
};

export const classifyExecutionError = (error: unknown): {
  code: Extract<ChatExecutionFailureCode, "PROVIDER_ERROR" | "TIMEOUT">;
  reason: string;
} => {
  const reason = error instanceof Error ? error.message : "Unknown provider failure";
  const name = error instanceof Error ? error.name : "";
  return /timeout|timed out|abort|超时/i.test(`${name} ${reason}`)
    ? { code: "TIMEOUT", reason }
    : { code: "PROVIDER_ERROR", reason };
};

const USER_SAFE_FAILURE_MESSAGES: Record<ChatExecutionFailureCode, string> = {
  PLAN_INVALID: "这次回复没能准备好，请重试。",
  GENERATION_NONCONFORMANT: "这次回复没能生成，请重试。",
  SAFETY_BLOCKED: "这次请求暂时无法继续。",
  PROVIDER_ERROR: "回复服务暂时不可用，请重试。",
  TIMEOUT: "回复超时了，请重试。",
  PERSISTENCE_ERROR: "回复未能保存，请重试。",
};

export const toUserSafeExecutionStatus = (
  execution: ChatExecutionTrace
): UserSafeExecutionStatus => {
  const failure = execution.failure ?? {
    code: "PROVIDER_ERROR" as const,
    retryable: true,
  };
  return {
    type: "system_status",
    code: failure.code,
    message: USER_SAFE_FAILURE_MESSAGES[failure.code],
    retryable: failure.retryable,
    turnId: execution.turnId,
  };
};
