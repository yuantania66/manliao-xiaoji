import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isValidDateOnly } from "@/lib/validation";

const parseDate = (value: string | null) => {
  if (!value || !isValidDateOnly(value)) {
    throw new AppError("VALIDATION_ERROR", "date 必须是 YYYY-MM-DD", 400, { field: "date" });
  }
  return new Date(`${value}T00:00:00.000Z`);
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const date = parseDate(searchParams.get("date"));

    const items = await prisma.emotionSlice.findMany({
      where: { userId: user.id, date },
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
        createdAt: true,
        event: { select: { title: true } },
      },
    });

    return ok({
      items: items.map((item) => ({
        ...item,
        date: item.date.toISOString().slice(0, 10),
        time: item.time?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        eventTitle: item.event?.title ?? null,
      })),
    });
  } catch (error) {
    return failFromError(error);
  }
}
