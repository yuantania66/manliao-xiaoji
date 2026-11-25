import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { getBearerToken, hashToken } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getVisitGrowth, recordVisitGrowth } from "@/services/growth/visitGrowthService";

export const dynamic = "force-dynamic";

const handle = async (request: NextRequest, record: boolean) => {
  let response;
  try {
    const token = getBearerToken(request);
    if (!token) throw new AppError("UNAUTHORIZED", "请先登录", 401);
    if (new URL(request.url).search) throw new AppError("VALIDATION_ERROR", "成长记录不接受查询参数", 400);
    if (record) {
      const text = (await request.text()).trim();
      let body: unknown = {};
      try { if (text) body = JSON.parse(text); }
      catch { throw new AppError("VALIDATION_ERROR", "请求体必须为空或空 JSON 对象", 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
        throw new AppError("VALIDATION_ERROR", "成长记录不接受客户端身份或日期", 400);
      }
    }
    response = ok(await (record ? recordVisitGrowth : getVisitGrowth)(hashToken(token)));
  } catch (error) {
    response = failFromError(error);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
