import { fail, ok } from "@/lib/api-response";
import { drainPendingAccountCancellationFiles } from "@/services/auth/accountCancellationService";

export async function POST(request: Request) {
  const secret = process.env.ACCOUNT_CANCELLATION_CLEANUP_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return fail("UNAUTHORIZED", "未授权", 401);
  }
  return ok(await drainPendingAccountCancellationFiles());
}
