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
  return { start, end };
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const { start, end } = parseDateRange(searchParams.get("date"));

    const items = await prisma.eventRelation.findMany({
      where: {
        userId: user.id,
        OR: [
          { fromEvent: { eventDate: { gte: start, lt: end } } },
          { toEvent: { eventDate: { gte: start, lt: end } } },
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
        createdAt: true,
        fromEvent: { select: { title: true } },
        toEvent: { select: { title: true } },
      },
    });

    return ok({
      items: items.map((item) => ({
        ...item,
        relationType: item.relationType.toLowerCase(),
        createdAt: item.createdAt.toISOString(),
        fromEventTitle: item.fromEvent.title,
        toEventTitle: item.toEvent.title,
      })),
    });
  } catch (error) {
    return failFromError(error);
  }
}
