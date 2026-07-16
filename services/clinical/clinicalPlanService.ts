import type { ClinicalContext, ClinicalPlan, PersonCenteredGateDecision } from "./clinicalTypes";
import { NOOP_CLINICAL_STRATEGY } from "./clinicalStrategyRegistry";
import { selectClinicalStrategy } from "./clinicalStrategySelector";
import { selectResponseGoal } from "./responseGoalSelector";
import { createRogersClinicalPlan } from "./rogersStrategy";

export const createNoOpClinicalPlan = (context: ClinicalContext): ClinicalPlan => ({
  responseGoal: "reflect",
  responseIntent: "receive",
  primaryStrategy: NOOP_CLINICAL_STRATEGY.name,
  secondaryStrategies: [],
  questionFunction: "none",
  toneConstraint: [
    "Clinical Logic Sprint 1 skeleton only.",
    "Do not change existing reply behavior.",
  ],
  interventionBoundary: [
    "No concrete Rogers / CBT / ACT / MI strategy is selected in Sprint 1 skeleton.",
    "Do not diagnose, assess, create a treatment plan, or write memory.",
    "Do not provide fixed response text.",
  ],
  safetyNotes: context.safety.safetyTriggered ? [`safetyLevel=${context.safety.safetyLevel}`] : [],
  rationale: [
    "NoOp ClinicalPlan created to prove normal chat passes through Clinical Logic Layer.",
    `ClinicalContext memory received: understandings=${context.memory.understandings.length}, timelineEvents=${context.memory.timelineEvents.length}, relationships=${context.memory.relationships.length}, semanticMemories=${context.memory.semanticMemories.length}.`,
  ],
});

export const createClinicalPlan = (
  context: ClinicalContext,
  gateDecision: PersonCenteredGateDecision | null = null
): ClinicalPlan => {
  const responseGoal = selectResponseGoal(context, gateDecision);
  const primaryStrategy = selectClinicalStrategy({
    context,
    responseGoal,
    gateDecision,
  });

  const plan =
    primaryStrategy === "rogers"
      ? createRogersClinicalPlan(context, responseGoal)
      : createNoOpClinicalPlan(context);

  if (!gateDecision) return plan;

  const personCenteredGate = Object.freeze({
    version: gateDecision.version,
    readiness: gateDecision.interventionReadiness,
    maxIntensity: gateDecision.maxInterventionIntensity,
    allowedFamilies: Object.freeze([
      ...gateDecision.allowedInterventionFamilies,
    ]),
    allowedResponseGoals: Object.freeze([
      ...gateDecision.responseGoalPolicy.allowed,
    ]),
  });

  return {
    ...plan,
    personCenteredGate,
  };
};
