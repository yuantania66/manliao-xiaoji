import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { getBearerToken, hashToken, requireAuthenticatedUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  abandonIncompleteProfile,
  drainAccountCancellationFiles,
} from "@/services/auth/accountCancellationService";

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) throw new AppError("UNAUTHORIZED", "请先登录", 401);
    const user = await requireAuthenticatedUser(request);
    const result = await abandonIncompleteProfile({
      userId: user.id,
      sessionTokenHash: hashToken(token),
    });
    const pending = result.cleanupTaskIds.length > 0
      ? await drainAccountCancellationFiles(result.cleanupTaskIds)
      : 0;
    return ok({
      abandoned: true,
      accountRemoved: result.accountRemoved,
      mediaCleanup: pending > 0 ? "pending" : "complete",
      fileCleanupPending: pending,
    });
  } catch (error) {
    return failFromError(error);
  }
}
