import type { ClinicalStrategyAdvice } from "@/conversation-os/control";

import { createRogersClinicalPlan } from "./rogersStrategy";
import type { ClinicalContext, ResponseGoal } from "./clinicalTypes";

export const createClinicalStrategyAdvice = ({
  context,
  need,
}: {
  context: ClinicalContext;
  need: "emotional_support" | "action_support";
}): { advice: ClinicalStrategyAdvice; compatibilityPlan: ReturnType<typeof createRogersClinicalPlan> } => {
  // Response Planner owns the need. Clinical only recommends how to serve it.
  const plannerSelectedGoal: ResponseGoal = need === "action_support" ? "support_action" : "reflect";
  const plan = createRogersClinicalPlan(context, plannerSelectedGoal);
  return {
    advice: {
      strategy: plan.primaryStrategy,
      intent: plan.responseIntent,
      questionFunction: plan.questionFunction,
      toneConstraints: plan.toneConstraint,
      interventionBoundaries: plan.interventionBoundary,
      evidence: [
        `Planner requested clinical need=${need}.`,
        ...plan.rationale,
      ],
    },
    compatibilityPlan: plan,
  };
};
