import { AppError } from "@/lib/errors";

// Sanitized provider-failure class; "unknown" whenever the error carries no provider status evidence.
// A locally wrapped 502 (empty reply, network error) has no details.status and stays "unknown".
export type ProviderFailureCategory =
  | "timeout"
  | "rate_limited"
  | "provider_5xx"
  | "provider_4xx"
  | "unknown";

export const classifyProviderFailureCategory = (error: unknown): ProviderFailureCategory => {
  if (!(error instanceof AppError)) return "unknown";
  if (error.status === 504) return "timeout";
  const providerStatus = typeof error.details === "object" && error.details !== null
    ? (error.details as { status?: unknown }).status
    : undefined;
  if (providerStatus === 429) return "rate_limited";
  if (typeof providerStatus === "number" && providerStatus >= 500 && providerStatus <= 599) {
    return "provider_5xx";
  }
  if (typeof providerStatus === "number" && providerStatus >= 400 && providerStatus <= 499) {
    return "provider_4xx";
  }
  return "unknown";
};
