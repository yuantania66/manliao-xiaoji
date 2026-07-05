import {
  EventRelationType,
  EventSourceType,
  EventStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { callModel, getDefaultAiModel } from "@/services/ai/modelProvider";

import {
  buildExperienceExtractorPrompt,
  EXPERIENCE_EXTRACTOR_PROMPT_VERSION,
} from "./experienceExtractorPrompt";

type ExtractExperienceInput = {
  userId: string;
  sessionId: string;
  messageId: string;
  content: string;
  createdAt: Date;
};

type ExtractedEvent = {
  title: string;
  description?: string;
  eventDate?: string;
  category?: string;
  participants?: string[];
  importanceScore?: number;
  isCoreEventCandidate?: boolean;
  status?: keyof typeof EventStatus;
  evidenceText?: string;
};

type ExtractedEmotionSlice = {
  eventTitle?: string;
  emotionType: string;
  intensity?: number;
  delta?: number;
  valence?: number;
  arousal?: number;
  evidenceText?: string;
};

type ExtractedEventRelation = {
  fromEventTitle: string;
  toEventTitle: string;
  relationType: keyof typeof EventRelationType;
  emotionType?: string;
  strength?: number;
  evidenceText?: string;
};

type ExperienceExtractionPayload = {
  events: ExtractedEvent[];
  emotionSlices: ExtractedEmotionSlice[];
  eventRelations: ExtractedEventRelation[];
  noteCandidate?: {
    shouldGenerate?: boolean;
    coreEventTitles?: string[];
    tone?: string;
  };
};

const LOW_INFORMATION_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[a-zA-Z]|[嗯啊哦好行对是]|算了|不知道|没事|随便|[^\s\p{L}\p{N}])$/u;

const formatDateInTimeZone = (date: Date, timeZone = "Asia/Shanghai") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

const clamp = (value: unknown, min: number, max: number) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
};

const normalizeTitle = (value: string) => value.replace(/\s+/g, "").trim().toLowerCase();

const extractJsonObject = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? "";
};

const parseExtractionJson = (text: string): ExperienceExtractionPayload | null => {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Partial<ExperienceExtractionPayload>;
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      emotionSlices: Array.isArray(parsed.emotionSlices) ? parsed.emotionSlices : [],
      eventRelations: Array.isArray(parsed.eventRelations) ? parsed.eventRelations : [],
      noteCandidate:
        typeof parsed.noteCandidate === "object" && parsed.noteCandidate !== null
          ? parsed.noteCandidate
          : undefined,
    };
  } catch {
    return null;
  }
};

const inferLocalExtraction = ({
  content,
  messageDate,
}: {
  content: string;
  messageDate: string;
}): ExperienceExtractionPayload => {
  const text = content.trim();
  if (!text || LOW_INFORMATION_PATTERN.test(text)) {
    return { events: [], emotionSlices: [], eventRelations: [], noteCandidate: { shouldGenerate: false } };
  }

  if (/领导|老板|上司/.test(text)) {
    return {
      events: [
        {
          title: "和领导沟通",
          description: "用户提到和领导沟通后心里有些不舒服",
          eventDate: messageDate,
          category: "work",
          participants: ["领导"],
          importanceScore: 0.72,
          isCoreEventCandidate: true,
          status: "ENDED",
          evidenceText: text,
        },
      ],
      emotionSlices: [
        {
          eventTitle: "和领导沟通",
          emotionType: /堵/.test(text) ? "堵" : /委屈/.test(text) ? "委屈" : "不舒服",
          intensity: 68,
          delta: 35,
          valence: -0.65,
          arousal: 0.6,
          evidenceText: text,
        },
      ],
      eventRelations: [],
      noteCandidate: { shouldGenerate: true, coreEventTitles: ["和领导沟通"], tone: "light_observation" },
    };
  }

  if (/跑步|跑完|运动/.test(text)) {
    return {
      events: [
        {
          title: /晚上/.test(text) ? "晚上跑步" : "跑步",
          description: "用户提到跑步后状态有变化",
          eventDate: messageDate,
          category: "health",
          importanceScore: 0.56,
          isCoreEventCandidate: /轻松|舒服|缓/.test(text),
          status: "ENDED",
          evidenceText: text,
        },
      ],
      emotionSlices: [
        {
          eventTitle: /晚上/.test(text) ? "晚上跑步" : "跑步",
          emotionType: /轻松/.test(text) ? "轻松" : "放松",
          intensity: 52,
          delta: /轻松|放松|舒服/.test(text) ? -25 : undefined,
          valence: 0.45,
          arousal: 0.35,
          evidenceText: text,
        },
      ],
      eventRelations: [],
      noteCandidate: { shouldGenerate: false, coreEventTitles: [], tone: "light_observation" },
    };
  }

  if (/累|疲惫|烦|压力|焦虑|难受|堵|委屈|轻松|放松|开心|难过/.test(text)) {
    return {
      events: [],
      emotionSlices: [
        {
          emotionType: /累|疲惫/.test(text)
            ? "疲惫"
            : /焦虑/.test(text)
              ? "焦虑"
              : /委屈/.test(text)
                ? "委屈"
                : /轻松|放松/.test(text)
                  ? "轻松"
                  : "情绪波动",
          intensity: 50,
          valence: /轻松|放松|开心/.test(text) ? 0.4 : -0.45,
          arousal: /焦虑|烦/.test(text) ? 0.65 : 0.35,
          evidenceText: text,
        },
      ],
      eventRelations: [],
      noteCandidate: { shouldGenerate: false },
    };
  }

  return { events: [], emotionSlices: [], eventRelations: [], noteCandidate: { shouldGenerate: false } };
};

const callExtractorModel = async ({
  content,
  messageDate,
  existingEventTitles,
}: {
  content: string;
  messageDate: string;
  existingEventTitles: string[];
}) => {
  const response = await callModel({
    model: process.env.AI_EXTRACTOR_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    messages: buildExperienceExtractorPrompt({ content, messageDate, existingEventTitles }),
    temperature: 0.2,
  });

  return parseExtractionJson(response.text);
};

const sanitizeEvent = (event: ExtractedEvent, fallbackDate: string): ExtractedEvent | null => {
  const title = typeof event.title === "string" ? event.title.trim().slice(0, 80) : "";
  if (!title) return null;
  const eventDate = typeof event.eventDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)
    ? event.eventDate
    : fallbackDate;

  return {
    title,
    description: typeof event.description === "string" ? event.description.trim().slice(0, 500) : undefined,
    eventDate,
    category: typeof event.category === "string" ? event.category.trim().slice(0, 40) : undefined,
    participants: Array.isArray(event.participants)
      ? event.participants.filter((item) => typeof item === "string" && item.trim()).slice(0, 8)
      : undefined,
    importanceScore: clamp(event.importanceScore, 0, 1) ?? 0,
    isCoreEventCandidate: Boolean(event.isCoreEventCandidate),
    status: event.status && event.status in EventStatus ? event.status : "UNCLEAR",
    evidenceText: typeof event.evidenceText === "string" ? event.evidenceText.trim().slice(0, 500) : undefined,
  };
};

const mergeSourceMessageIds = (value: Prisma.JsonValue | null | undefined, messageId: string) => {
  const ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return [...new Set([...ids, messageId])];
};

const findMatchingEvent = async ({
  userId,
  eventDate,
  title,
}: {
  userId: string;
  eventDate: Date;
  title: string;
}) => {
  const events = await prisma.event.findMany({
    where: { userId, eventDate },
    select: { id: true, title: true, sourceMessageIds: true, importanceScore: true },
  });
  const normalized = normalizeTitle(title);
  return (
    events.find((event) => normalizeTitle(event.title) === normalized) ??
    events.find((event) => {
      const other = normalizeTitle(event.title);
      return normalized.includes(other) || other.includes(normalized);
    }) ??
    null
  );
};

const upsertEvent = async ({
  userId,
  messageId,
  event,
}: {
  userId: string;
  messageId: string;
  event: ExtractedEvent;
}) => {
  const eventDate = parseDateOnly(event.eventDate!);
  const existing = await findMatchingEvent({ userId, eventDate, title: event.title });
  const importanceScore = clamp(event.importanceScore, 0, 1) ?? 0;
  const isCoreEvent = Boolean(event.isCoreEventCandidate) || importanceScore >= 0.7;

  if (existing) {
    return prisma.event.update({
      where: { id: existing.id },
      data: {
        description: event.description,
        category: event.category,
        participants: event.participants as Prisma.InputJsonValue | undefined,
        importanceScore: Math.max(existing.importanceScore, importanceScore),
        isCoreEvent: existing.importanceScore >= 0.7 || isCoreEvent,
        status: event.status as EventStatus,
        sourceMessageIds: mergeSourceMessageIds(existing.sourceMessageIds, messageId),
      },
      select: { id: true, title: true, eventDate: true, importanceScore: true },
    });
  }

  return prisma.event.create({
    data: {
      userId,
      title: event.title,
      description: event.description,
      eventDate,
      sourceType: EventSourceType.CHAT,
      sourceMessageIds: [messageId],
      participants: event.participants as Prisma.InputJsonValue | undefined,
      category: event.category,
      importanceScore,
      isCoreEvent,
      status: event.status as EventStatus,
    },
    select: { id: true, title: true, eventDate: true, importanceScore: true },
  });
};

const createEmotionSlices = async ({
  userId,
  messageId,
  messageDate,
  createdAt,
  slices,
  eventByTitle,
}: {
  userId: string;
  messageId: string;
  messageDate: string;
  createdAt: Date;
  slices: ExtractedEmotionSlice[];
  eventByTitle: Map<string, { id: string; title: string }>;
}) => {
  const created = [];
  for (const slice of slices) {
    const emotionType =
      typeof slice.emotionType === "string" ? slice.emotionType.trim().slice(0, 40) : "";
    if (!emotionType) continue;
    const event = slice.eventTitle ? eventByTitle.get(normalizeTitle(slice.eventTitle)) : undefined;
    created.push(
      await prisma.emotionSlice.create({
        data: {
          userId,
          eventId: event?.id,
          date: parseDateOnly(messageDate),
          time: createdAt,
          emotionType,
          intensity: clamp(slice.intensity, 0, 100),
          delta: clamp(slice.delta, -100, 100),
          valence: clamp(slice.valence, -1, 1),
          arousal: clamp(slice.arousal, 0, 1),
          evidenceText:
            typeof slice.evidenceText === "string" ? slice.evidenceText.trim().slice(0, 500) : undefined,
          sourceMessageId: messageId,
        },
        select: { id: true, emotionType: true },
      })
    );
  }
  return created;
};

const createEventRelations = async ({
  userId,
  relations,
  eventByTitle,
}: {
  userId: string;
  relations: ExtractedEventRelation[];
  eventByTitle: Map<string, { id: string; title: string }>;
}) => {
  const created = [];
  for (const relation of relations) {
    const fromEvent = eventByTitle.get(normalizeTitle(relation.fromEventTitle));
    const toEvent = eventByTitle.get(normalizeTitle(relation.toEventTitle));
    if (!fromEvent || !toEvent || fromEvent.id === toEvent.id) continue;
    const relationType =
      relation.relationType && relation.relationType in EventRelationType
        ? relation.relationType
        : "UNRELATED";
    created.push(
      await prisma.eventRelation.create({
        data: {
          userId,
          fromEventId: fromEvent.id,
          toEventId: toEvent.id,
          relationType: relationType as EventRelationType,
          emotionType:
            typeof relation.emotionType === "string" ? relation.emotionType.trim().slice(0, 40) : undefined,
          strength: clamp(relation.strength, 0, 1),
          evidenceText:
            typeof relation.evidenceText === "string"
              ? relation.evidenceText.trim().slice(0, 500)
              : undefined,
        },
        select: { id: true, relationType: true },
      })
    );
  }
  return created;
};

const inferRecoveryRelation = async ({
  userId,
  eventByTitle,
  content,
  messageDate,
}: {
  userId: string;
  eventByTitle: Map<string, { id: string; title: string }>;
  content: string;
  messageDate: string;
}): Promise<ExtractedEventRelation[]> => {
  if (!/轻松|放松|缓过来|舒服一点/.test(content)) return [];
  const currentEvent = [...eventByTitle.values()].find((event) => /跑步|运动/.test(event.title));
  if (!currentEvent) return [];

  const prior = await prisma.event.findFirst({
    where: {
      userId,
      eventDate: parseDateOnly(messageDate),
      id: { not: currentEvent.id },
      OR: [{ isCoreEvent: true }, { importanceScore: { gte: 0.5 } }],
    },
    orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
    select: { title: true },
  });

  if (!prior) return [];
  return [
    {
      fromEventTitle: currentEvent.title,
      toEventTitle: prior.title,
      relationType: "RECOVERY",
      emotionType: "压力",
      strength: 0.5,
      evidenceText: content,
    },
  ];
};

export const extractExperienceFromChatMessage = async (input: ExtractExperienceInput) => {
  const messageDate = formatDateInTimeZone(input.createdAt);
  const dayStart = parseDateOnly(messageDate);
  const dayEnd = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate() + 1));
  const existingEvents = await prisma.event.findMany({
    where: {
      userId: input.userId,
      eventDate: { gte: dayStart, lt: dayEnd },
    },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  let extraction: ExperienceExtractionPayload | null = null;
  if (!LOW_INFORMATION_PATTERN.test(input.content.trim())) {
    extraction = await callExtractorModel({
      content: input.content,
      messageDate,
      existingEventTitles: existingEvents.map((event) => event.title),
    }).catch(() => null);
  }

  const localExtraction = inferLocalExtraction({ content: input.content, messageDate });
  if (!extraction || (extraction.events.length === 0 && extraction.emotionSlices.length === 0)) {
    extraction = localExtraction;
  }

  const sanitizedEvents = extraction.events
    .map((event) => sanitizeEvent(event, messageDate))
    .filter((event): event is ExtractedEvent => Boolean(event));

  const createdEvents = [];
  const eventByTitle = new Map<string, { id: string; title: string }>();
  for (const event of existingEvents) {
    eventByTitle.set(normalizeTitle(event.title), event);
  }
  for (const event of sanitizedEvents) {
    const saved = await upsertEvent({ userId: input.userId, messageId: input.messageId, event });
    createdEvents.push(saved);
    eventByTitle.set(normalizeTitle(saved.title), saved);
    eventByTitle.set(normalizeTitle(event.title), saved);
  }

  const createdEmotionSlices = await createEmotionSlices({
    userId: input.userId,
    messageId: input.messageId,
    messageDate,
    createdAt: input.createdAt,
    slices: extraction.emotionSlices,
    eventByTitle,
  });

  const inferredRelations = await inferRecoveryRelation({
    userId: input.userId,
    eventByTitle,
    content: input.content,
    messageDate,
  });
  const createdEventRelations = await createEventRelations({
    userId: input.userId,
    relations: [...extraction.eventRelations, ...inferredRelations],
    eventByTitle,
  });

  return {
    promptVersion: EXPERIENCE_EXTRACTOR_PROMPT_VERSION,
    events: createdEvents,
    emotionSlices: createdEmotionSlices,
    eventRelations: createdEventRelations,
    noteCandidate: extraction.noteCandidate ?? localExtraction.noteCandidate,
  };
};
