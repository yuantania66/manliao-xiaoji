import { createHash } from "node:crypto";

import {
  createSafetyGeneration,
  triageSafety,
  type SafetySemanticProvider,
} from "./chatSafety";
import type { AiConversationMessage } from "./types";
import {
  P3_CANONICAL_HARD_FACTS,
  assertP3HardFactsSurfaceDecision,
  createP3HardFactsSurfaceRequest,
  type P3HardFactsSemanticProvider,
} from "./p3HardFactsSurfaceAuthority";

export const P3_SAFETY_TRUNK_VERSION = "p3_safety_trunk_v1" as const;
export const P3_SAFETY_TRUNK_DEFAULT_ENABLED = false as const;
export const P3_OUTPUT_GUARD_REPAIR_BUDGET = 0 as const;

type PublicationStatus = "reserved" | "streaming" | "committed" | "failed_retryable" | "failed_terminal";
type MemoryCategory = "stable_preference" | "personal_fact" | "important_person" | "commitment" | "significant_event" | "unresolved_topic" | "remember_request";
const MEMORY_CATEGORIES = new Set<MemoryCategory>(["stable_preference", "personal_fact", "important_person", "commitment", "significant_event", "unresolved_topic", "remember_request"]);
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export type P3CanonicalHardFacts = Readonly<{
  schemaVersion: "p3_canonical_hard_facts_v1";
  authorityVersion: "assistant_grounding_v3";
  facts: readonly Readonly<{ factId: string; value: string }>[];
}>;
const CANONICAL_HARD_FACTS: P3CanonicalHardFacts = P3_CANONICAL_HARD_FACTS;

export type P3UntrustedMemoryItem = Readonly<{
  memoryId: string;
  category: MemoryCategory | "safety" | "secret" | "credential" | "unknown";
  text: string;
  sourceMessageIds: readonly string[];
}>;

export type P3ComposerInput = Readonly<{
  schemaVersion: "p3_composer_input_v1";
  turnId: string;
  currentUserMessage: string;
  recentCommittedMessages: readonly AiConversationMessage[];
  canonicalHardFacts: P3CanonicalHardFacts;
  untrusted_memory_data: readonly P3UntrustedMemoryItem[];
}>;

export type P3ComposerProvider = (request: Readonly<{ input: P3ComposerInput; signal: AbortSignal }>) => Promise<AsyncIterable<string>>;
export type P3OutputGuard = (request: Readonly<{ text: string; scope: "segment" | "final"; signal: AbortSignal }>) => Promise<unknown>;
export type P3MonotonicClock = Readonly<{ nowMs(): number }>;

type Publication = {
  id: string;
  sessionId: string;
  clientTurnId: string;
  userContentHash: string;
  status: PublicationStatus;
  leaseOwner: string | null;
  leaseExpiresAtMs: number | null;
  attempt: number;
  draftVersion: number;
  draftContent: string;
  finalContent: string | null;
  failureCode: "SAFETY_BLOCKED" | "GENERATION_NONCONFORMANT" | "PERSISTENCE_ERROR" | null;
};

export type P3PublicationSnapshot = Readonly<Publication>;
export type P3PublicationFaultPoint = "before_commit";

export class P3SafetyTrunkFailure extends Error {
  constructor(public readonly code: string) { super(code); this.name = "P3SafetyTrunkFailure"; }
}

export class InMemoryP3PublicationPort {
  private readonly rows = new Map<string, Publication>();
  private sequence = 0;
  private key(sessionId: string, clientTurnId: string) { return `${sessionId}\0${clientTurnId}`; }
  private snapshot(row: Publication): P3PublicationSnapshot { return Object.freeze({ ...row }); }

  reserve(sessionId: string, clientTurnId: string, userContent: string) {
    const key = this.key(sessionId, clientTurnId);
    const existing = this.rows.get(key);
    const userContentHash = hash(userContent);
    if (existing) {
      if (existing.userContentHash !== userContentHash) throw new P3SafetyTrunkFailure("client_turn_content_conflict");
      return this.snapshot(existing);
    }
    const row: Publication = { id: `p3-local-publication-${++this.sequence}`, sessionId, clientTurnId, userContentHash, status: "reserved", leaseOwner: null, leaseExpiresAtMs: null, attempt: 0, draftVersion: 0, draftContent: "", finalContent: null, failureCode: null };
    this.rows.set(key, row);
    return this.snapshot(row);
  }

  acquire(sessionId: string, clientTurnId: string, leaseOwner: string, nowMs: number) {
    const row = this.rows.get(this.key(sessionId, clientTurnId));
    if (!row) throw new P3SafetyTrunkFailure("publication_not_found");
    if (row.status === "committed") return { action: "replay_committed" as const, publication: this.snapshot(row) };
    if (row.status === "failed_terminal") return { action: "replay_terminal" as const, publication: this.snapshot(row) };
    if (row.leaseExpiresAtMs !== null && row.leaseExpiresAtMs > nowMs) return { action: row.leaseOwner === leaseOwner ? "acquired" as const : "attached" as const, publication: this.snapshot(row) };
    row.status = "reserved";
    row.leaseOwner = leaseOwner;
    row.leaseExpiresAtMs = nowMs + 30_000;
    row.attempt += 1;
    row.failureCode = null;
    row.draftContent = "";
    row.draftVersion = 0;
    return { action: "acquired" as const, publication: this.snapshot(row) };
  }

  begin(publicationId: string, leaseOwner: string, attempt: number, nowMs: number) {
    const row = this.byId(publicationId);
    this.assertFence(row, leaseOwner, attempt, nowMs);
    if (row.status !== "reserved") throw new P3SafetyTrunkFailure("invalid_publication_transition");
    row.status = "streaming";
    return this.snapshot(row);
  }

  append(publicationId: string, leaseOwner: string, attempt: number, expectedDraftVersion: number, segment: string, nowMs: number) {
    const row = this.byId(publicationId);
    this.assertFence(row, leaseOwner, attempt, nowMs);
    if (row.status !== "streaming" || row.draftVersion !== expectedDraftVersion) throw new P3SafetyTrunkFailure("stale_publication_fence");
    row.draftContent += segment;
    row.draftVersion += 1;
    row.leaseExpiresAtMs = nowMs + 30_000;
    return this.snapshot(row);
  }

  commit(publicationId: string, leaseOwner: string, attempt: number, expectedDraftVersion: number, finalContent: string, nowMs: number, faultInjector?: (point: P3PublicationFaultPoint) => void) {
    const row = this.byId(publicationId);
    if (row.status === "committed") {
      if (row.finalContent !== finalContent) throw new P3SafetyTrunkFailure("committed_payload_conflict");
      return this.snapshot(row);
    }
    this.assertFence(row, leaseOwner, attempt, nowMs);
    if ((row.status !== "reserved" && row.status !== "streaming") || row.draftVersion !== expectedDraftVersion || !finalContent.startsWith(row.draftContent)) throw new P3SafetyTrunkFailure("stale_publication_fence");
    faultInjector?.("before_commit");
    row.status = "committed";
    row.finalContent = finalContent;
    row.leaseOwner = null;
    row.leaseExpiresAtMs = null;
    return this.snapshot(row);
  }

  fail(publicationId: string, leaseOwner: string, attempt: number, failureCode: Publication["failureCode"], nowMs: number, terminal = true) {
    const row = this.byId(publicationId);
    this.assertFence(row, leaseOwner, attempt, nowMs);
    row.status = terminal ? "failed_terminal" : "failed_retryable";
    row.failureCode = failureCode;
    row.leaseOwner = null;
    row.leaseExpiresAtMs = null;
    return this.snapshot(row);
  }

  replay(sessionId: string, clientTurnId: string) {
    const row = this.rows.get(this.key(sessionId, clientTurnId));
    return row ? this.snapshot(row) : null;
  }

  count() { return this.rows.size; }
  private byId(id: string) { const row = [...this.rows.values()].find((item) => item.id === id); if (!row) throw new P3SafetyTrunkFailure("publication_not_found"); return row; }
  private assertFence(row: Publication, leaseOwner: string, attempt: number, nowMs: number) { if (row.leaseOwner !== leaseOwner || row.attempt !== attempt || row.leaseExpiresAtMs === null || row.leaseExpiresAtMs <= nowMs) throw new P3SafetyTrunkFailure("stale_publication_fence"); }
}

class TopLevelReplyDecoder {
  private raw = "";
  private scan = 0;
  private replyStart = -1;
  private escaped = false;
  private closed = false;
  private decoded = "";
  private pendingSegment = "";
  private readonly segments: string[] = [];

  push(chunk: string) {
    this.raw += chunk;
    if (this.replyStart < 0) {
      const start = this.findReplyStart();
      if (start < 0) return [];
      this.replyStart = start;
      this.scan = start;
    }
    const before = this.segments.length;
    while (this.scan < this.raw.length && !this.closed) {
      const char = this.raw[this.scan];
      if (this.escaped) {
        const end = char === "u" ? this.scan + 5 : this.scan + 1;
        if (end > this.raw.length) break;
        const token = this.raw.slice(this.scan - 1, end);
        try { this.append(JSON.parse(`"${token}"`) as string); } catch { throw new P3SafetyTrunkFailure("malformed_composer_output"); }
        this.scan = end;
        this.escaped = false;
        continue;
      }
      if (char === "\\") { this.escaped = true; this.scan += 1; continue; }
      if (char === '"') { this.closed = true; this.scan += 1; break; }
      this.append(char);
      this.scan += 1;
    }
    return this.segments.slice(before);
  }

  finish() {
    if (!this.closed || this.escaped) throw new P3SafetyTrunkFailure("malformed_composer_output");
    if (this.pendingSegment) { this.segments.push(this.pendingSegment); this.pendingSegment = ""; }
    return { raw: this.raw, reply: this.decoded, segments: [...this.segments] };
  }

  private append(text: string) { for (const char of text) { this.decoded += char; this.pendingSegment += char; if (/[。！？.!?]/u.test(char)) { this.segments.push(this.pendingSegment); this.pendingSegment = ""; } } }
  private findReplyStart() {
    let depth = 0; let inString = false; let escaped = false; let start = -1; let expectingKey = false;
    for (let index = 0; index < this.raw.length; index += 1) {
      const char = this.raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') {
          inString = false;
          if (depth === 1 && expectingKey) {
            let key = "";
            try { key = JSON.parse(this.raw.slice(start, index + 1)) as string; } catch { return -1; }
            let cursor = index + 1;
            while (/\s/u.test(this.raw[cursor] ?? "")) cursor += 1;
            if (this.raw[cursor] !== ":") return -1;
            cursor += 1;
            while (/\s/u.test(this.raw[cursor] ?? "")) cursor += 1;
            if (key === "reply") return this.raw[cursor] === '"' ? cursor + 1 : -1;
            expectingKey = false;
          }
        }
        continue;
      }
      if (char === '"') { inString = true; start = index; }
      else if (char === "{") { depth += 1; if (depth === 1) expectingKey = true; }
      else if (char === "}") depth -= 1;
      else if (depth === 1 && char === ",") expectingKey = true;
    }
    return -1;
  }
}

const validateHardFacts = (facts: P3CanonicalHardFacts) => {
  if (!record(facts) || !exactKeys(facts, ["schemaVersion", "authorityVersion", "facts"]) || facts.schemaVersion !== "p3_canonical_hard_facts_v1" || facts.authorityVersion !== "assistant_grounding_v3" || !Array.isArray(facts.facts) || facts.facts.length === 0) throw new P3SafetyTrunkFailure("invalid_canonical_hard_facts");
  const ids = new Set<string>();
  for (const fact of facts.facts) { if (!record(fact) || !exactKeys(fact, ["factId", "value"]) || typeof fact.factId !== "string" || !fact.factId || typeof fact.value !== "string" || !fact.value || ids.has(fact.factId)) throw new P3SafetyTrunkFailure("invalid_canonical_hard_facts"); ids.add(fact.factId); }
};

const sanitizeMemory = (items: readonly P3UntrustedMemoryItem[]) => items.filter((item) => record(item) && exactKeys(item, ["memoryId", "category", "text", "sourceMessageIds"]) && typeof item.memoryId === "string" && MEMORY_CATEGORIES.has(item.category as MemoryCategory) && typeof item.text === "string" && Array.isArray(item.sourceMessageIds) && item.sourceMessageIds.length > 0 && item.sourceMessageIds.every((id) => typeof id === "string"));

const parseFinalOutput = (raw: string, expectedTurnId: string, expectedReply: string, hardFacts: P3CanonicalHardFacts) => {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new P3SafetyTrunkFailure("malformed_composer_output"); }
  if (!record(value) || !exactKeys(value, ["schemaVersion", "turnId", "reply", "groundingRefs", "hardFactClaims"]) || value.schemaVersion !== "p3_composer_output_v1" || value.turnId !== expectedTurnId || value.reply !== expectedReply || typeof value.reply !== "string" || value.reply.trim().length === 0 || !Array.isArray(value.groundingRefs) || !Array.isArray(value.hardFactClaims)) throw new P3SafetyTrunkFailure("invalid_composer_output");
  const expected = new Map(hardFacts.facts.map((fact) => [fact.factId, fact.value]));
  if (value.groundingRefs.length !== expected.size || new Set(value.groundingRefs).size !== expected.size || value.groundingRefs.some((id) => typeof id !== "string" || !expected.has(id))) throw new P3SafetyTrunkFailure("hard_fact_binding_failed");
  if (value.hardFactClaims.length !== expected.size) throw new P3SafetyTrunkFailure("hard_fact_binding_failed");
  for (const claim of value.hardFactClaims) if (!record(claim) || !exactKeys(claim, ["factId", "value"]) || typeof claim.factId !== "string" || claim.value !== expected.get(claim.factId)) throw new P3SafetyTrunkFailure("hard_fact_binding_failed");
};

const withTimeout = async <T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, code: string): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(controller.signal), new Promise<T>((_, reject) => { timer = setTimeout(() => { controller.abort(code); reject(new P3SafetyTrunkFailure(code)); }, timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
};

const assertGuardDecision = (value: unknown) => {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "safe", "reasonCode"]) || value.schemaVersion !== "p3_output_safety_guard_v1" || typeof value.safe !== "boolean" || !(value.reasonCode === null || typeof value.reasonCode === "string")) throw new P3SafetyTrunkFailure("output_guard_invalid");
  if (!value.safe) throw new P3SafetyTrunkFailure("output_guard_unsafe");
};

export type RunP3SafetyTrunkInput = Readonly<{
  enabled?: boolean;
  sessionId: string;
  clientTurnId: string;
  leaseOwner: string;
  userMessage: string;
  recentCommittedMessages: readonly AiConversationMessage[];
  publicationPort: InMemoryP3PublicationPort;
  composer: P3ComposerProvider;
  outputGuard: P3OutputGuard;
  hardFactsSemanticProvider: P3HardFactsSemanticProvider;
  clock: P3MonotonicClock;
  safetyProvider?: SafetySemanticProvider;
  loadMemory?: () => Promise<readonly P3UntrustedMemoryItem[]>;
  inputSafetyTimeoutMs?: number;
  memoryTimeoutMs?: number;
  outputGuardTimeoutMs?: number;
  commitFaultInjector?: (point: P3PublicationFaultPoint) => void;
}>;

export type P3SafetyTrunkResult = Readonly<{
  status: "not_invoked" | "attached" | "committed" | "failed";
  publicationId: string | null;
  provisionalSegments: readonly string[];
  finalContent: string | null;
  composerCalls: number;
  outputGuardCalls: number;
  inputSafetyReleasedAtMs: number | null;
  firstSafeSegmentMs: number | null;
  failureCode: string | null;
  memoryAccepted: number;
  memoryRejected: number;
}>;

export const runP3SafetyTrunk = async (input: RunP3SafetyTrunkInput): Promise<P3SafetyTrunkResult> => {
  if (input.enabled !== true) return Object.freeze({ status: "not_invoked", publicationId: null, provisionalSegments: [], finalContent: null, composerCalls: 0, outputGuardCalls: 0, inputSafetyReleasedAtMs: null, firstSafeSegmentMs: null, failureCode: null, memoryAccepted: 0, memoryRejected: 0 });
  validateHardFacts(CANONICAL_HARD_FACTS);
  const reserved = input.publicationPort.reserve(input.sessionId, input.clientTurnId, input.userMessage);
  const lease = input.publicationPort.acquire(input.sessionId, input.clientTurnId, input.leaseOwner, input.clock.nowMs());
  if (lease.action === "replay_committed") return Object.freeze({ status: "committed", publicationId: reserved.id, provisionalSegments: [], finalContent: lease.publication.finalContent, composerCalls: 0, outputGuardCalls: 0, inputSafetyReleasedAtMs: null, firstSafeSegmentMs: null, failureCode: null, memoryAccepted: 0, memoryRejected: 0 });
  if (lease.action === "attached") return Object.freeze({ status: "attached", publicationId: reserved.id, provisionalSegments: lease.publication.draftContent ? [lease.publication.draftContent] : [], finalContent: null, composerCalls: 0, outputGuardCalls: 0, inputSafetyReleasedAtMs: null, firstSafeSegmentMs: null, failureCode: null, memoryAccepted: 0, memoryRejected: 0 });
  if (lease.action === "replay_terminal") return Object.freeze({ status: "failed", publicationId: reserved.id, provisionalSegments: [], finalContent: null, composerCalls: 0, outputGuardCalls: 0, inputSafetyReleasedAtMs: null, firstSafeSegmentMs: null, failureCode: lease.publication.failureCode, memoryAccepted: 0, memoryRejected: 0 });

  let composerCalls = 0; let outputGuardCalls = 0; const provisionalSegments: string[] = []; let inputSafetyReleasedAtMs: number | null = null; let firstSafeSegmentMs: number | null = null; let memoryAccepted = 0; let memoryRejected = 0; let commitAttempted = false;
  const fail = (code: string) => {
    const persistenceFailure = commitAttempted;
    try { input.publicationPort.fail(reserved.id, input.leaseOwner, lease.publication.attempt, persistenceFailure ? "PERSISTENCE_ERROR" : code === "input_safety_blocked" ? "SAFETY_BLOCKED" : "GENERATION_NONCONFORMANT", input.clock.nowMs(), !persistenceFailure); } catch { /* stale failure cannot create success */ }
    return Object.freeze({ status: "failed" as const, publicationId: reserved.id, provisionalSegments: [...provisionalSegments], finalContent: null, composerCalls, outputGuardCalls, inputSafetyReleasedAtMs, firstSafeSegmentMs, failureCode: persistenceFailure ? "PERSISTENCE_ERROR" : code, memoryAccepted, memoryRejected });
  };

  try {
    const triage = await withTimeout(() => triageSafety({ currentUserMessage: input.userMessage, recentMessages: [...input.recentCommittedMessages], provider: input.safetyProvider }), input.inputSafetyTimeoutMs ?? 150, "input_safety_timeout");
    if (triage.status === "blocked") return fail("input_safety_blocked");
    inputSafetyReleasedAtMs = input.clock.nowMs();
    input.publicationPort.begin(reserved.id, input.leaseOwner, lease.publication.attempt, input.clock.nowMs());

    let chunks: AsyncIterable<string>;
    if (triage.decision.requiresSafetyResponse) {
      const safetyText = createSafetyGeneration(triage.decision).text;
      const payload = JSON.stringify({ schemaVersion: "p3_composer_output_v1", turnId: input.clientTurnId, reply: safetyText, groundingRefs: CANONICAL_HARD_FACTS.facts.map((fact) => fact.factId), hardFactClaims: CANONICAL_HARD_FACTS.facts });
      chunks = { async *[Symbol.asyncIterator]() { yield payload; } };
    } else {
      const loaded = input.loadMemory ? await withTimeout(() => input.loadMemory!(), input.memoryTimeoutMs ?? 80, "memory_timeout").catch(() => [] as readonly P3UntrustedMemoryItem[]) : [];
      const accepted = sanitizeMemory(loaded);
      memoryAccepted = accepted.length; memoryRejected = loaded.length - accepted.length;
      const composerInput: P3ComposerInput = Object.freeze({ schemaVersion: "p3_composer_input_v1", turnId: input.clientTurnId, currentUserMessage: input.userMessage, recentCommittedMessages: Object.freeze([...input.recentCommittedMessages]), canonicalHardFacts: CANONICAL_HARD_FACTS, untrusted_memory_data: Object.freeze(accepted) });
      composerCalls += 1;
      chunks = await input.composer({ input: composerInput, signal: new AbortController().signal });
    }

    const decoder = new TopLevelReplyDecoder();
    let draftVersion = 0; let semanticReplyPrefix = "";
    for await (const chunk of chunks) {
      for (const segment of decoder.push(chunk)) {
        const semanticRequest = createP3HardFactsSurfaceRequest("segment", segment, `${semanticReplyPrefix}${segment}`, semanticReplyPrefix.length);
        const semanticDecision = await withTimeout((signal) => input.hardFactsSemanticProvider({ ...semanticRequest, signal }), input.outputGuardTimeoutMs ?? 100, "hard_facts_surface_timeout");
        const semantic = assertP3HardFactsSurfaceDecision(semanticRequest, semanticDecision);
        if (semantic === "contradiction" || semantic === "uncertain") throw new P3SafetyTrunkFailure("hard_facts_surface_blocked");
        outputGuardCalls += 1;
        const decision = await withTimeout((signal) => input.outputGuard({ text: segment, scope: "segment", signal }), input.outputGuardTimeoutMs ?? 100, "output_guard_timeout");
        assertGuardDecision(decision);
        const acceptedAt = input.clock.nowMs();
        firstSafeSegmentMs ??= acceptedAt - inputSafetyReleasedAtMs;
        input.publicationPort.append(reserved.id, input.leaseOwner, lease.publication.attempt, draftVersion, segment, input.clock.nowMs());
        draftVersion += 1; provisionalSegments.push(segment); semanticReplyPrefix += segment;
      }
    }
    const finished = decoder.finish();
    for (const segment of finished.segments.slice(provisionalSegments.length)) {
      const semanticRequest = createP3HardFactsSurfaceRequest("segment", segment, `${semanticReplyPrefix}${segment}`, semanticReplyPrefix.length);
      const semanticDecision = await withTimeout((signal) => input.hardFactsSemanticProvider({ ...semanticRequest, signal }), input.outputGuardTimeoutMs ?? 100, "hard_facts_surface_timeout");
      const semantic = assertP3HardFactsSurfaceDecision(semanticRequest, semanticDecision);
      if (semantic === "contradiction" || semantic === "uncertain") throw new P3SafetyTrunkFailure("hard_facts_surface_blocked");
      outputGuardCalls += 1;
      const decision = await withTimeout((signal) => input.outputGuard({ text: segment, scope: "segment", signal }), input.outputGuardTimeoutMs ?? 100, "output_guard_timeout");
      assertGuardDecision(decision);
      const acceptedAt = input.clock.nowMs(); firstSafeSegmentMs ??= acceptedAt - inputSafetyReleasedAtMs;
      input.publicationPort.append(reserved.id, input.leaseOwner, lease.publication.attempt, draftVersion, segment, input.clock.nowMs());
      draftVersion += 1; provisionalSegments.push(segment); semanticReplyPrefix += segment;
    }
    parseFinalOutput(finished.raw, input.clientTurnId, finished.reply, CANONICAL_HARD_FACTS);
    const finalSemanticRequest = createP3HardFactsSurfaceRequest("final", finished.reply, finished.reply, 0);
    const finalSemanticDecision = await withTimeout((signal) => input.hardFactsSemanticProvider({ ...finalSemanticRequest, signal }), input.outputGuardTimeoutMs ?? 100, "hard_facts_surface_timeout");
    const finalSemantic = assertP3HardFactsSurfaceDecision(finalSemanticRequest, finalSemanticDecision);
    if (finalSemantic === "contradiction" || finalSemantic === "uncertain") throw new P3SafetyTrunkFailure("hard_facts_surface_blocked");
    outputGuardCalls += 1;
    const finalDecision = await withTimeout((signal) => input.outputGuard({ text: finished.reply, scope: "final", signal }), input.outputGuardTimeoutMs ?? 100, "output_guard_timeout");
    assertGuardDecision(finalDecision);
    commitAttempted = true;
    const committed = input.publicationPort.commit(reserved.id, input.leaseOwner, lease.publication.attempt, draftVersion, finished.reply, input.clock.nowMs(), input.commitFaultInjector);
    return Object.freeze({ status: "committed", publicationId: reserved.id, provisionalSegments: [...provisionalSegments], finalContent: committed.finalContent, composerCalls, outputGuardCalls, inputSafetyReleasedAtMs, firstSafeSegmentMs, failureCode: null, memoryAccepted, memoryRejected });
  } catch (error) {
    return fail(error instanceof P3SafetyTrunkFailure ? error.code : "p3_trunk_failed");
  }
};
