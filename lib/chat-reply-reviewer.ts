import type { NextRequest } from "next/server";

import { requireUser } from "./auth";
import { AppError } from "./errors";

export const requireChatReplyReviewer = async (request: NextRequest) => {
  const user = await requireUser(request);
  const reviewerIds = (process.env.CHAT_REPLY_REVIEWER_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!reviewerIds.includes(user.id)) {
    throw new AppError("FORBIDDEN", "没有回复评价复核权限", 403);
  }
  return user;
};
