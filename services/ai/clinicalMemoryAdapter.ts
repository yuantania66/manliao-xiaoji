import {
  ActiveHypothesisMemory,
  StructuredMemoryItem,
  StructuredRagContext,
} from "@/services/understanding/understandingTypes";

export type ClinicalMemoryKind =
  | "understanding"
  | "timeline_event"
  | "relationship"
  | "semantic_memory"
  | "raw_summary"
  | "legacy_memory";

export type ClinicalMemoryItem = {
  id: string;
  kind: ClinicalMemoryKind;
  text: string;
  occurredAt?: string | null;
  people: string[];
  topics: string[];
  confidence?: number | null;
  reason?: string;
  source: "memory_v2" | "legacy_structured_rag";
  role: "primary_understanding" | "supporting_context" | "legacy_context";
  caveat?: string;
};

export type ClinicalMemoryContext = {
  understandings: ClinicalMemoryItem[];
  timelineEvents: ClinicalMemoryItem[];
  relationships: ClinicalMemoryItem[];
  semanticMemories: ClinicalMemoryItem[];
  rawSummaries: ClinicalMemoryItem[];
  legacyMemories: ClinicalMemoryItem[];
  excluded: {
    rawMemory: "not_allowed";
    directRecentMemories: "not_allowed";
    v1ContextUsed: boolean;
    deterministicMemoryCaveat: string[];
  };
  retrievalReason: string;
};

const deterministicMemoryCaveat = [
  "Memory V2 Phase 2 uses deterministic MVP projections.",
  "Understanding is primary context; Timeline and Relationship are supporting only.",
  "Clinical Logic must not treat these memories as diagnosis, assessment, or stable user facts.",
];

const emptyClinicalMemoryContext = (retrievalReason = ""): ClinicalMemoryContext => ({
  understandings: [],
  timelineEvents: [],
  relationships: [],
  semanticMemories: [],
  rawSummaries: [],
  legacyMemories: [],
  excluded: {
    rawMemory: "not_allowed",
    directRecentMemories: "not_allowed",
    v1ContextUsed: false,
    deterministicMemoryCaveat,
  },
  retrievalReason,
});

const asClinicalMemoryItem = ({
  item,
  kind,
  source,
  role,
  caveat,
}: {
  item: StructuredMemoryItem;
  kind: ClinicalMemoryKind;
  source: ClinicalMemoryItem["source"];
  role: ClinicalMemoryItem["role"];
  caveat?: string;
}): ClinicalMemoryItem => ({
  id: item.id,
  kind,
  text: item.text,
  occurredAt: item.occurredAt,
  people: item.people ?? [],
  topics: item.topics ?? [],
  confidence: item.confidence,
  reason: item.reason,
  source,
  role,
  caveat,
});

const activeHypothesisToClinicalItem = (hypothesis: ActiveHypothesisMemory): ClinicalMemoryItem => ({
  id: hypothesis.id,
  kind: "legacy_memory",
  text: hypothesis.hypothesisText,
  people: [],
  topics: [hypothesis.category],
  confidence: hypothesis.confidence,
  reason: "legacy_active_hypothesis",
  source: "legacy_structured_rag",
  role: "legacy_context",
  caveat: "Legacy hypothesis is compatibility context only and must not be treated as fact.",
});

const isV2Understanding = (item: StructuredMemoryItem) =>
  item.id.startsWith("memory-v2-understanding:") ||
  item.reason === "memory_v2_understanding_current_version";

const isV2Timeline = (item: StructuredMemoryItem) =>
  item.id.startsWith("memory-v2-timeline:") ||
  item.reason === "memory_v2_timeline_supporting_current_version";

const isV2Relationship = (item: StructuredMemoryItem) =>
  item.id.startsWith("memory-v2-relationship:") ||
  item.reason === "memory_v2_relationship_supporting_current_version";

const isV2SemanticMemory = (item: StructuredMemoryItem) =>
  item.id.startsWith("memory-v2:") ||
  item.reason === "memory_v2_raw_segment_current_version";

const isRawSummary = (item: StructuredMemoryItem) =>
  item.kind === "note" || item.reason?.includes("recent_note") || item.reason?.includes("raw_segment");

export const createClinicalMemoryContext = (
  structuredContext?: StructuredRagContext | null
): ClinicalMemoryContext => {
  if (!structuredContext) return emptyClinicalMemoryContext();

  const context = emptyClinicalMemoryContext(structuredContext.retrievalReason);
  const legacyItems: ClinicalMemoryItem[] = [];

  for (const item of structuredContext.recentMemories) {
    if (isV2Understanding(item)) {
      context.understandings.push(
        asClinicalMemoryItem({
          item,
          kind: "understanding",
          source: "memory_v2",
          role: "primary_understanding",
          caveat: "Primary continuity context; still provisional and user-correctable.",
        })
      );
      continue;
    }

    if (isV2Timeline(item)) {
      context.timelineEvents.push(
        asClinicalMemoryItem({
          item,
          kind: "timeline_event",
          source: "memory_v2",
          role: "supporting_context",
          caveat: "Supporting timeline context only; do not infer stable patterns from it.",
        })
      );
      continue;
    }

    if (isV2Relationship(item)) {
      context.relationships.push(
        asClinicalMemoryItem({
          item,
          kind: "relationship",
          source: "memory_v2",
          role: "supporting_context",
          caveat: "Supporting relationship context only; do not diagnose relationship dynamics.",
        })
      );
      continue;
    }

    if (isV2SemanticMemory(item)) {
      context.semanticMemories.push(
        asClinicalMemoryItem({
          item,
          kind: "semantic_memory",
          source: "memory_v2",
          role: "supporting_context",
          caveat: "Raw segment semantic memory is supporting context, not clinical evidence.",
        })
      );
      continue;
    }

    legacyItems.push(
      asClinicalMemoryItem({
        item,
        kind: isRawSummary(item) ? "raw_summary" : "legacy_memory",
        source: "legacy_structured_rag",
        role: "legacy_context",
        caveat: "Legacy StructuredRagContext item; use only as compatibility context.",
      })
    );
  }

  context.rawSummaries.push(...legacyItems.filter((item) => item.kind === "raw_summary"));
  context.legacyMemories.push(...legacyItems.filter((item) => item.kind !== "raw_summary"));
  context.legacyMemories.push(...structuredContext.similarMemories.map((item) =>
    asClinicalMemoryItem({
      item,
      kind: "legacy_memory",
      source: "legacy_structured_rag",
      role: "legacy_context",
      caveat: "Legacy similar memory; do not treat as a direct Clinical Logic input.",
    })
  ));
  context.legacyMemories.push(...structuredContext.coreEvents.map((item) =>
    asClinicalMemoryItem({
      item,
      kind: "legacy_memory",
      source: "legacy_structured_rag",
      role: "legacy_context",
      caveat: "Legacy core event; supporting context only until Evidence-based Timeline is primary.",
    })
  ));
  context.legacyMemories.push(...structuredContext.counterEvidence.map((item) =>
    asClinicalMemoryItem({
      item,
      kind: "legacy_memory",
      source: "legacy_structured_rag",
      role: "legacy_context",
      caveat: "Legacy counter evidence; keep as caution, not a strategy decision.",
    })
  ));
  context.legacyMemories.push(...structuredContext.activeHypotheses.map(activeHypothesisToClinicalItem));

  context.excluded.v1ContextUsed =
    context.rawSummaries.length > 0 || context.legacyMemories.length > 0;

  return context;
};

export const summarizeClinicalMemoryContext = (context: ClinicalMemoryContext) => ({
  understandings: context.understandings.length,
  timelineEvents: context.timelineEvents.length,
  relationships: context.relationships.length,
  semanticMemories: context.semanticMemories.length,
  rawSummaries: context.rawSummaries.length,
  legacyMemories: context.legacyMemories.length,
  rawMemory: context.excluded.rawMemory,
  directRecentMemories: context.excluded.directRecentMemories,
  v1ContextUsed: context.excluded.v1ContextUsed,
});
