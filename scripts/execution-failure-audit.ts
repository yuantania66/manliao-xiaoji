import type {
  ChatExecutionFailureCategory,
  ChatExecutionTrace,
} from "../services/ai/chatExecutionLifecycle";

export type ExecutionFailedPhase =
  | "plan_preflight"
  | "safety"
  | "before_surface_attempt"
  | "after_surface_attempt_started"
  | "validation"
  | "persistence";

export type ExecutionFailureRecord = {
  code: NonNullable<ChatExecutionTrace["failure"]>["code"];
  category: ChatExecutionFailureCategory | null;
  failedPhase: ExecutionFailedPhase;
  surfaceAttemptsStarted: number;
  planPreflightAttempts: number;
  infrastructureRerunEligible: boolean;
} | null;

const INFRASTRUCTURE_CATEGORIES: ReadonlySet<ChatExecutionFailureCategory> = new Set([
  "timeout",
  "rate_limited",
  "provider_5xx",
]);

// Records only the sanitized code, category, phase, and counts; never the raw failure reason.
export const executionFailureRecordFor = (execution: ChatExecutionTrace): ExecutionFailureRecord => {
  const failure = execution.failure;
  if (!failure) return null;
  const surfaceAttemptsStarted = execution.attempts.length;
  const providerFailure = failure.code === "PROVIDER_ERROR" || failure.code === "TIMEOUT";
  const category = providerFailure ? failure.category ?? "unknown" : null;
  const failedPhase: ExecutionFailedPhase =
    failure.code === "PLAN_INVALID" ? "plan_preflight"
      : failure.code === "SAFETY_BLOCKED" ? "safety"
        : failure.code === "GENERATION_NONCONFORMANT" ? "validation"
          : failure.code === "PERSISTENCE_ERROR" ? "persistence"
            : surfaceAttemptsStarted === 0 ? "before_surface_attempt"
              : "after_surface_attempt_started";
  return {
    code: failure.code,
    category,
    failedPhase,
    surfaceAttemptsStarted,
    planPreflightAttempts: execution.planPreflightAttempts?.length ?? 1,
    infrastructureRerunEligible: category !== null && INFRASTRUCTURE_CATEGORIES.has(category),
  };
};

export const executionFailureKey = (record: ExecutionFailureRecord) =>
  record ? `${record.code}:${record.category ?? "-"}:${record.failedPhase}` : null;
