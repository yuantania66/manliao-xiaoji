import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { applyWallpaperAction, createGeneratedWallpaperCopy, getWallpaperView, parseWallpaperAction, parseWallpaperState,
  selectWallpaperCopy, WALLPAPER_COPIES, WALLPAPER_TEMPLATES, WallpaperState, WallpaperStateError, type WallpaperCopy } from "../lib/note-wallpaper-state";

const DEADLINE_MS = 20_000;
const HANG_ENV = "NOTE_WALLPAPER_SERVER_CHECK_HANG";

// Offline contract evidence only: the serialized transaction double cannot prove PostgreSQL locks/cascades.
const run = async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  process.env.SESSION_SECRET = "synthetic-wallpaper-contract-secret";
  const hangMode = process.env[HANG_ENV] === "1";
  let completed = false;
  const deadline = setTimeout(() => {
    console.error(`FAIL note-wallpaper-server-check: did not finish within ${hangMode ? 800 : DEADLINE_MS}ms`);
    process.exit(1);
  }, hangMode ? 800 : DEADLINE_MS);
  if (hangMode) {
    await new Promise(() => {});
  }
  assert.equal(WALLPAPER_COPIES.length, 8);
  assert.equal(selectWallpaperCopy("累").copyId, "rest-v1");
  assert.equal(selectWallpaperCopy("", 1).copyId, "photo-v1");
  const generated = createGeneratedWallpaperCopy("把今晚轻轻放下。", "明天的事，明天再碰。");
  assert.ok(generated);
  const generatedParsed = parseWallpaperState(applyWallpaperAction(null, { action: "initialize" }, [], generated).state);
  assert.ok(generatedParsed);
  assert.equal(generatedParsed.copy.copyId, "generated-v1");
  assert.throws(() => parseWallpaperState({
    schemaVersion: 1,
    copy: { copyId: "generated-v1", quote: "短", caption: "也短" },
    versions: [{ revision: 0, templateId: "garden-light-v1", allocationOrder: 1, requestId: null }],
  }), WallpaperStateError);
  const initialCopy = selectWallpaperCopy("累");
  const init = (history: WallpaperState[] = []) => applyWallpaperAction(null, { action: "initialize" }, history, initialCopy).state;
  const initial = init();
  assert.equal(getWallpaperView(initial)?.templateId, "garden-light-v1");
  assert.equal(getWallpaperView(initial)?.switchesRemaining, 3);
  assert.equal(parseWallpaperState(null), null);
  assert.equal(getWallpaperView(null), null);
  const badState = (value: unknown) => assert.throws(() => parseWallpaperState(value), (error: unknown) =>
    error instanceof WallpaperStateError && error.reason === "STATE_INVALID");
  badState({ ...initial, versions: new Array(2) });
  badState({ ...initial, versions: [initial.versions[0], { ...initial.versions[0], revision: 1, allocationOrder: 2, requestId: "same-template" }] });
  for (const value of [undefined, {}, [], "null", { ...initial, schemaVersion: 2 }, { ...initial, versions: [] },
    { ...initial, copy: { ...initial.copy, quote: "unapproved original content" } }, { ...initial, extra: true },
    { ...initial, versions: [{ ...initial.versions[0], requestId: "bad-initial" }] },
    { ...initial, versions: [{ ...initial.versions[0], allocationOrder: 0 }] },
    { ...initial, versions: [{ ...initial.versions[0], templateId: "external-template" }] },
    { ...initial, versions: [{ ...initial.versions[0], revision: 3 }] }]) badState(value);
  for (const action of [{}, null, [], { action: "initialize", userId: "B" }, { action: "switch", requestId: "", expectedRevision: 0 },
    { action: "switch", requestId: "x", expectedRevision: 4 }, { action: "switch", requestId: "x", expectedRevision: 0.5 },
    { action: "switch", requestId: " x", expectedRevision: 0 }, { action: "switch", requestId: "x\n", expectedRevision: 0 }]) {
    assert.throws(() => parseWallpaperAction(action), WallpaperStateError);
  }
  const pool: WallpaperState[] = [];
  for (let index = 0; index < 6; index += 1) pool.push(init(pool));
  assert.equal(new Set(pool.map(state => state.versions[0].templateId)).size, 6);
  assert.equal(getWallpaperView(pool[1])?.templateId, "hills-path-v1", "unused tie changes theme");
  assert.equal(getWallpaperView(pool[2])?.templateId, "garden-meadow-v1");
  assert.equal(getWallpaperView(init(pool))?.templateId, "garden-light-v1", "exhausted pool uses LRU");
  const oldNoteSwitch = applyWallpaperAction(pool[0], { action: "switch", requestId: "old", expectedRevision: 0 }, pool);
  assert.notEqual(getWallpaperView(oldNoteSwitch.state)?.templateId, getWallpaperView(pool[0])?.templateId);
  assert.notEqual(getWallpaperView(oldNoteSwitch.state)?.templateId, getWallpaperView(pool[5])?.templateId);
  assert.deepEqual(oldNoteSwitch.state.copy, initialCopy);
  badState({ ...oldNoteSwitch.state, versions: [...oldNoteSwitch.state.versions, { ...oldNoteSwitch.state.versions[1], revision: 2, allocationOrder: 8 }] });
  assert.throws(() => applyWallpaperAction(null, { action: "initialize" }, [{ ...initial, versions: [{ ...initial.versions[0], allocationOrder: Number.MAX_SAFE_INTEGER }] }], initialCopy), WallpaperStateError);
  assert.equal(getWallpaperView(init())?.templateId, "garden-light-v1", "deleted history need not be retained");
  assert.deepEqual(initial.copy, initialCopy, "transitions do not mutate the original state");

  type User = { status: string; isProvisional: unknown; wechatOpenid?: string };
  type Note = { userId: string; content: string; mediaUrls: unknown; wallpaperState: unknown; isDraft: boolean };
  const users = new Map<string, User>();
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  let notes = new Map<string, Note>();
  let writes = 0;
  let serverNow = new Date("2026-09-15T00:00:00Z");
  let afterResolve: (() => void) | undefined;
  let afterUser: (() => void) | undefined;
  let beforeNote: (() => void) | undefined;
  let afterPeekNote: (() => void) | undefined;
  let failUpdate = false;
  let holdWrite: Promise<void> | undefined;
  const trace: string[] = [];
  let queue = Promise.resolve();
  const sqlText = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ").trim();
  const queryRaw = async (locked: boolean, strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = sqlText(strings);
    assert.ok(!sql.includes("synthetic-"), "all identity values must be bound");
    if (sql.startsWith('SELECT "userId" FROM "Session"')) {
      trace.push(locked ? "principal" : "peek-principal");
      const session = sessions.get(String(values[0]));
      const result = session ? [{ userId: session.userId }] : [];
      afterResolve?.(); afterResolve = undefined; return result;
    }
    if (sql.startsWith('SELECT "status", "isProvisional", "wechatOpenid" FROM "User"')) {
      if (locked) {
        trace.push("user-lock"); assert.ok(sql.endsWith("FOR UPDATE"));
      } else {
        trace.push("peek-user"); assert.ok(!sql.endsWith("FOR UPDATE"));
      }
      const user = users.get(String(values[0])); afterUser?.(); afterUser = undefined; return user ? [user] : [];
    }
    if (sql.startsWith('SELECT "expiresAt" FROM "Session"')) {
      if (locked) {
        trace.push("session-lock"); assert.ok(sql.endsWith("FOR UPDATE"));
      } else {
        trace.push("peek-session"); assert.ok(!sql.endsWith("FOR UPDATE"));
      }
      const session = sessions.get(String(values[1]));
      return session && session.userId === values[0] ? [{ expiresAt: session.expiresAt }] : [];
    }
    if (sql === 'SELECT clock_timestamp() AS "serverNow"') {
      trace.push(locked ? "clock" : "peek-clock");
      return [{ serverNow }];
    }
    if (sql.startsWith('SELECT "id" FROM "Note"')) {
      assert.ok(!locked);
      trace.push("peek-note");
      assert.ok(sql.endsWith('AND "isDraft" = false'));
      beforeNote?.(); beforeNote = undefined;
      const note = notes.get(String(values[0]));
      const result = note && note.userId === values[1] && !note.isDraft ? [{ id: values[0] }] : [];
      afterPeekNote?.(); afterPeekNote = undefined;
      return result;
    }
    if (sql.startsWith('SELECT "content", "mediaUrls", "wallpaperState" FROM "Note"')) {
      assert.ok(locked, "note plaintext is selected only under its transaction lock");
      trace.push("note-lock");
      assert.ok(sql.endsWith('AND "isDraft" = false FOR UPDATE'));
      beforeNote?.(); beforeNote = undefined;
      const note = notes.get(String(values[0])); return note && note.userId === values[1] && !note.isDraft ? [structuredClone(note)] : [];
    }
    if (sql.startsWith('SELECT "wallpaperState" FROM "Note"')) {
      assert.ok(locked, "history is transaction-only");
      trace.push("history"); assert.ok(sql.includes('WHERE "userId" = ? AND "wallpaperState" IS NOT NULL'));
      return [...notes.values()].filter(note => note.userId === values[0] && note.wallpaperState !== null)
        .map(note => ({ wallpaperState: note.wallpaperState }));
    }
    throw new Error(`unexpected offline query: ${sql}`);
  };
  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      return queryRaw(true, strings, ...values);
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      assert.equal(sqlText(strings), 'UPDATE "Note" SET "wallpaperState" = ?::jsonb WHERE "id" = ? AND "userId" = ?');
      if (holdWrite) await holdWrite;
      trace.push("write");
      const note = notes.get(String(values[1]));
      if (!note || note.userId !== values[2]) return 0;
      note.wallpaperState = JSON.parse(String(values[0]));
      if (failUpdate) throw new Error("synthetic rollback");
      writes += 1; return 1;
    },
  };
  const fakePrisma = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      return queryRaw(false, strings, ...values);
    },
    $transaction<T>(operation: (client: typeof tx) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const before = structuredClone(notes);
        try { return await operation(tx); } catch (error) { notes = before; throw error; }
      });
      queue = result.then(() => undefined, () => undefined); return result;
    },
  };
  const globals = globalThis as unknown as { prisma?: unknown };
  const previousPrisma = globals.prisma;
  globals.prisma = fakePrisma;
  try {
    const { hashToken } = await import("../lib/auth");
    const { GET, POST } = await import("../app/api/notes/[noteId]/wallpaper/route");
    const seedNote = (id: string, userId = "synthetic-A", content = "累", mediaUrls: unknown = []) =>
      notes.set(id, { userId, content, mediaUrls, wallpaperState: null, isDraft: false });
    const reset = () => {
      users.clear(); sessions.clear(); notes.clear(); writes = 0; trace.length = 0; failUpdate = false; holdWrite = undefined;
      afterResolve = undefined; afterUser = undefined; beforeNote = undefined; serverNow = new Date("2026-09-15T00:00:00Z");
      for (const userId of ["synthetic-A", "synthetic-B"]) {
        users.set(userId, { status: "ACTIVE", isProvisional: false });
        sessions.set(hashToken(`${userId}-token`), { userId, expiresAt: new Date("2099-01-01T00:00:00Z") });
      }
      sessions.set(hashToken("synthetic-A-device2"), { userId: "synthetic-A", expiresAt: new Date("2099-01-01T00:00:00Z") });
      seedNote("note-A"); seedNote("note-B", "synthetic-B");
    };
    type ResponseData = { noteId: string; wallpaper: ReturnType<typeof getWallpaperView>; appliedRevision?: number; replayed?: boolean };
    const invoke = async (method: "GET" | "POST", body?: unknown, noteId = "note-A", token: string | null = "synthetic-A-token", query = "") => {
      const response = await (method === "POST" ? POST : GET)(new Request(`http://localhost/api/notes/${noteId}/wallpaper${query}`, {
        method, headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }) as never, { params: Promise.resolve({ noteId }) });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      return { status: response.status, body: await response.json() as { data?: ResponseData; error?: { code: string; details?: { reason: string } } } };
    };
    const initialize = { action: "initialize" };
    const switchAction = (expectedRevision: number, requestId = `switch-${expectedRevision}`) => ({ action: "switch", expectedRevision, requestId });
    reset();
    assert.deepEqual((await invoke("GET")).body.data, { noteId: "note-A", wallpaper: null }); assert.equal(writes, 0);
    trace.length = 0;
    const first = await invoke("POST", initialize);
    assert.equal(first.status, 200); assert.equal(first.body.data?.wallpaper?.revision, 0);
    assert.deepEqual(trace, [
      "peek-principal", "peek-user", "peek-session", "peek-clock", "peek-note",
      "principal", "user-lock", "session-lock", "clock", "note-lock", "history", "write",
      "principal", "user-lock", "session-lock", "clock", "note-lock",
    ]);
    assert.equal(first.body.data?.wallpaper?.copy.copyId, "rest-v1");
    assert.deepEqual((await invoke("GET", undefined, "note-A", "synthetic-A-device2")).body.data?.wallpaper, first.body.data?.wallpaper);
    assert.equal((await invoke("POST", initialize)).body.data?.replayed, true); assert.equal(writes, 1);
    notes.get("note-A")!.content = "开心，原文不能出现在壁纸";
    const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) => invoke("POST", switchAction(0, `tap-${index}`))));
    assert.equal(concurrent.filter(result => result.status === 200).length, 1); assert.equal(writes, 2);
    assert.ok(concurrent.every(result => result.status === 200 || result.body.error?.details?.reason === "REVISION_CONFLICT"));
    const second = await invoke("POST", switchAction(1));
    assert.deepEqual(second.body.data?.wallpaper?.copy, first.body.data?.wallpaper?.copy);
    const replay = await invoke("POST", switchAction(0, "tap-0"));
    assert.equal(replay.body.data?.appliedRevision, 1); assert.equal(replay.body.data?.wallpaper?.revision, 2); assert.equal(writes, 3);
    assert.equal((await invoke("POST", switchAction(1, "tap-0"))).status, 409);
    serverNow = new Date("2027-01-01T00:00:00Z");
    assert.equal((await invoke("POST", switchAction(2))).body.data?.wallpaper?.switchesRemaining, 0);
    assert.equal((await invoke("POST", switchAction(3))).body.error?.details?.reason, "SWITCH_LIMIT");
    assert.equal((await invoke("POST", initialize)).body.data?.wallpaper?.revision, 3);
    assert.equal((await invoke("POST", switchAction(2))).body.data?.replayed, true); assert.equal(writes, 4);
    assert.equal((await invoke("POST", initialize, "note-B")).status, 404);
    assert.equal((await invoke("GET", undefined, "note-A", "synthetic-B-token")).status, 404);
    assert.equal((await invoke("GET", undefined, "note-B", "synthetic-B-token")).body.data?.wallpaper, null);

    reset();
    const parallelInit = await Promise.all(Array.from({ length: 10 }, () => invoke("POST", initialize)));
    assert.equal(writes, 1, "parallel initialize must coalesce to one write");
    assert.ok(parallelInit.every(result => result.status === 200 && result.body.data?.wallpaper?.revision === 0));
    assert.equal(new Set(parallelInit.map(result => JSON.stringify(result.body.data?.wallpaper))).size, 1, "coalesced initialize returns one shared wallpaper");
    const parallelReplay = await Promise.all(Array.from({ length: 10 }, () => invoke("POST", switchAction(0))));
    assert.equal(parallelReplay.filter(result => !result.body.data?.replayed).length, 1); assert.equal(writes, 2);
    reset();
    for (let i = 0; i < 7; i += 1) seedNote(`pool-${i}`);
    const allocated = await Promise.all(Array.from({ length: 7 }, (_, i) => invoke("POST", initialize, `pool-${i}`)));
    assert.equal(new Set(allocated.slice(0, 6).map(result => result.body.data?.wallpaper?.templateId)).size, 6);
    assert.equal(allocated[6].body.data?.wallpaper?.templateId, allocated[0].body.data?.wallpaper?.templateId);
    assert.deepEqual([...notes.values()].filter(note => note.wallpaperState).map(note => parseWallpaperState(note.wallpaperState)!.versions[0].allocationOrder), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(WALLPAPER_TEMPLATES.length, 6);

    reset(); seedNote("photo", "synthetic-A", "", ["private-image"]);
    assert.equal((await invoke("POST", initialize, "photo")).body.data?.wallpaper?.copy.copyId, "photo-v1");
    notes.get("note-A")!.isDraft = true;
    assert.equal((await invoke("POST", initialize)).status, 404);
    reset(); notes.get("note-A")!.wallpaperState = { schemaVersion: 99 };
    const corruptBefore = structuredClone(notes);
    assert.equal((await invoke("GET")).body.error?.details?.reason, "STATE_INVALID");
    assert.equal((await invoke("POST", initialize)).body.error?.details?.reason, "STATE_INVALID");
    assert.deepEqual(notes, corruptBefore); assert.equal(writes, 0);
    reset(); users.get("synthetic-A")!.status = "CANCELLED";
    assert.equal((await invoke("POST", initialize)).status, 401); assert.equal(writes, 0);
    reset(); failUpdate = true;
    assert.equal((await invoke("POST", initialize)).status, 500); assert.equal(notes.get("note-A")!.wallpaperState, null);
    failUpdate = false; assert.equal((await invoke("POST", initialize)).body.data?.wallpaper?.revision, 0);

    for (const malformed of ["", "{", "null", "[]", "true", JSON.stringify({ action: "initialize", templateId: "forged" }),
      JSON.stringify({ action: "switch", requestId: "x", expectedRevision: 0, copy: initialCopy }), " ".repeat(1025)]) {
      reset(); assert.equal((await invoke("POST", malformed)).status, 400); assert.equal(writes, 0); assert.equal(trace.length, 0);
    }
    reset(); assert.equal((await invoke("GET", undefined, "note-A", null)).status, 401);
    assert.equal((await invoke("POST", initialize, "note-A", "synthetic-A-token", "?userId=synthetic-B")).status, 400);
    for (const provisional of [true, undefined, "false", null, 0]) {
      reset(); users.get("synthetic-A")!.isProvisional = provisional;
      assert.equal((await invoke("POST", initialize)).status, 403); assert.equal(writes, 0);
    }
    reset(); afterResolve = () => { users.delete("synthetic-A"); };
    assert.equal((await invoke("POST", initialize)).status, 401); assert.equal(writes, 0);
    reset(); afterUser = () => { sessions.delete(hashToken("synthetic-A-token")); };
    assert.equal((await invoke("POST", initialize)).status, 401); assert.equal(writes, 0);
    reset(); sessions.get(hashToken("synthetic-A-token"))!.expiresAt = serverNow;
    assert.equal((await invoke("POST", initialize)).status, 401); assert.equal(writes, 0);
    reset(); beforeNote = () => { notes.delete("note-A"); };
    assert.equal((await invoke("POST", initialize)).status, 404); assert.equal(writes, 0);
    reset(); await invoke("POST", initialize); notes.delete("note-A");
    assert.equal((await invoke("GET")).status, 404);
    seedNote("replacement"); assert.equal((await invoke("POST", initialize, "replacement")).body.data?.wallpaper?.templateId, "garden-light-v1");
    assert.match(readFileSync("prisma/migrations/20261110000100_add_note_wallpaper_state/migration.sql", "utf8"), /ALTER TABLE "Note" ADD COLUMN "wallpaperState" JSONB;/u);
    assert.match(readFileSync("prisma/schema.prisma", "utf8"), /wallpaperState\s+Json\?/u);

    // Direct service path: auth before AI; unauthorized/expired must not call the model.
    const { noteWallpaper } = await import("../services/notes/noteWallpaperService");
    const { AppError } = await import("../lib/errors");
    const { createGeneratedWallpaperCopy: makeGenerated } = await import("../lib/note-wallpaper-state");
    const generatedSeed = makeGenerated("把今晚轻轻放下。", "明天的事，明天再碰。");
    assert.ok(generatedSeed);
    reset();
    let aiCalls = 0;
    const countingGenerator = async () => {
      aiCalls += 1;
      return generatedSeed!;
    };
    const authorized = await noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: countingGenerator,
    });
    assert.equal(aiCalls, 1);
    assert.equal(authorized.wallpaper?.copy.copyId, "generated-v1");
    assert.equal(authorized.wallpaper?.copy.quote, "把今晚轻轻放下。");
    aiCalls = 0;
    const replayed = await noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: countingGenerator,
    });
    assert.equal(aiCalls, 0, "replayed initialize must not call AI again");
    assert.equal(replayed.replayed, true);

    for (const [label, setup] of [
      ["expired", () => { sessions.get(hashToken("synthetic-A-token"))!.expiresAt = serverNow; }],
      ["cancelled", () => { users.get("synthetic-A")!.status = "CANCELLED"; }],
      ["missing-token", () => { sessions.delete(hashToken("synthetic-A-token")); }],
      ["foreign-note", () => { /* use note-B below */ }],
      ["provisional", () => { users.get("synthetic-A")!.isProvisional = true; }],
    ] as const) {
      reset();
      aiCalls = 0;
      setup();
      const noteId = label === "foreign-note" ? "note-B" : "note-A";
      await assert.rejects(
        () => noteWallpaper(hashToken("synthetic-A-token"), noteId, { action: "initialize" }, {
          generateWarmCopy: countingGenerator,
        }),
        (error: unknown) => error instanceof AppError && (error.status === 401 || error.status === 403 || error.status === 404),
        label,
      );
      assert.equal(aiCalls, 0, `${label} must not call AI`);
      assert.equal(notes.get(noteId)?.wallpaperState ?? null, null, `${label} must not write wallpaper`);
    }

    // Current owner-only policy is enforced inside the service, not just the route.
    reset();
    process.env.STAGING_OWNER_ACCESS_MODE = "owner-only";
    process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 = createHash("sha256").update("synthetic-approved-owner").digest("hex");
    try {
      aiCalls = 0;
      await assert.rejects(() => noteWallpaper(hashToken("synthetic-A-token"), "note-A", initialize as never,
        {generateWarmCopy: countingGenerator}), (error: unknown) => error instanceof AppError && error.status === 403);
      assert.equal(aiCalls, 0);
      users.get("synthetic-A")!.wechatOpenid = "synthetic-approved-owner";
      assert.equal((await noteWallpaper(hashToken("synthetic-A-token"), "note-A", initialize as never,
        {generateWarmCopy: countingGenerator})).wallpaper?.copy.copyId, "generated-v1");
    } finally {
      delete process.env.STAGING_OWNER_ACCESS_MODE;
      delete process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256;
    }
    reset();
    await noteWallpaper(hashToken("synthetic-A-token"), "note-A", initialize as never, {
      generateWarmCopy: async () => { throw new Error("synthetic model unavailable"); },
    });
    aiCalls = 0;
    assert.equal((await noteWallpaper(hashToken("synthetic-A-token"), "note-A", initialize as never,
      {generateWarmCopy: countingGenerator})).wallpaper?.copy.copyId, "rest-v1");
    assert.equal(aiCalls, 0, "failed AI retains durable fallback, retry never regenerates");
    reset();
    const edited = await noteWallpaper(hashToken("synthetic-A-token"), "note-A", initialize as never, {
      generateWarmCopy: async () => { notes.get("note-A")!.content = "新的小记"; return generatedSeed!; },
    });
    assert.equal(edited.wallpaper?.copy.copyId, "rest-v1", "late AI from old content cannot publish after edit");

    reset();
    const currentDraft = "更新过的小记";
    afterPeekNote = () => { notes.get("note-A")!.content = currentDraft; };
    const refreshed = await noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: async ({ content }) => {
        assert.equal(content, currentDraft, "only the note captured under the committed claim reaches the model");
        return generatedSeed!;
      },
    });
    assert.equal(refreshed.wallpaper?.copy.copyId, "generated-v1");
    assert.ok(!JSON.stringify(refreshed).includes(currentDraft), "the private generation input never enters the response");

    // Coalescing is per note, but authentication outcomes belong to each session.
    for (const scenario of ["first-revoked", "joiner-revoked", "both-revoked", "account-cancelled", "owner-revoked"] as const) {
      reset();
      aiCalls = 0;
      let releaseJoined!: (copy: typeof generatedSeed) => void;
      const pendingGenerator = async (): Promise<WallpaperCopy> => {
        aiCalls += 1;
        return await new Promise<NonNullable<typeof generatedSeed>>(resolve => {
          releaseJoined = copy => resolve(copy!);
        });
      };
      const observe = (token: string): Promise<{status: number; wallpaper: ReturnType<typeof getWallpaperView>}> => noteWallpaper(hashToken(token), "note-A", {action: "initialize"},
        {generateWarmCopy: pendingGenerator}).then(
          value => ({status: 200, wallpaper: value.wallpaper}),
          error => ({status: error instanceof AppError ? error.status : 500, wallpaper: null}),
        );
      const first = observe("synthetic-A-token");
      for (let i = 0; i < 20 && aiCalls === 0; i += 1) await new Promise(resolve => setImmediate(resolve));
      assert.equal(aiCalls, 1, scenario);
      const joinedRequest = observe("synthetic-A-device2");
      for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve));
      if (scenario === "first-revoked" || scenario === "both-revoked") sessions.delete(hashToken("synthetic-A-token"));
      if (scenario === "joiner-revoked" || scenario === "both-revoked") sessions.delete(hashToken("synthetic-A-device2"));
      if (scenario === "account-cancelled") users.get("synthetic-A")!.status = "CANCELLED";
      if (scenario === "owner-revoked") {
        process.env.STAGING_OWNER_ACCESS_MODE = "owner-only";
        process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256 = createHash("sha256").update("another-owner").digest("hex");
      }
      releaseJoined(generatedSeed);
      try {
        const [firstResult, joinedResult] = await Promise.all([first, joinedRequest]);
        assert.equal(firstResult.status, scenario === "joiner-revoked" ? 200 : scenario === "owner-revoked" ? 403 : 401, scenario);
        assert.equal(joinedResult.status, scenario === "first-revoked" ? 200 : scenario === "owner-revoked" ? 403 : 401, scenario);
        if (scenario === "first-revoked") {
          assert.equal(joinedResult.wallpaper?.copy.copyId, "rest-v1");
          assert.equal(joinedResult.wallpaper?.switchesRemaining, 3);
          assert.deepEqual((await noteWallpaper(hashToken("synthetic-A-device2"), "note-A")).wallpaper, joinedResult.wallpaper);
        }
        assert.equal(aiCalls, 1, `${scenario}: no retry or extra AI`);
        assert.equal(writes, scenario === "joiner-revoked" ? 2 : 1, `${scenario}: no duplicate claims/publications`);
      } finally {
        delete process.env.STAGING_OWNER_ACCESS_MODE;
        delete process.env.STAGING_ALLOWED_WECHAT_OPENID_SHA256;
      }
    }

    // A failed initial claim is not silently retried by a joined request.
    reset();
    aiCalls = 0;
    failUpdate = true;
    let releaseFailedClaim!: () => void;
    holdWrite = new Promise<void>(resolve => { releaseFailedClaim = resolve; });
    const failedClaim = noteWallpaper(hashToken("synthetic-A-token"), "note-A", {action: "initialize"},
      {generateWarmCopy: countingGenerator}).then(() => "unexpected-success", () => "failed");
    for (let i = 0; i < 20 && !trace.includes("note-lock"); i += 1) await new Promise(resolve => setImmediate(resolve));
    const readAfterFailedClaim = noteWallpaper(hashToken("synthetic-A-device2"), "note-A", {action: "initialize"},
      {generateWarmCopy: countingGenerator});
    for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve));
    releaseFailedClaim();
    assert.equal(await failedClaim, "failed");
    assert.equal((await readAfterFailedClaim).wallpaper, null, "uncommitted claim remains null, no hidden retry");
    assert.equal(aiCalls, 0);
    assert.equal(writes, 0);

    // Client timed out; server still generating; retry same account+note must not start a second AI.
    reset();
    aiCalls = 0;
    const slowCopy = generatedSeed!;
    let releaseAi: ((copy: typeof slowCopy) => void) | undefined;
    const slowGenerator = async () => {
      aiCalls += 1;
      return await new Promise<typeof slowCopy>((resolve) => {
        releaseAi = resolve;
      });
    };
    const firstSlow = noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: slowGenerator,
    });
    for (let i = 0; i < 20 && aiCalls === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(aiCalls, 1, "first initialize must start AI once");
    const retrySlow = noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: slowGenerator,
    });
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(aiCalls, 1, "timeout-retry while generating must not start a second AI");
    assert.ok(releaseAi);
    releaseAi!(slowCopy);
    const [firstResult, retryResult] = await Promise.all([firstSlow, retrySlow]);
    assert.equal(firstResult.wallpaper?.copy.copyId, "generated-v1");
    assert.equal(retryResult.wallpaper?.copy.copyId, "generated-v1");
    assert.equal(aiCalls, 1);
    assert.equal(writes, 2, "one durable claim plus one generated copy publication");

    // AI returned → commit delayed → client retry must still coalesce: AI=1, writes=1.
    reset();
    aiCalls = 0;
    let releaseWrite: (() => void) | undefined;
    holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const delayedGenerator = async () => {
      aiCalls += 1;
      return generatedSeed!;
    };
    const firstDelayed = noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: delayedGenerator,
    });
    for (let i = 0; i < 40 && writes === 0 && aiCalls === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(aiCalls, 0, "AI must not start before durable claim commits");
    for (let i = 0; i < 40 && !trace.includes("note-lock"); i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(trace.includes("note-lock"), "commit must reach locked note before write is released");
    assert.equal(writes, 0, "write still held after AI returns");
    const retryDelayed = noteWallpaper(hashToken("synthetic-A-token"), "note-A", { action: "initialize" }, {
      generateWarmCopy: delayedGenerator,
    });
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(aiCalls, 0, "retry cannot start AI before claim commits");
    assert.equal(writes, 0, "retry during delayed commit must not write early");
    assert.ok(releaseWrite);
    releaseWrite!();
    const [delayedFirst, delayedRetry] = await Promise.all([firstDelayed, retryDelayed]);
    assert.equal(delayedFirst.wallpaper?.copy.copyId, "generated-v1");
    assert.equal(delayedRetry.wallpaper?.copy.copyId, "generated-v1");
    assert.equal(aiCalls, 1);
    assert.equal(writes, 2, "claim and generated copy publish once each");

    // Hang self-check: intentional pre-completion hang must exit non-zero under the deadline.
    const hang = spawnSync(process.execPath, ["--import", "tsx", "scripts/note-wallpaper-server-check.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, [HANG_ENV]: "1", SESSION_SECRET: process.env.SESSION_SECRET },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(hang.status, 1, "intentional hang before completion must exit 1 via bounded deadline");
    assert.match(String(hang.stderr || ""), /did not finish within/u);

    completed = true;
    console.log("PASS note-wallpaper offline: peek auth before AI, durable claim then AI coalesce AI=1/writes=2, zero AI on unauthorized/expired, locks/replay/quota. PostgreSQL not exercised.");
  } finally {
    globals.prisma = previousPrisma;
    clearTimeout(deadline);
  }
  assert.equal(completed, true, "async assertions must finish before the process exits");
};
run().catch(error => { console.error(error); process.exitCode = 1; });
