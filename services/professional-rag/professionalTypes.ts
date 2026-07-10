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
};
