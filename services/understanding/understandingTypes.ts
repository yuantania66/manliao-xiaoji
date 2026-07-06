export type UnderstandingSourceTypeValue = "chat" | "note";

export type ExtractedFact = {
  eventText: string;
  occurredAt?: string | null;
  people?: string[];
  location?: string | null;
  topics?: string[];
  confidence?: number;
};

export type ExtractedExperienceSlice = {
  eventText?: string | null;
  emotion?: string | null;
  emotionIntensity?: number | null;
  bodySignal?: string | null;
  behavior?: string | null;
  duration?: string | null;
};

export type ExtractedInterpretation = {
  eventText?: string | null;
  interpretationText: string;
  evidenceText?: string | null;
  confidence?: number;
};

export type UnderstandingExtraction = {
  facts: ExtractedFact[];
  experiences: ExtractedExperienceSlice[];
  interpretations: ExtractedInterpretation[];
  people: string[];
  topics: string[];
  occurredAt?: string | null;
};

export type StructuredMemoryItem = {
  id: string;
  kind: "fact" | "experience" | "interpretation" | "note" | "event" | "hypothesis";
  text: string;
  occurredAt?: string | null;
  people?: string[];
  topics?: string[];
  emotion?: string | null;
  confidence?: number | null;
  reason?: string;
};

export type ActiveHypothesisMemory = {
  id: string;
  hypothesisText: string;
  category: string;
  confidence: number;
  supportingEvidenceIds: string[];
  counterEvidenceIds: string[];
};

export type StructuredRagContext = {
  recentMemories: StructuredMemoryItem[];
  similarMemories: StructuredMemoryItem[];
  coreEvents: StructuredMemoryItem[];
  activeHypotheses: ActiveHypothesisMemory[];
  counterEvidence: StructuredMemoryItem[];
  retrievalReason: string;
};
