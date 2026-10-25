import {
  OBSERVATION_KEYS,
  observedKindFor,
  type PlannedFunctionSemanticProviderInput,
  type PositiveFunctionSemanticVerdict,
} from "../services/ai/plannedFunctionSemanticValidator";

// Observations that fail nothing, for fake judges whose verdict decides the outcome on other grounds.
// Prior-pause fakes set their own priorPauseObservation, so that kind is left to them.
const CLEAN_OBSERVATIONS = {
  currentRefusal: {
    refusalResponse: "responds_to_both",
    feelingAsReason: "no",
    decidesForUser: "no",
    affectDrift: "none",
    invitesOrAsks: "no",
  },
  invitation: { invitationCount: "one", invitationTarget: "open_sharing", affectDrift: "none" },
  relationalImpact: { affectDrift: "none" },
} as const;

export const affectEvidenceFor = (
  input: Pick<PlannedFunctionSemanticProviderInput, "currentUserText" | "candidateReply">
): NonNullable<PositiveFunctionSemanticVerdict["affectEvidence"]> => ({
  userSpans: input.currentUserText ? [{ start: 0, end: input.currentUserText.length, text: input.currentUserText }] : [],
  candidateSpans: input.candidateReply ? [{ start: 0, end: input.candidateReply.length, text: input.candidateReply }] : [],
  reason: "Offline fixture compares the candidate wording with the current User context; no real-model judgment is claimed.",
});

export const cleanObservationFor = (
  input: Pick<PlannedFunctionSemanticProviderInput, "positiveFunctionBinding" | "declinedSharingSource"> &
    Partial<Pick<PlannedFunctionSemanticProviderInput, "currentUserText" | "candidateReply" | "ordinaryPurposeBinding">>
): Pick<PositiveFunctionSemanticVerdict, "currentRefusalObservation" | "invitationObservation" | "affectObservation" | "affectEvidence" | "ordinaryUseObservation" | "acknowledgmentScopeObservation" | "invitationUseObservation"> => {
  // Fixed transport fixtures; this does not claim the model observed a useful response.
  if (input.positiveFunctionBinding?.action === "acknowledge_without_psychologizing" ||
      (input.positiveFunctionBinding?.action === "offer_emotional_support" && input.positiveFunctionBinding.supportFunction === "invite_optional_sharing")) {
    if (!input.currentUserText) throw new Error("Ordinary mock evidence requires the exact current User text.");
    return {
      ...(input.positiveFunctionBinding?.action === "offer_emotional_support" ? { invitationObservation: { ...CLEAN_OBSERVATIONS.invitation }, invitationUseObservation: { contextualUse: "useful_in_context" as const, candidateEvidenceIndices: [0], priorInvitation: null } } : {}),
      ...(input.ordinaryPurposeBinding?.requiredContribution?.purposeEvidence?.kind === "limit_scope_of_acknowledgment" ? {
        acknowledgmentScopeObservation: {scopeObject:"treatment_acceptance" as const,implication:"not_required_by_acknowledgment" as const,candidateEvidenceIndices:[0]},
      } : {}),
      ordinaryUseObservation: { contentRelation: "other_response", repetitionPurpose: "not_applicable",
      purposeEvidence: [{ source: "current_user", messageIndex: null, start: 0,
        end: input.currentUserText.length, text: input.currentUserText }],
      useComparison: { userMeaning: "Fixed offline fixture User context.",
        candidateAct: "Fixed offline fixture conversational act; not model quality evidence.",
        candidateEvidenceIndices: [0], relation: "supported_conversational_act" } } };
  }
  const kind = observedKindFor(input.positiveFunctionBinding, input.declinedSharingSource);
  if (kind === "relationalImpact") {
    if (input.currentUserText === undefined || input.candidateReply === undefined) {
      throw new Error("Relational mock evidence requires both exact source texts.");
    }
    return { affectObservation: { ...CLEAN_OBSERVATIONS.relationalImpact }, affectEvidence: affectEvidenceFor({
      currentUserText: input.currentUserText, candidateReply: input.candidateReply,
    }) };
  }
  return kind && kind !== "priorPause" ? { [OBSERVATION_KEYS[kind]]: { ...CLEAN_OBSERVATIONS[kind] } } : {};
};
