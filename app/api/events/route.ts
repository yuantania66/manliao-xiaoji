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

const serializeEvent = (event: {
  id: string;
  title: string;
  description: string | null;
  eventDate: Date;
  category: string | null;
  importanceScore: number;
  isCoreEvent: boolean;
  status: string;
  sourceMessageIds: unknown;
  participants: unknown;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: event.id,
  title: event.title,
  description: event.description,
  eventDate: event.eventDate.toISOString().slice(0, 10),
  category: event.category,
  importanceScore: event.importanceScore,
  isCoreEvent: event.isCoreEvent,
  status: event.status.toLowerCase(),
  sourceMessageIds: Array.isArray(event.sourceMessageIds) ? event.sourceMessageIds : [],
  participants: Array.isArray(event.participants) ? event.participants : [],
  location: event.location,
  createdAt: event.createdAt.toISOString(),
  updatedAt: event.updatedAt.toISOString(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const date = parseDate(searchParams.get("date"));

    const items = await prisma.event.findMany({
      where: { userId: user.id, eventDate: date },
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
        participants: true,
        location: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok({ items: items.map(serializeEvent) });
  } catch (error) {
    return failFromError(error);
  }
}
