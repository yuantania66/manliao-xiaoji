import type { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireChatReplyReviewer } from "@/lib/chat-reply-reviewer";
import { AppError } from "@/lib/errors";
import { decideChatReplyReviewPacket, previewChatReplyReviewPacket } from "@/services/ai/chatReplyReviewPacket";
import { decidePendingChatReplyReview, listPendingChatReplyReviews, previewPendingChatReplyReview } from "@/services/ai/chatReplyReviewQueue";

export const dynamic = "force-dynamic";

const noStore = (response: Response) => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

const invalid = (): never => {
  throw new AppError("VALIDATION_ERROR", "复核请求无效", 400);
};

const readReviewRequest = async (request: NextRequest) => {
  const body: unknown = await request.json().catch(invalid);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();
  const { operation, packet, assistantMessageId, reviewVersion } = body as Record<string, unknown>;
  if (operation !== "preview" && operation !== "approve" && operation !== "reject" && operation !== "approveTraining") return invalid();
  const keys = Object.keys(body).length;
  if (keys === 2 && operation !== "approveTraining" && typeof packet === "string" && packet.trim()) return { operation, packet } as const;
  if (keys === 3 && typeof assistantMessageId === "string" && assistantMessageId.trim() && assistantMessageId.length <= 160 &&
      typeof reviewVersion === "string" && /^[1-9]\d{0,9}:[a-f0-9]{64}$/.test(reviewVersion)) {
    return { operation, reference: { assistantMessageId, reviewVersion } } as const;
  }
  return invalid();
};

export async function GET(request: NextRequest) {
  try {
    await requireChatReplyReviewer(request);
    if (request.nextUrl.searchParams.get("pending") === "1") {
      return noStore(ok(await listPendingChatReplyReviews()));
    }
    return noStore(ok({ canReview: true }));
  } catch (error) {
    return noStore(failFromError(error));
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireChatReplyReviewer(request);
    const review = await readReviewRequest(request);
    if (review.operation === "preview") {
      const preview = review.reference
        ? await previewPendingChatReplyReview(review.reference)
        : await previewChatReplyReviewPacket(review.packet);
      return noStore(ok(preview));
    }
    const decision = review.operation === "reject" ? "REJECTED" : "APPROVED";
    const result = review.reference
      ? await decidePendingChatReplyReview(review.reference, user.id, decision, review.operation === "approveTraining")
      : await decideChatReplyReviewPacket({ packet: review.packet, reviewerId: user.id, decision });
    return noStore(ok(result));
  } catch (error) {
    return noStore(failFromError(error));
  }
}
