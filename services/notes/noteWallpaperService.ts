import { assertStagingOwnerIdentity } from "@/lib/staging-owner-access";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  applyWallpaperAction,
  approvedWallpaperCopy,
  warmCopyLeaksNoteBody,
  getWallpaperView,
  parseWallpaperState,
  selectWallpaperCopy,
  type WallpaperAction,
  type WallpaperCopy,
  WallpaperStateError,
} from "@/lib/note-wallpaper-state";
import { generateNoteWarmCopy } from "@/services/notes/noteWarmCopyService";

type WarmCopyInput = { content: string; mediaCount?: number };
type WarmCopyGenerator = (input: WarmCopyInput) => Promise<WallpaperCopy>;

type WallpaperResult = {
  noteId: string;
  wallpaper: ReturnType<typeof getWallpaperView>;
  appliedRevision?: number;
  replayed?: boolean;
};

const unauthorized = () => new AppError("UNAUTHORIZED", "请先登录", 401);

/**
 * Covers AI + DB commit for one account+note initialize.
 * Released only after commit settles so a timeout-retry cannot start a second AI/write.
 */
const initializeInflight = new Map<string, Promise<WallpaperResult>>();

const authorizeWallpaperAccess = async (tokenHash: string, noteId: string) => {
  if (!tokenHash) throw unauthorized();
  const principals = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "Session" WHERE "tokenHash" = ${tokenHash}
  `;
  const userId = principals[0]?.userId;
  if (!userId) throw unauthorized();
  const users = await prisma.$queryRaw<Array<{ status: string; isProvisional: boolean; wechatOpenid: string | null }>>`
    SELECT "status", "isProvisional", "wechatOpenid" FROM "User" WHERE "id" = ${userId}
  `;
  if (!users[0] || users[0].status !== "ACTIVE") throw unauthorized();
  assertStagingOwnerIdentity(users[0].wechatOpenid);
  if (users[0].isProvisional !== false) {
    throw new AppError("FORBIDDEN", "请使用正式账号保存壁纸", 403);
  }
  const sessions = await prisma.$queryRaw<Array<{ expiresAt: Date }>>`
    SELECT "expiresAt" FROM "Session"
    WHERE "userId" = ${userId} AND "tokenHash" = ${tokenHash}
  `;
  const clocks = await prisma.$queryRaw<Array<{ serverNow: Date }>>`SELECT clock_timestamp() AS "serverNow"`;
  if (!sessions[0] || sessions[0].expiresAt <= clocks[0].serverNow) throw unauthorized();
  const notes = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Note"
    WHERE "id" = ${noteId} AND "userId" = ${userId} AND "isDraft" = false
  `;
  if (!notes[0]) throw new AppError("NOT_FOUND", "小记不存在", 404);
  return userId;
};

const runLockedWallpaper = async (
  tokenHash: string,
  noteId: string,
  action: WallpaperAction | null,
  captureClaim?: (input: WarmCopyInput) => void,
  replaceCopy?: { content: string; copy: WallpaperCopy },
): Promise<WallpaperResult> => {
  return prisma.$transaction(async (tx) => {
    if (!tokenHash) throw unauthorized();
    const principals = await tx.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "Session" WHERE "tokenHash" = ${tokenHash}
    `;
    const userId = principals[0]?.userId;
    if (!userId) throw unauthorized();
    // Same lock order as growth and cancellation; also serializes cross-note allocations.
    const users = await tx.$queryRaw<Array<{ status: string; isProvisional: boolean; wechatOpenid: string | null }>>`
      SELECT "status", "isProvisional", "wechatOpenid" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `;
    if (!users[0] || users[0].status !== "ACTIVE") throw unauthorized();
    assertStagingOwnerIdentity(users[0].wechatOpenid);
    if (users[0].isProvisional !== false) throw new AppError("FORBIDDEN", "请使用正式账号保存壁纸", 403);
    const sessions = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT "expiresAt" FROM "Session"
      WHERE "userId" = ${userId} AND "tokenHash" = ${tokenHash} FOR UPDATE
    `;
    const clocks = await tx.$queryRaw<Array<{ serverNow: Date }>>`SELECT clock_timestamp() AS "serverNow"`;
    if (!sessions[0] || sessions[0].expiresAt <= clocks[0].serverNow) throw unauthorized();
    const notes = await tx.$queryRaw<Array<{ content: string; mediaUrls: unknown; wallpaperState: unknown }>>`
      SELECT "content", "mediaUrls", "wallpaperState" FROM "Note"
      WHERE "id" = ${noteId} AND "userId" = ${userId} AND "isDraft" = false FOR UPDATE
    `;
    const note = notes[0];
    if (!note) throw new AppError("NOT_FOUND", "小记不存在", 404);
    const state = parseWallpaperState(note.wallpaperState);
    if (replaceCopy && state && note.content === replaceCopy.content) {
      // A committed initial state is the durable, one-attempt AI claim. Never reset versions.
      state.copy = replaceCopy.copy;
      await tx.$executeRaw`
        UPDATE "Note" SET "wallpaperState" = ${JSON.stringify(state)}::jsonb
        WHERE "id" = ${noteId} AND "userId" = ${userId}
      `;
    }
    if (!action) return { noteId, wallpaper: getWallpaperView(state) };
    // History belongs to retained notes only. No new account-level retention or image uploads.
    const rows = await tx.$queryRaw<Array<{ wallpaperState: unknown }>>`
      SELECT "wallpaperState" FROM "Note"
      WHERE "userId" = ${userId} AND "wallpaperState" IS NOT NULL
    `;
    const history = rows.map(row => {
      const parsed = parseWallpaperState(row.wallpaperState);
      if (!parsed) throw new WallpaperStateError("STATE_INVALID");
      return parsed;
    });
    const mediaCount = Array.isArray(note.mediaUrls) ? note.mediaUrls.length : 0;
    const seedCopy = selectWallpaperCopy(note.content, mediaCount);
    const result = applyWallpaperAction(state, action, history, state ? undefined : seedCopy);
    if (!result.replayed) {
      // Wallpaper changes are not text edits; preserve Note.updatedAt and creation requestHash.
      const count = await tx.$executeRaw`
        UPDATE "Note" SET "wallpaperState" = ${JSON.stringify(result.state)}::jsonb
        WHERE "id" = ${noteId} AND "userId" = ${userId}
      `;
      if (count !== 1) throw new AppError("NOT_FOUND", "小记不存在", 404);
      if (action.action === "initialize") captureClaim?.({ content: note.content, mediaCount });
    }
    return {
      noteId,
      wallpaper: getWallpaperView(result.state),
      appliedRevision: result.appliedRevision,
      replayed: result.replayed,
    };
  });
};

const runInitializeThroughCommit = async (
  tokenHash: string,
  noteId: string,
  generateWarmCopy: WarmCopyGenerator,
): Promise<WallpaperResult> => {
  // Commit curated state BEFORE any model call. Cross-process retries or a crash can
  // return the curated result but can never reserve/pay for a second generation.
  let claimedInput: WarmCopyInput | undefined;
  const claimed = await runLockedWallpaper(tokenHash, noteId, { action: "initialize" }, (input) => {
    claimedInput = input;
  });
  // Use the locked note snapshot only after its durable claim commits.
  if (claimed.replayed || !claimedInput) return claimed;
  let copy: WallpaperCopy;
  try {
    copy = await generateWarmCopy(claimedInput);
  } catch {
    return runLockedWallpaper(tokenHash, noteId, null);
  }
  // The generator validates output. Recheck auth and original note revision before
  // publishing; cancellation, expiry, deletion or edits cannot resurrect old content.
  const result = await runLockedWallpaper(tokenHash, noteId, null, undefined,
    approvedWallpaperCopy(copy) && copy.copyId === "generated-v1" && !warmCopyLeaksNoteBody(claimedInput.content, copy)
      ? { content: claimedInput.content, copy } : undefined);
  return { ...result, appliedRevision: claimed.appliedRevision, replayed: false };
};

export const noteWallpaper = async (
  tokenHash: string,
  noteId: string,
  action?: WallpaperAction,
  options?: { generateWarmCopy?: WarmCopyGenerator },
) => {
  try {
    // GET and switch stay on the locked path only; initialize peeks for auth-before-AI.
    if (!action || action.action === "switch") {
      return await runLockedWallpaper(tokenHash, noteId, action ?? null);
    }

    // initialize: auth every request, then join or own the AI→commit critical section.
    const generateWarmCopy = options?.generateWarmCopy ?? generateNoteWarmCopy;
    const userId = await authorizeWallpaperAccess(tokenHash, noteId);
    const key = `${userId}:${noteId}`;
    const joined = initializeInflight.get(key);
    if (joined) {
      // Only share completion, never the initiating session's authorization result.
      // Its failure may leave a durable curated claim. Read it with this request's
      // own session; revoked joiners still fail, and this never retries AI/writes.
      await joined.catch(() => undefined);
      return await runLockedWallpaper(tokenHash, noteId, null);
    }

    let settle!: (value: WallpaperResult) => void;
    let fail!: (error: unknown) => void;
    const reserved = new Promise<WallpaperResult>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const tracked = reserved.finally(() => {
      if (initializeInflight.get(key) === tracked) initializeInflight.delete(key);
    });
    initializeInflight.set(key, tracked);

    void (async () => {
      try {
        settle(await runInitializeThroughCommit(tokenHash, noteId, generateWarmCopy));
      } catch (error) {
        fail(error);
      }
    })();

    return await tracked;
  } catch (error) {
    if (!(error instanceof WallpaperStateError)) throw error;
    if (error.reason === "VALIDATION_ERROR") throw new AppError("VALIDATION_ERROR", "壁纸请求无效", 400);
    const messages = { STATE_INVALID: "壁纸记录不可用，请稍后重试", REVISION_CONFLICT: "壁纸版本已变化，请刷新后重试", SWITCH_LIMIT: "这篇小记的三次更换已用完" };
    throw new AppError("CONFLICT", messages[error.reason], 409, { reason: error.reason });
  }
};
