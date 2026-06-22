import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").trim();

    if (!query) {
      return ok({ items: [] });
    }

    if (query.length > 80) {
      throw new AppError("VALIDATION_ERROR", "搜索内容太长", 400, { field: "q" });
    }

    const items = await prisma.chatMessage.findMany({
      where: {
        userId: user.id,
        content: {
          contains: query,
          mode: "insensitive",
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        sessionId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return ok({
      items: items.map((item) => ({
        id: item.id,
        sessionId: item.sessionId,
        role: item.role.toLowerCase(),
        content: item.content,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return failFromError(error);
  }
}
