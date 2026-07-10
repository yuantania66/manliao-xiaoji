import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { isValidDateOnly } from "@/lib/validation";
import { generateNoteDraftForDate } from "@/services/notes/noteDraftService";

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    const date = body.date;
    if (typeof date !== "string" || !isValidDateOnly(date)) {
      throw new AppError("VALIDATION_ERROR", "date 必须是 YYYY-MM-DD", 400, { field: "date" });
    }

    const draft = await generateNoteDraftForDate({ userId: user.id, date });
    return ok(draft);
  } catch (error) {
    return failFromError(error);
  }
}
