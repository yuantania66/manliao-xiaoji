import type { ClinicalContext, ClinicalStrategy, ResponseGoal } from "./clinicalTypes";

export const selectClinicalStrategy = ({
  context,
  responseGoal,
}: {
  context: ClinicalContext;
  responseGoal: ResponseGoal;
}): ClinicalStrategy => {
  void context;
  void responseGoal;
  return "rogers";
};
