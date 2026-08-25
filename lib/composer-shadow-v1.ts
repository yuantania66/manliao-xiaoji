import {
  assertFrozenV1ObservationSnapshotV1,
  deepFreezeObservationValue,
  hashFrozenObservationValue,
  type FrozenV1ObservationSnapshotV1,
} from "./frozen-v1-observation-snapshot-authority";
import { assertComposerObservationLedgerAuthorityResultV1, type ComposerObservationLedgerAuthorityResultV1 } from "./composer-observation-ledger-authority";

export const COMPOSER_SHADOW_INPUT_SCHEMA = "composer_shadow_input_v1" as const;
export const COMPOSER_SHADOW_OUTPUT_SCHEMA = "composer_shadow_output_v1" as const;
export const COMPOSER_SHADOW_OBSERVATION_SCHEMA = "composer_shadow_observation_v1" as const;

export type BaselineCaseV1 = Readonly<{
  caseId: string;
  sampleSetVersion: string;
  category: string;
  currentUserTurn: string;
  recentCommittedTurns: readonly Readonly<{ role: "user" | "assistant"; text: string }>[];
  canonicalGroundingVersion: string;
  activeCommittedEventProjection: Readonly<{ sourceAssistantEventId: string; purpose: string | null }> | null;
  episodeCandidatesSnapshot: readonly Readonly<{ episodeId: string; compactSummary: string; confirmedFacts?: readonly string[]; hypotheses?: readonly string[]; people?: readonly string[]; topics?: readonly string[]; sourceMessageIds?: readonly string[] }>[];
  expectedSafetyOwnership: "safety" | "ordinary";
  source: "real_failure" | "positive_regression" | "adversarial";
}>;

export type ComposerShadowInputV1 = Readonly<{
  schemaVersion: typeof COMPOSER_SHADOW_INPUT_SCHEMA;
  shadowRunId: string;
  caseId: string | null;
  sampleSetVersion: string | null;
  conversationIdHash: string;
  turnId: string;
  currentUserText: string;
  recentCommittedTurns: readonly Readonly<{
    messageId: string;
    role: "user" | "assistant";
    text: string;
    replyToMessageId: string | null;
  }>[];
  assistantGrounding: readonly Readonly<{
    canonicalFactId: string;
    value: string;
    epistemicStatus: string;
  }>[];
  activeEvent: Readonly<{
    sourceAssistantEventId: string;
    relation: "open";
    purpose: string | null;
  }> | null;
  episodeCandidates: readonly Readonly<{
    episodeId: string;
    compactSummary: string;
    confirmedFacts: readonly string[];
    hypotheses: readonly string[];
    people: readonly string[];
    topics: readonly string[];
    sourceMessageIds: readonly string[];
  }>[];
  purposeContractVersion: string;
}>;

const PURPOSES = [
  "first_contact", "direct_answer", "repair", "respect_boundary",
  "accompany", "explore", "proactive",
] as const;
export type ComposerPurposeV1 = (typeof PURPOSES)[number];

export type ComposerShadowOutputV1 = Readonly<{
  schemaVersion: typeof COMPOSER_SHADOW_OUTPUT_SCHEMA;
  turnId: string;
  purpose: ComposerPurposeV1;
  reply: string;
  episodeRef: string | null;
  groundingRefs: readonly string[];
  eventRef: string | null;
}>;

export const hashComposerValue = hashFrozenObservationValue;
export const deepFreezeComposerValue = deepFreezeObservationValue;

export const buildComposerShadowInputFromSnapshotV1 = (snapshot: FrozenV1ObservationSnapshotV1, shadowRunId: string): ComposerShadowInputV1 => {
  assertFrozenV1ObservationSnapshotV1(snapshot);
  const baselineCase = snapshot.baselineCase;
  return deepFreezeComposerValue({
  schemaVersion: COMPOSER_SHADOW_INPUT_SCHEMA,
  shadowRunId,
  caseId: baselineCase.caseId,
  sampleSetVersion: baselineCase.sampleSetVersion,
  conversationIdHash: hashComposerValue({ sampleSetVersion: baselineCase.sampleSetVersion, caseId: baselineCase.caseId, kind: "conversation" }),
  turnId: hashComposerValue({ sampleSetVersion: baselineCase.sampleSetVersion, caseId: baselineCase.caseId, kind: "turn" }),
  currentUserText: baselineCase.currentUserTurn,
  recentCommittedTurns: baselineCase.recentCommittedTurns.map((turn, index) => ({
    messageId: hashComposerValue({ caseId: baselineCase.caseId, index, role: turn.role }), role: turn.role, text: turn.text,
    replyToMessageId: index > 0 && turn.role === "assistant" ? hashComposerValue({ caseId: baselineCase.caseId, index: index - 1, role: baselineCase.recentCommittedTurns[index - 1].role }) : null,
  })),
  assistantGrounding: [
    { canonicalFactId: "assistant.displayName", value: snapshot.canonicalGrounding.availableFacts.assistant.displayName, epistemicStatus: "canonical" },
    { canonicalFactId: "assistant.kind", value: snapshot.canonicalGrounding.availableFacts.assistant.kind, epistemicStatus: "canonical" },
  ],
  activeEvent: baselineCase.activeCommittedEventProjection ? { ...baselineCase.activeCommittedEventProjection, relation: "open" as const } : null,
  episodeCandidates: baselineCase.episodeCandidatesSnapshot.map((episode) => ({
    episodeId: episode.episodeId, compactSummary: episode.compactSummary, confirmedFacts: episode.confirmedFacts ?? [],
    hypotheses: episode.hypotheses ?? [], people: episode.people ?? [], topics: episode.topics ?? [], sourceMessageIds: episode.sourceMessageIds ?? [],
  })),
  purposeContractVersion: snapshot.purposeContract.version,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export function assertComposerShadowInputV1(value: unknown): asserts value is ComposerShadowInputV1 {
  const rootKeys = ["schemaVersion", "shadowRunId", "caseId", "sampleSetVersion", "conversationIdHash", "turnId", "currentUserText", "recentCommittedTurns", "assistantGrounding", "activeEvent", "episodeCandidates", "purposeContractVersion"];
  if (!isRecord(value) || !exactKeys(value, rootKeys) || value.schemaVersion !== COMPOSER_SHADOW_INPUT_SCHEMA) throw new Error("invalid_shadow_input_root");
  for (const key of ["shadowRunId", "conversationIdHash", "turnId", "currentUserText", "purposeContractVersion"] as const) if (typeof value[key] !== "string" || !value[key]) throw new Error(`invalid_shadow_input_${key}`);
  if (!(value.caseId === null || typeof value.caseId === "string") || !(value.sampleSetVersion === null || typeof value.sampleSetVersion === "string")) throw new Error("invalid_shadow_input_case_binding");
  if (!Array.isArray(value.recentCommittedTurns) || value.recentCommittedTurns.some((item) => !isRecord(item) || !exactKeys(item, ["messageId", "role", "text", "replyToMessageId"]) || typeof item.messageId !== "string" || !["user", "assistant"].includes(String(item.role)) || typeof item.text !== "string" || !(item.replyToMessageId === null || typeof item.replyToMessageId === "string"))) throw new Error("invalid_shadow_input_recent_turns");
  if (!Array.isArray(value.assistantGrounding) || value.assistantGrounding.some((item) => !isRecord(item) || !exactKeys(item, ["canonicalFactId", "value", "epistemicStatus"]) || typeof item.canonicalFactId !== "string" || typeof item.value !== "string" || typeof item.epistemicStatus !== "string")) throw new Error("invalid_shadow_input_grounding");
  if (!(value.activeEvent === null || (isRecord(value.activeEvent) && exactKeys(value.activeEvent, ["sourceAssistantEventId", "relation", "purpose"]) && typeof value.activeEvent.sourceAssistantEventId === "string" && value.activeEvent.relation === "open" && (value.activeEvent.purpose === null || typeof value.activeEvent.purpose === "string")))) throw new Error("invalid_shadow_input_event");
  if (!Array.isArray(value.episodeCandidates) || value.episodeCandidates.some((item) => !isRecord(item) || !exactKeys(item, ["episodeId", "compactSummary", "confirmedFacts", "hypotheses", "people", "topics", "sourceMessageIds"]) || typeof item.episodeId !== "string" || typeof item.compactSummary !== "string" || !isStrings(item.confirmedFacts) || !isStrings(item.hypotheses) || !isStrings(item.people) || !isStrings(item.topics) || !isStrings(item.sourceMessageIds))) throw new Error("invalid_shadow_input_episodes");
}

export type StrictParseResult =
  | { ok: true; output: ComposerShadowOutputV1 }
  | { ok: false; kind: "malformed" | "schema" | "binding"; reason: string };

export const parseComposerShadowOutputV1 = (raw: string, input: ComposerShadowInputV1): StrictParseResult => {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, kind: "malformed", reason: "invalid_json" }; }
  const keys = ["schemaVersion", "turnId", "purpose", "reply", "episodeRef", "groundingRefs", "eventRef"];
  if (!isRecord(value) || !exactKeys(value, keys)) return { ok: false, kind: "schema", reason: "non_exact_keys" };
  if (value.schemaVersion !== COMPOSER_SHADOW_OUTPUT_SCHEMA || typeof value.turnId !== "string" ||
      !PURPOSES.includes(value.purpose as ComposerPurposeV1) || typeof value.reply !== "string" || !value.reply.trim() ||
      !(value.episodeRef === null || typeof value.episodeRef === "string") || !isStrings(value.groundingRefs) ||
      !(value.eventRef === null || typeof value.eventRef === "string")) {
    return { ok: false, kind: "schema", reason: "invalid_field" };
  }
  const groundingIds = new Set(input.assistantGrounding.map((item) => item.canonicalFactId));
  const episodeIds = new Set(input.episodeCandidates.map((item) => item.episodeId));
  if (value.turnId !== input.turnId) return { ok: false, kind: "binding", reason: "turn" };
  if (new Set(value.groundingRefs).size !== value.groundingRefs.length || value.groundingRefs.some((id) => !groundingIds.has(id)))
    return { ok: false, kind: "binding", reason: "grounding" };
  if (value.episodeRef !== null && !episodeIds.has(value.episodeRef)) return { ok: false, kind: "binding", reason: "episode" };
  if (value.eventRef !== null && value.eventRef !== input.activeEvent?.sourceAssistantEventId)
    return { ok: false, kind: "binding", reason: "event" };
  return { ok: true, output: deepFreezeComposerValue(value as ComposerShadowOutputV1) };
};

export type MonotonicClock = { nowMs(): number };

export class IncrementalReplyDecoderV1 {
  private raw = "";
  private decoded = "";
  private replyStart = -1;
  private scan = 0;
  private escaped = false;
  firstReplyCharAt: number | null = null;
  firstSegmentAt: number | null = null;
  segmentCount = 0;

  constructor(private readonly clock: MonotonicClock) {}

  push(chunk: string) {
    this.raw += chunk;
    if (this.replyStart < 0) {
      const start = this.findTopLevelReplyStart();
      if (start < 0) return;
      this.replyStart = start;
      this.scan = this.replyStart;
    }
    for (; this.scan < this.raw.length; this.scan += 1) {
      const char = this.raw[this.scan];
      if (this.escaped) {
        if (char === "u" && this.scan + 4 >= this.raw.length) return;
        const token = this.raw.slice(this.scan - 1, char === "u" ? this.scan + 5 : this.scan + 1);
        try { this.append(JSON.parse(`"${token}"`) as string); } catch { /* final parser owns malformed output */ }
        if (char === "u") this.scan += 4;
        this.escaped = false;
      } else if (char === "\\") {
        this.escaped = true;
      } else if (char === '"') {
        return;
      } else {
        this.append(char);
      }
    }
  }

  private findTopLevelReplyStart() {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let start = -1;
    let expectingKey = false;
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

  finish() {
    if (this.decoded.length > 0 && !/[。！？!?]$/u.test(this.decoded)) {
      this.segmentCount += 1;
      this.firstSegmentAt ??= this.clock.nowMs();
    }
  }

  private append(text: string) {
    for (const char of text) {
      this.decoded += char;
      this.firstReplyCharAt ??= this.clock.nowMs();
      if (/[。！？!?]/u.test(char)) {
        this.segmentCount += 1;
        this.firstSegmentAt ??= this.clock.nowMs();
      }
    }
  }
}

export type ShadowProviderV1 = (request: Readonly<{
  input: ComposerShadowInputV1;
  attempt: 1 | 2;
  priorFailure: string | null;
  signal: AbortSignal;
}>) => Promise<AsyncIterable<string>>;

export type V1ResultSnapshot = Readonly<{
  resultStatus: string;
  committedWinnerHash: string | null;
  committedEdge: "opens" | "fulfills" | "supersedes" | null;
  writeSetHash: string;
}>;

export type ShadowRunResultV1 = Readonly<{
  invocationStatus: "success" | "provider_failed" | "timed_out" | "malformed" | "hard_binding_failed" | "cancelled";
  calls: 1 | 2;
  repairUsed: boolean;
  output: ComposerShadowOutputV1 | null;
  outputHash: string | null;
  timings: Readonly<{
    queueDelayMs: number;
    providerFirstByteMs: number | null;
    firstReplyCharMs: number | null;
    firstCompleteCandidateSegmentMs: number | null;
    totalGenerationMs: number | null;
    strictResultMs: number | null;
    segmentCount: number | null;
  }>;
}>;

const runComposerShadowCoreV1 = async ({ input, provider, clock, timeoutMs = 20_000, externalSignal }: {
  input: ComposerShadowInputV1;
  provider: ShadowProviderV1;
  clock: MonotonicClock;
  timeoutMs?: number;
  externalSignal?: AbortSignal;
}): Promise<ShadowRunResultV1> => {
  assertComposerShadowInputV1(input);
  deepFreezeComposerValue(input);
  const eligibleAt = clock.nowMs();
  let priorFailure: string | null = null;
  let lastTiming: ShadowRunResultV1["timings"] | null = null;
  for (const attempt of [1, 2] as const) {
    const dispatch = clock.nowMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const cancel = () => controller.abort("cancelled");
    externalSignal?.addEventListener("abort", cancel, { once: true });
    if (externalSignal?.aborted) cancel();
    const decoder = new IncrementalReplyDecoderV1(clock);
    let firstByte: number | null = null;
    let done: number | null = null;
    let raw = "";
    try {
      const aborted = () => new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error(String(controller.signal.reason)));
        else controller.signal.addEventListener("abort", () => reject(new Error(String(controller.signal.reason))), { once: true });
      });
      const stream = await Promise.race([provider({ input, attempt, priorFailure, signal: controller.signal }), aborted()]);
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), aborted()]);
        if (next.done) break;
        const chunk = next.value;
        firstByte ??= clock.nowMs();
        raw += chunk;
        decoder.push(chunk);
      }
      done = clock.nowMs();
      decoder.finish();
      const parsed = parseComposerShadowOutputV1(raw, input);
      const parsedAt = clock.nowMs();
      lastTiming = {
        queueDelayMs: dispatch - eligibleAt,
        providerFirstByteMs: firstByte === null ? null : firstByte - dispatch,
        firstReplyCharMs: decoder.firstReplyCharAt === null ? null : decoder.firstReplyCharAt - dispatch,
        firstCompleteCandidateSegmentMs: decoder.firstSegmentAt === null ? null : decoder.firstSegmentAt - dispatch,
        totalGenerationMs: done - dispatch,
        strictResultMs: parsedAt - dispatch,
        segmentCount: decoder.segmentCount,
      };
      if (parsed.ok) return deepFreezeComposerValue({ invocationStatus: "success", calls: attempt, repairUsed: attempt === 2, output: parsed.output, outputHash: hashComposerValue(parsed.output), timings: lastTiming });
      priorFailure = parsed.reason;
      if (attempt === 2) return deepFreezeComposerValue({ invocationStatus: parsed.kind === "binding" ? "hard_binding_failed" : "malformed", calls: 2, repairUsed: true, output: null, outputHash: null, timings: lastTiming });
    } catch {
      const reason = controller.signal.aborted ? String(controller.signal.reason) : "provider_failed";
      return deepFreezeComposerValue({
        invocationStatus: reason === "timeout" ? "timed_out" : reason === "cancelled" ? "cancelled" : "provider_failed",
        calls: attempt, repairUsed: attempt === 2, output: null, outputHash: null,
        timings: lastTiming ?? { queueDelayMs: dispatch - eligibleAt, providerFirstByteMs: null, firstReplyCharMs: null, firstCompleteCandidateSegmentMs: null, totalGenerationMs: null, strictResultMs: null, segmentCount: null },
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", cancel);
    }
  }
  throw new Error("unreachable");
};

export const runComposerShadowV1 = async ({ snapshot, ...request }: {
  snapshot: FrozenV1ObservationSnapshotV1;
  input: ComposerShadowInputV1;
  provider: ShadowProviderV1;
  clock: MonotonicClock;
  timeoutMs?: number;
  externalSignal?: AbortSignal;
}): Promise<ShadowRunResultV1 | null> => {
  assertFrozenV1ObservationSnapshotV1(snapshot);
  const baselineCase = snapshot.baselineCase;
  const expectedInput = buildComposerShadowInputFromSnapshotV1(snapshot, request.input.shadowRunId);
  if (hashComposerValue(request.input) !== hashComposerValue(expectedInput)) {
    throw new Error("baseline_input_binding_mismatch");
  }
  if (baselineCase.expectedSafetyOwnership !== "ordinary") return null;
  return runComposerShadowCoreV1(request);
};

export type ShadowNotInvokedReasonV1 = "safety_owned" | "feature_disabled" | "budget_exhausted" | "invalid_input" | "context_overflow";
export type ShadowEvaluationV1 = Readonly<{ shadow: ShadowRunResultV1 | null; notInvokedReason: ShadowNotInvokedReasonV1 | null }>;
export type ShadowConcurrencyBudgetV1 = { tryAcquire(): (() => void) | null };

export const evaluateComposerShadowCaseV1 = async ({ snapshot, input, enabled, budget, maxInputBytes = 65_536, ...request }: {
  snapshot: FrozenV1ObservationSnapshotV1; input: unknown; enabled: boolean; budget: ShadowConcurrencyBudgetV1; maxInputBytes?: number;
  provider: ShadowProviderV1; clock: MonotonicClock; timeoutMs?: number; externalSignal?: AbortSignal;
}): Promise<ShadowEvaluationV1> => {
  assertFrozenV1ObservationSnapshotV1(snapshot);
  const baselineCase = snapshot.baselineCase;
  try { assertComposerShadowInputV1(input); } catch { return { shadow: null, notInvokedReason: "invalid_input" }; }
  if (hashComposerValue(input) !== hashComposerValue(buildComposerShadowInputFromSnapshotV1(snapshot, input.shadowRunId))) return { shadow: null, notInvokedReason: "invalid_input" };
  if (baselineCase.expectedSafetyOwnership !== "ordinary") return { shadow: null, notInvokedReason: "safety_owned" };
  if (!enabled) return { shadow: null, notInvokedReason: "feature_disabled" };
  if (Buffer.byteLength(JSON.stringify(input)) > maxInputBytes) return { shadow: null, notInvokedReason: "context_overflow" };
  const release = budget.tryAcquire();
  if (!release) return { shadow: null, notInvokedReason: "budget_exhausted" };
  try { return { shadow: await runComposerShadowV1({ snapshot, input, ...request }), notInvokedReason: null }; }
  finally { release(); }
};

export type HashCountObservationV1 = Readonly<{
  schemaVersion: typeof COMPOSER_SHADOW_OBSERVATION_SCHEMA;
  observationId: string;
  createdAt: string;
  runConfigHash: string;
  caseId: string;
  sampleSetVersion: string;
  expectedSafetyOwnership: "safety" | "ordinary";
  eligibility: "eligible" | "ineligible";
  ineligibleReason: "safety_owned" | null;
  notInvokedReason: ShadowNotInvokedReasonV1 | null;
  environment: string;
  revision: string;
  cohortKey: string;
  processTemperature: "cold" | "hot" | "production_unknown";
  conversationIdHash: string | null;
  turnIdHash: string | null;
  inputHash: string;
  inputByteSize: number;
  recentTurnCount: number;
  episodeCandidateCount: number;
  hasActiveEvent: boolean;
  v1SnapshotHash: string;
  shadowStatus: ShadowRunResultV1["invocationStatus"] | "not_invoked";
  calls: number;
  outputHash: string | null;
  replyLength: number | null;
  segmentCount: number | null;
  v1: Readonly<{ resultStatus: string; committedWinnerHash: string | null; failureCategory: string | null; retryable: boolean; blockingQwenCalls: number; plannerAttempts: number; surfaceCandidates: number; serverElapsedMs: number; episodeSelectedIdHash: string | null; committedEdge: V1ResultSnapshot["committedEdge"]; writeSetHash: string }>;
  shadow: Readonly<{ model: string | null; promptVersion: string; calls: number; repairUsed: boolean; promptTokens: null; completionTokens: null; outputHash: string | null; purpose: ComposerPurposeV1 | null; replyLength: number | null; episodeRefHash: string | null; groundingRefIds: readonly string[]; eventRefHash: string | null; schemaValid: boolean; turnBindingValid: boolean; groundingRefsValid: boolean; episodeRefValid: boolean; eventRefValid: boolean; timings: ShadowRunResultV1["timings"] | null }>;
  qualityAnnotations: Readonly<{ evaluatorVersion: null; willingToReply: null; selfUnderstandingIncrement: null; autonomyPreserved: null; unsupportedPsychologizing: null; historicalCausalityOverstated: null; notesCode: readonly string[] }>;
  isolation: FrozenV1ObservationSnapshotV1["isolation"];
}>;

export class InMemoryHashCountObservationSinkV1 {
  private readonly rows: HashCountObservationV1[] = [];
  append(row: HashCountObservationV1) { this.rows.push(deepFreezeComposerValue({ ...row })); }
  all(): readonly HashCountObservationV1[] { return deepFreezeComposerValue([...this.rows]); }
}

export const buildHashCountObservationV1 = ({ observationId, runConfigHash, snapshot, input, shadow, notInvokedReason = snapshot.baselineCase.expectedSafetyOwnership === "safety" ? "safety_owned" : null, environment = "local_eval", revision = "unknown", processTemperature = "production_unknown", model = null, createdAt = "1970-01-01T00:00:00.000Z" }: {
  observationId: string; runConfigHash: string; snapshot: FrozenV1ObservationSnapshotV1; input: unknown;
  shadow: ShadowRunResultV1 | null; notInvokedReason?: ShadowNotInvokedReasonV1 | null; environment?: string; revision?: string; processTemperature?: "cold" | "hot" | "production_unknown"; model?: string | null; createdAt?: string;
}): HashCountObservationV1 => {
  assertFrozenV1ObservationSnapshotV1(snapshot);
  const baselineCase = snapshot.baselineCase;
  const v1 = snapshot.execution;
  if (baselineCase.expectedSafetyOwnership === "safety" && shadow !== null) throw new Error("safety_owned_shadow_forbidden");
  if (notInvokedReason !== null && shadow !== null) throw new Error("not_invoked_shadow_forbidden");
  const validInput = (() => { try { assertComposerShadowInputV1(input); return input; } catch { return null; } })();
  if (notInvokedReason !== "invalid_input") {
    if (!validInput || hashComposerValue(validInput) !== hashComposerValue(buildComposerShadowInputFromSnapshotV1(snapshot, validInput.shadowRunId))) throw new Error("observation_snapshot_input_binding_mismatch");
  }
  return deepFreezeComposerValue({
  schemaVersion: COMPOSER_SHADOW_OBSERVATION_SCHEMA,
  observationId, createdAt, runConfigHash, caseId: baselineCase.caseId, sampleSetVersion: baselineCase.sampleSetVersion,
  expectedSafetyOwnership: baselineCase.expectedSafetyOwnership,
  eligibility: baselineCase.expectedSafetyOwnership === "ordinary" ? "eligible" : "ineligible",
  ineligibleReason: baselineCase.expectedSafetyOwnership === "safety" ? "safety_owned" : null,
  notInvokedReason, environment, revision, cohortKey: `${baselineCase.sampleSetVersion}:${baselineCase.category}`, processTemperature,
  conversationIdHash: validInput?.conversationIdHash ?? null, turnIdHash: validInput ? hashComposerValue(validInput.turnId) : null,
  inputHash: hashComposerValue(input), inputByteSize: Buffer.byteLength(JSON.stringify(input)),
  recentTurnCount: validInput?.recentCommittedTurns.length ?? 0, episodeCandidateCount: validInput?.episodeCandidates.length ?? 0, hasActiveEvent: validInput?.activeEvent !== null && validInput !== null,
  v1SnapshotHash: hashComposerValue(v1), shadowStatus: shadow?.invocationStatus ?? "not_invoked",
  calls: shadow?.calls ?? 0, outputHash: shadow?.outputHash ?? null,
  replyLength: shadow?.output?.reply.length ?? (baselineCase.expectedSafetyOwnership === "safety" ? 0 : null), segmentCount: shadow?.timings.segmentCount ?? null,
  v1: { resultStatus: v1.resultStatus, committedWinnerHash: v1.committedWinnerHash, failureCategory: v1.failureCategory, retryable: v1.retryable, blockingQwenCalls: v1.blockingQwenCalls, plannerAttempts: v1.plannerAttempts, surfaceCandidates: v1.surfaceCandidates, serverElapsedMs: v1.serverElapsedMs, episodeSelectedIdHash: v1.episodeSelectedIdHash, committedEdge: v1.committedEdge, writeSetHash: v1.writeSetHash },
  shadow: { model: model ? hashComposerValue(model) : null, promptVersion: "composer_shadow_prompt_v1", calls: shadow?.calls ?? 0, repairUsed: shadow?.repairUsed ?? false, promptTokens: null, completionTokens: null, outputHash: shadow?.outputHash ?? null, purpose: shadow?.output?.purpose ?? null, replyLength: shadow?.output?.reply.length ?? (baselineCase.expectedSafetyOwnership === "safety" ? 0 : null), episodeRefHash: shadow?.output?.episodeRef ? hashComposerValue(shadow.output.episodeRef) : null, groundingRefIds: shadow?.output?.groundingRefs.map(hashComposerValue) ?? [], eventRefHash: shadow?.output?.eventRef ? hashComposerValue(shadow.output.eventRef) : null, schemaValid: shadow?.invocationStatus === "success", turnBindingValid: shadow?.invocationStatus === "success", groundingRefsValid: shadow?.invocationStatus === "success", episodeRefValid: shadow?.invocationStatus === "success", eventRefValid: shadow?.invocationStatus === "success", timings: shadow?.timings ?? null },
  qualityAnnotations: { evaluatorVersion: null, willingToReply: null, selfUnderstandingIncrement: null, autonomyPreserved: null, unsupportedPsychologizing: null, historicalCausalityOverstated: null, notesCode: [] },
  isolation: snapshot.isolation,
  });
};

export const buildPairedDeterministicReportV1 = (ledger: ComposerObservationLedgerAuthorityResultV1) => {
  assertComposerObservationLedgerAuthorityResultV1(ledger);
  return JSON.stringify({
    schemaVersion: "composer_shadow_paired_report_v1",
    ledgerAuthorityVersion: ledger.authorityVersion,
    ledgerHash: ledger.ledgerHash,
    runConfigHash: ledger.runConfigHash,
    observationCount: ledger.observationCount,
    caseCoverage: ledger.caseCoverage,
    behaviorStability: ledger.behaviorStability,
    eventIsolation: ledger.eventIsolation,
    blindReview: ledger.blindReview,
    latencyCalibration: ledger.latencyCalibration,
    p1ExitStatus: ledger.p1ExitStatus,
  }, null, 2);
};
