import { NextRequest } from "next/server";
import { failFromError, ok } from "@/lib/api-response";
import { getBearerToken, hashToken } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { parseWallpaperAction, WallpaperStateError } from "@/lib/note-wallpaper-state";
import { noteWallpaper } from "@/services/notes/noteWallpaperService";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ noteId: string }> };
const handle = async (request: NextRequest, context: Context, write: boolean) => {
  let response;
  try {
    const token = getBearerToken(request);
    if (!token) throw new AppError("UNAUTHORIZED", "请先登录", 401);
    if (new URL(request.url).search) throw new AppError("VALIDATION_ERROR", "壁纸接口不接受查询参数", 400);
    const { noteId } = await context.params;
    if (typeof noteId !== "string" || !noteId.trim() || noteId.length > 128 || noteId !== noteId.trim()) {
      throw new AppError("VALIDATION_ERROR", "小记编号无效", 400);
    }
    let action;
    if (write) {
      const text = await request.text();
      if (text.length > 1024) throw new AppError("VALIDATION_ERROR", "壁纸请求过长", 400);
      let body: unknown;
      try { body = JSON.parse(text); }
      catch { throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400); }
      action = parseWallpaperAction(body);
    }
    response = ok(await noteWallpaper(hashToken(token), noteId, action));
  } catch (error) {
    response = failFromError(error instanceof WallpaperStateError
      ? new AppError("VALIDATION_ERROR", "壁纸请求无效", 400) : error);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
};
export const GET = (request: NextRequest, context: Context) => handle(request, context, false);
export const POST = (request: NextRequest, context: Context) => handle(request, context, true);
