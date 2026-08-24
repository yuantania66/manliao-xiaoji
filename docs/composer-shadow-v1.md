# Composer Shadow V1 Implementation Contract

## 1. Status and outcome

- Status: **frozen P1 implementation contract; not implemented**.
- Parent contract: `docs/HOT_COLD_PATH_V1_CONTRACT.md`.
- Outcome: measure whether a single real Qwen Conversation Composer can produce
  structurally usable ordinary-chat candidates, with paired latency and quality
  evidence and zero user/production authority.
- P1 does not authorize P2 winner code, P3 Safety rollout, production writer
  switching, Memory writes, event writes or retirement of V1.

The cheapest-risk-first decision is to use versioned replay first. Arbitrary
production traffic mirroring is not part of P1 V1.

## 2. Inputs and cohorts

### 2.1 Required cohort: frozen replay

The required input is a versioned, access-controlled replay set built from
explicitly authorized historical/manual conversations and synthetic adversarial
cases. Direct identifiers are removed; stable case ids replace user/session ids.
Conversation-text replay artifacts expire after 30 days or when their source
authorization expires, whichever is earlier. Source deletion or authorization
withdrawal invalidates the case immediately and removes linked text within 24
hours; an incomplete sample version must be rerun rather than silently reused.
Each case is an immutable `BaselineCaseV1` snapshot:

```text
caseId
sampleSetVersion
category
currentUserTurn
recentCommittedTurns
canonicalGroundingVersion
activeCommittedEventProjection | null
episodeCandidatesSnapshot[]
expectedSafetyOwnership: safety | ordinary
source: real_failure | positive_regression | adversarial
```

Categories must cover distinct risks: first contact, greeting reciprocity,
ordinary accompaniment, exploration, direct answer/identity, repair, stop/end,
no-topic opening, active event, Episode hit, Episode empty, provider failure,
current Safety danger and quoted/third-party Safety content.

Safety-owned cases establish P0 V1 evidence only and are `ineligible` for the
Composer. P1 does not test or bypass the Safety decision owner.

### 2.2 Optional cohort: explicitly authorized local/manual turns

After the frozen replay isolation gate passes, an explicitly authorized local or
manual evaluation session may be mirrored after V1 has determined the result.
The Shadow receives the pre-winner input snapshot and never sees the V1 winner.
General production sampling, silent real-user mirroring and raw production text
telemetry require a separate privacy/rollout decision and are out of scope.

### 2.3 Input contract

`ComposerShadowInputV1` is recursively frozen before V1 and Shadow diverge:

```text
schemaVersion: composer_shadow_input_v1
shadowRunId
caseId | null
sampleSetVersion | null
conversationIdHash
turnId
currentUserText
recentCommittedTurns[]:
  messageId, role, text, replyToMessageId | null
assistantGrounding[]:
  canonicalFactId, value, epistemicStatus
activeEvent:
  sourceAssistantEventId, relation=open, purpose | null
episodeCandidates[]:
  episodeId, compactSummary, confirmedFacts[], hypotheses[],
  people[], topics[], sourceMessageIds[]
purposeContractVersion
```

The input must not contain V1 Interpretation, Dialogue State, Clinical/Helping
advice, ResponsePlan, preflight reasons, Surface candidates, Validator verdicts,
winner text or internal failure labels. A hash covers every field. Missing
required data, invalid active-event parsing or Context overflow produces
`not_invoked` with a reason; no field is silently dropped to make the call pass.

## 3. Composer output and call budget

Qwen must return exact-schema JSON:

```text
schemaVersion: composer_shadow_output_v1
turnId
purpose:
  first_contact | direct_answer | repair | respect_boundary |
  accompany | explore | proactive
reply
episodeRef: episodeId | null
groundingRefs: canonicalFactId[]
eventRef: sourceAssistantEventId | null
```

- Use the configured real Qwen main model, `response_format=json_object` and
  `enable_thinking=false`.
- Record the exact model, Prompt version, schema version, temperature and all
  provider parameters in `runConfigHash`.
- First output may receive one repair only for malformed JSON, extra/missing keys
  or exact binding failure. Maximum Composer calls per observation is two.
- Repair never triggers V1 retry and never changes user-visible execution.
- `purpose` is turn-local observation metadata, not persistent conversation mode.

## 4. Isolation contract

Shadow is valid only if all seven boundaries hold:

1. **Writer isolation:** V1 remains the only ChatMessage/Assistant winner writer.
2. **Data isolation:** no `AiGeneration` authority/judge, session,
   SemanticMemory/Version/Evidence, envelope, relation edge or lifecycle write.
3. **Timing isolation:** start through a failure-isolated background task only
   after the V1 server result is fixed; never delay or alter that result.
4. **Provider isolation:** separate feature flag, concurrency limit, timeout,
   request tag and call budget; budget exhaustion is `not_invoked`.
5. **Event isolation:** `eventRef` is checked but never publishes
   `opens / fulfills / supersedes` or changes active/resolved queries.
6. **Telemetry isolation:** append-only, low-privilege diagnostic sink with zero
   production readers. It cannot be injected into Context or Memory.
7. **Failure isolation:** timeout, cancellation, malformed output and process exit
   affect only the observation; no UI banner, HTTP change or manual retry prompt.

Any detected conversation, event, Memory, session, authority or user-visible
write immediately stops P1. Quality gains cannot compensate for isolation loss.

## 5. Timing definitions

All timestamps use one monotonic server clock. Wall-clock timestamps are only
for grouping and must not be subtracted for latency.

```text
t_shadow_eligible   frozen input accepted for Shadow
t_provider_dispatch immediately before the Qwen HTTP request
t_first_byte        first provider response byte/chunk received
t_first_reply_char  first decoded character inside the JSON reply value
t_first_segment     first complete sentence-sized segment decoded from reply
t_provider_done     provider stream completed
t_parse_done        final strict JSON and exact binding parse completed
```

Reported durations:

| Metric | Definition |
|---|---|
| `queue_delay_ms` | `t_provider_dispatch - t_shadow_eligible` |
| `provider_first_byte_ms` | `t_first_byte - t_provider_dispatch` |
| `first_reply_char_ms` | `t_first_reply_char - t_provider_dispatch` |
| `first_complete_candidate_segment_ms` | `t_first_segment - t_provider_dispatch` |
| `total_generation_ms` | `t_provider_done - t_provider_dispatch` |
| `strict_result_ms` | `t_parse_done - t_provider_dispatch` |

A sentence-sized segment ends at a terminal Chinese/ASCII punctuation boundary
(`。！？!?`), or at provider completion for a non-empty final fragment. Boundaries
inside escaped JSON are decoded before segmentation; punctuation in JSON keys or
metadata is ignored. Segment count is computed from decoded `reply`, not raw
provider chunks.

P1 does **not** own the production output Safety Guard. Therefore it reports
`first_complete_candidate_segment_ms`, not `first_safe_segment_ms`. The latter
is defined in P3 as:

```text
first_safe_segment_ms =
  output-Safety acceptance time of the first segment - input-Safety release time
```

This distinction prevents a structurally complete but unchecked segment from
being mislabeled safe. P1 closes the model-speed unknown; P3 closes the full
user-visible first-safe-segment SLO.

## 6. Observation schema

`ComposerShadowObservationV1` is append-only and non-authoritative:

```text
observationId, schemaVersion, createdAt
environment, revision, runConfigHash
sampleSetVersion | null, caseId | null, cohortKey
processTemperature: cold | hot | production_unknown

conversationIdHash, turnIdHash, inputHash
inputByteSize, recentTurnCount, episodeCandidateCount, hasActiveEvent

v1:
  resultStatus, committedWinnerHash | null, failureCategory | null
  retryable, blockingQwenCalls, plannerAttempts, surfaceCandidates
  serverElapsedMs, episodeSelectedIdHash | null
  committedEdge: opens | fulfills | supersedes | null

shadow:
  eligibility: eligible | ineligible
  ineligibleReason | null
  invocationStatus: not_invoked | success | provider_failed | timed_out |
                    malformed | hard_binding_failed | cancelled
  model, promptVersion, calls, repairUsed
  queueDelayMs | null
  providerFirstByteMs | null
  firstReplyCharMs | null
  firstCompleteCandidateSegmentMs | null
  totalGenerationMs | null
  strictResultMs | null
  segmentCount | null, tokenRate | null
  promptTokens | null, completionTokens | null
  outputHash | null, purpose | null, replyLength | null
  episodeRefHash | null, groundingRefIds[], eventRefHash | null
  schemaValid, turnBindingValid, groundingRefsValid
  episodeRefValid, eventRefValid

qualityAnnotations:
  evaluatorVersion | null
  willingToReply | null
  selfUnderstandingIncrement | null
  autonomyPreserved | null
  unsupportedPsychologizing | null
  historicalCausalityOverstated | null
  notesCode[]
```

Default telemetry stores hashes and counts, not raw User or Assistant text.
Paired human review uses the separately access-controlled frozen artifact and
links by `observationId`. Free-form production notes are forbidden.
Hashed observations expire after 90 days. Source deletion or authorization
withdrawal immediately invalidates their replay linkage and removes any
re-identifiable mapping within 24 hours; only non-re-identifiable aggregates may
remain.

## 7. Metrics and reporting

Report these separately; no composite “Composer score” is allowed:

- coverage and every `not_invoked` reason;
- first-pass strict JSON validity, repair rate and final binding validity;
- latency p50/p95/p99 for each timing metric, split by process Cold/Hot;
- total duration, segment count, prompt/output tokens, token rate and failure rate;
- V1 blocking calls/attempts/result versus Shadow calls/result on the same case;
- Shadow on/off equality of V1 result, winner hash, committed edge and write set;
- valid/invalid Episode selection, and legal no-Episode generation;
- paired blind review for willingness to reply, self-understanding increment,
  autonomy, unsupported psychologizing and overstated historical causality;
- per-case instability and disagreement, never only an aggregate average.

Provider timeouts and failures are excluded from successful latency percentiles
but reported as separate rates and counts. Cold and Hot observations are never
pooled. Retrieval miss is an upstream Context fact, not Composer failure.

## 8. Sample size and stability gate

Two sample units serve different purposes:

1. **Behavior stability:** every frozen ordinary case runs three independent
   times under the same `runConfigHash`. All three are retained. Strict schema,
   turn/ref validity and isolation must agree; one violation makes the case
   hard-unstable.
2. **Latency calibration:** collect at least 200 successful first-attempt Hot
   observations across three separate calendar days, with at least 50 on each
   day and representation from short, medium and near-bound Context bands.

After 200 observations, compute a bootstrap 95% confidence interval for p95
`first_complete_candidate_segment_ms` using a frozen seed and method. Exit when
the interval half-width is <= 15% of the p95 estimate. If it is wider, extend to
400 observations; if it remains wider, report the distribution as unstable and
do not freeze a latency number.

Any change to model, Prompt, schema, temperature, streaming decoder, Context
bound or sample content creates a new `runConfigHash`; observations from
different hashes cannot satisfy one gate.

## 9. Exit and stop gates

P1 is complete only when:

1. 100% of sampled turns have an observation or explicit `not_invoked` reason;
2. all seven isolation boundaries pass, including injected provider timeout,
   cancellation and malformed-output cases;
3. V1 remains the only writer and its result/winner/edge/write set is identical
   with Shadow on and off;
4. each frozen ordinary case completes its three-run stability unit with no hard
   inconsistency;
5. exact input/output hash, revision, model, Prompt, schema and call count are
   traceable;
6. paired blind review is reported case-by-case;
7. Safety-owned cases stay ineligible and Episode miss is counted separately;
8. the adaptive latency sample and confidence gate in §8 is satisfied or
   explicitly reported unstable;
9. the resulting `[BUDGET-CANDIDATE]` decision follows the parent contract:
   700 ms only when the
   p95 upper confidence bound is <= 700 ms; otherwise 1,200 ms when it is
   <= 1,200 ms; above 1,200 ms stops automatic progression to P3
   `[SLO-FIRST-SAFE]` work.

Immediate stop conditions:

- any production conversation/event/Memory/session/lifecycle write;
- any user-visible status, latency or response-authority change caused by Shadow;
- V1 and Shadow sharing a commit writer or retry budget;
- raw production conversation text entering general telemetry;
- a second repair or an unversioned Prompt/schema/config change.

P1 completion produces an evidence report and one `[BUDGET-CANDIDATE]`
decision. Only P3 may freeze `[SLO-FIRST-SAFE]`. P1 does not automatically
authorize P2 or P3.

## 10. Implementation boundary

Allowed in a separately authorized P1 implementation slice:

- P0 versioned baseline runner and frozen replay artifact;
- a Qwen streaming Composer Shadow adapter;
- strict incremental JSON reply decoder and final exact-schema parser;
- non-authoritative observation sink;
- feature flag, independent concurrency/timeout budget and isolation checks;
- paired report generator.

Out of scope:

- changing `createChatReply` authority or current V1 output;
- Assistant reservation/lease/takeover code;
- database winner schema or migration;
- production output Safety implementation;
- Message, event, Memory, session or lifecycle writes;
- real-user rollout, arbitrary production mirroring or V1 retirement.
