import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { assertInsightsConsent, createInsightsConsent } from "@/services/insights/consentAuthority";
import { getUserObservation } from "@/services/insights/observationService";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return ok(createInsightsConsent({ userId: user.id }));
  } catch (error) {
    return failFromError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    assertInsightsConsent({ token: request.headers.get("x-insights-consent"), userId: user.id });
    const range = request.nextUrl.searchParams.get("range");
    const daysValue = Number(request.nextUrl.searchParams.get("days") ?? range?.replace(/d$/u, "") ?? "30");
    if (![7, 30, 90].includes(daysValue)) {
      throw new AppError("VALIDATION_ERROR", "观察范围必须是 7、30 或 90 天", 400);
    }
    return ok(await getUserObservation({
      userId: user.id,
      days: daysValue as 7 | 30 | 90,
    }));
  } catch (error) {
    return failFromError(error);
  }
}
