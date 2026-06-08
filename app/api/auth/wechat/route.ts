import { createHash } from "crypto";
import { UserStatus } from "@prisma/client";

import { failFromError, ok } from "@/lib/api-response";
import { createSession, serializeUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireNonEmptyString } from "@/lib/validation";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const mockOpenIdFromCode = (code: string) =>
  `mock_${createHash("sha256").update(code).digest("hex").slice(0, 28)}`;

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const code = requireNonEmptyString(body.code, "code", 200);
    const wechatOpenid = mockOpenIdFromCode(code);

    const user = await prisma.user.upsert({
      where: { wechatOpenid },
      create: {
        wechatOpenid,
        status: UserStatus.ACTIVE,
      },
      update: {
        status: UserStatus.ACTIVE,
      },
    });

    const session = await createSession(user.id);

    return ok({
      user: serializeUser(user),
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      provider: "wechat_mock",
    });
  } catch (error) {
    return failFromError(error);
  }
}
