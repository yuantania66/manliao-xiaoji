import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { parsePagination, requireNonEmptyString } from "@/lib/validation";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const pagination = parsePagination(searchParams);

    const [items, total] = await prisma.$transaction([
      prisma.chatSession.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          title: true,
          lastMessage: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.chatSession.count({ where: { userId: user.id } }),
    ]);

    return ok({
      items: items.map((item) => ({
        ...item,
        lastMessageAt: item.lastMessageAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
    });
  } catch (error) {
    return failFromError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? requireNonEmptyString(body.title, "title", 40)
        : "慢慢说";

    const session = await prisma.chatSession.create({
      data: {
        userId: user.id,
        title,
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok(
      {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      },
      201
    );
  } catch (error) {
    return failFromError(error);
  }
}
