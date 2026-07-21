import type {
  InterventionFamily,
  InterventionIntensity,
  PersonCenteredGateDecision,
} from "@/services/clinical/clinicalTypes";
import type {
  ActiveHypothesisMemory,
  StructuredMemoryItem,
  StructuredRagContext,
  UserFeedbackMemory,
} from "@/services/understanding/understandingTypes";

import type {
  ProfessionalGuidanceGateMetadata,
  RetrievedProfessionalGuidance,
} from "./professionalTypes";

type InterventionGuidanceGateMetadata = Extract<
  ProfessionalGuidanceGateMetadata,
  { role: "intervention" }
>;

type BaselineBoundaryGateMetadata = Extract<
  ProfessionalGuidanceGateMetadata,
  { role: "baseline_boundary" }
>;

export type PromptEligibleInterventionGuidance = Omit<
  RetrievedProfessionalGuidance,
  "gate"
> & {
  gate: InterventionGuidanceGateMetadata;
};

/**
 * A baseline boundary may contribute only negative constraints. Keeping this as
 * a distinct shape prevents principle/applyWhen/responseMove from reaching the
 * prompt through accidental object spreading.
 */
export type PromptEligibleBaselineBoundary = Pick<
  RetrievedProfessionalGuidance,
  "id" | "sourceTitle" | "sourceUrl" | "sourceKind" | "avoid" | "reason"
> & {
  gate: BaselineBoundaryGateMetadata;
};

export type PromptEligibleProfessionalGuidance =
  | PromptEligibleInterventionGuidance
  | PromptEligibleBaselineBoundary;

export type GatedStructuredRagContext = Omit<
  StructuredRagContext,
  "professionalGuidance"
> & {
  gateApplied: true;
  gateVersion: "person-centered-gate-v1";
  professionalGuidance: PromptEligibleProfessionalGuidance[];
};

export type ProfessionalGuidanceProjectionTrace = {
  retrievedIds: string[];
  injectedIds: string[];
  withheldIds: string[];
  unknownMetadataIds: string[];
};

export type PromptEligibleContextProjection = {
  understandingContext: GatedStructuredRagContext | null;
  trace: ProfessionalGuidanceProjectionTrace;
};

type ProjectedContextAuthorization = {
  gateDecision: PersonCenteredGateDecision;
  decisionSnapshot: string;
};

const PROJECTED_CONTEXT_AUTHORIZATIONS = new WeakMap<
  GatedStructuredRagContext,
  ProjectedContextAuthorization
>();

const snapshotGateDecision = (gateDecision: PersonCenteredGateDecision) =>
  JSON.stringify(gateDecision);

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
};

/**
 * Runtime provenance check for the typed prompt boundary. The public brand
 * fields make the shape explicit, while this module-private binding prevents
 * raw or differently-authorized contexts from forging that shape.
 */
export const assertPromptEligibleContextForDecision = ({
  context,
  gateDecision,
}: {
  context: GatedStructuredRagContext;
  gateDecision: PersonCenteredGateDecision;
}) => {
  const authorization = PROJECTED_CONTEXT_AUTHORIZATIONS.get(context);
  if (
    !context.gateApplied ||
    context.gateVersion !== gateDecision.version ||
    !Object.isFrozen(context) ||
    authorization?.gateDecision !== gateDecision ||
    authorization.decisionSnapshot !== snapshotGateDecision(gateDecision)
  ) {
    throw new Error(
      "Prompt understanding context was not projected for the active Person-Centered Gate decision."
    );
  }
};

const INTERVENTION_FAMILIES: ReadonlySet<InterventionFamily> = new Set([
  "bounded_decision_support",
  "direct_judgment",
  "low_risk_action_support",
  "high_impact_action_support",
  "general_advice",
  "diagnostic_assessment",
  "cbt",
  "act",
  "mi",
  "case_formulation",
  "dream_interpretation",
]);

const INTENSITY_RANK: Record<InterventionIntensity, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isKnownInterventionFamily = (value: unknown): value is InterventionFamily =>
  typeof value === "string" && INTERVENTION_FAMILIES.has(value as InterventionFamily);

const isProfessionalGuidanceGateMetadata = (
  value: unknown,
): value is ProfessionalGuidanceGateMetadata => {
  if (!isRecord(value)) return false;

  if (value.role === "baseline_boundary") {
    return value.interventionFamily === null && value.requiredIntensity === "none";
  }

  if (value.role === "safety") {
    return value.interventionFamily === null && value.requiredIntensity === "high";
  }

  if (value.role !== "intervention") return false;

  return (
    isKnownInterventionFamily(value.interventionFamily) &&
    (value.requiredIntensity === "low" ||
      value.requiredIntensity === "moderate" ||
      value.requiredIntensity === "high")
  );
};

const isIntensityAllowed = ({
  required,
  maximum,
}: {
  required: Exclude<InterventionIntensity, "none">;
  maximum: InterventionIntensity;
}) => INTENSITY_RANK[required] <= INTENSITY_RANK[maximum];

const cloneMemoryItem = (item: StructuredMemoryItem): StructuredMemoryItem => ({
  ...item,
  ...(item.people ? { people: [...item.people] } : {}),
  ...(item.topics ? { topics: [...item.topics] } : {}),
});

const cloneActiveHypothesis = (
  item: ActiveHypothesisMemory,
): ActiveHypothesisMemory => ({
  ...item,
  supportingEvidenceIds: [...item.supportingEvidenceIds],
  counterEvidenceIds: [...item.counterEvidenceIds],
});

const cloneUserFeedback = (item: UserFeedbackMemory): UserFeedbackMemory => ({
  ...item,
  tags: [...item.tags],
});

const projectProfessionalGuidance = ({
  candidates,
  gateDecision,
}: {
  candidates: RetrievedProfessionalGuidance[];
  gateDecision: PersonCenteredGateDecision;
}): {
  guidance: PromptEligibleProfessionalGuidance[];
  trace: ProfessionalGuidanceProjectionTrace;
} => {
  const guidance: PromptEligibleProfessionalGuidance[] = [];
  const trace: ProfessionalGuidanceProjectionTrace = {
    retrievedIds: [],
    injectedIds: [],
    withheldIds: [],
    unknownMetadataIds: [],
  };

  for (const candidate of candidates) {
    trace.retrievedIds.push(candidate.id);

    if (!isProfessionalGuidanceGateMetadata(candidate.gate)) {
      trace.withheldIds.push(candidate.id);
      trace.unknownMetadataIds.push(candidate.id);
      continue;
    }

    if (candidate.gate.role === "safety") {
      trace.withheldIds.push(candidate.id);
      continue;
    }

    if (candidate.gate.role === "baseline_boundary") {
      guidance.push({
        id: candidate.id,
        sourceTitle: candidate.sourceTitle,
        sourceUrl: candidate.sourceUrl,
        sourceKind: candidate.sourceKind,
        avoid: [...candidate.avoid],
        reason: candidate.reason,
        gate: { ...candidate.gate },
      });
      trace.injectedIds.push(candidate.id);
      continue;
    }

    const familyAllowed = gateDecision.allowedInterventionFamilies.includes(
      candidate.gate.interventionFamily,
    );
    const intensityAllowed = isIntensityAllowed({
      required: candidate.gate.requiredIntensity,
      maximum: gateDecision.maxInterventionIntensity,
    });

    if (!familyAllowed || !intensityAllowed) {
      trace.withheldIds.push(candidate.id);
      continue;
    }

    guidance.push({
      ...candidate,
      avoid: [...candidate.avoid],
      gate: { ...candidate.gate },
    });
    trace.injectedIds.push(candidate.id);
  }

  return { guidance, trace };
};

const cloneStructuredItems = ({
  items,
  caseFormulationAllowed,
}: {
  items: StructuredMemoryItem[];
  caseFormulationAllowed: boolean;
}) =>
  items
    .filter((item) => caseFormulationAllowed || item.kind !== "hypothesis")
    .map(cloneMemoryItem);

/**
 * Converts raw retrieval candidates into the only context shape accepted by a
 * gate-enabled prompt. It is deliberately a pure mechanical projection: the
 * Gate decision is never recalculated and the raw context is never mutated.
 */
export const projectPromptEligibleContext = ({
  raw,
  gateDecision,
}: {
  raw: StructuredRagContext | null | undefined;
  gateDecision: PersonCenteredGateDecision;
}): PromptEligibleContextProjection => {
  if (!raw) {
    return {
      understandingContext: null,
      trace: {
        retrievedIds: [],
        injectedIds: [],
        withheldIds: [],
        unknownMetadataIds: [],
      },
    };
  }

  const caseFormulationAllowed =
    gateDecision.allowedInterventionFamilies.includes("case_formulation");
  const counterEvidenceAllowed =
    caseFormulationAllowed ||
    gateDecision.allowedInterventionFamilies.includes("cbt");
  const professionalProjection = projectProfessionalGuidance({
    candidates: raw.professionalGuidance,
    gateDecision,
  });

  const understandingContext = deepFreeze<GatedStructuredRagContext>({
    recentMemories: cloneStructuredItems({
      items: raw.recentMemories,
      caseFormulationAllowed,
    }),
    similarMemories: cloneStructuredItems({
      items: raw.similarMemories,
      caseFormulationAllowed,
    }),
    coreEvents: cloneStructuredItems({
      items: raw.coreEvents,
      caseFormulationAllowed,
    }),
    activeHypotheses: caseFormulationAllowed
      ? raw.activeHypotheses.map(cloneActiveHypothesis)
      : [],
    counterEvidence: counterEvidenceAllowed
      ? cloneStructuredItems({
          items: raw.counterEvidence,
          caseFormulationAllowed,
        })
      : [],
    professionalGuidance: professionalProjection.guidance,
    userFeedback: raw.userFeedback.map(cloneUserFeedback),
    retrievalReason: raw.retrievalReason,
    gateApplied: true,
    gateVersion: gateDecision.version,
  });
  PROJECTED_CONTEXT_AUTHORIZATIONS.set(understandingContext, {
    gateDecision,
    decisionSnapshot: snapshotGateDecision(gateDecision),
  });

  return {
    understandingContext,
    trace: professionalProjection.trace,
  };
};
