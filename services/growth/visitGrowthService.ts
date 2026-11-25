import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { assertStagingOwnerIdentity } from "@/lib/staging-owner-access";

type VisitMonth = { month: string; visitDays: number; recordedToday: boolean };

export const beijingVisitDay = (serverNow: Date) =>
  new Date(serverNow.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const summarizeVisitGrowth = (
  userId: string,
  serverNow: Date,
  months: VisitMonth[],
  addedToday = false,
) => {
  const totalDays = months.reduce((sum, month) => sum + month.visitDays, 0);
  return {
    userId,
    day: beijingVisitDay(serverNow),
    serverNow: serverNow.toISOString(),
    totalDays,
    leafCount: Math.min(totalDays, 365),
    // The first twelve visited months remain visible; empty months create no flower.
    flowers: [...months].sort((a, b) => a.month.localeCompare(b.month)).slice(0, 12).map(({ month, visitDays }) => ({
      month,
      visitDays,
      daysInMonth: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate(),
    })),
    recordedToday: months.some((month) => month.recordedToday),
    addedToday,
  };
};

const visitGrowth = (tokenHash: string, record: boolean) => prisma.$transaction(async (tx) => {
  const unauthorized = () => new AppError("UNAUTHORIZED", "请先登录", 401);
  if (!tokenHash) throw unauthorized();

  // Resolve identity without a lock, then follow cancellation's User -> Session order.
  const principals = await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "Session" WHERE "tokenHash" = ${tokenHash}
  `;
  const userId = principals[0]?.userId;
  if (!userId) throw unauthorized();

  const users = await tx.$queryRaw<Array<{ status: string; isProvisional: boolean; wechatOpenid: string | null }>>`
    SELECT "status", "isProvisional", "wechatOpenid" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  const user = users[0];
  if (!user || user.status !== "ACTIVE") throw unauthorized();
  if (user.isProvisional !== false) throw new AppError("FORBIDDEN", "请使用正式账号查看成长记录", 403);

  // Holding this row also linearizes a concurrent logout's session deletion.
  const sessions = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
    SELECT "expiresAt" FROM "Session"
    WHERE "userId" = ${userId} AND "tokenHash" = ${tokenHash} FOR UPDATE
  `;
  const clocks = await tx.$queryRaw<Array<{ serverNow: Date }>>`
    SELECT clock_timestamp() AS "serverNow"
  `;
  const serverNow = clocks[0].serverNow;
  if (!sessions[0] || sessions[0].expiresAt <= serverNow) throw unauthorized();
  // This route rechecks auth under row locks instead of calling requireUser.
  // Preserve that helper's staging owner boundary before any visit read/write.
  assertStagingOwnerIdentity(user.wechatOpenid);
  const day = beijingVisitDay(serverNow);

  let addedToday = false;
  if (record) {
    const inserted = await tx.$executeRaw`
      INSERT INTO "UserVisitDay" ("userId", "day") VALUES (${userId}, ${day}::date)
      ON CONFLICT ("userId", "day") DO NOTHING
    `;
    addedToday = inserted === 1;
  }
  const months = await tx.$queryRaw<VisitMonth[]>`
    SELECT to_char("day", 'YYYY-MM') AS "month", COUNT(*)::int AS "visitDays",
           bool_or("day" = ${day}::date) AS "recordedToday"
    FROM "UserVisitDay" WHERE "userId" = ${userId}
    GROUP BY to_char("day", 'YYYY-MM') ORDER BY "month" ASC
  `;
  return summarizeVisitGrowth(userId, serverNow, months, addedToday);
});

export const getVisitGrowth = (tokenHash: string) => visitGrowth(tokenHash, false);
export const recordVisitGrowth = (tokenHash: string) => visitGrowth(tokenHash, true);
