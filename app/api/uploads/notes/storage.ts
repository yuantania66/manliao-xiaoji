import { createHash, timingSafeEqual } from "crypto";
import { unlink } from "fs/promises";
import path from "path";

export const getNoteUploadRoot = () =>
  process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), "private-uploads");

export const hashUploadToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const tokenMatches = (token: string, expectedHash: string) => {
  const actual = Buffer.from(hashUploadToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const uploadIdFromUrl = (value: string) => {
  try {
    const url = new URL(value, "https://local.invalid");
    const match = url.pathname.match(/^\/api\/uploads\/notes\/([0-9a-f-]{36})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

export const removeNoteUploadFile = async (storageKey: string) => {
  if (
    process.env.APP_ENV !== "production" &&
    process.env.ACCOUNT_CANCEL_TEST_FAIL_FILE_DELETE_ONCE === "1"
  ) {
    delete process.env.ACCOUNT_CANCEL_TEST_FAIL_FILE_DELETE_ONCE;
    const error = new Error("account_cancel_test_file_delete_failure") as NodeJS.ErrnoException;
    error.code = "EACCES";
    throw error;
  }
  if (
    process.env.APP_ENV !== "production" &&
    process.env.PROFILE_AVATAR_TEST_FAIL_FILE_DELETE_ONCE === "1" &&
    /\/profile\//u.test(storageKey)
  ) {
    delete process.env.PROFILE_AVATAR_TEST_FAIL_FILE_DELETE_ONCE;
    const error = new Error("profile_avatar_test_file_delete_failure") as NodeJS.ErrnoException;
    error.code = "EACCES";
    throw error;
  }
  await unlink(path.join(getNoteUploadRoot(), storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
};
