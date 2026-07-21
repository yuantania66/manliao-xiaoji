import type {
  ClinicalContext,
  ClinicalStrategy,
  PersonCenteredGateDecision,
  ResponseGoal,
} from "./clinicalTypes";

export const selectClinicalStrategy = ({
  context,
  responseGoal,
  gateDecision = null,
}: {
  context: ClinicalContext;
  responseGoal: ResponseGoal;
  gateDecision?: PersonCenteredGateDecision | null;
}): ClinicalStrategy => {
  void context;

  if (gateDecision && !gateDecision.responseGoalPolicy.allowed.includes(responseGoal)) {
    throw new Error(`Person-Centered Gate rejected responseGoal=${responseGoal}.`);
  }

  // Rogers is the current Person-Centered baseline. No intervention family is
  // selected here, and this selector must not recalculate Gate eligibility.
  return "rogers";
};
