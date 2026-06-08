import { NextResponse } from "next/server";

import { ApiErrorCode, AppError, toAppError } from "./errors";

export const ok = <T>(data: T, status = 200) =>
  NextResponse.json(
    {
      ok: true,
      data,
    },
    { status }
  );

export const fail = (
  code: ApiErrorCode,
  message: string,
  status = 500,
  details?: unknown
) =>
  NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status }
  );

export const failFromError = (error: unknown) => {
  const appError: AppError = toAppError(error);
  return fail(appError.code, appError.message, appError.status, appError.details);
};
