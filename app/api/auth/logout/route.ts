import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { getBearerToken, hashToken } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) throw new AppError("UNAUTHORIZED", "请先登录", 401);

    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });

    return ok({ loggedOut: true });
  } catch (error) {
    return failFromError(error);
  }
}
