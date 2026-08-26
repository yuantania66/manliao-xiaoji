import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildProactiveGreetingAssistantMoveEnvelope } from "../conversation-os";
import { buildComposerShadowInputFromSnapshotV1, hashComposerValue, parseComposerShadowOutputV1, runComposerShadowV1, type BaselineCaseV1, type ShadowProviderV1 } from "../lib/composer-shadow-v1";
import { COMPOSER_HUMAN_BLIND_MAP_PATH, COMPOSER_HUMAN_BLIND_PACK_PATH, COMPOSER_HUMAN_BLIND_RATINGS_PATH, COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION, COMPOSER_HUMAN_BLIND_REVIEW_DEFINITION_HASH, hashHumanBlindValue } from "../lib/composer-human-blind-review-authority";
import { createFrozenV1ObservationSnapshotV1, hashFrozenObservationValue } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import type { SafetySemanticProvider } from "../services/ai/chatSafety";
import type { AiConversationMessage } from "../services/ai/types";
import { buildComposerOutputSchemaPromptV1, COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1 } from "./composer-shadow-qwen-local";
import { SYNTHETIC_BASELINE_CASES_V1, SYNTHETIC_BASELINE_SAMPLE_HASH } from "./hot-cold-p0-frozen-replay";

const OFFICIAL_PROVIDER_ORIGIN = "https://dashscope.aliyuncs.com";
const ORDINARY = SYNTHETIC_BASELINE_CASES_V1.filter((item) => item.expectedSafetyOwnership === "ordinary");
const MODEL = "qwen3.7-max";
export const HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1 = Object.freeze({ version: "human_review_repair_context_projection_v1", caseId: "ordinary-repair", priorAssistant: Object.freeze({ id: "ordinary-repair:synthetic-prior-assistant", role: "assistant" as const, text: "我刚才把你说的理解成生活里的事。" }) });
export const HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_HASH_V1 = "sha256:d8489182eaae3917b1bde849a4cd6d05a6b093cc38756ab4f9e8109b306f6ed5";
assert.equal(hashComposerValue(HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1), HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_HASH_V1);
export const HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1 = Object.freeze({ version: "human_blind_ordinary_no_risk_safety_fixture_v1", decision: Object.freeze({ schemaVersion: 1 as const, riskLevel: "none" as const, categories: Object.freeze([]), currentness: "current" as const, evidence: Object.freeze([]), requiresSafetyResponse: false as const }) });
export const HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1 = "sha256:75eefcfc5afabbf863837bff82ffcbb3d371c6e3b9166a6bf68e88f728040556";
assert.equal(hashComposerValue(HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1), HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1);
const ordinaryNoRiskSafetyProvider: SafetySemanticProvider = async () => JSON.stringify(HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1.decision);

const snapshotFor = (caseId: string) => createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId, fixtureOwner: "explicit_local_v1_fixture", executionOutcome: createV1ExecutionOutcomeIntegrityResultV1({ resultStatus: "COMMITTED", committedWinnerHash: hashFrozenObservationValue(`human-blind-v1:${caseId}`), failureCategory: null, retryable: false, blockingQwenCalls: 1, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 1, episodeSelectedIdHash: null, committedEdge: null, writeSetHash: hashFrozenObservationValue(`human-blind-write:${caseId}`) }) });

export const buildExactV1BlindInputV1 = (item: BaselineCaseV1, slot: 1 | 2 | 3) => {
  assert.equal(item.expectedSafetyOwnership, "ordinary");
  const recentMessages: AiConversationMessage[] = item.recentCommittedTurns.map((turn, index) => ({ id: `${item.caseId}:recent:${index}`, role: turn.role, content: turn.text, status: "saved" }));
  if (item.caseId === HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.caseId) recentMessages.push({ id: HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.priorAssistant.id, role: "assistant", content: HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.priorAssistant.text, status: "saved" });
  if (item.activeCommittedEventProjection) {
    assert.equal(recentMessages.length, 0, "active-event fixture cannot silently replace recent turns");
    const event = item.activeCommittedEventProjection;
    recentMessages.push({ id: event.sourceAssistantEventId, role: "assistant", content: event.purpose ?? "我们可以接着聊。", status: "saved", interactionMoveEnvelope: buildProactiveGreetingAssistantMoveEnvelope({ assistantMoveId: event.sourceAssistantEventId, generationId: `${item.caseId}:synthetic-generation`, intent: { move: "open_statement", requiredFunction: "offer_self_contained_conversation_entry", realization: { kind: "self_contained_entry", topic: "synthetic-context", proposition: event.purpose ?? "我们可以接着聊。" }, expectedUserContribution: "none", userBurden: "none" } }) });
  }
  const input = { conversationId: `composer-human-blind:${item.caseId}:${slot}`, currentTurnId: `${item.caseId}:slot:${slot}`, requestId: `${item.caseId}:slot:${slot}:request`, userId: "composer-human-blind-synthetic-user", userMessage: item.currentUserTurn, recentMessages, episodeMemoryCandidates: item.episodeCandidatesSnapshot.map((episode) => ({ semanticMemoryId: episode.episodeId, sessionId: `${item.caseId}:synthetic-session`, summary: episode.compactSummary, confirmedFacts: [...(episode.confirmedFacts ?? [])], hypotheses: [...(episode.hypotheses ?? [])], people: [...(episode.people ?? [])], topics: [...(episode.topics ?? [])], sourceMessageIds: [...(episode.sourceMessageIds ?? [])], emotions: [], openThreads: [], occurredAt: "2000-01-01T00:00:00.000Z", relevanceScore: 1, matchedDimensions: ["text" as const] })), safetySemanticProvider: ordinaryNoRiskSafetyProvider, includeDebugTrace: false } as const;
  return Object.freeze({ input, bindingHash: hashComposerValue({ baselineCase: item, slot, safetyFixtureVersion: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1.version, safetyFixtureHash: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1, input: { ...input, safetySemanticProvider: "frozen_ordinary_no_risk_fixture" } }) });
};

export const assertRepairPairedContextExactV1 = (v1Context: readonly Readonly<{ messageId: string; role: string; text: string }>[], composerContext: readonly Readonly<{ messageId: string; role: string; text: string }>[]) => assert.deepEqual(v1Context, composerContext, "repair paired context mismatch");

export const buildPairedHumanReviewContextV1 = (item: BaselineCaseV1, slot: 1 | 2 | 3) => {
  const snapshot = snapshotFor(item.caseId);
  const v1 = buildExactV1BlindInputV1(item, slot);
  const baseComposer = buildComposerShadowInputFromSnapshotV1(snapshot, hashComposerValue({ humanBlind: item.caseId, slot }));
  const composer = item.caseId === HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.caseId
    ? Object.freeze({ ...baseComposer, recentCommittedTurns: Object.freeze([{ messageId: HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.priorAssistant.id, role: "assistant" as const, text: HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.priorAssistant.text, replyToMessageId: null }]) })
    : baseComposer;
  const v1Context = v1.input.recentMessages.map(({ id, role, content }) => ({ messageId: id!, role, text: content }));
  const composerContext = composer.recentCommittedTurns.map(({ messageId, role, text }) => ({ messageId, role, text }));
  if (item.caseId === HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.caseId) assertRepairPairedContextExactV1(v1Context, composerContext);
  return Object.freeze({ snapshot, v1, composer, pairedContextCommitment: hashComposerValue({ caseId: item.caseId, slot, currentUserTurn: item.currentUserTurn, recentContext: composerContext, projectionVersion: item.caseId === "ordinary-repair" ? HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.version : null, projectionHash: item.caseId === "ordinary-repair" ? HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_HASH_V1 : null, safetyFixtureVersion: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1.version, safetyFixtureHash: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1 }) });
};

const composerProvider = (apiKey: string, baseUrl: string, model: string): ShadowProviderV1 => async ({ input, attempt, priorFailure, signal }) => {
  const prompt = buildComposerOutputSchemaPromptV1({ input, attempt, priorFailure });
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, { method: "POST", signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Request-Tag": "composer-human-blind-local-synthetic-v1" }, body: JSON.stringify({ model, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], temperature: 0, stream: false, enable_thinking: false, response_format: { type: "json_object" } }) });
  if (!response.ok) throw new Error(`human_blind_qwen_status_${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("human_blind_qwen_empty");
  return { async *[Symbol.asyncIterator]() { yield content; } };
};

type CandidatePair = Readonly<{ item: BaselineCaseV1; slot: 1 | 2 | 3; v1: string; composer: string; recentContext: readonly Readonly<{ messageId: string; role: "user" | "assistant"; text: string }>[]; pairedContextCommitment: string }>;
const buildArtifacts = (pairs: readonly CandidatePair[], reviewerId: string, evidenceSource: "direct_official_provider_execution" | "injected_mock", seed = randomBytes(32).toString("hex")) => {
  assert.equal(pairs.length, 36); assert.equal(new Set(pairs.map(({ item, slot }) => `${item.caseId}:${slot}`)).size, 36);
  const reviewerIdHash = hashHumanBlindValue(`human-reviewer:${reviewerId}`);
  const randomizationCommitmentHash = hashHumanBlindValue(seed);
  const mapRows = pairs.map((pair, index) => {
    const blindId = `blind-${String(index + 1).padStart(2, "0")}`;
    const candidateASource = Number.parseInt(hashHumanBlindValue(`${seed}:${blindId}`).slice(-2), 16) % 2 === 0 ? "v1" as const : "composer" as const;
    return { blindId, candidateASource, candidateBSource: candidateASource === "v1" ? "composer" as const : "v1" as const };
  });
  const rows = pairs.map((pair, index) => {
    const map = mapRows[index]; const a = map.candidateASource === "v1" ? pair.v1 : pair.composer; const b = map.candidateBSource === "v1" ? pair.v1 : pair.composer;
    return { blindId: map.blindId, caseId: pair.item.caseId, slot: pair.slot, pairedContextCommitment: pair.pairedContextCommitment, syntheticContext: { currentUserTurn: pair.item.currentUserTurn, recentCommittedTurns: pair.recentContext }, candidateA: a, candidateB: b, candidateAHash: hashHumanBlindValue(a), candidateBHash: hashHumanBlindValue(b) };
  });
  const v1RunConfigHash = hashComposerValue({ authority: COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION, side: "current_v1_createChatReply", sampleSetHash: SYNTHETIC_BASELINE_SAMPLE_HASH, model: MODEL, safetyFixtureVersion: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1.version, safetyFixtureHash: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1 });
  const composerRunConfigHash = hashComposerValue({ authority: COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION, side: "frozen_composer", sampleSetHash: SYNTHETIC_BASELINE_SAMPLE_HASH, model: MODEL, promptHash: COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1 });
  const packBody = { schemaVersion: "composer_human_blind_pack_v1", authorityVersion: COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION, definitionHash: COMPOSER_HUMAN_BLIND_REVIEW_DEFINITION_HASH, evidenceSource, sampleSetHash: SYNTHETIC_BASELINE_SAMPLE_HASH, safetyFixtureVersion: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1.version, safetyFixtureHash: HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1, v1RunConfigHash, composerRunConfigHash, reviewerIdHash, randomizationCommitmentHash, pairCount: 36, rows };
  const pack = { ...packBody, packHash: hashHumanBlindValue(packBody) };
  const map = { schemaVersion: "composer_human_blind_unblinding_map_v1", packHash: pack.packHash, randomSeed: seed, randomizationCommitmentHash, rows: mapRows };
  const ratings = { schemaVersion: "composer_human_blind_ratings_v1", packHash: pack.packHash, reviewerIdHash, sealed: false, rows: rows.map(({ blindId }) => ({ blindId, candidateA: null, candidateB: null })), ratingsHash: null };
  const authorization = { schemaVersion: "composer_human_reviewer_authorization_v1", packHash: pack.packHash, reviewerIdHash, humanConfirmed: false };
  return { pack, map, ratings, authorization };
};

const runReal = async (apiKey: string, baseUrl: string, reviewerId: string) => {
  assert.equal(new URL(baseUrl).origin, OFFICIAL_PROVIDER_ORIGIN); assert.equal(ORDINARY.length, 12);
  const pairs: CandidatePair[] = [];
  for (const item of ORDINARY) for (const slot of [1, 2, 3] as const) {
    const paired = buildPairedHumanReviewContextV1(item, slot);
    const v1 = await createChatReply(paired.v1.input);
    assert(v1.generation.text.trim(), `V1 empty: ${item.caseId}:${slot}`);
    let composerReply: string;
    if (item.caseId === HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.caseId) {
      let priorFailure: string | null = null; let parsedReply: string | null = null;
      for (const attempt of [1, 2] as const) {
        const stream = await composerProvider(apiKey, baseUrl, MODEL)({ input: paired.composer, attempt, priorFailure, signal: new AbortController().signal }); let raw = ""; for await (const chunk of stream) raw += chunk;
        const parsed = parseComposerShadowOutputV1(raw, paired.composer); if (parsed.ok) { parsedReply = parsed.output.reply; break; } priorFailure = parsed.reason;
      }
      assert(parsedReply, `Projected Composer failed: ${item.caseId}:${slot}`); composerReply = parsedReply;
    } else {
      const shadow = await runComposerShadowV1({ snapshot: paired.snapshot, input: paired.composer, clock: { nowMs: () => performance.now() }, provider: composerProvider(apiKey, baseUrl, MODEL) });
      assert(shadow?.invocationStatus === "success" && shadow.output?.reply, `Composer failed: ${item.caseId}:${slot}`); composerReply = shadow.output.reply;
    }
    pairs.push({ item, slot, v1: v1.generation.text, composer: composerReply, recentContext: paired.composer.recentCommittedTurns.map(({ messageId, role, text }) => ({ messageId, role, text })), pairedContextCommitment: paired.pairedContextCommitment });
  }
  return buildArtifacts(pairs, reviewerId, "direct_official_provider_execution");
};

const runMock = (reviewerId: string) => buildArtifacts(ORDINARY.flatMap((item) => ([1, 2, 3] as const).map((slot) => { const paired = buildPairedHumanReviewContextV1(item, slot); return { item, slot, v1: `V1 synthetic ${item.caseId} ${slot}`, composer: `Composer synthetic ${item.caseId} ${slot}`, recentContext: paired.composer.recentCommittedTurns.map(({ messageId, role, text }) => ({ messageId, role, text })), pairedContextCommitment: paired.pairedContextCommitment }; })), reviewerId, "injected_mock", "00".repeat(32));

const diagnoseV1Execution = async () => {
  assert.equal(process.env.COMPOSER_SHADOW_SYNTHETIC_ONLY, "true");
  const slotValue = Number(process.env.COMPOSER_HUMAN_DIAGNOSTIC_SLOT ?? "2");
  assert(slotValue === 1 || slotValue === 2 || slotValue === 3, "COMPOSER_HUMAN_DIAGNOSTIC_SLOT must be 1, 2, or 3");
  const slot = slotValue as 1 | 2 | 3;
  const caseId = process.env.COMPOSER_HUMAN_DIAGNOSTIC_CASE_ID?.trim() || HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.caseId;
  const item = ORDINARY.find((candidate) => candidate.caseId === caseId);
  assert(item, "COMPOSER_HUMAN_DIAGNOSTIC_CASE_ID must name a frozen ordinary case");
  const paired = buildPairedHumanReviewContextV1(item, slot);
  const stages: string[] = [];
  const providerStatuses: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    providerStatuses.push(response.status);
    return response;
  };
  let result: Awaited<ReturnType<typeof createChatReply>>;
  try {
    result = await createChatReply({
      ...paired.v1.input,
      inspectExternalPrompt: ({ stage }) => { stages.push(stage); },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const plan = result.controlTrace?.responsePlan;
  const validations = result.controlTrace?.validation ?? [];
  console.log(JSON.stringify({
    schemaVersion: "v1_synthetic_execution_boundary_diagnostic_v1",
    caseId: item.caseId,
    slot,
    projectionVersion: HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.version,
    projectionHash: HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_HASH_V1,
    pairedContextCommitment: paired.pairedContextCommitment,
    finalSource: result.finalSource,
    executionPhase: result.execution.phase,
    failureCode: result.execution.failure?.code ?? null,
    retryable: result.execution.failure?.retryable ?? null,
    generationAttemptCount: result.generationAttempts.length,
    executionAttemptCount: result.execution.attempts.length,
    planIdHash: plan ? hashComposerValue(plan.planId) : null,
    executionPlanIdHash: result.execution.planId ? hashComposerValue(result.execution.planId) : null,
    planPreflightPassed: result.execution.planPreflight.passed,
    planPreflightFailureCount: result.execution.planPreflight.failureReasons.length,
    validationCount: validations.length,
    hardFailureCount: validations.at(-1)?.hardFailureReasons?.length ?? 0,
    advisoryFailureCount: validations.at(-1)?.advisoryFailureReasons?.length ?? 0,
    externalStages: stages,
    providerStatuses,
    outputPresent: result.generation.text.trim().length > 0,
    plaintextIncluded: false,
  }));
};

const main = async () => {
  const mode = process.argv[2]; assert(["--check-mechanism", "--allow-synthetic-qwen-human-blind", "--diagnose-v1-execution", "--authorize-human-reviewer", "--seal-human-ratings"].includes(mode));
  if (mode === "--diagnose-v1-execution") { await diagnoseV1Execution(); return; }
  if (mode === "--authorize-human-reviewer") {
    const authorization = JSON.parse(readFileSync(COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, "utf8")) as Record<string, unknown>;
    assert.equal(authorization.humanConfirmed, false, "reviewer authorization must start unconfirmed");
    writeFileSync(COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, JSON.stringify({ ...authorization, humanConfirmed: true }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: "human_reviewer_authorized_by_explicit_cli_action" })); return;
  }
  if (mode === "--seal-human-ratings") {
    const ratings = JSON.parse(readFileSync(COMPOSER_HUMAN_BLIND_RATINGS_PATH, "utf8")) as Record<string, unknown>;
    assert.equal(ratings.sealed, false, "ratings already sealed");
    const body: Record<string, unknown> = { ...ratings, sealed: true }; delete body.ratingsHash;
    assert(Array.isArray(body.rows) && body.rows.length === 36 && body.rows.every((row: unknown) => typeof row === "object" && row !== null && (row as { candidateA?: unknown }).candidateA !== null && (row as { candidateB?: unknown }).candidateB !== null), "all 36 human ratings must be filled before sealing");
    writeFileSync(COMPOSER_HUMAN_BLIND_RATINGS_PATH, JSON.stringify({ ...body, ratingsHash: hashHumanBlindValue(body) }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: "human_ratings_sealed" })); return;
  }
  const reviewerId = process.env.COMPOSER_HUMAN_REVIEWER_ID?.trim(); assert(reviewerId, "COMPOSER_HUMAN_REVIEWER_ID is required and must identify the user-authorized human.");
  const artifacts = mode === "--check-mechanism" ? runMock(reviewerId) : await (async () => {
    assert.equal(process.env.COMPOSER_SHADOW_SYNTHETIC_ONLY, "true"); const apiKey = process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim(); const baseUrl = process.env.QWEN_BASE_URL?.trim() || process.env.DASHSCOPE_BASE_URL?.trim(); assert(apiKey && baseUrl); return runReal(apiKey, baseUrl, reviewerId);
  })();
  writeFileSync(COMPOSER_HUMAN_BLIND_PACK_PATH, JSON.stringify(artifacts.pack, null, 2), { mode: 0o600 });
  writeFileSync(COMPOSER_HUMAN_BLIND_MAP_PATH, JSON.stringify(artifacts.map, null, 2), { mode: 0o600 });
  writeFileSync(COMPOSER_HUMAN_BLIND_RATINGS_PATH, JSON.stringify(artifacts.ratings, null, 2), { mode: 0o600 });
  writeFileSync(COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, JSON.stringify(artifacts.authorization, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "pack_created", pairCount: 36, packHash: artifacts.pack.packHash, readableArtifactRetention: "delete_after_seal_or_within_30_days", humanReviewStatus: "pending_explicit_reviewer_authorization_and_scoring" }));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
