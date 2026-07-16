import type { AiRiskLevel } from "@/services/ai/types";

import { createEmptyClinicalSignals, deriveClinicalConversationSignals } from "./clinicalContextBuilder";
import type {
  ClinicalContext,
  ClinicalPlan,
  ClinicalTrace,
  PersonCenteredGateDecision,
  ProfessionalGuidanceGateTrace,
} from "./clinicalTypes";

const memoryUsedFromContext = (context: ClinicalContext): ClinicalTrace["memoryUsed"] => ({
  understandings: context.memory.understandings.map((item) => item.text),
  relationships: context.memory.relationships.map((item) => item.text),
  timelineEvents: context.memory.timelineEvents.map((item) => item.text),
});

const memoryExcludedFromContext = (context: ClinicalContext): ClinicalTrace["memoryExcluded"] => ({
  rawMemory: "not_allowed",
  deterministicMemoryCaveat: [
    "Memory V2 Phase 2 uses deterministic MVP projections.",
    `ClinicalContext semanticMemories=${context.memory.semanticMemories.length}; raw memory remains unavailable to Clinical Logic.`,
  ],
});

export const buildClinicalTrace = ({
  context,
  plan,
  gateDecision = null,
  professionalGuidanceProjection = null,
  safetyDecision = {
    level: "low",
    routedToSafety: false,
    notes: [],
  },
}: {
  context: ClinicalContext;
  plan: ClinicalPlan;
  gateDecision?: PersonCenteredGateDecision | null;
  professionalGuidanceProjection?: ProfessionalGuidanceGateTrace | null;
  safetyDecision?: {
    level: AiRiskLevel | "none";
    routedToSafety: boolean;
    notes: string[];
  };
}): ClinicalTrace => {
  if (gateDecision && !context.personCenteredEvidence) {
    throw new Error("Person-Centered Gate trace requires personCenteredEvidence.");
  }

  return {
    skippedBySafety: false,
    conversationState: context.conversation.state,
    safetyDecision,
    inputSignals: deriveClinicalConversationSignals(context.conversation.currentUserMessage),
    signals: context.signals,
    memoryUsed: memoryUsedFromContext(context),
    memoryExcluded: memoryExcludedFromContext(context),
    selectedPlan: plan,
    ...(gateDecision && context.personCenteredEvidence
      ? {
          personCenteredGate: {
            evidence: context.personCenteredEvidence,
            decision: gateDecision,
            ...(professionalGuidanceProjection
              ? { professionalGuidance: professionalGuidanceProjection }
              : {}),
          },
        }
      : {}),
  };
};

export const buildSafetySkippedClinicalTrace = ({
  level = "crisis",
  notes,
  conversationState = "exploring",
}: {
  level?: AiRiskLevel;
  notes: string[];
  conversationState?: ClinicalTrace["conversationState"];
}): ClinicalTrace => ({
  skippedBySafety: true,
  conversationState,
  safetyDecision: {
    level,
    routedToSafety: true,
    notes,
  },
  inputSignals: {
    userCorrectedAi: false,
    userWantsPause: false,
    userRequestsHelp: false,
    userRequestsSummary: false,
    userExpressesUncertainty: false,
    userExpressesEmotion: false,
    ambiguityLevel: "high",
  },
  signals: createEmptyClinicalSignals(),
  memoryUsed: {
    understandings: [],
    relationships: [],
    timelineEvents: [],
  },
  memoryExcluded: {
    rawMemory: "not_allowed",
    deterministicMemoryCaveat: [],
  },
});
