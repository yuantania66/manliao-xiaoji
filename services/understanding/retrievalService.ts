import { HypothesisStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  ActiveHypothesisMemory,
  StructuredMemoryItem,
  StructuredRagContext,
  UnderstandingExtraction,
} from "./understandingTypes";

const DAY_MS = 24 * 60 * 60 * 1000;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

const compact = <T>(items: T[], limit: number) => items.slice(0, limit);

const uniqueById = <T extends { id: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const normalize = (value: string) => value.replace(/\s+/g, "").trim().toLowerCase();

const overlaps = (left: string[], right: string[]) => {
  const normalizedRight = new Set(right.map(normalize));
  return left.some((item) => normalizedRight.has(normalize(item)));
};

const parseEvidenceIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const getRetrievalIntent = (extraction: UnderstandingExtraction) => {
  const emotions = extraction.experiences.flatMap((item) => (item.emotion ? [item.emotion] : []));
  return {
    people: extraction.people,
    topics: extraction.topics,
    emotions,
  };
};

export const buildStructuredRagContext = async ({
  userId,
  extraction,
  now = new Date(),
}: {
  userId: string;
  extraction: UnderstandingExtraction;
  now?: Date;
}): Promise<StructuredRagContext> => {
  const intent = getRetrievalIntent(extraction);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const threeDaysAgo = new Date(now.getTime() - 3 * DAY_MS);

  const [recentFacts, recentExperiences, recentNotes, factsForSimilarity, experiencesForSimilarity, coreEvents, hypotheses] =
    await Promise.all([
      prisma.fact.findMany({
        where: {
          userId,
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          eventText: true,
          occurredAt: true,
          people: true,
          topics: true,
          confidence: true,
        },
      }),
      prisma.experienceSlice.findMany({
        where: {
          userId,
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          emotion: true,
          emotionIntensity: true,
          behavior: true,
          bodySignal: true,
          createdAt: true,
          event: {
            select: {
              eventText: true,
              occurredAt: true,
              topics: true,
              people: true,
            },
          },
        },
      }),
      prisma.note.findMany({
        where: {
          userId,
          createdAt: { gte: threeDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, content: true, recordDate: true },
      }),
      prisma.fact.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          id: true,
          eventText: true,
          occurredAt: true,
          people: true,
          topics: true,
          confidence: true,
        },
      }),
      prisma.experienceSlice.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          id: true,
          emotion: true,
          emotionIntensity: true,
          behavior: true,
          bodySignal: true,
          createdAt: true,
          event: {
            select: {
              eventText: true,
              occurredAt: true,
              topics: true,
              people: true,
            },
          },
        },
      }),
      prisma.event.findMany({
        where: {
          userId,
          OR: [{ isCoreEvent: true }, { importanceScore: { gte: 0.7 } }],
        },
        orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
        take: 10,
        select: {
          id: true,
          title: true,
          description: true,
          eventDate: true,
          participants: true,
          category: true,
          importanceScore: true,
        },
      }),
      prisma.hypothesis.findMany({
        where: {
          userId,
          status: HypothesisStatus.ACTIVE,
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take: 12,
      }),
    ]);

  const factToItem = (fact: (typeof recentFacts)[number], reason?: string): StructuredMemoryItem => ({
    id: fact.id,
    kind: "fact",
    text: fact.eventText,
    occurredAt: fact.occurredAt?.toISOString() ?? null,
    people: asStringArray(fact.people),
    topics: asStringArray(fact.topics),
    confidence: fact.confidence,
    reason,
  });

  const experienceToItem = (
    experience: (typeof recentExperiences)[number],
    reason?: string
  ): StructuredMemoryItem => ({
    id: experience.id,
    kind: "experience",
    text: experience.event?.eventText ?? [experience.emotion, experience.bodySignal, experience.behavior].filter(Boolean).join(" / "),
    occurredAt: experience.event?.occurredAt?.toISOString() ?? experience.createdAt.toISOString(),
    people: asStringArray(experience.event?.people),
    topics: asStringArray(experience.event?.topics),
    emotion: experience.emotion,
    reason,
  });

  const recentMemories: StructuredMemoryItem[] = [
    ...recentFacts.map((fact) => factToItem(fact, "recent_fact_7d")),
    ...recentExperiences.map((experience) => experienceToItem(experience, "recent_experience_7d")),
    ...recentNotes.map((note) => ({
      id: note.id,
      kind: "note" as const,
      text: note.content.slice(0, 240),
      occurredAt: note.recordDate.toISOString(),
      reason: "recent_note_3d",
    })),
  ];

  const similarFacts = factsForSimilarity.filter(
    (fact) =>
      overlaps(intent.people, asStringArray(fact.people)) ||
      overlaps(intent.topics, asStringArray(fact.topics))
  );
  const similarExperiences = experiencesForSimilarity.filter(
    (experience) =>
      (experience.emotion && intent.emotions.includes(experience.emotion)) ||
      overlaps(intent.people, asStringArray(experience.event?.people)) ||
      overlaps(intent.topics, asStringArray(experience.event?.topics))
  );

  const activeHypotheses: ActiveHypothesisMemory[] = hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    hypothesisText: hypothesis.hypothesisText,
    category: hypothesis.category.toLowerCase(),
    confidence: hypothesis.confidence,
    supportingEvidenceIds: parseEvidenceIds(hypothesis.supportingEvidenceIds),
    counterEvidenceIds: parseEvidenceIds(hypothesis.counterEvidenceIds),
  }));

  const counterEvidenceIds = activeHypotheses.flatMap((item) => item.counterEvidenceIds);
  const explicitCounterFacts =
    counterEvidenceIds.length > 0
      ? await prisma.fact.findMany({
          where: { userId, id: { in: counterEvidenceIds } },
          take: 10,
          select: {
            id: true,
            eventText: true,
            occurredAt: true,
            people: true,
            topics: true,
            confidence: true,
          },
        })
      : [];
  const recoveryCounterEvidence = experiencesForSimilarity.filter(
    (experience) =>
      /恢复|放松|轻松|缓过来/.test(experience.emotion ?? "") ||
      /运动|跑步|健身/.test(experience.behavior ?? "")
  );

  return {
    recentMemories: compact(uniqueById(recentMemories), 20),
    similarMemories: compact(
      uniqueById([
        ...similarFacts.map((fact) => factToItem(fact, "same_people_or_topic")),
        ...similarExperiences.map((experience) => experienceToItem(experience, "same_emotion_people_or_topic")),
      ]),
      16
    ),
    coreEvents: compact(
      coreEvents.map((event) => ({
        id: event.id,
        kind: "event" as const,
        text: [event.title, event.description].filter(Boolean).join("："),
        occurredAt: event.eventDate.toISOString(),
        people: asStringArray(event.participants),
        topics: event.category ? [event.category] : [],
        confidence: event.importanceScore,
        reason: "core_event",
      })),
      10
    ),
    activeHypotheses,
    counterEvidence: compact(
      uniqueById([
        ...explicitCounterFacts.map((fact) => factToItem(fact, "explicit_counter_evidence")),
        ...recoveryCounterEvidence.map((experience) => experienceToItem(experience, "possible_recovery_counter_evidence")),
      ]),
      10
    ),
    retrievalReason: [
      intent.people.length ? `people=${intent.people.join(",")}` : null,
      intent.topics.length ? `topics=${intent.topics.join(",")}` : null,
      intent.emotions.length ? `emotions=${intent.emotions.join(",")}` : null,
    ]
      .filter(Boolean)
      .join("; "),
  };
};
