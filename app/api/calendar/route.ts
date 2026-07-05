import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const parseMonth = (value: string | null) => {
  const month =
    value ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());

  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new AppError("VALIDATION_ERROR", "month 必须是 YYYY-MM", 400, { field: "month" });
  }

  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new AppError("VALIDATION_ERROR", "month 无效", 400, { field: "month" });
  }

  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { month, start, end };
};

const formatDateInTimeZone = (date: Date, timeZone = "Asia/Shanghai") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

type CalendarDay = {
  date: string;
  noteCount: number;
  chatMessageCount: number;
  eventCount: number;
  coreEventCount: number;
  noteIds: string[];
  chatSessionIds: string[];
  coreEvents: { id: string; title: string; importanceScore: number }[];
  emotionTypes: string[];
  emotionPath: string[];
  moods: { name: string | null; icon: string | null }[];
};

const ensureDay = (days: Map<string, CalendarDay>, date: string) => {
  const existing = days.get(date);
  if (existing) return existing;

  const created = {
    date,
    noteCount: 0,
    chatMessageCount: 0,
    eventCount: 0,
    coreEventCount: 0,
    noteIds: [],
    chatSessionIds: [],
    coreEvents: [],
    emotionTypes: [],
    emotionPath: [],
    moods: [],
  };
  days.set(date, created);
  return created;
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const { month, start, end } = parseMonth(searchParams.get("month"));
    const timeZone = searchParams.get("timeZone") || "Asia/Shanghai";

    const [notes, chatMessages, chatSessions, events, emotionSlices] = await prisma.$transaction([
      prisma.note.findMany({
        where: {
          userId: user.id,
          recordDate: { gte: start, lt: end },
        },
        orderBy: [{ recordDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          recordDate: true,
          moodName: true,
          moodIcon: true,
        },
      }),
      prisma.chatMessage.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: start, lt: end },
        },
        orderBy: { createdAt: "asc" },
        select: {
          sessionId: true,
          createdAt: true,
        },
      }),
      prisma.chatSession.findMany({
        where: {
          userId: user.id,
          lastMessageAt: { gte: start, lt: end },
        },
        orderBy: { lastMessageAt: "asc" },
        select: {
          id: true,
          lastMessageAt: true,
        },
      }),
      prisma.event.findMany({
        where: {
          userId: user.id,
          eventDate: { gte: start, lt: end },
        },
        orderBy: [{ eventDate: "asc" }, { importanceScore: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          eventDate: true,
          importanceScore: true,
          isCoreEvent: true,
        },
      }),
      prisma.emotionSlice.findMany({
        where: {
          userId: user.id,
          date: { gte: start, lt: end },
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: {
          date: true,
          emotionType: true,
          delta: true,
        },
      }),
    ]);

    const days = new Map<string, CalendarDay>();

    for (const note of notes) {
      const date = note.recordDate.toISOString().slice(0, 10);
      const day = ensureDay(days, date);
      day.noteCount += 1;
      day.noteIds.push(note.id);
      if (note.moodName || note.moodIcon) {
        day.moods.push({ name: note.moodName, icon: note.moodIcon });
      }
    }

    for (const message of chatMessages) {
      const date = formatDateInTimeZone(message.createdAt, timeZone);
      if (!date.startsWith(month)) continue;
      const day = ensureDay(days, date);
      day.chatMessageCount += 1;
      if (!day.chatSessionIds.includes(message.sessionId)) {
        day.chatSessionIds.push(message.sessionId);
      }
    }

    for (const session of chatSessions) {
      if (!session.lastMessageAt) continue;
      const date = formatDateInTimeZone(session.lastMessageAt, timeZone);
      if (!date.startsWith(month)) continue;
      const day = ensureDay(days, date);
      if (day.chatMessageCount === 0) {
        day.chatMessageCount = 1;
      }
      if (!day.chatSessionIds.includes(session.id)) {
        day.chatSessionIds.push(session.id);
      }
    }

    for (const event of events) {
      const date = event.eventDate.toISOString().slice(0, 10);
      const day = ensureDay(days, date);
      day.eventCount += 1;
      if (event.isCoreEvent) {
        day.coreEventCount += 1;
        day.coreEvents.push({
          id: event.id,
          title: event.title,
          importanceScore: event.importanceScore,
        });
      }
    }

    for (const slice of emotionSlices) {
      const date = slice.date.toISOString().slice(0, 10);
      const day = ensureDay(days, date);
      if (!day.emotionTypes.includes(slice.emotionType)) {
        day.emotionTypes.push(slice.emotionType);
      }
      const label =
        typeof slice.delta === "number" && slice.delta !== 0
          ? `${slice.emotionType}${slice.delta > 0 ? "上升" : "下降"}`
          : slice.emotionType;
      day.emotionPath.push(label);
    }

    return ok({
      month,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (error) {
    return failFromError(error);
  }
}
