import {
  EvidenceRole,
  EvidenceTargetType,
  MemoryActor,
  MessageStatus,
  Prisma,
  SemanticMemoryKind,
  SemanticMemoryStatus,
  type SemanticMemoryVersion,
  VersionChangeType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { callModel, getDefaultAiModel } from "@/services/ai/modelProvider";
import type { AiModelMessage } from "@/services/ai/types";
import type { UnderstandingExtraction } from "@/services/understanding/understandingTypes";

import { createEvidenceFromRawMemory } from "./evidenceService";

const SUMMARY_KEYS = [
  "naturalSummary",
  "people",
  "topics",
  "emotions",
  "openThreads",
  "confirmedFacts",
  "hypotheses",
  "sourceMessageIds",
] as const;
const COMMITTED_MESSAGE_STATUSES = [
  MessageStatus.SAVED,
  MessageStatus.REWRITTEN,
  MessageStatus.FALLBACK,
];
const MAX_SOURCE_MESSAGES = 48;
const MAX_RETRIEVAL_CANDIDATES = 3;

export type EpisodeSummarySnapshot = {
  naturalSummary: string;
  people: string[];
  topics: string[];
  emotions: string[];
  openThreads: string[];
  confirmedFacts: string[];
  hypotheses: string[];
  sourceMessageIds: string[];
};

export type EpisodeSummaryProviderInput = {
  sessionId: string;
  previousSummary: EpisodeSummarySnapshot | null;
  committedMessages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
};

export type EpisodeSummaryProvider = (
  input: EpisodeSummaryProviderInput
) => Promise<unknown>;

export type EpisodeMemoryCandidate = {
  semanticMemoryId: string;
  sessionId: string;
  summary: string;
  people: string[];
  topics: string[];
  emotions: string[];
  openThreads: string[];
  confirmedFacts: string[];
  hypotheses: string[];
  sourceMessageIds: string[];
  occurredAt: string;
  relevanceScore: number;
  matchedDimensions: Array<"people" | "topics" | "emotions" | "text">;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>) => {
  const actual = Object.keys(value).sort();
  const expected = [...SUMMARY_KEYS].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
};

const parseCompactStringArray = (
  value: unknown,
  { maxItems = 12, maxLength = 160 }: { maxItems?: number; maxLength?: number } = {}
) => {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > maxLength) return null;
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
};

export const parseEpisodeSummaryProviderOutput = (
  value: unknown
): EpisodeSummarySnapshot | null => {
  let parsed = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed)) return null;
  const naturalSummary = typeof parsed.naturalSummary === "string"
    ? parsed.naturalSummary.replace(/\s+/g, " ").trim()
    : "";
  const people = parseCompactStringArray(parsed.people, { maxItems: 12, maxLength: 48 });
  const topics = parseCompactStringArray(parsed.topics, { maxItems: 12, maxLength: 48 });
  const emotions = parseCompactStringArray(parsed.emotions, { maxItems: 8, maxLength: 48 });
  const openThreads = parseCompactStringArray(parsed.openThreads);
  const confirmedFacts = parseCompactStringArray(parsed.confirmedFacts);
  const hypotheses = parseCompactStringArray(parsed.hypotheses);
  const sourceMessageIds = parseCompactStringArray(parsed.sourceMessageIds, {
    maxItems: 120,
    maxLength: 180,
  });
  if (
    !naturalSummary || naturalSummary.length > 480 ||
    !people || !topics || !emotions || !openThreads ||
    !confirmedFacts || !hypotheses || !sourceMessageIds || sourceMessageIds.length === 0
  ) return null;
  return {
    naturalSummary,
    people,
    topics,
    emotions,
    openThreads,
    confirmedFacts,
    hypotheses,
    sourceMessageIds,
  };
};

const buildSummaryMessages = (input: EpisodeSummaryProviderInput): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "Create one evidence-bound conversation episode summary as a JSON object.",
      "Return exactly these keys: naturalSummary, people, topics, emotions, openThreads, confirmedFacts, hypotheses, sourceMessageIds.",
      "All fields except naturalSummary are string arrays. naturalSummary is concise natural Chinese.",
      "Keep confirmed user-stated events separate from hypotheses. Never upgrade a possible relationship or cause into a fact.",
      "Every sourceMessageId must be copied exactly from the supplied committed messages (or retained from the previous summary).",
      "Use only supplied material. Do not add advice, diagnosis, response copy, or lifecycle state.",
    ].join("\n"),
  },
  {
    role: "user",
    content: JSON.stringify(input),
  },
];

export const defaultEpisodeSummaryProvider: EpisodeSummaryProvider = async (input) => {
  const response = await callModel({
    model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    messages: buildSummaryMessages(input),
    temperature: 0,
    responseFormat: "json_object",
  });
  return response.text;
};

const snapshotFromJson = (value: Prisma.JsonValue | null | undefined) =>
  parseEpisodeSummaryProviderOutput(value);

const summaryProjectionId = (sessionId: string) => `episode-summary:${sessionId}`;
const summarySource = (sessionId: string) => `CHAT_SESSION:${sessionId}`;
const summaryOperationId = (sessionId: string, lastMessageId: string) =>
  `episode_summary:${sessionId}:${lastMessageId}`;

export const refreshEpisodeSummaryForSession = async ({
  userId,
  sessionId,
  provider = defaultEpisodeSummaryProvider,
}: {
  userId: string;
  sessionId: string;
  provider?: EpisodeSummaryProvider;
}) => {
  const projectionId = summaryProjectionId(sessionId);
  const [messagesDescending, previousMemory] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        userId,
        sessionId,
        status: { in: COMMITTED_MESSAGE_STATUSES },
        role: { in: ["USER", "ASSISTANT"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SOURCE_MESSAGES,
      select: { id: true, role: true, content: true, createdAt: true },
    }),
    prisma.semanticMemory.findUnique({
      where: { id: projectionId },
      include: { currentVersionRecord: true },
    }),
  ]);
  const messages = messagesDescending.reverse();
  const lastMessage = messages.at(-1);
  if (!lastMessage || !messages.some((message) => message.role === "USER") ||
      !messages.some((message) => message.role === "ASSISTANT")) {
    return { outcome: "skipped" as const, reason: "insufficient_committed_turns" as const };
  }

  const operationId = summaryOperationId(sessionId, lastMessage.id);
  const existingVersion = await prisma.semanticMemoryVersion.findUnique({ where: { operationId } });
  if (existingVersion) {
    return {
      outcome: "unchanged" as const,
      semanticMemoryId: existingVersion.semanticMemoryId,
      versionId: existingVersion.id,
    };
  }

  const previousSummary = snapshotFromJson(previousMemory?.currentVersionRecord?.snapshot);
  const previousSourceIds = new Set(previousSummary?.sourceMessageIds ?? []);
  const newMessages = previousSummary
    ? messages.filter((message) => !previousSourceIds.has(message.id))
    : messages;
  if (previousSummary && newMessages.length === 0) {
    return { outcome: "skipped" as const, reason: "no_new_committed_turns" as const };
  }

  const providerOutput = await provider({
    sessionId,
    previousSummary,
    committedMessages: newMessages.map((message) => ({
      id: message.id,
      role: message.role === "USER" ? "user" : "assistant",
      content: message.content.slice(0, 600),
      createdAt: message.createdAt.toISOString(),
    })),
  });
  const summary = parseEpisodeSummaryProviderOutput(providerOutput);
  if (!summary) throw new Error("Episode summary provider returned invalid structured JSON.");

  const allowedSourceIds = new Set([
    ...(previousSummary?.sourceMessageIds ?? []),
    ...messages.map((message) => message.id),
  ]);
  if (
    !summary.sourceMessageIds.includes(lastMessage.id) ||
    summary.sourceMessageIds.some((id) => !allowedSourceIds.has(id))
  ) {
    throw new Error("Episode summary sourceMessageIds are not bound to committed session messages.");
  }

  const committedSourceCount = await prisma.chatMessage.count({
    where: {
      userId,
      sessionId,
      id: { in: summary.sourceMessageIds },
      status: { in: COMMITTED_MESSAGE_STATUSES },
    },
  });
  if (committedSourceCount !== summary.sourceMessageIds.length) {
    throw new Error("Episode summary references a message outside the committed session boundary.");
  }

  const sourceRawMemoryRevisions = await prisma.rawMemory.findMany({
    where: {
      userId,
      sessionId,
      sourceId: { in: summary.sourceMessageIds },
      sourceType: "CHAT_MESSAGE",
    },
    orderBy: { sourceRevision: "desc" },
    select: { id: true, sourceId: true },
  });
  const sourceRawMemoryByMessageId = new Map<string, { id: string }>();
  for (const rawMemory of sourceRawMemoryRevisions) {
    if (!sourceRawMemoryByMessageId.has(rawMemory.sourceId)) {
      sourceRawMemoryByMessageId.set(rawMemory.sourceId, { id: rawMemory.id });
    }
  }
  if (sourceRawMemoryByMessageId.size !== summary.sourceMessageIds.length) {
    throw new Error("Episode summary cannot publish without evidence for every source message.");
  }
  const sourceEvidence = await Promise.all(
    [...sourceRawMemoryByMessageId.values()].map((rawMemory) =>
      createEvidenceFromRawMemory({ rawMemoryId: rawMemory.id })
    )
  );

  let persisted: {
    version: SemanticMemoryVersion;
    unchanged: boolean;
  };
  try {
    persisted = await prisma.$transaction(async (tx) => {
      const racedVersion = await tx.semanticMemoryVersion.findUnique({ where: { operationId } });
      if (racedVersion) return { version: racedVersion, unchanged: true };
      const memory = await tx.semanticMemory.upsert({
        where: { id: projectionId },
        create: {
          id: projectionId,
          userId,
          kind: SemanticMemoryKind.EPISODE_SUMMARY,
          title: "Conversation episode summary",
          content: summary.naturalSummary,
          confidence: 0.7,
          source: summarySource(sessionId),
          status: SemanticMemoryStatus.ACTIVE,
        },
        update: {},
      });
      if (
        memory.userId !== userId ||
        memory.kind !== SemanticMemoryKind.EPISODE_SUMMARY ||
        memory.source !== summarySource(sessionId)
      ) throw new Error("Episode summary projection identity conflicts with existing memory.");

      const nextVersion = memory.currentVersionId ? memory.currentVersion + 1 : 1;
      const version = await tx.semanticMemoryVersion.create({
        data: {
          userId,
          semanticMemoryId: memory.id,
          version: nextVersion,
          kind: SemanticMemoryKind.EPISODE_SUMMARY,
          title: "Conversation episode summary",
          content: summary.naturalSummary,
          confidence: 0.7,
          source: summarySource(sessionId),
          status: SemanticMemoryStatus.ACTIVE,
          snapshot: summary as unknown as Prisma.InputJsonValue,
          changeType: nextVersion === 1 ? VersionChangeType.CREATED : VersionChangeType.UPDATED,
          reason: "Refreshed from committed messages in the same chat session.",
          operationId,
          createdBy: MemoryActor.SYSTEM,
        },
      });
      await tx.semanticMemory.update({
        where: { id: memory.id },
        data: {
          content: summary.naturalSummary,
          currentVersion: version.version,
          currentVersionId: version.id,
          lastUpdatedAt: new Date(),
        },
      });
      await tx.memoryEvidenceLink.createMany({
        data: sourceEvidence.flatMap((evidence) => [
          {
            userId,
            evidenceId: evidence.id,
            targetType: EvidenceTargetType.SEMANTIC_MEMORY,
            targetId: memory.id,
            role: EvidenceRole.SOURCE,
          },
          {
            userId,
            evidenceId: evidence.id,
            targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
            targetId: version.id,
            role: EvidenceRole.SOURCE,
          },
        ]),
        skipDuplicates: true,
      });
      return { version, unchanged: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.semanticMemoryVersion.findUnique({ where: { operationId } });
      if (winner) persisted = { version: winner, unchanged: true };
      else throw error;
    } else {
      throw error;
    }
  }

  return {
    outcome: persisted.unchanged ? "unchanged" as const : "refreshed" as const,
    semanticMemoryId: projectionId,
    versionId: persisted.version.id,
  };
};

const normalizedTerms = (values: string[]) => new Set(
  values.map((value) => value.replace(/\s+/g, "").toLocaleLowerCase()).filter(Boolean)
);

const exactOverlapCount = (left: string[], right: string[]) => {
  const rightTerms = normalizedTerms(right);
  return [...normalizedTerms(left)].filter((item) => rightTerms.has(item)).length;
};

export const countTopicTermOverlap = (left: string[], right: string[]) => {
  const rightTerms = normalizedTerms(right);
  return [...normalizedTerms(left)].filter((item) =>
    [...rightTerms].some((candidate) =>
      item === candidate ||
      Math.min(item.length, candidate.length) >= 2 &&
        (item.includes(candidate) || candidate.includes(item))
    )
  ).length;
};

const textUnits = (value: string) => {
  const normalized = value.replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase();
  const units = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    units.add(normalized.slice(index, index + 2));
  }
  return units;
};

const textOverlapCount = (left: string, right: string) => {
  const rightUnits = textUnits(right);
  return [...textUnits(left)].filter((unit) => rightUnits.has(unit)).length;
};

const sessionIdFromSource = (source: string) =>
  source.startsWith("CHAT_SESSION:") ? source.slice("CHAT_SESSION:".length) : null;

export const retrieveRelevantEpisodeMemories = async ({
  userId,
  currentSessionId,
  currentMessage,
  extraction,
  take = MAX_RETRIEVAL_CANDIDATES,
}: {
  userId: string;
  currentSessionId: string;
  currentMessage: string;
  extraction: UnderstandingExtraction;
  take?: number;
}): Promise<EpisodeMemoryCandidate[]> => {
  const currentEmotions = extraction.experiences
    .flatMap((item) => item.emotion ? [item.emotion] : []);
  const memories = await prisma.semanticMemory.findMany({
    where: {
      userId,
      kind: SemanticMemoryKind.EPISODE_SUMMARY,
      status: { in: [SemanticMemoryStatus.ACTIVE, SemanticMemoryStatus.USER_CORRECTED] },
      currentVersionId: { not: null },
      source: { not: summarySource(currentSessionId) },
    },
    include: { currentVersionRecord: true },
    orderBy: { lastUpdatedAt: "desc" },
    take: 40,
  });

  return memories.flatMap((memory) => {
    const snapshot = snapshotFromJson(memory.currentVersionRecord?.snapshot);
    const sessionId = sessionIdFromSource(memory.source);
    if (!snapshot || !sessionId || sessionId === currentSessionId) return [];
    const peopleOverlap = exactOverlapCount(extraction.people, snapshot.people);
    const topicOverlap = countTopicTermOverlap(extraction.topics, snapshot.topics);
    const emotionOverlap = exactOverlapCount(currentEmotions, snapshot.emotions);
    const compactSearchText = [
      snapshot.naturalSummary,
      ...snapshot.people,
      ...snapshot.topics,
      ...snapshot.openThreads,
      ...snapshot.confirmedFacts,
    ].join(" ");
    const textOverlap = Math.min(3, textOverlapCount(currentMessage, compactSearchText));
    const relevanceScore = peopleOverlap * 4 + topicOverlap * 3 + emotionOverlap + textOverlap;
    if (relevanceScore < 3) return [];
    const matchedDimensions: EpisodeMemoryCandidate["matchedDimensions"] = [];
    if (peopleOverlap) matchedDimensions.push("people");
    if (topicOverlap) matchedDimensions.push("topics");
    if (emotionOverlap) matchedDimensions.push("emotions");
    if (textOverlap) matchedDimensions.push("text");
    return [{
      semanticMemoryId: memory.id,
      sessionId,
      summary: snapshot.naturalSummary.slice(0, 320),
      people: snapshot.people.slice(0, 6),
      topics: snapshot.topics.slice(0, 6),
      emotions: snapshot.emotions.slice(0, 4),
      openThreads: snapshot.openThreads.slice(0, 4),
      confirmedFacts: snapshot.confirmedFacts.slice(0, 6),
      hypotheses: snapshot.hypotheses.slice(0, 4),
      sourceMessageIds: snapshot.sourceMessageIds,
      occurredAt: memory.lastUpdatedAt.toISOString(),
      relevanceScore,
      matchedDimensions,
    }];
  }).sort((left, right) =>
    right.relevanceScore - left.relevanceScore ||
    right.occurredAt.localeCompare(left.occurredAt)
  ).slice(0, Math.max(0, Math.min(take, MAX_RETRIEVAL_CANDIDATES)));
};
