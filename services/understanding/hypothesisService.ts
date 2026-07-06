import {
  HypothesisCategory,
  HypothesisStatus,
  UnderstandingGraphEdgeType,
  UnderstandingGraphNodeType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { UnderstandingExtraction } from "./understandingTypes";

type WrittenFact = {
  id: string;
  eventText: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const jsonIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const mergeIds = (current: unknown, next: string[]) => [...new Set([...jsonIds(current), ...next])];

const upsertHypothesis = async ({
  userId,
  hypothesisText,
  category,
  supportIds,
  counterIds = [],
  confidenceDelta,
  maxConfidence,
}: {
  userId: string;
  hypothesisText: string;
  category: HypothesisCategory;
  supportIds: string[];
  counterIds?: string[];
  confidenceDelta: number;
  maxConfidence: number;
}) => {
  const existing = await prisma.hypothesis.findFirst({
    where: {
      userId,
      hypothesisText,
      status: { in: [HypothesisStatus.ACTIVE, HypothesisStatus.WEAKENED] },
    },
  });

  if (!existing) {
    return prisma.hypothesis.create({
      data: {
        userId,
        hypothesisText,
        category,
        confidence: clamp(0.25 + confidenceDelta, 0.1, maxConfidence),
        supportingEvidenceIds: supportIds,
        counterEvidenceIds: counterIds,
        status: HypothesisStatus.ACTIVE,
      },
    });
  }

  const nextCounterIds = mergeIds(existing.counterEvidenceIds, counterIds);
  const counterPenalty = nextCounterIds.length > jsonIds(existing.counterEvidenceIds).length ? 0.08 : 0;
  const nextConfidence = clamp(
    existing.confidence + confidenceDelta - counterPenalty,
    0.05,
    maxConfidence
  );

  return prisma.hypothesis.update({
    where: { id: existing.id },
    data: {
      confidence: nextConfidence,
      supportingEvidenceIds: mergeIds(existing.supportingEvidenceIds, supportIds),
      counterEvidenceIds: nextCounterIds,
      status: nextConfidence < 0.18 ? HypothesisStatus.WEAKENED : HypothesisStatus.ACTIVE,
    },
  });
};

const findOrCreateNode = async ({
  userId,
  type,
  label,
  refId,
}: {
  userId: string;
  type: UnderstandingGraphNodeType;
  label: string;
  refId?: string | null;
}) => {
  const existing = await prisma.understandingGraphNode.findFirst({
    where: {
      userId,
      type,
      label,
      refId: refId ?? null,
    },
  });
  if (existing) return existing;

  return prisma.understandingGraphNode.create({
    data: {
      userId,
      type,
      label,
      refId,
    },
  });
};

const createEdgeIfMissing = async ({
  userId,
  fromNodeId,
  toNodeId,
  type,
  evidenceId,
  weight = 0.5,
}: {
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  type: UnderstandingGraphEdgeType;
  evidenceId?: string;
  weight?: number;
}) => {
  const existing = await prisma.understandingGraphEdge.findFirst({
    where: {
      userId,
      fromNodeId,
      toNodeId,
      type,
      evidenceId,
    },
  });
  if (existing) return existing;

  return prisma.understandingGraphEdge.create({
    data: {
      userId,
      fromNodeId,
      toNodeId,
      type,
      evidenceId,
      weight,
    },
  });
};

export const updateUnderstandingHypotheses = async ({
  userId,
  extraction,
  writtenFacts,
}: {
  userId: string;
  extraction: UnderstandingExtraction;
  writtenFacts: WrittenFact[];
}) => {
  const supportIds = writtenFacts.map((fact) => fact.id);
  if (supportIds.length === 0) return;

  const people = new Set(extraction.people);
  const topics = new Set(extraction.topics);
  const emotionText = extraction.experiences.map((item) => item.emotion ?? "").join(" ");
  const interpretationText = extraction.interpretations
    .map((item) => item.interpretationText)
    .join(" ");
  const factText = writtenFacts.map((fact) => fact.eventText).join(" ");

  if (/讨厌|评价|不喜欢|是不是/.test(interpretationText) && /焦虑|担心/.test(emotionText)) {
    await upsertHypothesis({
      userId,
      hypothesisText: "用户可能对他人的回应和评价较敏感，但这只是低置信假设。",
      category: HypothesisCategory.RELATIONSHIP,
      supportIds,
      confidenceDelta: 0.04,
      maxConfidence: 0.45,
    });
  }

  if (people.has("妈妈") && /低落|难受|焦虑|担心|烦/.test(emotionText)) {
    const motherFactCount = await prisma.fact.count({
      where: {
        userId,
        eventText: { contains: "妈妈" },
      },
    });
    await upsertHypothesis({
      userId,
      hypothesisText: "妈妈相关事件可能和用户情绪下降有关，但不能据此下创伤结论。",
      category: HypothesisCategory.FAMILY,
      supportIds,
      confidenceDelta: motherFactCount >= 2 ? 0.08 : 0.03,
      maxConfidence: 0.5,
    });
  }

  if (topics.has("工作") || /工作|项目|领导|压力/.test(factText)) {
    await upsertHypothesis({
      userId,
      hypothesisText: "工作可能是近期压力来源之一。",
      category: HypothesisCategory.WORK,
      supportIds,
      confidenceDelta: 0.04,
      maxConfidence: 0.65,
    });
  }

  if (topics.has("恢复") || /运动|跑步|健身|恢复/.test(factText)) {
    await upsertHypothesis({
      userId,
      hypothesisText: "运动可能是对用户有效的恢复方式之一。",
      category: HypothesisCategory.RECOVERY,
      supportIds,
      confidenceDelta: 0.12,
      maxConfidence: 0.75,
    });

    const workHypothesis = await prisma.hypothesis.findFirst({
      where: {
        userId,
        hypothesisText: "工作可能是近期压力来源之一。",
        status: HypothesisStatus.ACTIVE,
      },
    });
    if (workHypothesis) {
      await prisma.hypothesis.update({
        where: { id: workHypothesis.id },
        data: {
          confidence: clamp(workHypothesis.confidence - 0.06, 0.05, 0.65),
          counterEvidenceIds: mergeIds(workHypothesis.counterEvidenceIds, supportIds),
        },
      });
    }
  }

  for (const fact of writtenFacts) {
    const eventNode = await findOrCreateNode({
      userId,
      type: UnderstandingGraphNodeType.EVENT,
      label: fact.eventText.slice(0, 80),
      refId: fact.id,
    });

    for (const person of extraction.people.slice(0, 6)) {
      const personNode = await findOrCreateNode({
        userId,
        type: UnderstandingGraphNodeType.PERSON,
        label: person,
      });
      await createEdgeIfMissing({
        userId,
        fromNodeId: personNode.id,
        toNodeId: eventNode.id,
        type: UnderstandingGraphEdgeType.RELATED_TO,
        evidenceId: fact.id,
      });
    }

    for (const topic of extraction.topics.slice(0, 6)) {
      const topicNode = await findOrCreateNode({
        userId,
        type: UnderstandingGraphNodeType.TOPIC,
        label: topic,
      });
      await createEdgeIfMissing({
        userId,
        fromNodeId: eventNode.id,
        toNodeId: topicNode.id,
        type: UnderstandingGraphEdgeType.RELATED_TO,
        evidenceId: fact.id,
      });
    }

    for (const experience of extraction.experiences.slice(0, 4)) {
      if (!experience.emotion) continue;
      const emotionNode = await findOrCreateNode({
        userId,
        type: UnderstandingGraphNodeType.EMOTION,
        label: experience.emotion,
      });
      await createEdgeIfMissing({
        userId,
        fromNodeId: eventNode.id,
        toNodeId: emotionNode.id,
        type: /恢复|放松|轻松/.test(experience.emotion)
          ? UnderstandingGraphEdgeType.RELIEVED_BY
          : UnderstandingGraphEdgeType.TRIGGERED,
        evidenceId: fact.id,
      });
    }
  }
};
