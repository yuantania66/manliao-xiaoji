import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidDateOnly } from "@/lib/validation";

const parseDateRange = (value: string | null) => {
  if (!value || !isValidDateOnly(value)) {
    throw new AppError("VALIDATION_ERROR", "date 必须是 YYYY-MM-DD", 400, { field: "date" });
  }
  const start = new Date(`${value}T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
  return { date: value, start, end };
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const { date, start, end } = parseDateRange(searchParams.get("date"));

    const [chats, events, emotionSlices, eventRelations, notes] = await prisma.$transaction([
      prisma.chatMessage.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: start, lt: end },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sessionId: true,
          role: true,
          content: true,
          createdAt: true,
        },
      }),
      prisma.event.findMany({
        where: { userId: user.id, eventDate: start },
        orderBy: [{ isCoreEvent: "desc" }, { importanceScore: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          eventDate: true,
          category: true,
          importanceScore: true,
          isCoreEvent: true,
          status: true,
          sourceMessageIds: true,
        },
      }),
      prisma.emotionSlice.findMany({
        where: { userId: user.id, date: start },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          eventId: true,
          date: true,
          time: true,
          emotionType: true,
          intensity: true,
          valence: true,
          arousal: true,
          delta: true,
          evidenceText: true,
          sourceMessageId: true,
        },
      }),
      prisma.eventRelation.findMany({
        where: {
          userId: user.id,
          OR: [
            { fromEvent: { eventDate: start } },
            { toEvent: { eventDate: start } },
          ],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromEventId: true,
          toEventId: true,
          relationType: true,
          emotionType: true,
          strength: true,
          evidenceText: true,
          fromEvent: { select: { title: true } },
          toEvent: { select: { title: true } },
          createdAt: true,
        },
      }),
      prisma.note.findMany({
        where: { userId: user.id, recordDate: start },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          moodName: true,
          moodIcon: true,
          recordDate: true,
          isDraft: true,
          coreEventIds: true,
          emotionSliceIds: true,
          generatedFromChatIds: true,
          createdAt: true,
        },
      }),
    ]);

    return ok({
      date,
      chats: chats.map((chat) => ({
        ...chat,
        role: chat.role.toLowerCase(),
        createdAt: chat.createdAt.toISOString(),
      })),
      events: events.map((event) => ({
        ...event,
        eventDate: event.eventDate.toISOString().slice(0, 10),
        status: event.status.toLowerCase(),
      })),
      coreEvents: events
        .filter((event) => event.isCoreEvent)
        .map((event) => ({ id: event.id, title: event.title, importanceScore: event.importanceScore })),
      emotionSlices: emotionSlices.map((slice) => ({
        ...slice,
        date: slice.date.toISOString().slice(0, 10),
        time: slice.time?.toISOString() ?? null,
      })),
      eventRelations: eventRelations.map((relation) => ({
        ...relation,
        relationType: relation.relationType.toLowerCase(),
        fromEventTitle: relation.fromEvent.title,
        toEventTitle: relation.toEvent.title,
        createdAt: relation.createdAt.toISOString(),
      })),
      notes: notes.map((note) => ({
        ...note,
        recordDate: note.recordDate.toISOString().slice(0, 10),
        createdAt: note.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return failFromError(error);
  }
}
