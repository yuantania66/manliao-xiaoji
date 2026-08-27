import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { assertComposerHumanBlindReviewResultV1, COMPOSER_HUMAN_BLIND_MAP_PATH, COMPOSER_HUMAN_BLIND_PACK_PATH, COMPOSER_HUMAN_BLIND_RATINGS_PATH, COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, createComposerHumanBlindReviewResultV1, hashHumanBlindValue } from "../lib/composer-human-blind-review-authority";
import { detectAssistantCorrection } from "../conversation-os/control/repairSignal";
import { triageSafety } from "../services/ai/chatSafety";
import { assertRepairPairedContextExactV1, buildExactV1BlindInputV1, buildPairedHumanReviewContextV1, HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1, HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1, HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_HASH_V1, HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1 } from "./composer-human-blind-pack-local";
import { SYNTHETIC_BASELINE_CASES_V1 } from "./hot-cold-p0-frozen-replay";

const artifactPaths = [COMPOSER_HUMAN_BLIND_PACK_PATH, COMPOSER_HUMAN_BLIND_MAP_PATH, COMPOSER_HUMAN_BLIND_RATINGS_PATH, COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH] as const;
const originalArtifacts = artifactPaths.map((path) => existsSync(path) ? { path, bytes: readFileSync(path), mode: statSync(path).mode & 0o777 } : { path, bytes: null, mode: 0o600 });
process.on("exit", () => {
  for (const artifact of originalArtifacts) {
    if (artifact.bytes === null) rmSync(artifact.path, { force: true });
    else writeFileSync(artifact.path, artifact.bytes, { mode: artifact.mode });
  }
});

const generated = spawnSync(process.execPath, ["--import", "tsx", "scripts/composer-human-blind-pack-local.ts", "--check-mechanism"], { cwd: process.cwd(), env: { ...process.env, COMPOSER_HUMAN_REVIEWER_ID: "user-authorized-human-reviewer" }, encoding: "utf8" });
assert.equal(generated.status, 0, generated.stderr);
const pack = JSON.parse(readFileSync(COMPOSER_HUMAN_BLIND_PACK_PATH, "utf8"));
const map = JSON.parse(readFileSync(COMPOSER_HUMAN_BLIND_MAP_PATH, "utf8"));
const authorization = JSON.parse(readFileSync(COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, "utf8"));
assert.equal(authorization.humanConfirmed, false);
authorization.humanConfirmed = true;
writeFileSync(COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH, JSON.stringify(authorization));
assert.equal(pack.rows.length, 36); assert.equal(map.rows.length, 36);
assert(pack.rows.every((row: Record<string, unknown>) => !Object.hasOwn(row, "candidateASource") && !Object.hasOwn(row, "candidateBSource")));
assert.equal(new Set(pack.rows.map((row: { caseId: string; slot: number }) => `${row.caseId}:${row.slot}`)).size, 36);

const active = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === "ordinary-active-event")!;
const activeInput = buildExactV1BlindInputV1(active, 1);
assert.equal(activeInput.input.recentMessages.length, 1);
assert.equal(activeInput.input.recentMessages[0].id, active.activeCommittedEventProjection!.sourceAssistantEventId);
assert(activeInput.input.recentMessages[0].interactionMoveEnvelope);
const episode = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === "ordinary-episode-hit")!;
assert.deepEqual(buildExactV1BlindInputV1(episode, 1).input.episodeMemoryCandidates, episode.episodeCandidatesSnapshot.map((item) => ({ semanticMemoryId: item.episodeId, sessionId: `${episode.caseId}:synthetic-session`, summary: item.compactSummary, confirmedFacts: [], hypotheses: [], people: [], topics: [], sourceMessageIds: [], emotions: [], openThreads: [], occurredAt: "2000-01-01T00:00:00.000Z", relevanceScore: 1, matchedDimensions: ["text"] })));
assert.equal(hashHumanBlindValue(HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1), HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_HASH_V1);
const repairCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === "ordinary-repair")!;
assert.equal(repairCase.recentCommittedTurns.length, 0, "original frozen case must remain unchanged");
const repairPair = buildPairedHumanReviewContextV1(repairCase, 1);
const repairV1Context = repairPair.v1.input.recentMessages.map(({ id, role, content }) => ({ messageId: id!, role, text: content }));
const repairComposerContext = repairPair.composer.recentCommittedTurns.map(({ messageId, role, text }) => ({ messageId, role, text }));
assertRepairPairedContextExactV1(repairV1Context, repairComposerContext);
assert.throws(() => assertRepairPairedContextExactV1(repairV1Context, []));
assert.throws(() => assertRepairPairedContextExactV1(repairV1Context, [{ ...repairComposerContext[0], text: "changed on one side" }]));
const correction = detectAssistantCorrection({ text: repairCase.currentUserTurn, adjacentTurns: repairPair.v1.input.recentMessages.map(({ id, role, content, status, interactionMoveEnvelope }) => { assert(role === "user" || role === "assistant"); return { id, role, content, status, interactionMoveEnvelope }; }) });
assert(correction); assert.equal(correction.targetTurnId, HUMAN_REVIEW_REPAIR_CONTEXT_PROJECTION_V1.priorAssistant.id);
assert.equal(hashHumanBlindValue(HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1), HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_HASH_V1);
const ordinaryCases = SYNTHETIC_BASELINE_CASES_V1.filter((item) => item.expectedSafetyOwnership === "ordinary");
const ordinaryProviders = ordinaryCases.flatMap((item) => ([1, 2, 3] as const).map((slot) => buildExactV1BlindInputV1(item, slot).input.safetySemanticProvider));
assert.equal(ordinaryProviders.length, 36); assert(ordinaryProviders.every((provider) => provider === ordinaryProviders[0]));
const safetyCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.expectedSafetyOwnership === "safety")!;
assert.throws(() => buildExactV1BlindInputV1(safetyCase, 1));
const checkSafetyFixture = async () => {
  assert.deepEqual(JSON.parse(await ordinaryProviders[0]({ messages: [], attempt: 1, previousFailure: null }) as string), HUMAN_BLIND_ORDINARY_SAFETY_FIXTURE_V1.decision);
  const malformedSafety = await triageSafety({ currentUserMessage: "ordinary synthetic input", recentMessages: [], provider: async () => "{}" });
  assert.equal(malformedSafety.status, "blocked");
  if (malformedSafety.status === "blocked") { assert.equal(malformedSafety.failureType, "invalid_output"); assert.equal(malformedSafety.attempts, 2); }
};

const filledBody = { schemaVersion: "composer_human_blind_ratings_v1", packHash: pack.packHash, reviewerIdHash: pack.reviewerIdHash, sealed: true, rows: pack.rows.map((row: { blindId: string }) => ({ blindId: row.blindId, candidateA: { willingToReply: 4, selfUnderstandingIncrement: 3, autonomyPreserved: 5, unsupportedPsychologizing: false, historicalCausalityOverstated: false }, candidateB: { willingToReply: 3, selfUnderstandingIncrement: 4, autonomyPreserved: 4, unsupportedPsychologizing: false, historicalCausalityOverstated: false } })) };
const validRatings = { ...filledBody, ratingsHash: hashHumanBlindValue(filledBody) };
writeFileSync(COMPOSER_HUMAN_BLIND_RATINGS_PATH, JSON.stringify(validRatings, null, 2), { mode: 0o600 });
const result = createComposerHumanBlindReviewResultV1();
assertComposerHumanBlindReviewResultV1(result);
assert.equal(result.evidenceSource, "injected_mock"); assert.equal(result.reviewStatus, "pending"); assert.equal(result.gateUpgrades.human, "unchanged_pending"); assert.equal(result.thresholdPolicy, "none_report_only"); assert.equal(result.gateUpgrades.p1Overall, "unchanged_pending");
assert(!JSON.stringify(result).includes("V1 synthetic") && !JSON.stringify(result).includes("Composer synthetic"));

type MutableRecord = Record<string, unknown>;
const rejects = (mutate: (ratings: MutableRecord, packValue: MutableRecord, mapValue: MutableRecord) => void) => {
  const r = structuredClone(validRatings); const p = structuredClone(pack); const m = structuredClone(map); mutate(r, p, m);
  writeFileSync(COMPOSER_HUMAN_BLIND_RATINGS_PATH, JSON.stringify(r)); writeFileSync(COMPOSER_HUMAN_BLIND_PACK_PATH, JSON.stringify(p)); writeFileSync(COMPOSER_HUMAN_BLIND_MAP_PATH, JSON.stringify(m));
  assert.throws(() => createComposerHumanBlindReviewResultV1());
  writeFileSync(COMPOSER_HUMAN_BLIND_RATINGS_PATH, JSON.stringify(validRatings)); writeFileSync(COMPOSER_HUMAN_BLIND_PACK_PATH, JSON.stringify(pack)); writeFileSync(COMPOSER_HUMAN_BLIND_MAP_PATH, JSON.stringify(map));
};
rejects((ratings) => { (ratings.rows as unknown[]).pop(); ratings.ratingsHash = "sha256:" + "0".repeat(64); });
rejects((ratings) => { (((ratings.rows as MutableRecord[])[0].candidateA) as MutableRecord).notes = "caller supplied free text"; const { ratingsHash: ignored, ...body } = ratings; void ignored; ratings.ratingsHash = hashHumanBlindValue(body); });
rejects((ratings) => { (((ratings.rows as MutableRecord[])[0].candidateA) as MutableRecord).willingToReply = 6; const { ratingsHash: ignored, ...body } = ratings; void ignored; ratings.ratingsHash = hashHumanBlindValue(body); });
rejects((_ratings, packValue) => { (packValue.rows as MutableRecord[])[0].candidateA = "tampered"; const { packHash: ignored, ...body } = packValue; void ignored; packValue.packHash = hashHumanBlindValue(body); });
rejects((_ratings, _packValue, mapValue) => { const row = (mapValue.rows as MutableRecord[])[0]; row.candidateASource = row.candidateBSource; });

void checkSafetyFixture().then(() => console.log("composer-human-blind-review-authority-check: PASS (36 pairs, frozen ordinary Safety fixture, exact V1 adapter, sealed five-dimension ratings, tamper fail-closed, no plaintext result)"));
