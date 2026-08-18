/**
 * Client-side helpers for P2 provisional / committed publication markers.
 * Pure functions — safe for client components and narrow checks.
 *
 * Product rule (§14): provisional segments must be marked temporary until committed.
 * V1 / no publication fields → no marker (do not mislead ordinary users).
 */

import { USER_COPY } from "@/services/chat/assistantPublication/types";

export type PublicationUiState = "none" | "provisional" | "committed" | "failed";

export type PublicationUiFields = {
  /** API `provisional` — authoritative for temporary vs final after commit. */
  provisional?: boolean | null;
  provisionalMarkedTemporary?: boolean | null;
  provisionalMarker?: string | null;
  publicationStatus?: string | null;
};

export const P2_PUBLICATION_OPT_IN_QUERY = "p2Publication";

/**
 * True when URL/opt-in requests the P2 eval UI path (still requires server flag for data).
 *
 * Accepts several forms because some browsers/clients over-encode `=` as `%3D`,
 * which turns `?p2Publication=1` into a literal key `p2Publication=1`:
 * - `?p2Publication=1` / `true` / `yes` / `on`
 * - `?p2Publication` (key present, any/empty value)
 * - `?p2=1` short alias
 * - malformed key `p2Publication=1` after `%3D` encoding
 */
export function isP2PublicationClientOptIn(
  searchParams: {
    get(name: string): string | null;
    has?(name: string): boolean;
    keys?(): IterableIterator<string>;
  } | URLSearchParams,
): boolean {
  const truthy = (raw: string | null | undefined) => {
    const v = (raw ?? "").trim().toLowerCase();
    return v === "" || v === "1" || v === "true" || v === "yes" || v === "on";
  };

  if (searchParams.has?.(P2_PUBLICATION_OPT_IN_QUERY)) {
    return truthy(searchParams.get(P2_PUBLICATION_OPT_IN_QUERY));
  }

  const primary = searchParams.get(P2_PUBLICATION_OPT_IN_QUERY);
  if (primary != null && truthy(primary)) return true;

  const short = searchParams.get("p2");
  if (short != null && truthy(short)) return true;

  // Over-encoded `?p2Publication%3D1` → key is literally "p2Publication=1"
  if (searchParams.has?.("p2Publication=1")) return true;
  if (searchParams.get("p2Publication=1") != null) return true;

  if (typeof searchParams.keys === "function") {
    for (const key of searchParams.keys()) {
      if (key === "p2Publication=1" || key.toLowerCase() === "p2publication=1") {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolve product-facing publication UI state from API fields.
 * No publication signal → `none` (V1 default; no temporary label).
 */
export function resolvePublicationUiState(
  fields: PublicationUiFields | null | undefined,
): PublicationUiState {
  if (!fields) return "none";

  const status = typeof fields.publicationStatus === "string" ? fields.publicationStatus : null;
  const hasSignal =
    fields.provisional != null ||
    fields.provisionalMarkedTemporary != null ||
    status != null ||
    (typeof fields.provisionalMarker === "string" && fields.provisionalMarker.length > 0);

  if (!hasSignal) return "none";

  if (status === "failed_terminal" || status === "failed_retryable") {
    return "failed";
  }

  // After successful commit, API sets provisional:false; status is authority.
  if (status === "committed" || fields.provisional === false) {
    return "committed";
  }

  if (fields.provisional === true) {
    return "provisional";
  }

  if (fields.provisionalMarkedTemporary === true && status !== "committed") {
    return "provisional";
  }

  if (typeof fields.provisionalMarker === "string" && fields.provisionalMarker.length > 0) {
    return "provisional";
  }

  return "none";
}

export function publicationMarkerLabel(
  state: PublicationUiState,
  fields?: PublicationUiFields | null,
): string | null {
  if (state === "provisional") {
    const custom =
      typeof fields?.provisionalMarker === "string" && fields.provisionalMarker.trim()
        ? fields.provisionalMarker.trim()
        : null;
    return custom ?? USER_COPY.provisional;
  }
  if (state === "committed") {
    return "已确认";
  }
  if (state === "failed") {
    return USER_COPY.terminal;
  }
  return null;
}
