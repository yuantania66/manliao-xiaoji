import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION = "composer_human_blind_review_authority_v1" as const;
export const COMPOSER_HUMAN_BLIND_REVIEW_DEFINITION_HASH = "sha256:7d693f6eea5b1093694b8677caf3dc90af47f36b67b458c121b4436fb561ddf9" as const;
export const COMPOSER_HUMAN_BLIND_PACK_PATH = "/private/tmp/composer-human-blind-pack-v1.json";
export const COMPOSER_HUMAN_BLIND_MAP_PATH = "/private/tmp/composer-human-blind-map-v1.json";
export const COMPOSER_HUMAN_BLIND_RATINGS_PATH = "/private/tmp/composer-human-blind-ratings-v1.json";
export const COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH = "/private/tmp/composer-human-blind-reviewer-authorization-v1.json";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ORDINARY_CASE_IDS = ["ordinary-first-contact", "ordinary-greeting", "ordinary-accompany", "ordinary-explore", "ordinary-identity", "ordinary-repair", "ordinary-stop", "ordinary-no-topic", "ordinary-active-event", "ordinary-episode-hit", "ordinary-episode-empty", "ordinary-provider-failure"] as const;
const exact = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const canonical = (value: Json): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key])}`).join(",")}}`;
export const hashHumanBlindValue = (value: unknown) => `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonical(value as Json)).digest("hex")}`;
const freeze = <T>(value: T): Readonly<T> => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; };
const equalHash = (a: string, b: string) => SHA256.test(a) && SHA256.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type BlindRatingV1 = Readonly<{ willingToReply: 1 | 2 | 3 | 4 | 5; selfUnderstandingIncrement: 1 | 2 | 3 | 4 | 5; autonomyPreserved: 1 | 2 | 3 | 4 | 5; unsupportedPsychologizing: boolean; historicalCausalityOverstated: boolean }>;
type Source = "v1" | "composer";

const parseFile = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const assertRating: (value: unknown) => asserts value is BlindRatingV1 = (value) => {
  if (!record(value) || !exact(value, ["willingToReply", "selfUnderstandingIncrement", "autonomyPreserved", "unsupportedPsychologizing", "historicalCausalityOverstated"])) throw new Error("human_rating_shape");
  for (const key of ["willingToReply", "selfUnderstandingIncrement", "autonomyPreserved"] as const) if (!Number.isInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > 5) throw new Error("human_rating_scale");
  if (typeof value.unsupportedPsychologizing !== "boolean" || typeof value.historicalCausalityOverstated !== "boolean") throw new Error("human_rating_boolean");
};

export type ComposerHumanBlindReviewResultV1 = Readonly<{ schemaVersion: "composer_human_blind_review_result_v1"; authorityVersion: typeof COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION; definitionHash: typeof COMPOSER_HUMAN_BLIND_REVIEW_DEFINITION_HASH; evidenceSource: "direct_official_provider_execution" | "injected_mock"; packHash: string; ratingsHash: string; reviewerIdHash: string; pairCount: 36; caseCount: 12; reviewStatus: "pass" | "pending"; thresholdPolicy: "none_report_only"; rows: readonly Readonly<{ blindId: string; caseId: string; slot: 1 | 2 | 3; v1: BlindRatingV1; composer: BlindRatingV1 }>[]; gateUpgrades: Readonly<{ human: "pass" | "unchanged_pending"; behavior: "unchanged"; latency: "unchanged_pending"; budget: "unchanged_pending"; p1Overall: "unchanged_pending" }>; resultHash: string }>;

export const createComposerHumanBlindReviewResultV1 = (): ComposerHumanBlindReviewResultV1 => {
  const pack = parseFile(COMPOSER_HUMAN_BLIND_PACK_PATH);
  const map = parseFile(COMPOSER_HUMAN_BLIND_MAP_PATH);
  const ratings = parseFile(COMPOSER_HUMAN_BLIND_RATINGS_PATH);
  const authorization = parseFile(COMPOSER_HUMAN_BLIND_REVIEWER_AUTH_PATH);
  if (!record(pack) || !exact(pack, ["schemaVersion", "authorityVersion", "definitionHash", "evidenceSource", "sampleSetHash", "safetyFixtureVersion", "safetyFixtureHash", "v1RunConfigHash", "composerRunConfigHash", "reviewerIdHash", "randomizationCommitmentHash", "pairCount", "rows", "packHash"]) || pack.schemaVersion !== "composer_human_blind_pack_v1" || pack.authorityVersion !== COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION || pack.definitionHash !== COMPOSER_HUMAN_BLIND_REVIEW_DEFINITION_HASH || !["direct_official_provider_execution", "injected_mock"].includes(String(pack.evidenceSource)) || pack.safetyFixtureVersion !== "human_blind_ordinary_no_risk_safety_fixture_v1" || pack.safetyFixtureHash !== "sha256:75eefcfc5afabbf863837bff82ffcbb3d371c6e3b9166a6bf68e88f728040556" || pack.pairCount !== 36 || !Array.isArray(pack.rows) || !SHA256.test(String(pack.packHash))) throw new Error("human_pack_root");
  const { packHash: omittedPackHash, ...packBody } = pack; void omittedPackHash;
  if (!equalHash(pack.packHash as string, hashHumanBlindValue(packBody))) throw new Error("human_pack_hash");
  if (!record(map) || !exact(map, ["schemaVersion", "packHash", "randomSeed", "randomizationCommitmentHash", "rows"]) || map.schemaVersion !== "composer_human_blind_unblinding_map_v1" || map.packHash !== pack.packHash || typeof map.randomSeed !== "string" || !Array.isArray(map.rows) || hashHumanBlindValue(map.randomSeed) !== pack.randomizationCommitmentHash || map.randomizationCommitmentHash !== pack.randomizationCommitmentHash) throw new Error("human_map_root");
  if (!record(authorization) || !exact(authorization, ["schemaVersion", "packHash", "reviewerIdHash", "humanConfirmed"]) || authorization.schemaVersion !== "composer_human_reviewer_authorization_v1" || authorization.packHash !== pack.packHash || authorization.reviewerIdHash !== pack.reviewerIdHash || authorization.humanConfirmed !== true || !SHA256.test(String(authorization.reviewerIdHash))) throw new Error("human_reviewer_authorization");
  if (!record(ratings) || !exact(ratings, ["schemaVersion", "packHash", "reviewerIdHash", "sealed", "rows", "ratingsHash"]) || ratings.schemaVersion !== "composer_human_blind_ratings_v1" || ratings.packHash !== pack.packHash || ratings.reviewerIdHash !== pack.reviewerIdHash || ratings.sealed !== true || !Array.isArray(ratings.rows) || !SHA256.test(String(ratings.ratingsHash))) throw new Error("human_ratings_root");
  const { ratingsHash: omittedRatingsHash, ...ratingsBody } = ratings; void omittedRatingsHash;
  if (!equalHash(ratings.ratingsHash as string, hashHumanBlindValue(ratingsBody))) throw new Error("human_ratings_hash");
  const packRows = new Map<string, Record<string, unknown>>();
  for (const row of pack.rows) {
    if (!record(row) || !exact(row, ["blindId", "caseId", "slot", "pairedContextCommitment", "syntheticContext", "candidateA", "candidateB", "candidateAHash", "candidateBHash"]) || typeof row.blindId !== "string" || !/^blind-[0-9]{2}$/u.test(row.blindId) || !ORDINARY_CASE_IDS.includes(row.caseId as typeof ORDINARY_CASE_IDS[number]) || ![1, 2, 3].includes(Number(row.slot)) || !SHA256.test(String(row.pairedContextCommitment)) || !record(row.syntheticContext) || !exact(row.syntheticContext, ["currentUserTurn", "recentCommittedTurns"]) || typeof row.syntheticContext.currentUserTurn !== "string" || !Array.isArray(row.syntheticContext.recentCommittedTurns) || typeof row.candidateA !== "string" || typeof row.candidateB !== "string" || hashHumanBlindValue(row.candidateA) !== row.candidateAHash || hashHumanBlindValue(row.candidateB) !== row.candidateBHash || packRows.has(row.blindId)) throw new Error("human_pack_row");
    if (row.syntheticContext.recentCommittedTurns.some((turn) => !record(turn) || !exact(turn, ["messageId", "role", "text"]) || typeof turn.messageId !== "string" || !["user", "assistant"].includes(String(turn.role)) || typeof turn.text !== "string")) throw new Error("human_pack_context");
    const expectedContextCommitment = hashHumanBlindValue({ caseId: row.caseId, slot: row.slot, currentUserTurn: row.syntheticContext.currentUserTurn, recentContext: row.syntheticContext.recentCommittedTurns, projectionVersion: row.caseId === "ordinary-repair" ? "human_review_repair_context_projection_v1" : null, projectionHash: row.caseId === "ordinary-repair" ? "sha256:d8489182eaae3917b1bde849a4cd6d05a6b093cc38756ab4f9e8109b306f6ed5" : null, safetyFixtureVersion: pack.safetyFixtureVersion, safetyFixtureHash: pack.safetyFixtureHash });
    if (row.pairedContextCommitment !== expectedContextCommitment) throw new Error("human_pack_context_commitment");
    packRows.set(row.blindId, row);
  }
  if (packRows.size !== 36 || new Set([...packRows.values()].map((row) => `${row.caseId}:${row.slot}`)).size !== 36 || ORDINARY_CASE_IDS.some((caseId) => [1, 2, 3].some((slot) => ![...packRows.values()].some((row) => row.caseId === caseId && row.slot === slot)))) throw new Error("human_pack_coverage");
  const mapRows = new Map<string, Record<string, unknown>>();
  for (const row of map.rows) {
    if (!record(row) || !exact(row, ["blindId", "candidateASource", "candidateBSource"]) || typeof row.blindId !== "string" || !["v1", "composer"].includes(String(row.candidateASource)) || !["v1", "composer"].includes(String(row.candidateBSource)) || row.candidateASource === row.candidateBSource || mapRows.has(row.blindId)) throw new Error("human_map_row");
    const expectedA: Source = Number.parseInt(hashHumanBlindValue(`${map.randomSeed}:${row.blindId}`).slice(-2), 16) % 2 === 0 ? "v1" : "composer";
    if (row.candidateASource !== expectedA || row.candidateBSource !== (expectedA === "v1" ? "composer" : "v1")) throw new Error("human_map_randomization");
    mapRows.set(row.blindId, row);
  }
  const reviewed = new Set<string>();
  const resultRows = ratings.rows.map((row) => {
    if (!record(row) || !exact(row, ["blindId", "candidateA", "candidateB"]) || typeof row.blindId !== "string" || reviewed.has(row.blindId) || !packRows.has(row.blindId) || !mapRows.has(row.blindId)) throw new Error("human_ratings_row");
    assertRating(row.candidateA); assertRating(row.candidateB); reviewed.add(row.blindId);
    const packRow = packRows.get(row.blindId)!; const mapping = mapRows.get(row.blindId)!;
    return freeze({ blindId: row.blindId, caseId: packRow.caseId as string, slot: packRow.slot as 1 | 2 | 3, v1: (mapping.candidateASource === "v1" ? row.candidateA : row.candidateB) as BlindRatingV1, composer: (mapping.candidateASource === "composer" ? row.candidateA : row.candidateB) as BlindRatingV1 });
  });
  if (reviewed.size !== 36 || [...packRows.keys()].some((id) => !reviewed.has(id))) throw new Error("human_ratings_coverage");
  const realEvidence = pack.evidenceSource === "direct_official_provider_execution";
  const body = freeze({ schemaVersion: "composer_human_blind_review_result_v1" as const, authorityVersion: COMPOSER_HUMAN_BLIND_REVIEW_AUTHORITY_VERSION, definitionHash: COMPOSER_HUMAN_BLIND_REVIEW_DEFINITION_HASH, evidenceSource: pack.evidenceSource as "direct_official_provider_execution" | "injected_mock", packHash: pack.packHash as string, ratingsHash: ratings.ratingsHash as string, reviewerIdHash: pack.reviewerIdHash as string, pairCount: 36 as const, caseCount: 12 as const, reviewStatus: realEvidence ? "pass" as const : "pending" as const, thresholdPolicy: "none_report_only" as const, rows: freeze(resultRows), gateUpgrades: freeze({ human: realEvidence ? "pass" as const : "unchanged_pending" as const, behavior: "unchanged" as const, latency: "unchanged_pending" as const, budget: "unchanged_pending" as const, p1Overall: "unchanged_pending" as const }) });
  return freeze({ ...body, resultHash: hashHumanBlindValue(body) });
};

export const assertComposerHumanBlindReviewResultV1 = (result: ComposerHumanBlindReviewResultV1) => {
  const expected = createComposerHumanBlindReviewResultV1();
  if (canonical(result as Json) !== canonical(expected as Json)) throw new Error("human_review_result_binding");
};
