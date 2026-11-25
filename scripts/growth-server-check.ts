import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Offline contract check only. The serialized SQL double is not PostgreSQL lock/cascade evidence.
const run = async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Offline check must not run in production mode");
  process.env.SESSION_SECRET = "synthetic-growth-contract-secret";
  const users = new Map<string, { status: string; isProvisional: unknown; wechatOpenid?: string | null }>();
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  let visits = new Map<string, Set<string>>();
  let serverNow = new Date("2026-09-10T02:00:00.000Z");
  let afterResolve: (() => void) | undefined;
  let failSummary = false;
  let writes = 0;
  let transactions = 0;
  const trace: string[] = [];
  let queue = Promise.resolve();
  const sqlText = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();
  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = sqlText(strings);
      assert.ok(!sql.includes("synthetic-account"), "identity must be a bound parameter");
      if (sql.startsWith('SELECT "userId" FROM "Session"')) {
        trace.push("principal");
        const session = sessions.get(String(values[0]));
        const result = session ? [{ userId: session.userId }] : [];
        afterResolve?.(); afterResolve = undefined;
        return result;
      }
      if (sql.startsWith('SELECT "status", "isProvisional", "wechatOpenid" FROM "User"')) {
        assert.ok(sql.endsWith("FOR UPDATE")); trace.push("user-lock");
        const user = users.get(String(values[0]));
        return user ? [user] : [];
      }
      if (sql.startsWith('SELECT "expiresAt" FROM "Session"')) {
        assert.ok(sql.endsWith("FOR UPDATE")); trace.push("session-lock");
        const session = sessions.get(String(values[1]));
        return session && session.userId === values[0] ? [{ expiresAt: session.expiresAt }] : [];
      }
      if (sql === 'SELECT clock_timestamp() AS "serverNow"') {
        trace.push("clock"); return [{ serverNow: new Date(serverNow) }];
      }
      if (sql.startsWith('SELECT to_char("day",')) {
        trace.push("summary");
        if (failSummary) throw new Error("synthetic summary failure");
        assert.ok(sql.includes('COUNT(*)::int AS "visitDays"'));
        assert.ok(sql.includes('bool_or("day" = ?::date) AS "recordedToday"'));
        assert.ok(sql.includes('WHERE "userId" = ?'));
        const months = new Map<string, { month: string; visitDays: number; recordedToday: boolean }>();
        for (const day of visits.get(String(values[1])) || []) {
          const month = day.slice(0, 7);
          const item = months.get(month) || { month, visitDays: 0, recordedToday: false };
          item.visitDays += 1; item.recordedToday ||= day === values[0]; months.set(month, item);
        }
        return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
      }
      throw new Error(`Unexpected offline query: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = sqlText(strings);
      assert.equal(sql, 'INSERT INTO "UserVisitDay" ("userId", "day") VALUES (?, ?::date) ON CONFLICT ("userId", "day") DO NOTHING');
      trace.push("insert"); writes += 1;
      const userId = String(values[0]), day = String(values[1]);
      assert.ok(users.has(userId), "foreign-key model");
      const days = visits.get(userId) || new Set<string>();
      const added = !days.has(day); days.add(day); visits.set(userId, days);
      return added ? 1 : 0;
    },
  };
  const fakePrisma = {
    $transaction<T>(operation: (client: typeof tx) => Promise<T>): Promise<T> {
      transactions += 1;
      const result = queue.then(async () => {
        const before = new Map([...visits].map(([id, days]) => [id, new Set(days)]));
        try { return await operation(tx); }
        catch (error) { visits = before; throw error; }
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const globals = globalThis as unknown as { prisma?: unknown };
  const previous = globals.prisma;
  globals.prisma = fakePrisma;
  try {
    const { hashToken } = await import("../lib/auth");
    const { GET, POST } = await import("../app/api/growth/route");
    const { beijingVisitDay, summarizeVisitGrowth } = await import("../services/growth/visitGrowthService");
    const accountA = "synthetic-account-A", accountB = "synthetic-account-B";
    const tokenA = "synthetic-token-A", tokenA2 = "synthetic-token-A-device-2", tokenB = "synthetic-token-B";
    const seedSession = (token: string, userId: string) => sessions.set(hashToken(token), { userId, expiresAt: new Date("2099-01-01T00:00:00Z") });
    const reset = () => {
      users.clear(); sessions.clear(); visits.clear(); trace.length = 0;
      users.set(accountA, { status: "ACTIVE", isProvisional: false });
      users.set(accountB, { status: "ACTIVE", isProvisional: false });
      seedSession(tokenA, accountA); seedSession(tokenA2, accountA); seedSession(tokenB, accountB);
      serverNow = new Date("2026-09-10T02:00:00.000Z"); afterResolve = undefined; failSummary = false;
      writes = 0; transactions = 0;
    };
    type Summary = ReturnType<typeof summarizeVisitGrowth>;
    const invoke = async (method: "GET" | "POST", token: string | null = tokenA, body?: string, query = "") => {
      const response = await (method === "POST" ? POST : GET)(new Request(`http://localhost/api/growth${query}`, {
        method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body }),
      }) as never);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      return { status: response.status, body: await response.json() as { ok: boolean; data: Summary; error?: { code: string; message: string } } };
    };

    for (const [instant, day] of [
      ["2026-09-10T15:59:59.999Z", "2026-09-10"], ["2026-09-10T16:00:00.000Z", "2026-09-11"],
      ["2026-12-31T16:00:00.000Z", "2027-01-01"], ["2024-02-28T16:00:00.000Z", "2024-02-29"],
      ["2024-02-29T16:00:00.000Z", "2024-03-01"], ["2025-02-28T16:00:00.000Z", "2025-03-01"],
    ]) assert.equal(beijingVisitDay(new Date(instant)), day);
    assert.deepEqual(summarizeVisitGrowth(accountA, serverNow, [
      { month: "2025-03", visitDays: 1, recordedToday: false },
      { month: "2025-02", visitDays: 2, recordedToday: false },
    ]).flowers, [
      { month: "2025-02", visitDays: 2, daysInMonth: 28 },
      { month: "2025-03", visitDays: 1, daysInMonth: 31 },
    ]);

    reset();
    let result = await invoke("GET");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, { userId: accountA, day: "2026-09-10", serverNow: serverNow.toISOString(), totalDays: 0, leafCount: 0, flowers: [], recordedToday: false, addedToday: false });
    assert.equal(writes, 0);
    trace.length = 0;
    result = await invoke("POST", tokenA, "{}");
    assert.deepEqual(trace, ["principal", "user-lock", "session-lock", "clock", "insert", "summary"]);
    assert.equal(result.body.data.addedToday, true); assert.equal(result.body.data.recordedToday, true);
    assert.deepEqual(result.body.data.flowers, [{ month: "2026-09", visitDays: 1, daysInMonth: 30 }]);
    assert.equal((await invoke("POST", tokenA2)).body.data.addedToday, false);
    assert.equal((await invoke("GET", tokenB)).body.data.totalDays, 0);
    const writeCount = writes;
    assert.equal((await invoke("GET")).body.data.addedToday, false); assert.equal(writes, writeCount);

    reset();
    const parallel = await Promise.all(Array.from({ length: 20 }, (_, i) => invoke("POST", i % 2 ? tokenA : tokenA2)));
    assert.equal(parallel.filter((item) => item.body.data.addedToday).length, 1);
    assert.ok(parallel.every((item) => item.body.data.totalDays === 1));
    // This proves service idempotency under a serialized double, not real database concurrency.

    reset();
    for (const instant of ["2026-07-01T02:00:00Z", "2026-07-31T15:59:59.999Z", "2026-09-01T02:00:00Z"]) {
      serverNow = new Date(instant); await invoke("POST");
    }
    result = await invoke("GET");
    assert.equal(result.body.data.totalDays, 3);
    assert.deepEqual(result.body.data.flowers, [{ month: "2026-07", visitDays: 2, daysInMonth: 31 }, { month: "2026-09", visitDays: 1, daysInMonth: 30 }]);
    serverNow = new Date("2026-09-01T16:00:00Z");
    assert.equal((await invoke("GET")).body.data.recordedToday, false);
    result = await invoke("POST");
    assert.equal(result.body.data.day, "2026-09-02"); assert.equal(result.body.data.totalDays, 4);
    assert.deepEqual(result.body.data.flowers[0], { month: "2026-07", visitDays: 2, daysInMonth: 31 });

    reset();
    const days = new Set<string>();
    for (let day = Date.UTC(2024, 0, 1); day < Date.UTC(2025, 1, 1); day += 86_400_000) days.add(new Date(day).toISOString().slice(0, 10));
    visits.set(accountA, days); serverNow = new Date("2025-03-01T02:00:00Z");
    result = await invoke("POST");
    assert.equal(result.body.data.totalDays, 398); assert.equal(result.body.data.leafCount, 365);
    assert.equal(result.body.data.flowers.length, 12);
    assert.equal(result.body.data.flowers[0].month, "2024-01"); assert.equal(result.body.data.flowers.at(-1)?.month, "2024-12");
    assert.deepEqual(result.body.data.flowers[1], { month: "2024-02", visitDays: 29, daysInMonth: 29 });
    assert.equal(result.body.data.addedToday, true); assert.equal(result.body.data.recordedToday, true);

    reset();
    for (const body of ['{"userId":"other"}', '{"day":"2020-01-01"}', '{"serverNow":"2020-01-01"}', '{"visitDays":100}', 'null', '[]', 'true', '1', '""', '{']) {
      assert.equal((await invoke("POST", tokenA, body)).status, 400);
    }
    assert.equal((await invoke("GET", tokenA, undefined, "?userId=other")).status, 400);
    assert.equal((await invoke("POST", tokenA, undefined, "?day=2020-01-01")).status, 400);
    assert.equal((await invoke("GET", null)).status, 401); assert.equal((await invoke("POST", null)).status, 401);
    assert.equal(transactions, 0); assert.equal(writes, 0);
    assert.equal((await invoke("POST", tokenA, "  {}  ")).status, 200);

    for (const provisional of [true, "false", null, undefined, 0]) {
      reset(); users.set(accountA, { status: "ACTIVE", isProvisional: provisional });
      assert.equal((await invoke("POST")).status, 403); assert.equal(writes, 0);
    }
    for (const status of ["BLOCKED", "CANCELLED"]) {
      reset(); users.set(accountA, { status, isProvisional: false });
      assert.equal((await invoke("POST")).status, 401); assert.equal(writes, 0);
    }
    reset(); sessions.get(hashToken(tokenA))!.expiresAt = new Date(serverNow);
    assert.equal((await invoke("POST")).status, 401); assert.equal(writes, 0);
    reset(); assert.equal((await invoke("POST", "unknown-token")).status, 401); assert.equal(writes, 0);
    reset(); afterResolve = () => users.delete(accountA);
    assert.equal((await invoke("POST")).status, 401); assert.equal(writes, 0);
    reset(); afterResolve = () => sessions.delete(hashToken(tokenA));
    assert.equal((await invoke("POST")).status, 401); assert.equal(writes, 0);
    reset(); afterResolve = () => seedSession(tokenA, accountB);
    assert.equal((await invoke("POST")).status, 401); assert.equal(writes, 0);
    reset(); afterResolve = () => { serverNow = new Date("2099-01-01T00:00:00Z"); };
    assert.equal((await invoke("POST")).status, 401); assert.equal(writes, 0);

    reset(); failSummary = true;
    result = await invoke("POST");
    assert.equal(result.status, 500); assert.equal(visits.size, 0);
    assert.equal(result.body.error?.message, "服务暂时不可用");
    failSummary = false; assert.equal((await invoke("POST")).body.data.addedToday, true);
    reset();
    const unusualId = "synthetic-account-' OR 1=1 --";
    users.set(unusualId, { status: "ACTIVE", isProvisional: false }); seedSession(tokenA, unusualId);
    assert.equal((await invoke("POST")).body.data.userId, unusualId);
    assert.equal((await invoke("GET", tokenB)).body.data.totalDays, 0);

    // A raw-SQL authentication path must enforce the deployed staging owner gate.
    const stagingKeys = ["APP_ENV", "STAGING_MODEL_BUDGET_MODE", "STAGING_OWNER_ACCESS_MODE", "STAGING_ALLOWED_WECHAT_OPENID_SHA256"];
    const previousEnvironment = Object.fromEntries(stagingKeys.map((key) => [key, process.env[key]]));
    try {
      for (const key of stagingKeys) delete process.env[key];
      process.env.APP_ENV = "staging";
      process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 = createHash("sha256").update("synthetic-owner-openid").digest("hex");
      for (const method of ["GET", "POST"] as const) {
        for (const openid of [null, "mock_owner", "synthetic-other-openid"]) {
          reset(); users.get(accountA)!.wechatOpenid = openid;
          assert.equal((await invoke(method)).status, 403);
          assert.equal(writes, 0); assert.ok(!trace.includes("summary"));
        }
        reset(); users.get(accountA)!.wechatOpenid = "synthetic-owner-openid";
        assert.equal((await invoke(method)).status, 200);
        assert.equal(writes, method === "POST" ? 1 : 0);
      }
      for (const hash of ["", "invalid"]) {
        reset(); users.get(accountA)!.wechatOpenid = "synthetic-owner-openid";
        process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 = hash;
        assert.equal((await invoke("POST")).status, 403); assert.equal(writes, 0);
      }
      for (const key of stagingKeys) delete process.env[key];
      // Presence of budget mode also enables the owner gate; no toggle bypass.
      process.env.STAGING_MODEL_BUDGET_MODE = "";
      reset(); assert.equal((await invoke("POST")).status, 403); assert.equal(writes, 0);
      for (const key of stagingKeys) delete process.env[key];
      // Profile fields are optional in the current product. Nonprovisional auth is sufficient.
      reset(); assert.equal((await invoke("POST")).status, 200);
    } finally {
      for (const key of stagingKeys) {
        if (previousEnvironment[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnvironment[key];
      }
    }

    const migration = readFileSync("prisma/migrations/20260910000100_add_user_visit_day/migration.sql", "utf8");
    assert.match(migration, /PRIMARY KEY \("userId", "day"\)/);
    assert.match(migration, /"day" DATE NOT NULL/);
    assert.match(migration, /REFERENCES "User"\("id"\) ON DELETE CASCADE/);
    assert.doesNotMatch(migration, /INSERT INTO|UPDATE "User"/);
    const service = readFileSync("services/growth/visitGrowthService.ts", "utf8");
    assert.doesNotMatch(service, /SELECT \*|\$queryRawUnsafe|\$executeRawUnsafe|console\.|Date\.now/);
    console.log("PASS growth-server offline: UTC+8 boundaries, month freeze/gaps/leap/caps, route authority/no-store, staging owner fail-closed and optional profile, session/status races, serialized idempotency and rollback model, parameterized SQL, unique/cascade/no-backfill DDL contract.");
    console.log("NOT RUN: real PostgreSQL unique enforcement, concurrent lock ordering, migration application and deletion cascade.");
  } finally {
    globals.prisma = previous;
  }
};

run().catch((error) => { console.error(error); process.exitCode = 1; });
