import type { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { chatReplyTrainingNoticeVersion as noticeVersion } from "@/lib/chat-reply-training-consent";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const noStore = (response: Response) => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

const invalid = () => new AppError("VALIDATION_ERROR", "授权设置无效", 400);

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const consent = await prisma.chatReplyTrainingConsent.findUnique({
      where: { userId: user.id },
      select: { noticeVersion: true },
    });
    return noStore(ok({ enabled: consent?.noticeVersion === noticeVersion, noticeVersion }));
  } catch (error) {
    return noStore(failFromError(error));
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body: unknown = await request.json().catch(() => { throw invalid(); });
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "enabled" && key !== "noticeVersion")) throw invalid();
    const choice = body as Record<string, unknown>;
    if (typeof choice.enabled !== "boolean") throw invalid();
    const userId = user.id;
    const enabled = choice.enabled;
    if (enabled) {
      if (choice.noticeVersion !== noticeVersion) {
        throw new AppError("CONFLICT", "授权说明已更新，请刷新后再确认", 409);
      }
      await prisma.$transaction(async (tx) => {
        await tx.chatReplyTrainingConsent.deleteMany({ where: { userId, noticeVersion: { not: noticeVersion } } });
        await tx.$executeRaw`
          INSERT INTO "ChatReplyTrainingConsent" ("userId", "noticeVersion", "grantedAt")
          VALUES (${userId}, ${noticeVersion}, ${new Date()})
          ON CONFLICT ("userId") DO NOTHING
        `;
      });
    } else {
      await prisma.chatReplyTrainingConsent.deleteMany({ where: { userId } });
    }
    return noStore(ok({ enabled, noticeVersion }));
  } catch (error) {
    return noStore(failFromError(error));
  }
}
