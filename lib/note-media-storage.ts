import { chmod, lstat, mkdir, readdir, realpath, rename, rm, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";

import { AppError } from "./errors";

const MANAGED_NOTE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/i;

export const getNoteUploadRoot = () =>
  path.resolve(process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), "public", "uploads"));

export const getNoteMediaPublicBaseUrl = (requestUrl: string) =>
  (process.env.UPLOAD_PUBLIC_BASE_URL?.trim() || `${new URL(requestUrl).origin}/uploads`).replace(/\/$/, "");

export const getPrivateCancelMediaRoot = () => {
  const root = path.resolve(
    process.env.CANCEL_MEDIA_STAGING_DIR?.trim() || path.join(os.tmpdir(), "xinqing-private-cancel-media")
  );
  const uploadRoot = getNoteUploadRoot();
  const publicRoot = path.resolve(process.cwd(), "public");
  if (
    root === path.parse(root).root ||
    root === path.resolve(os.tmpdir()) ||
    root === uploadRoot ||
    root.startsWith(`${uploadRoot}${path.sep}`) ||
    root === publicRoot ||
    root.startsWith(`${publicRoot}${path.sep}`)
  ) {
    throw new AppError("INTERNAL_ERROR", "注销媒体私有暂存目录配置不安全", 500);
  }
  return root;
};

const ensurePrivateCancelMediaRoot = async () => {
  const root = getPrivateCancelMediaRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new AppError("INTERNAL_ERROR", "注销媒体私有暂存目录不安全", 500);
  }
  const [canonicalRoot, canonicalUploadRoot, canonicalPublicRoot] = await Promise.all([
    realpath(root),
    realpath(getNoteUploadRoot()),
    realpath(path.resolve(process.cwd(), "public")),
  ]);
  if (
    canonicalRoot === canonicalUploadRoot ||
    canonicalRoot.startsWith(`${canonicalUploadRoot}${path.sep}`) ||
    canonicalRoot === canonicalPublicRoot ||
    canonicalRoot.startsWith(`${canonicalPublicRoot}${path.sep}`)
  ) {
    throw new AppError("INTERNAL_ERROR", "注销媒体私有暂存目录配置不安全", 500);
  }
  await chmod(root, 0o700);
  return root;
};

const resolveManagedNoteMediaPath = (mediaUrl: string, requestUrl: string) => {
  let media: URL;
  let publicBase: URL;
  try {
    media = new URL(mediaUrl);
    publicBase = new URL(getNoteMediaPublicBaseUrl(requestUrl));
  } catch {
    throw new AppError("VALIDATION_ERROR", "存在无法安全删除的媒体文件，账号未注销", 409);
  }

  const basePath = publicBase.pathname.replace(/\/$/, "");
  const expectedPrefix = `${basePath}/notes/`;
  const filename = decodeURIComponent(media.pathname.slice(expectedPrefix.length));
  if (
    media.origin !== publicBase.origin ||
    !media.pathname.startsWith(expectedPrefix) ||
    !MANAGED_NOTE_FILENAME.test(filename)
  ) {
    throw new AppError("VALIDATION_ERROR", "存在无法安全删除的媒体文件，账号未注销", 409);
  }

  return path.join(getNoteUploadRoot(), "notes", filename);
};

export type StagedNoteMedia = { originalPath: string; stagedPath: string; batchDirectory: string };

export const stageManagedNoteMedia = async ({
  mediaUrls,
  requestUrl,
}: {
  mediaUrls: string[];
  requestUrl: string;
}) => {
  const paths = [...new Set(mediaUrls.map((url) => resolveManagedNoteMediaPath(url, requestUrl)))];
  if (paths.length === 0) return [];

  for (const filePath of paths) {
    const stat = await lstat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new AppError("VALIDATION_ERROR", "存在无法安全删除的媒体文件，账号未注销", 409);
    }
  }

  const stagingRoot = await ensurePrivateCancelMediaRoot();
  const batchDirectory = path.join(stagingRoot, randomUUID());
  await mkdir(batchDirectory, { mode: 0o700 });
  await writeFile(path.join(batchDirectory, "ACTIVE"), "active", { flag: "wx", mode: 0o600 });
  const staged: StagedNoteMedia[] = [];
  try {
    for (const originalPath of paths) {
      if (process.env.APP_ENV !== "production" && process.env.ACCOUNT_CANCEL_TEST_FAIL_STAGE_ONCE === "1") {
        delete process.env.ACCOUNT_CANCEL_TEST_FAIL_STAGE_ONCE;
        throw new Error("Injected staged-media rename failure");
      }
      const stagedPath = path.join(batchDirectory, randomUUID());
      await rename(originalPath, stagedPath);
      staged.push({ originalPath, stagedPath, batchDirectory });
    }
    return staged;
  } catch {
    for (const item of [...staged].reverse()) await rename(item.stagedPath, item.originalPath);
    await rm(batchDirectory, { recursive: true, force: true });
    throw new AppError("INTERNAL_ERROR", "媒体文件暂存失败，账号未注销", 500);
  }
};

export const restoreStagedNoteMedia = async (staged: StagedNoteMedia[]) => {
  for (const item of [...staged].reverse()) await rename(item.stagedPath, item.originalPath);
  if (staged[0]) await rm(staged[0].batchDirectory, { recursive: true, force: true });
};

export const markStagedNoteMediaCommitted = async (staged: StagedNoteMedia[]) => {
  if (!staged[0]) return;
  if (process.env.APP_ENV !== "production" && process.env.ACCOUNT_CANCEL_TEST_FAIL_MARK_ONCE === "1") {
    delete process.env.ACCOUNT_CANCEL_TEST_FAIL_MARK_ONCE;
    throw new Error("Injected staged-media commit marker failure");
  }
  await rename(
    path.join(staged[0].batchDirectory, "ACTIVE"),
    path.join(staged[0].batchDirectory, "COMMITTED")
  );
};

export const permanentlyDeleteStagedNoteMedia = async (staged: StagedNoteMedia[]) => {
  if (process.env.APP_ENV !== "production" && process.env.ACCOUNT_CANCEL_TEST_FAIL_FINALIZE_ONCE === "1") {
    delete process.env.ACCOUNT_CANCEL_TEST_FAIL_FINALIZE_ONCE;
    throw new Error("Injected staged-media finalize failure");
  }
  for (const item of staged) {
    await unlink(item.stagedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  if (staged[0]) await rm(staged[0].batchDirectory, { recursive: true, force: true });
};

export const cleanupPrivateStagedNoteMedia = async () => {
  const root = await ensurePrivateCancelMediaRoot();
  const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names) {
    if (!/^[0-9a-f-]{36}$/i.test(name)) continue;
    const batchDirectory = path.join(root, name);
    const stat = await lstat(batchDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    const committed = await lstat(path.join(batchDirectory, "COMMITTED")).catch(() => null);
    if (!committed?.isFile() || committed.isSymbolicLink()) continue;
    await rm(batchDirectory, { recursive: true, force: true });
  }
};
