import { ok, fail } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return ok({
      status: "ok",
      database: "connected",
      environment: process.env.APP_ENV ?? "development",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return fail("DATABASE_ERROR", "数据库连接失败", 500, {
      database: "unavailable",
      timestamp: new Date().toISOString(),
    });
  }
}
