import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser, serializeUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return ok({ user: serializeUser(user) });
  } catch (error) {
    return failFromError(error);
  }
}
