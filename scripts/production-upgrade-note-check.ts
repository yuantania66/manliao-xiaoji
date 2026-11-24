import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2];
assert.ok(phase === "seed" || phase === "read" || phase === "verify", "Expected seed, read, or verify");
const databaseUrl = process.env.NOTE_UPGRADE_TEST_DATABASE_URL;
assert.ok(databaseUrl, "NOTE_UPGRADE_TEST_DATABASE_URL is required");
const url = new URL(databaseUrl);
assert.ok(url.protocol === "postgresql:" || url.protocol === "postgres:");
assert.ok(["127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(decodeURIComponent(url.pathname.slice(1)), /(?:^|[_-])(?:test|testing|spec|ci)(?:[_-]|$)/iu);
assert.ok(!url.searchParams.has("host"));

const scratch = path.resolve(process.env.NOTE_UPGRADE_FIXTURE_DIR ?? ".next/production-upgrade-note-fixture");
const statePath = path.join(scratch, "state.json");
const uploadRoot = path.join(scratch, "uploads");
process.env.DATABASE_URL = databaseUrl;
process.env.UPLOAD_DIR = uploadRoot;
process.env.APP_ENV = "development";
process.env.AI_PROVIDER = "mock";
process.env.SESSION_SECRET = "synthetic-production-upgrade-note-secret";
const origin = "http://127.0.0.1";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXQAAAAASUVORK5CYII=", "base64");
const content = "synthetic note present before upgrade";
const legacyContent = "synthetic legacy note without request identity";

async function run() {
  const { NextRequest } = await import("next/server");
  const { prisma } = await import("../lib/prisma");
  const { createSession } = await import("../lib/auth");
  const notes = await import("../app/api/notes/route");
  const note = await import("../app/api/notes/[noteId]/route");
  const uploads = await import("../app/api/uploads/notes/route");
  const media = await import("../app/api/uploads/notes/[uploadId]/route");

  const request = (target: string, method = "GET", token?: string, body?: FormData | Record<string, unknown>) => {
    const headers = new Headers(token ? { authorization: `Bearer ${token}` } : undefined);
    if (body && !(body instanceof FormData)) headers.set("content-type", "application/json");
    return new NextRequest(new URL(target, origin), {
      method,
      headers,
      body: !body || body instanceof FormData ? body : JSON.stringify(body),
    });
  };
  async function readData<T>(response: Response, status: number): Promise<T> {
    const payload = await response.json();
    assert.equal(response.status, status, JSON.stringify(payload.error ?? {}));
    assert.equal(payload.ok, true);
    return payload.data as T;
  }
  const noteContext = (noteId: string) => ({ params: Promise.resolve({ noteId }) });
  const uploadContext = (uploadId: string) => ({ params: Promise.resolve({ uploadId }) });
  const fixturePayload = (clientRequestId: string, mediaUrl: string) => ({
    clientRequestId,
    content,
    recordDate: "2026-07-02",
    mediaUrls: [mediaUrl],
  });
  type Fixture = {
    ownerId: string;
    ownerToken: string;
    foreignToken: string;
    foreignNoteId: string;
    noteId: string;
    legacyNoteId: string;
    clientRequestId: string;
    mediaUrl: string;
    uploadId: string;
    storageKey: string;
  };
  type NoteResult = { id: string; content: string; mediaUrls: string[] };

  try {
    const versions = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM "_prisma_migrations"
      WHERE migration_name LIKE '20261124%' AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    assert.equal(versions[0]?.total, phase === "seed" ? 0 : 5, "fixture must cross the five upgrade migrations");

    if (phase === "seed") {
      await mkdir(scratch, { recursive: true });
      await assert.rejects(access(statePath), { code: "ENOENT" });
      const owner = await prisma.user.create({ data: { nickname: "synthetic note owner" } });
      const other = await prisma.user.create({ data: { nickname: "synthetic other owner" } });
      const { token: ownerToken } = await createSession(owner.id);
      const { token: foreignToken } = await createSession(other.id);
      const recordDate = new Date("2026-07-02T00:00:00Z");
      const legacy = await prisma.note.create({ data: { userId: owner.id, content: legacyContent, recordDate } });
      const foreign = await prisma.note.create({ data: { userId: other.id, content: "synthetic foreign note", recordDate } });
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "synthetic.png");
      const { items } = await readData<{ items: { url: string }[] }>(await uploads.POST(request("/api/uploads/notes", "POST", ownerToken, form)), 200);
      const mediaUrl = items[0].url;
      const uploadId = new URL(mediaUrl).pathname.split("/").at(-1)!;
      assert.equal((await media.GET(request(mediaUrl), uploadContext(uploadId))).status, 404);
      const clientRequestId = randomUUID();
      const created = await readData<NoteResult>(await notes.POST(request("/api/notes", "POST", ownerToken, fixturePayload(clientRequestId, mediaUrl))), 201);
      const upload = await prisma.noteUpload.findUniqueOrThrow({ where: { id: uploadId } });
      assert.equal(upload.noteId, created.id);
      assert.equal(await prisma.rawMemory.count({ where: { userId: owner.id, sourceType: "NOTE", sourceId: created.id } }), 1);
      const fixture: Fixture = { ownerId: owner.id, ownerToken, foreignToken, foreignNoteId: foreign.id, noteId: created.id, legacyNoteId: legacy.id, clientRequestId, mediaUrl, uploadId, storageKey: upload.storageKey };
      await writeFile(statePath, JSON.stringify(fixture), { mode: 0o600, flag: "wx" });
      console.log("Seeded authenticated note, signed image, NOTE RawMemory and legacy note before upgrade.");
      return;
    }

    const fixture = JSON.parse(await readFile(statePath, "utf8")) as Fixture;
    const { ownerId, ownerToken, foreignToken, noteId, legacyNoteId, clientRequestId, mediaUrl, uploadId, storageKey } = fixture;
    const ownPath = `/api/notes/${noteId}`;
    const legacyPath = `/api/notes/${legacyNoteId}`;
    const listed = await readData<{ items: NoteResult[] }>(await notes.GET(request("/api/notes?date=2026-07-02", "GET", ownerToken)), 200);
    assert.deepEqual(listed.items.map(({ id }) => id).sort(), [noteId, legacyNoteId].sort());
    const detail = await readData<NoteResult>(await note.GET(request(ownPath, "GET", ownerToken), noteContext(noteId)), 200);
    assert.equal(detail.content, content);
    assert.deepEqual(detail.mediaUrls, [mediaUrl]);
    assert.equal((await readData<NoteResult>(await note.GET(request(legacyPath, "GET", ownerToken), noteContext(legacyNoteId)), 200)).content, legacyContent);
    assert.equal((await note.GET(request(ownPath, "GET", foreignToken), noteContext(noteId))).status, 404);
    assert.equal((await media.GET(request(new URL(mediaUrl).pathname, "GET", foreignToken), uploadContext(uploadId))).status, 404);
    const downloaded = await media.GET(request(mediaUrl), uploadContext(uploadId));
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
    const payload = fixturePayload(clientRequestId, mediaUrl);
    const replay = await readData<NoteResult>(await notes.POST(request("/api/notes", "POST", ownerToken, payload)), 200);
    assert.equal(replay.id, noteId);
    assert.equal(await prisma.note.count({ where: { userId: ownerId, clientRequestId } }), 1);
    assert.equal((await notes.POST(request("/api/notes", "POST", ownerToken, { ...payload, content: "changed payload" }))).status, 409);
    assert.equal(await prisma.rawMemory.count({ where: { userId: ownerId, sourceType: "NOTE", sourceId: noteId } }), 1);
    if (phase === "read") {
      console.log("Read and replayed old note, legacy note and original image after upgrade.");
      return;
    }

    const freshForm = new FormData();
    freshForm.append("file", new Blob([png], { type: "image/png" }), "new-after-upgrade.png");
    const freshUpload = await readData<{ items: { url: string }[] }>(
      await uploads.POST(request("/api/uploads/notes", "POST", ownerToken, freshForm)), 200,
    );
    const freshUrl = freshUpload.items[0].url;
    const fresh = await readData<NoteResult>(await notes.POST(request("/api/notes", "POST", ownerToken, {
      ...fixturePayload(randomUUID(), freshUrl), content: "synthetic note created after upgrade",
    })), 201);
    assert.notEqual(fresh.id, noteId);
    assert.deepEqual(fresh.mediaUrls, [freshUrl]);
    const freshStored = await readData<NoteResult>(
      await note.GET(request(`/api/notes/${fresh.id}`, "GET", ownerToken), noteContext(fresh.id)), 200,
    );
    assert.equal(freshStored.content, "synthetic note created after upgrade");

    const updated = await readData<NoteResult>(await note.PATCH(request(ownPath, "PATCH", ownerToken, { content: "synthetic edited note" }), noteContext(noteId)), 200);
    assert.equal(updated.content, "synthetic edited note");
    const removed = await readData<{ deleted: boolean }>(await note.DELETE(request(ownPath, "DELETE", ownerToken), noteContext(noteId)), 200);
    assert.equal(removed.deleted, true);
    assert.equal((await note.GET(request(ownPath, "GET", ownerToken), noteContext(noteId))).status, 404);
    assert.equal((await media.GET(request(mediaUrl), uploadContext(uploadId))).status, 404);
    assert.equal(await prisma.rawMemory.count({ where: { userId: ownerId, sourceType: "NOTE", sourceId: noteId } }), 0);
    assert.equal(await prisma.noteUpload.count({ where: { id: uploadId } }), 0);
    await assert.rejects(access(path.join(uploadRoot, storageKey)), { code: "ENOENT" });
    assert.equal(await prisma.note.count({ where: { id: { in: [legacyNoteId, fixture.foreignNoteId] } } }), 2);
    console.log("Verified existing and new notes and images after upgrade, with owner isolation, retry/conflict, edit and deletion.");
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
