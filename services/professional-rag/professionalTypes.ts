import type {
  InterventionFamily,
  InterventionIntensity,
} from "@/services/clinical/clinicalTypes";

export type ProfessionalGuidanceGateMetadata =
  | {
      role: "baseline_boundary";
      interventionFamily: null;
      requiredIntensity: "none";
    }
  | {
      role: "intervention";
      interventionFamily: InterventionFamily;
      requiredIntensity: Exclude<InterventionIntensity, "none">;
    }
  | {
      role: "safety";
      interventionFamily: null;
      requiredIntensity: "high";
    };

export type ProfessionalGuidanceCard = {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceKind: "case_formulation" | "helping_skills" | "safety" | "emotional_support";
  topics: string[];
  cues: string[];
  principle: string;
  applyWhen: string;
  avoid: string[];
  responseMove: string;
  gate: ProfessionalGuidanceGateMetadata;
};

export type RetrievedProfessionalGuidance = {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceKind: ProfessionalGuidanceCard["sourceKind"];
  principle: string;
  applyWhen: string;
  avoid: string[];
  responseMove: string;
  reason: string;
  /**
   * Optional at this raw retrieval boundary so legacy or malformed candidates
   * can be represented and deterministically withheld by the prompt projection.
   * Cards in the local corpus are required to provide this metadata.
   */
  gate?: ProfessionalGuidanceGateMetadata;
};
