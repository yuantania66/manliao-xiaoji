import { createHash, randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { VerificationScene } from "@prisma/client";

import { prisma } from "./prisma";
import { AppError } from "./errors";

const getSessionSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") {
    return "xinqing-local-development-session-secret";
  }
  if (!secret) throw new AppError("INTERNAL_ERROR", "SESSION_SECRET 未配置", 500);
  return secret;
};

export const getSessionExpiresAt = () => {
  const days = Number(process.env.SESSION_EXPIRES_DAYS ?? "30");
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
};

export const hashToken = (token: string) =>
  createHash("sha256").update(`${getSessionSecret()}:${token}`).digest("hex");

export const hashVerificationCode = ({
  phone,
  scene,
  code,
}: {
  phone: string;
  scene: VerificationScene;
  code: string;
}) => createHash("sha256").update(`${getSessionSecret()}:${phone}:${scene}:${code}`).digest("hex");

export const createSessionToken = () => randomBytes(32).toString("base64url");

export const createSession = async (userId: string) => {
  const token = createSessionToken();
  const expiresAt = getSessionExpiresAt();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  return { token, expiresAt };
};

export const getBearerToken = (request: NextRequest) => {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
};

export const getCurrentUser = async (request: NextRequest) => {
  const token = getBearerToken(request);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;
  return session.user;
};

export const requireUser = async (request: NextRequest) => {
  const user = await getCurrentUser(request);
  if (!user) throw new AppError("UNAUTHORIZED", "请先登录", 401);
  return user;
};

export const serializeUser = (user: {
  id: string;
  phone: string | null;
  wechatOpenid: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
}) => ({
  id: user.id,
  phone: user.phone,
  wechatOpenid: user.wechatOpenid,
  nickname: user.nickname,
  avatarUrl: user.avatarUrl,
  status: user.status,
  createdAt: user.createdAt.toISOString(),
});
