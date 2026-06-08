export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CODE_INVALID"
  | "CODE_EXPIRED"
  | "RATE_LIMITED"
  | "DATABASE_ERROR"
  | "AI_GENERATION_FAILED"
  | "AI_JUDGE_FAILED"
  | "AI_REWRITE_FAILED"
  | "CRISIS_DETECTED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ApiErrorCode, message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const toAppError = (error: unknown) => {
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", "服务暂时不可用", 500);
};
