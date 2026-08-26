import type { ResponsePlan } from "@/conversation-os/control";
import type { ProactiveGreetingHandoffFunction } from "@/conversation-os/interactionMoveEnvelope";

import {
  defaultPlannedFunctionSemanticProvider,
  parsePlannedFunctionSemanticProviderOutput,
  validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticProviderInput,
  type PlannedFunctionSemanticProvider,
  type PlannedFunctionSemanticValidationPromptInspector,
  type PlannedFunctionSemanticVerdict,
  type SemanticEvidenceSpan,
} from "./plannedFunctionSemanticValidator";
import type { AiModelMessage } from "./types";

/** @deprecated Use PlannedFunctionSemanticContext. */
export type InteractionMoveHandoffSemanticContext = {
  targetAssistantText: string;
  currentUserText: string;
};

/** @deprecated Use PlannedFunctionSemanticProviderInput. */
export type InteractionMoveHandoffSemanticProviderInput = {
  planId: string;
  planBinding: NonNullable<ResponsePlan["interactionMoveHandoffPlan"]>;
  targetAssistantText: string;
  currentUserText: string;
  candidateReply: string;
  ordinaryQuestionIndependentlySupported: boolean;
  assistantIdentityContract: Readonly<{
    mode: "first_contact" | "identity_continuation" | "identity_repair";
    displayName: "小慢";
  }> | null;
};

/** @deprecated Use PlannedFunctionSemanticProvider. */
export type InteractionMoveHandoffSemanticProvider = (
  input: InteractionMoveHandoffSemanticProviderInput
) => Promise<unknown>;

/** @deprecated Use PlannedFunctionSemanticValidationPromptInspector. */
export type InteractionMoveHandoffValidationPromptInspector = (input: {
  stage: "interaction_move_handoff_validation";
  messages: AiModelMessage[];
}) => void | Promise<void>;

/** @deprecated Compatibility verdict for legacy handoff-only checks. */
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

export const parseInteractionMoveHandoffSemanticProviderOutput =
  parsePlannedFunctionSemanticProviderOutput;

const positiveBindingFromLegacy = (
  input: InteractionMoveHandoffSemanticProviderInput
): PlannedFunctionSemanticProviderInput["positiveFunctionBinding"] =>
  input.assistantIdentityContract
    ? {
        action: "establish_assistant_identity",
        mode: input.assistantIdentityContract.mode,
        displayName: input.assistantIdentityContract.displayName,
        sourceTurnId: input.planBinding.sourceUserTurnId,
        targetProposition: null,
        evidence: ["legacy compatibility binding"],
      }
    : null;

const canonicalInputFromLegacy = (
  input: InteractionMoveHandoffSemanticProviderInput
): PlannedFunctionSemanticProviderInput => ({
  planId: input.planId,
  handoffBinding: input.planBinding,
  positiveFunctionBinding: positiveBindingFromLegacy(input),
  currentUserText: input.currentUserText,
  handoffTargetAssistantText: input.targetAssistantText,
  candidateReply: input.candidateReply,
  ordinaryQuestionIndependentlySupported: input.ordinaryQuestionIndependentlySupported,
});

const legacyVerdictFromCanonical = (
  input: InteractionMoveHandoffSemanticProviderInput,
  raw: unknown
): unknown => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const verdict = raw as Partial<PlannedFunctionSemanticVerdict>;
  const handoff = verdict.handoff;
  if (!handoff || typeof verdict.planId !== "string" ||
      !Number.isInteger(verdict.semanticQuestionCount)) return raw;
  const positive = verdict.positiveFunction;
  const status = positive && positive.status !== "satisfied" ? positive.status : handoff.status;
  return {
    schemaVersion: 1,
    planId: verdict.planId,
    sourceAssistantMoveId: handoff.binding.sourceAssistantMoveId,
    sourceUserTurnId: handoff.binding.sourceUserTurnId,
    selectedRelation: handoff.binding.selectedRelation,
    requiredFunction: handoff.binding.requiredFunction,
    completionIntent: handoff.binding.completionIntent,
    questionPolicy: handoff.binding.questionPolicy,
    status,
    realizedFunction: handoff.realizedFunction,
    targetAddressed: handoff.targetAddressed && (positive?.targetAddressed ?? true),
    relationAddressed: handoff.relationAddressed,
    positiveFunctionRealized: handoff.requiredFunctionRealized,
    containsContradictoryMove:
      handoff.containsContradictoryMove || (positive?.containsContradictoryMove ?? false),
    handoffCompletionClaimed: handoff.handoffCompletionClaimed,
    semanticQuestionCount: verdict.semanticQuestionCount as number,
    ordinaryQuestionIndependentlySupported: input.ordinaryQuestionIndependentlySupported,
    optionalQuestionAfterPositiveFunction: handoff.optionalQuestionAfterRequiredFunction,
    evidence: positive?.evidence.length ? positive.evidence : handoff.evidence,
  } satisfies InteractionMoveHandoffSemanticVerdict;
};

const canonicalVerdictFromLegacy = (
  input: PlannedFunctionSemanticProviderInput,
  raw: unknown
): unknown => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const legacy = raw as Partial<InteractionMoveHandoffSemanticVerdict>;
  if (!input.handoffBinding) return raw;
  const handoffEvidence = Array.isArray(legacy.evidence) ? legacy.evidence : [];
  return {
    schemaVersion: legacy.schemaVersion,
    planId: legacy.planId,
    handoff: {
      binding: {
        sourceAssistantMoveId: legacy.sourceAssistantMoveId,
        sourceUserTurnId: legacy.sourceUserTurnId,
        selectedRelation: legacy.selectedRelation,
        requiredFunction: legacy.requiredFunction,
        completionIntent: legacy.completionIntent,
        questionPolicy: legacy.questionPolicy,
      },
      status: legacy.status,
      realizedFunction: legacy.realizedFunction,
      targetAddressed: legacy.targetAddressed,
      relationAddressed: legacy.relationAddressed,
      requiredFunctionRealized: legacy.positiveFunctionRealized,
      containsContradictoryMove: legacy.containsContradictoryMove,
      handoffCompletionClaimed: legacy.handoffCompletionClaimed,
      optionalQuestionAfterRequiredFunction: legacy.optionalQuestionAfterPositiveFunction,
      evidence: handoffEvidence,
    },
    positiveFunction: input.positiveFunctionBinding
      ? {
          binding: input.positiveFunctionBinding.action === "establish_assistant_identity"
            ? {
                action: input.positiveFunctionBinding.action,
                mode: input.positiveFunctionBinding.mode,
                sourceTurnId: input.positiveFunctionBinding.sourceTurnId,
                targetProposition: input.positiveFunctionBinding.targetProposition,
              }
            : null,
          status: legacy.status,
          realizedAction: legacy.status === "satisfied"
            ? input.positiveFunctionBinding.action
            : null,
          targetAddressed: legacy.targetAddressed,
          contractRealized: legacy.status === "satisfied",
          containsContradictoryMove: legacy.containsContradictoryMove,
          evidence: handoffEvidence,
        }
      : null,
    semanticQuestionCount: legacy.semanticQuestionCount,
  };
};

/** @deprecated Test-only compatibility adapter to the canonical provider contract. */
export const adaptInteractionMoveHandoffSemanticProvider = (
  plan: ResponsePlan,
  provider: InteractionMoveHandoffSemanticProvider
): PlannedFunctionSemanticProvider => async (input) => {
  const identity = plan.positiveFunctionContract?.action === "establish_assistant_identity"
    ? Object.freeze({
        mode: plan.positiveFunctionContract.mode,
        displayName: plan.positiveFunctionContract.displayName,
      })
    : null;
  const raw = await provider({
    planId: input.planId,
    planBinding: input.handoffBinding!,
    targetAssistantText: input.handoffTargetAssistantText!,
    currentUserText: input.currentUserText,
    candidateReply: input.candidateReply,
    ordinaryQuestionIndependentlySupported: input.ordinaryQuestionIndependentlySupported,
    assistantIdentityContract: identity,
  });
  return canonicalVerdictFromLegacy(input, raw);
};

/** @deprecated Test-only compatibility adapter to the canonical inspection stage. */
export const adaptInteractionMoveHandoffPromptInspector = (
  inspector: InteractionMoveHandoffValidationPromptInspector
): PlannedFunctionSemanticValidationPromptInspector => ({ messages }) => inspector({
  stage: "interaction_move_handoff_validation",
  messages,
});

/** @deprecated Compatibility adapter. It delegates to the sole canonical provider call. */
export const defaultInteractionMoveHandoffSemanticProvider = async (
  input: InteractionMoveHandoffSemanticProviderInput,
  inspectExternalPrompt?: InteractionMoveHandoffValidationPromptInspector
) => {
  const raw = await defaultPlannedFunctionSemanticProvider(
    canonicalInputFromLegacy(input),
    inspectExternalPrompt
      ? ({ messages }) => inspectExternalPrompt({
          stage: "interaction_move_handoff_validation",
          messages,
        })
      : undefined
  );
  return legacyVerdictFromCanonical(input, raw);
};

const legacyFailureReasons = (reasons: string[]) => {
  if (reasons.includes("planned_function_semantic:missing_context") ||
      reasons.includes("planned_function_semantic:handoff_missing_context")) {
    return ["interaction_move_handoff_semantic:missing_context"];
  }
  if (reasons.includes("planned_function_semantic:provider_failure")) {
    return ["interaction_move_handoff_semantic:provider_failure"];
  }
  if (reasons.includes("planned_function_semantic:malformed_verdict")) {
    return ["interaction_move_handoff_semantic:malformed_verdict"];
  }
  if (reasons.includes("planned_function_semantic:binding_mismatch")) {
    return ["interaction_move_handoff_semantic:binding_mismatch"];
  }
  if (reasons.includes("planned_function_semantic:evidence_mismatch")) {
    return ["interaction_move_handoff_semantic:evidence_mismatch"];
  }
  if (reasons.some((reason) => reason.endsWith("_uncertain"))) {
    return ["interaction_move_handoff_semantic:uncertain"];
  }
  return reasons.length ? ["interaction_move_handoff_semantic:function_or_policy_not_satisfied"] : [];
};

/** @deprecated Compatibility adapter. Production calls validatePlannedFunctionSemanticOutput. */
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
}): Promise<{
  passed: boolean;
  failureReasons: string[];
  verdict: InteractionMoveHandoffSemanticVerdict | null;
}> => {
  if (!plan.interactionMoveHandoffPlan) {
    const result = await validatePlannedFunctionSemanticOutput({
      plan,
      reply,
      semanticContext: semanticContext
        ? {
            currentUserText: semanticContext.currentUserText,
            handoffTargetAssistantText: semanticContext.targetAssistantText,
          }
        : undefined,
    });
    return {
      passed: result.passed,
      failureReasons: legacyFailureReasons(result.failureReasons),
      verdict: null,
    };
  }
  const identity = plan.positiveFunctionContract?.action === "establish_assistant_identity"
    ? Object.freeze({
        mode: plan.positiveFunctionContract.mode,
        displayName: plan.positiveFunctionContract.displayName,
      })
    : null;
  let latestLegacyVerdict: InteractionMoveHandoffSemanticVerdict | null = null;
  const result = await validatePlannedFunctionSemanticOutput({
    plan,
    reply,
    semanticContext: semanticContext
      ? {
          currentUserText: semanticContext.currentUserText,
          handoffTargetAssistantText: semanticContext.targetAssistantText,
        }
      : undefined,
    provider: provider
      ? async (input) => {
          const raw = await provider({
            planId: input.planId,
            planBinding: input.handoffBinding!,
            targetAssistantText: input.handoffTargetAssistantText!,
            currentUserText: input.currentUserText,
            candidateReply: input.candidateReply,
            ordinaryQuestionIndependentlySupported: input.ordinaryQuestionIndependentlySupported,
            assistantIdentityContract: identity,
          });
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            latestLegacyVerdict = raw as InteractionMoveHandoffSemanticVerdict;
          }
          return canonicalVerdictFromLegacy(input, raw);
        }
      : undefined,
    inspectExternalPrompt: inspectExternalPrompt
      ? ({ messages }) => inspectExternalPrompt({
          stage: "interaction_move_handoff_validation",
          messages,
        })
      : undefined,
  });
  return {
    passed: result.passed,
    failureReasons: legacyFailureReasons(result.failureReasons),
    verdict: latestLegacyVerdict ?? (
      result.verdict
        ? legacyVerdictFromCanonical({
            planId: plan.planId,
            planBinding: plan.interactionMoveHandoffPlan,
            targetAssistantText: semanticContext?.targetAssistantText ?? "",
            currentUserText: semanticContext?.currentUserText ?? "",
            candidateReply: reply,
            ordinaryQuestionIndependentlySupported: false,
            assistantIdentityContract: identity,
          }, result.verdict) as InteractionMoveHandoffSemanticVerdict
        : null
    ),
  };
};
