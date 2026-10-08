import {
  OBSERVATION_KEYS,
  observedKindFor,
  type PlannedFunctionSemanticProviderInput,
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

export const cleanObservationFor = (
  input: Pick<PlannedFunctionSemanticProviderInput, "positiveFunctionBinding" | "declinedSharingSource">
): Record<string, Record<string, string>> => {
  const kind = observedKindFor(input.positiveFunctionBinding, input.declinedSharingSource);
  return kind && kind !== "priorPause" ? { [OBSERVATION_KEYS[kind]]: { ...CLEAN_OBSERVATIONS[kind] } } : {};
};
