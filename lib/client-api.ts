"use client";

import { clearAuth, getAuthToken } from "./client-auth";

type ApiSuccess<T> = {
  ok: true;
  data: T;
};

type ApiFailure = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export class ClientApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}) => {
  const { body, auth = true, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);

  if (body !== undefined && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const token = auth ? getAuthToken() : null;
  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ClientApiError("网络连接失败，请稍后再试", 0, "NETWORK_ERROR");
  }

  let payload: ApiSuccess<T> | ApiFailure | null = null;
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    clearAuth();
  }

  if (!response.ok || !payload?.ok) {
    const error = payload && !payload.ok ? payload.error : undefined;
    throw new ClientApiError(
      error?.message || "服务暂时不可用",
      response.status,
      error?.code,
      error?.details
    );
  }

  return payload.data;
};
