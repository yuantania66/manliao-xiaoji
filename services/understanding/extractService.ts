import { Prisma, UnderstandingSourceType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { callModel, getDefaultAiModel } from "@/services/ai/modelProvider";

import { buildUnderstandingExtractPrompt } from "./extractPrompt";
import {
  ExtractedExperienceSlice,
  ExtractedFact,
  ExtractedInterpretation,
  UnderstandingExtraction,
  UnderstandingSourceTypeValue,
} from "./understandingTypes";

const LOW_INFORMATION_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[a-zA-Z]|[嗯啊哦好行对是]|算了|不知道|没事|随便|[^\s\p{L}\p{N}])$/u;

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const normalizeText = (value: string) => value.replace(/\s+/g, "").trim().toLowerCase();

const extractJsonObject = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  return trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "";
};

const compactStringArray = (value: unknown) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ].slice(0, 12)
    : [];

const sanitizeFact = (value: unknown): ExtractedFact | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const eventText = typeof record.eventText === "string" ? record.eventText.trim().slice(0, 300) : "";
  if (!eventText) return null;

  return {
    eventText,
    occurredAt: typeof record.occurredAt === "string" ? record.occurredAt : null,
    people: compactStringArray(record.people),
    location: typeof record.location === "string" && record.location.trim() ? record.location.trim().slice(0, 80) : null,
    topics: compactStringArray(record.topics),
    confidence: clamp(record.confidence, 0, 1, 0.5),
  };
};

const sanitizeExperience = (value: unknown): ExtractedExperienceSlice | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const emotion = typeof record.emotion === "string" ? record.emotion.trim().slice(0, 40) : null;
  const bodySignal = typeof record.bodySignal === "string" ? record.bodySignal.trim().slice(0, 120) : null;
  const behavior = typeof record.behavior === "string" ? record.behavior.trim().slice(0, 120) : null;
  if (!emotion && !bodySignal && !behavior) return null;

  return {
    eventText: typeof record.eventText === "string" ? record.eventText.trim().slice(0, 300) : null,
    emotion,
    emotionIntensity:
      record.emotionIntensity === null || record.emotionIntensity === undefined
        ? null
        : Math.round(clamp(record.emotionIntensity, 0, 100, 50)),
    bodySignal,
    behavior,
    duration: typeof record.duration === "string" ? record.duration.trim().slice(0, 80) : null,
  };
};

const sanitizeInterpretation = (value: unknown): ExtractedInterpretation | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const interpretationText =
    typeof record.interpretationText === "string" ? record.interpretationText.trim().slice(0, 300) : "";
  if (!interpretationText) return null;

  return {
    eventText: typeof record.eventText === "string" ? record.eventText.trim().slice(0, 300) : null,
    interpretationText,
    evidenceText: typeof record.evidenceText === "string" ? record.evidenceText.trim().slice(0, 300) : null,
    confidence: clamp(record.confidence, 0, 1, 0.5),
  };
};

export const parseUnderstandingExtraction = (value: string): UnderstandingExtraction | null => {
  const jsonText = extractJsonObject(value);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      facts: Array.isArray(parsed.facts) ? parsed.facts.flatMap((item) => sanitizeFact(item) ?? []) : [],
      experiences: Array.isArray(parsed.experiences)
        ? parsed.experiences.flatMap((item) => sanitizeExperience(item) ?? [])
        : [],
      interpretations: Array.isArray(parsed.interpretations)
        ? parsed.interpretations.flatMap((item) => sanitizeInterpretation(item) ?? [])
        : [],
      people: compactStringArray(parsed.people),
      topics: compactStringArray(parsed.topics),
      occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : null,
    };
  } catch {
    return null;
  }
};

export const inferLocalUnderstandingExtraction = ({
  content,
  messageCreatedAt,
}: {
  content: string;
  messageCreatedAt: Date;
}): UnderstandingExtraction => {
  const text = content.trim();
  if (!text || LOW_INFORMATION_PATTERN.test(text)) {
    return { facts: [], experiences: [], interpretations: [], people: [], topics: [], occurredAt: null };
  }

  const people = [
    /领导/.test(text) ? "领导" : null,
    /妈妈|母亲/.test(text) ? "妈妈" : null,
    /爸爸|父亲/.test(text) ? "爸爸" : null,
    /朋友/.test(text) ? "朋友" : null,
  ].filter((item): item is string => Boolean(item));
  const topics = [
    /领导|工作|项目|卡住|下班/.test(text) ? "工作" : null,
    /妈妈|母亲|爸爸|父亲|家庭/.test(text) ? "家庭" : null,
    /运动|跑步|健身|恢复/.test(text) ? "恢复" : null,
    /运动|跑步|健身/.test(text) ? "运动" : null,
    /消息|回复|回我/.test(text) ? "沟通" : null,
  ].filter((item): item is string => Boolean(item));

  const facts: ExtractedFact[] = [];
  if (/领导.*没回|没回.*领导/.test(text)) {
    facts.push({
      eventText: "领导没有回复消息",
      occurredAt: messageCreatedAt.toISOString(),
      people,
      topics: [...new Set([...topics, "工作", "沟通"])],
      confidence: 0.85,
    });
  } else if (/运动|跑步|健身/.test(text) && /恢复|好些|明显|缓过来|轻松/.test(text)) {
    facts.push({
      eventText: "运动后恢复明显",
      occurredAt: messageCreatedAt.toISOString(),
      people,
      topics: [...new Set([...topics, "恢复", "运动"])],
      confidence: 0.8,
    });
  } else if (/妈妈|母亲/.test(text)) {
    facts.push({
      eventText: text.slice(0, 120),
      occurredAt: messageCreatedAt.toISOString(),
      people: [...new Set([...people, "妈妈"])],
      topics: [...new Set([...topics, "家庭"])],
      confidence: 0.65,
    });
  } else if (/累|压力|焦虑|担心|难受|低落|烦|松一口气|推进/.test(text)) {
    facts.push({
      eventText: text.slice(0, 120),
      occurredAt: messageCreatedAt.toISOString(),
      people,
      topics,
      confidence: 0.55,
    });
  }

  const experiences: ExtractedExperienceSlice[] = [];
  if (/焦虑|担心|是不是|讨厌/.test(text)) {
    experiences.push({
      eventText: facts[0]?.eventText,
      emotion: "焦虑/担心",
      emotionIntensity: 65,
    });
  } else if (/难受|低落|下降|烦/.test(text)) {
    experiences.push({
      eventText: facts[0]?.eventText,
      emotion: "低落/难受",
      emotionIntensity: 65,
    });
  } else if (/累|压力/.test(text)) {
    experiences.push({
      eventText: facts[0]?.eventText,
      emotion: "疲惫/压力",
      emotionIntensity: 60,
    });
  } else if (/恢复|好些|轻松|缓过来|松一口气/.test(text)) {
    experiences.push({
      eventText: facts[0]?.eventText,
      emotion: "恢复/放松",
      emotionIntensity: 55,
      behavior: /运动|跑步|健身/.test(text) ? "运动" : undefined,
    });
  }

  const interpretations: ExtractedInterpretation[] = [];
  const dislikedMatch = text.match(/我是不是[^。！？\n]*讨厌[^。！？\n]*/);
  if (dislikedMatch) {
    interpretations.push({
      eventText: facts[0]?.eventText,
      interpretationText: dislikedMatch[0],
      evidenceText: "用户把对方未回复解释为可能被讨厌",
      confidence: 0.8,
    });
  }

  return {
    facts,
    experiences,
    interpretations,
    people: [...new Set(people)],
    topics: [...new Set(topics)],
    occurredAt: facts[0]?.occurredAt ?? messageCreatedAt.toISOString(),
  };
};

const parseDate = (value: string | null | undefined, fallback: Date) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
};

const findMatchingFact = (facts: { id: string; eventText: string }[], eventText?: string | null) => {
  if (!eventText) return facts[0] ?? null;
  const normalized = normalizeText(eventText);
  return (
    facts.find((fact) => normalizeText(fact.eventText) === normalized) ??
    facts.find((fact) => {
      const other = normalizeText(fact.eventText);
      return normalized.includes(other) || other.includes(normalized);
    }) ??
    facts[0] ??
    null
  );
};

const toSourceType = (value: UnderstandingSourceTypeValue) =>
  value === "note" ? UnderstandingSourceType.NOTE : UnderstandingSourceType.CHAT;

export const extractUnderstandingFromMessage = async ({
  content,
  createdAt,
}: {
  userId: string;
  sourceType: UnderstandingSourceTypeValue;
  sourceId: string;
  content: string;
  createdAt: Date;
}): Promise<UnderstandingExtraction> => {
  let extraction: UnderstandingExtraction | null = null;

  try {
    const response = await callModel({
      model: process.env.AI_EXTRACTOR_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
      messages: buildUnderstandingExtractPrompt({ content, messageCreatedAt: createdAt }),
      temperature: 0.1,
    });
    extraction = parseUnderstandingExtraction(response.text);
  } catch (error) {
    console.error("understanding extraction model failed", error);
  }

  return extraction ?? inferLocalUnderstandingExtraction({ content, messageCreatedAt: createdAt });
};

export const writeUnderstandingExtraction = async ({
  userId,
  sourceType,
  sourceId,
  createdAt,
  extraction,
}: {
  userId: string;
  sourceType: UnderstandingSourceTypeValue;
  sourceId: string;
  createdAt: Date;
  extraction: UnderstandingExtraction;
}) => {
  const source = toSourceType(sourceType);
  const createdFacts = [] as { id: string; eventText: string }[];

  for (const fact of extraction.facts.slice(0, 4)) {
    const created = await prisma.fact.create({
      data: {
        userId,
        sourceType: source,
        sourceId,
        occurredAt: parseDate(fact.occurredAt ?? extraction.occurredAt, createdAt),
        eventText: fact.eventText,
        people: (fact.people ?? []) as Prisma.InputJsonValue,
        location: fact.location ?? null,
        topics: (fact.topics ?? []) as Prisma.InputJsonValue,
        confidence: clamp(fact.confidence, 0, 1, 0.5),
      },
      select: { id: true, eventText: true },
    });
    createdFacts.push(created);
  }

  for (const experience of extraction.experiences.slice(0, 5)) {
    const event = findMatchingFact(createdFacts, experience.eventText);
    await prisma.experienceSlice.create({
      data: {
        userId,
        sourceType: source,
        sourceId,
        eventId: event?.id,
        emotion: experience.emotion,
        emotionIntensity:
          experience.emotionIntensity === null || experience.emotionIntensity === undefined
            ? null
            : Math.round(clamp(experience.emotionIntensity, 0, 100, 50)),
        bodySignal: experience.bodySignal,
        behavior: experience.behavior,
        duration: experience.duration,
      },
    });
  }

  for (const interpretation of extraction.interpretations.slice(0, 4)) {
    const event = findMatchingFact(createdFacts, interpretation.eventText);
    if (!event) continue;
    await prisma.interpretation.create({
      data: {
        userId,
        eventId: event.id,
        interpretationText: interpretation.interpretationText,
        evidenceText: interpretation.evidenceText,
        confidence: clamp(interpretation.confidence, 0, 1, 0.5),
      },
    });
  }

  return {
    factCount: createdFacts.length,
    facts: createdFacts,
  };
};
