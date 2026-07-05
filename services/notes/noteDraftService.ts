import { prisma } from "@/lib/prisma";

const joinNatural = (items: string[]) => {
  const unique = [...new Set(items.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length === 2) return `${unique[0]}，后来又有一点${unique[1]}`;
  return `${unique.slice(0, -1).join("、")}，后来又有一点${unique[unique.length - 1]}`;
};

const pickEvidenceChatIds = (events: { sourceMessageIds: unknown }[], slices: { sourceMessageId: string | null }[]) => {
  const ids = events.flatMap((event) =>
    Array.isArray(event.sourceMessageIds)
      ? event.sourceMessageIds.filter((item): item is string => typeof item === "string")
      : []
  );
  for (const slice of slices) {
    if (slice.sourceMessageId) ids.push(slice.sourceMessageId);
  }
  return [...new Set(ids)];
};

const formatEventSentence = (titles: string[]) => {
  if (titles.length === 0) return "今天有一些情绪被留下来了。";
  if (titles.length === 1) return `今天${titles[0]}了一次。`;
  return `今天有${titles.slice(0, 2).join("，也有")}。`;
};

const formatEmotionSentence = (emotions: string[]) => {
  const text = joinNatural(emotions);
  return text ? `之后有些${text}。` : "";
};

export const generateNoteDraftForDate = async ({
  userId,
  date,
}: {
  userId: string;
  date: string;
}) => {
  const recordDate = new Date(`${date}T00:00:00.000Z`);
  const [coreEvents, emotionSlices] = await prisma.$transaction([
    prisma.event.findMany({
      where: {
        userId,
        eventDate: recordDate,
        isCoreEvent: true,
      },
      orderBy: [{ importanceScore: "desc" }, { createdAt: "asc" }],
      take: 2,
      select: {
        id: true,
        title: true,
        description: true,
        importanceScore: true,
        sourceMessageIds: true,
      },
    }),
    prisma.emotionSlice.findMany({
      where: {
        userId,
        date: recordDate,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        eventId: true,
        emotionType: true,
        intensity: true,
        delta: true,
        evidenceText: true,
        sourceMessageId: true,
      },
    }),
  ]);

  const eventIds = coreEvents.map((event) => event.id);
  const relatedSlices = emotionSlices.filter((slice) => !slice.eventId || eventIds.includes(slice.eventId));
  const emotions = relatedSlices.map((slice) => slice.emotionType).slice(0, 4);
  const evidenceChatIds = pickEvidenceChatIds(coreEvents, relatedSlices);

  const content = (() => {
    if (coreEvents.length === 0 && emotions.length === 0) {
      return "";
    }

    const eventText = formatEventSentence(coreEvents.map((event) => event.title));
    const emotionText = formatEmotionSentence(emotions);
    return `${eventText}${emotionText}`.trim();
  })();

  return {
    content,
    recordDate: date,
    coreEventIds: eventIds,
    emotionSliceIds: relatedSlices.map((slice) => slice.id),
    generatedFromChatIds: evidenceChatIds,
    isDraft: true,
  };
};
