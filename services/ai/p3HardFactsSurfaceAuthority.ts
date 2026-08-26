import { createHash } from "node:crypto";

import { ASSISTANT_GROUNDING } from "@/conversation-os/control/assistantGrounding";

export const P3_HARD_FACTS_SURFACE_AUTHORITY_VERSION = "p3_hard_facts_surface_authority_v1" as const;
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const P3_CANONICAL_HARD_FACTS = Object.freeze({
  schemaVersion: "p3_canonical_hard_facts_v1" as const,
  authorityVersion: ASSISTANT_GROUNDING.source,
  facts: Object.freeze([
    Object.freeze({ factId: "assistant.displayName", value: ASSISTANT_GROUNDING.availableFacts.assistant.displayName }),
    Object.freeze({ factId: "assistant.kind", value: ASSISTANT_GROUNDING.availableFacts.assistant.kind }),
  ]),
});
export const P3_CANONICAL_HARD_FACTS_HASH = sha256(canonical(P3_CANONICAL_HARD_FACTS));

export type P3HardFactsSemanticDecision = "consistent" | "not_applicable" | "contradiction" | "uncertain";
export type P3HardFactsSurfaceRequest = Readonly<{
  schemaVersion: "p3_hard_facts_surface_request_v1";
  authorityVersion: typeof P3_HARD_FACTS_SURFACE_AUTHORITY_VERSION;
  planHash: string;
  scope: "segment" | "final";
  text: string;
  textHash: string;
  replyHash: string;
  utf16Start: number;
  utf16End: number;
}>;
export type P3HardFactsSemanticProvider = (request: P3HardFactsSurfaceRequest & { signal: AbortSignal }) => Promise<unknown>;

export const createP3HardFactsSurfaceRequest = (scope: "segment" | "final", text: string, reply: string, utf16Start: number): P3HardFactsSurfaceRequest => Object.freeze({
  schemaVersion: "p3_hard_facts_surface_request_v1",
  authorityVersion: P3_HARD_FACTS_SURFACE_AUTHORITY_VERSION,
  planHash: P3_CANONICAL_HARD_FACTS_HASH,
  scope,
  text,
  textHash: sha256(text),
  replyHash: sha256(reply),
  utf16Start,
  utf16End: utf16Start + text.length,
});

export const assertP3HardFactsSurfaceDecision = (request: P3HardFactsSurfaceRequest, value: unknown): P3HardFactsSemanticDecision => {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "authorityVersion", "planHash", "scope", "textHash", "replyHash", "utf16Start", "utf16End", "decision", "evidence"])) throw new Error("hard_facts_surface_invalid");
  if (value.schemaVersion !== "p3_hard_facts_surface_decision_v1" || value.authorityVersion !== request.authorityVersion || value.planHash !== request.planHash || value.scope !== request.scope || value.textHash !== request.textHash || value.replyHash !== request.replyHash || value.utf16Start !== request.utf16Start || value.utf16End !== request.utf16End) throw new Error("hard_facts_surface_binding_failed");
  if (!(value.decision === "consistent" || value.decision === "not_applicable" || value.decision === "contradiction" || value.decision === "uncertain")) throw new Error("hard_facts_surface_invalid");
  if (!Array.isArray(value.evidence)) throw new Error("hard_facts_surface_evidence_invalid");
  if (value.decision === "not_applicable" ? value.evidence.length !== 0 : value.evidence.length === 0) throw new Error("hard_facts_surface_evidence_mismatch");
  let previousEnd = request.utf16Start;
  const factIds = new Set<string>();
  for (const item of value.evidence) {
    if (!record(item) || !exactKeys(item, ["factId", "utf16Start", "utf16End", "textHash"]) || typeof item.factId !== "string" || !P3_CANONICAL_HARD_FACTS.facts.some((fact) => fact.factId === item.factId) || factIds.has(item.factId) || !Number.isInteger(item.utf16Start) || !Number.isInteger(item.utf16End)) throw new Error("hard_facts_surface_evidence_invalid");
    const start = item.utf16Start as number; const end = item.utf16End as number;
    if (start < request.utf16Start || start < previousEnd || end <= start || end > request.utf16End) throw new Error("hard_facts_surface_evidence_invalid");
    const relativeStart = start - request.utf16Start; const relativeEnd = end - request.utf16Start;
    if (item.textHash !== sha256(request.text.slice(relativeStart, relativeEnd))) throw new Error("hard_facts_surface_evidence_invalid");
    factIds.add(item.factId); previousEnd = end;
  }
  return value.decision;
};
