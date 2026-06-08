import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const parseMonth = (value: string | null) => {
  const month = value ?? new Intl.DateTimeFormat("en-CA", {
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

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const { month, start, end } = parseMonth(searchParams.get("month"));

    const notes = await prisma.note.findMany({
      where: {
        userId: user.id,
        recordDate: {
          gte: start,
          lt: end,
        },
      },
      orderBy: [{ recordDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        recordDate: true,
        moodName: true,
        moodIcon: true,
        createdAt: true,
      },
    });

    const days = new Map<
      string,
      {
        date: string;
        count: number;
        noteIds: string[];
        moods: { name: string | null; icon: string | null }[];
      }
    >();

    for (const note of notes) {
      const date = note.recordDate.toISOString().slice(0, 10);
      const item =
        days.get(date) ??
        days
          .set(date, {
            date,
            count: 0,
            noteIds: [],
            moods: [],
          })
          .get(date)!;
      item.count += 1;
      item.noteIds.push(note.id);
      if (note.moodName || note.moodIcon) {
        item.moods.push({ name: note.moodName, icon: note.moodIcon });
      }
    }

    return ok({
      month,
      days: [...days.values()],
    });
  } catch (error) {
    return failFromError(error);
  }
}
