## Problem

The proactive-greeting path selects `open_statement` before generation, but it
does not carry a structured realization of that move through generation,
validation, and commit. The final text is instead reclassified by punctuation
and phrase/topic matchers. This allows an announcement such as “今天想和你分享一个刚想到的有趣念头。” to be accepted as an
`open_statement` even though the promised thought has not been delivered. The
User must then ask the Assistant to reveal the content, so a move whose frozen
contract says `expectedUserContribution=none` has transferred the startup cost
back to the User.

This slice should enforce the existing meaning of
`offer_self_contained_conversation_entry`; it should not attempt to guarantee
that every User will continue the conversation. “Always produce an irresistible
reply hook”, “always ask a follow-up question”, a fixed topic taxonomy, and a
minimum conversation length would be new product postconditions and remain out
of scope. The existing postcondition is sufficient: an `open_statement` must
actually deliver its conversational proposition in the same committed turn and
must be complete without User contribution.

## Evidence

- The reported committed sequence is: Assistant announces that it wants to
  share an interesting thought; User replies “好哇，你说”; Assistant then supplies
  a cloud analogy; User still has to ask “比如呢” before the content becomes
  concrete. The first Assistant turn is therefore a teaser, not a self-contained
  entry.
- `selectProactiveGreetingMove` chooses a move before generation, but
  `generateProactiveGreeting` returns only final text plus
  `proactiveGreetingMove`. The semantic content of an `open_statement` is not
  represented.
- `proactiveGreetingMove(value)` reconstructs the move from `?`/`？`, a
  simple-greeting regex, and a default-to-`open_statement` branch. Consequently
  every non-question sentence not matching the greeting regex, including a
  content-free announcement, becomes `open_statement`.
- `validateProactiveGreeting` relies on punctuation, phrase/regex rejection,
  character similarity, and topic keyword lists. Its expected-move check only
  distinguishes question from non-question. It does not prove that the stated
  proposition was delivered or that the turn is complete without User input.
- The committed proactive envelope is built after the text has been saved and
  currently fabricates `claims=[]`, `questionOrRequest` from the selected move,
  and the expected contribution/burden from that enum. It records the intended
  contract, not evidence that Surface actually realized it.
- Authenticated recent-greeting selection projects the last greeting texts and
  calls the same text classifiers again. The current tests explicitly assert
  punctuation classification and keyword-derived topic classes, showing that
  text inference is part of the runtime authority rather than merely legacy
  diagnostics.
- `callModel` already supports Qwen `response_format: {type:
  "json_object"}` and rejects that response format for unsupported providers.
  This permits a strict local parser and fail-closed Qwen path without relaxing
  provider behavior or scraping JSON from free text.
- The authoritative handoff contract already says the required function comes
  from the move selected before Surface generation and must not be reconstructed
  from punctuation, final wording, or a text classifier. It also defines
  `open_statement` as `questionOrRequest=null`, expected contribution `none`,
  burden `none`, with completion only after semantic validation and atomic
  commit.

## Root Cause

The move selector, Surface, validator, dedupe logic, and committed event do not
share one typed semantic object. The selector owns an enum, Surface owns free
text, validation guesses semantics back from that text, and persistence records
the selector's intent regardless of what Surface delivered. This broken chain
has two consequences:

1. structural properties such as move type, expected contribution, and topic
   identity are repeatedly inferred from punctuation or phrase membership; and
2. the positive obligation of `offer_self_contained_conversation_entry` has no
   evidence-bearing payload, so negative filters can reject known bad wording
   but cannot prove that an actual proposition was supplied.

Adding more prohibited phrases would only enlarge the incomplete text
classifier. The owning layer is the proactive generation/commit boundary, not
the ordinary Response Planner, PHM-C handoff Surface, lifecycle state, Memory,
or Batch 2.

The v2 envelope also exposes a compile-time control-boundary mismatch.
`CommittedAssistantMoveEnvelopeV1` is now the authoritative parsed union and
contains proactive v1, proactive v2, ordinary response, and Safety members, but
`ActiveInteractionMoveHandoffTarget.envelope` and the proactive-open type guard
still name only `ProactiveGreetingAssistantMoveEnvelopeV1`. Their runtime checks
already accept a strictly parsed proactive `opens` event, so the concrete v1
annotation is stale type ownership, not a distinct runtime rule.

## Proposed Solution

Introduce one turn-local `ProactiveMoveIntentV1`, selected before Surface and
carried unchanged through validation and commit. The smallest useful union is:

```ts
type ProactiveMoveIntentV1 =
  | {
      move: "simple_greeting"
      requiredFunction: "initiate_reciprocal_contact"
      realization: { kind: "reciprocal_contact" }
      expectedUserContribution: "none"
      userBurden: "none"
    }
  | {
      move: "open_statement"
      requiredFunction: "offer_self_contained_conversation_entry"
      realization: {
        kind: "self_contained_entry"
        topic: string
        proposition: string
      }
      expectedUserContribution: "none"
      userBurden: "none"
    }
  | {
      move: "light_question"
      requiredFunction: "ask_one_bounded_low_burden_question"
      realization: {
        kind: "bounded_question"
        topic: string
        question: string
      }
      expectedUserContribution: "answer"
      userBurden: "low"
    }
```

`topic`, `proposition`, and `question` are semantic payload, not final wording.
For `open_statement`, `proposition` is the content actually being offered; “I
want to share an idea” is an announcement and cannot fill that field. No enum of
Chinese themes, phrase whitelist, fixed final reply, or assistant psychological
fiction is introduced.

The runtime sequence should be finite and explicit:

1. Select `move` from committed structured history, not greeting text. For a new
   history window, use the existing initial/return selection policy. The selected
   move fixes the required function, expected contribution, and burden.
2. For `open_statement` and `light_question`, ask the configured Qwen model for
   exactly one JSON object containing the bound intent fields. Use
   `responseFormat="json_object"`, an exact-key parser, exact enums, non-empty
   bounded strings, and no coercion, Markdown-fence stripping, JSON substring
   extraction, defaulting, or text-derived repair. A malformed or binding-
   mismatched object is rejected. At most one fresh model retry may occur; after
   that the greeting fails closed and no message/envelope is committed.
3. Give the frozen intent to Surface. Surface may phrase it naturally but may
   not select another move, replace the topic/proposition/question, or add an
   obligation. No deterministic Chinese reply is used as fallback.
4. Run a separate Qwen JSON semantic verdict bound to the selected intent and
   candidate text. Its strict schema must echo the selected move/function,
   return an exact candidate-text evidence span, and decide: intent faithfully
   realized, proposition actually delivered (for `open_statement`), no omitted
   content that requires a second Assistant reveal, contribution/burden obeyed,
   grounding obeyed, and no contradictory move. Exact binding, exact evidence
   substring, and a positive verdict are all required. Malformed, uncertain,
   mismatched, provider-failed, or negative verdicts fail closed. The verdict
   cannot rewrite Surface or create a different intent.
5. Only the accepted intent is committed. Introduce a logical proactive-envelope
   v2 that retains the existing `origin`, `committedMove`, and `handoff` fields
   and adds exactly one `proactiveIntent` field containing the union above. This
   avoids encoding topic identity into free-form evidence strings. The
   preselected move/function remains projected into `purpose`/`handoff`; an
   accepted `open_statement` projects its proposition into `claims`; a
   `light_question` projects its bound question into
   `questionOrRequest.text`; expected contribution and burden come from the
   intent union. The v2 parser requires exact keys and exact agreement between
   all projections. Existing v1 envelopes remain readable as legacy committed
   events but cannot supply v2 move/topic dedupe evidence. The message,
   generation trace, v2 intent, and `opens` edge remain one atomic commit. This
   is a versioned JSON event contract inside the existing trace, not a database
   schema migration. Draft intents, rejected Surface candidates, retries, and
   failures persist nothing.

Recent-move and topic dedupe must consume only strict committed projections:

- move identity comes from the valid v2 envelope's `proactiveIntent.move`, with
  exact cross-field agreement to the `handoff.greetingFunction` mapping, never
  `proactiveGreetingMove(finalText)`;
- topic/proposition comes from the accepted v2 `proactiveIntent`, never
  `proactiveGreetingTopics(finalText)`;
- exact/near-text similarity may remain a duplicate-text guard because it
  compares visible strings without assigning a move or topic;
- semantic topic repetition is decided from the current intent topic/proposition
  against the last three accepted structured topic/proposition values, using a
  strict bound JSON comparator or the generation constraint plus validator. It
  must not use a Chinese keyword category list;
- legacy text-only greetings provide text-similarity evidence only. They are
  never upgraded to a v1 move/topic by punctuation, regex, prompt version, or a
  classifier. Their absence of structured history simply uses the existing
  no-history selection branch until they leave the three-greeting window.

Authenticated chat should read the existing `aiGeneration.executionTrace`
envelope and persist the accepted projection there; no database migration is
needed. Guest chat should round-trip the same committed envelope plus text in
its recent-message projection/cache. A Guest cache is an immutable-event cache,
not `pending/active/completed` lifecycle state. Open, resolved, and active remain
pure queries over committed edges; Memory, User Model, Batch 2, ordinary Planner,
and PHM-C are unchanged.

The control projection should derive its proactive-open type from the
authoritative committed union instead of copying `V1 | V2`:

```ts
type CommittedProactiveGreetingOpenEnvelope = Extract<
  CommittedAssistantMoveEnvelopeV1,
  {
    origin: { kind: "proactive_greeting" };
    handoff: { edge: "opens" };
  }
>;
```

Use this alias for `ActiveInteractionMoveHandoffTarget.envelope` and for the
return predicate of `isProactiveGreetingOpenEnvelope`. `Extract` distributes
over the union and selects exactly the committed proactive v1 and v2 members;
ordinary response and Safety members satisfy neither discriminant. Preserve
the current parsed-envelope, committed message-id, immediate-adjacency,
proactive-origin, and open-edge runtime checks unchanged. This is type-level
acceptance of both committed proactive schema versions, not broader handoff
behavior.

Acceptance is automated by distinct risk category, not by enumerating possible
wording:

- strict parser: valid object for each of the three union variants; malformed
  JSON, unknown/missing keys, wrong enum, overlong/empty semantic field, and
  selected-move/function mismatch all reject;
- positive semantics: a complete proposition is accepted; a teaser/announcement,
  empty abstraction, deferred reveal, invented assistant experience, declarative
  request without a question mark, and an added question for `open_statement`
  all reject through semantic evidence rather than phrase matching;
- identity and dedupe: punctuation changes cannot change a committed move;
  paraphrased same-topic structured intents reject, a distinct structured topic
  passes, and legacy text cannot manufacture move/topic identity;
- commit boundary: accepted Auth and Guest events expose the same envelope;
  malformed intent, failed Surface, rejected verdict, retry loser, and failed
  transaction expose no message or envelope;
- real Qwen gate: one positive case for every move kind, one content-free teaser
  challenge, one obligation-laundering challenge, one paraphrased-topic duplicate,
  and one distinct-topic control. The gate fixes provider/model/temperature,
  logs only case id/result/latency, and passes only when both strict binding and
  semantic verdict agree. These categories cover the contract without asking a
  human to test unlimited phrasings.

Manual acceptance is therefore limited to one normal proactive share, one
natural response to it, and one return visit. It confirms product feel; it is
not the semantic coverage mechanism.

The structured contract also requires completing the compile-time migration.
Five existing fixture files still call
`buildProactiveGreetingAssistantMoveEnvelope({greetingMove})`. Each fixture must
instead declare the smallest explicit `ProactiveMoveIntentV1` matching the move
it is exercising and pass `{intent}`. After all five compile against the intent
form, remove the deprecated `{greetingMove}` overload and its unconditional
runtime throw from `interactionMoveEnvelope.ts`; the builder must expose only
the v2 intent signature. This is fixture migration, not a compatibility runtime
path, and prevents tests from preserving an API that production is forbidden to
use.

Repository-visible commit behavior needs one additional automated integration
gate rather than more source-string assertions. The gate should be implemented
as `scripts/proactive-move-structured-commit-check.ts` and should use only public
Auth and Guest entry points:

1. Start an in-process HTTP server on an OS-assigned loopback port implementing
   the Qwen-compatible `/chat/completions` response shape. Point
   `QWEN_BASE_URL` at it, use a synthetic key, and queue exact responses for a
   valid intent/Surface/verdict, malformed generation, semantic-validator
   rejection, and first-attempt rejection followed by a valid repair. This
   exercises the real `callModel` adapter without external network access or a
   production injection seam.
2. Dynamically import Prisma and the Auth service only after test environment
   variables are fixed. Create one uniquely named fixture User and one explicit
   unique fixture ChatSession id. Invoke public
   `ensureProactiveChatGreeting`. On success, assert exactly one generation and
   one Assistant message for that session, strict v2 parsing, and equality among
   saved content, generation output, accepted intent, committed-move projection,
   and handoff function. On malformed generation and validator rejection,
   assert zero new generations, messages, or envelopes. For one rejected first
   attempt followed by a valid repair, assert exactly one committed generation
   and message containing only the winner; the rejected candidate is not a
   persisted generation.
3. Invoke the exported Guest greeting route `POST` with the same scripted model
   sequence. Normalize only event-specific ids/timestamps, then deep-compare
   Guest and Auth `proactiveIntent`, `committedMove`, and `handoff`. Round-trip
   the Guest result through the authorized Guest recent-greeting cache helpers
   and a second route request, proving that structured history, not final-text
   reclassification, controls subsequent move/topic dedupe. Failure responses
   must contain no committable message/envelope.
4. Prove late-transaction rollback against PostgreSQL. The script must require
   an explicit `PROACTIVE_COMMIT_TEST_DATABASE_URL` before importing Prisma and
   assign it to `DATABASE_URL`; it must never default to the application's
   ordinary `DATABASE_URL`. It must also require an explicit destructive-test
   acknowledgement such as `PROACTIVE_COMMIT_TEST_ALLOW_DDL=1`, compare the
   server-reported database name with the explicit URL, reject a database name
   that is not visibly test-scoped, and check `CREATE` privilege on the current
   schema plus `TRIGGER` privilege on `"ChatSession"`. A missing database,
   privilege, or guard is a failed prerequisite, never a skipped/passing test.
5. After creating the unique fixture session, generate trigger/function names
   from lower-case hex only. Install a temporary `BEFORE UPDATE` trigger on
   `"ChatSession"` whose `WHEN` clause matches exactly that session id and whose
   temporary PL/pgSQL function raises only for that row. Then run an otherwise
   valid Auth greeting so the failure occurs at the transaction's final session
   update, after generation/message/trace writes were attempted. Assert the
   public entry returns no greeting, the fixture session retains its original
   last-message fields, and no generation, message, or envelope exists for the
   fixture session. In `finally`, drop the unique trigger, drop the unique
   function, delete the fixture User (cascading only its fixture rows), restore
   environment variables, close the HTTP server, and disconnect Prisma. Every
   cleanup target must be an exact generated identifier or fixture id; no broad
   deletes, globs, migration, or schema reset are allowed.

Static evidence remains useful but has a narrower claim: source inspection can
prove that generation/message creation, trace update, and session update are
inside one `prisma.$transaction`, that raw-memory creation is after that
transaction, and that no lifecycle column was added. Static structure cannot
prove PostgreSQL rollback, Auth/Guest response parity, zero commit on provider
or Validator failure, or single-winner behavior; those are the dynamic gate's
responsibility.

## Files To Change

- `services/ai/proactiveGreeting.ts`: replace free-text semantic authority with
  intent generation, strict parsing, Surface realization, bound semantic
  validation, and structured-history selection/dedupe; retire runtime dependence
  on `proactiveGreetingMove`/`proactiveGreetingTopics` for new events and do not
  add a fixed-text fallback.
- `conversation-os/interactionMoveEnvelope.ts`: add the logical proactive v2
  `proactiveIntent` field, retain v1 reading, build new proactive events as v2,
  and enforce exhaustive move/function/claim/question/contribution/burden
  cross-field invariants.
- `conversation-os/control/types.ts`: derive the exact proactive-open union with
  `Extract` from `CommittedAssistantMoveEnvelopeV1` and use it for
  `ActiveInteractionMoveHandoffTarget.envelope`.
- `conversation-os/control/interactionMoveHandoff.ts`: use that derived union in
  the proactive-open type guard while preserving every runtime condition.
- `services/chat/proactiveGreetingService.ts`: read strict committed envelope
  projections for recent Auth greetings and atomically persist the validated
  intent projection with the message.
- `app/api/chat/guest/greeting/route.ts`, `lib/guest-proactive-greeting.ts`, and
  the narrow Guest greeting projection in `app/chat/chat-client.tsx`: round-trip
  recent committed structured greeting events instead of move/topic-inferred
  strings, while treating legacy strings as text-only duplicate evidence.
- `lib/proactive-greeting.ts`: bump generation provenance for the new contract;
  keep prior versions as provenance-only legacy recognition.
- `scripts/proactive-greeting-control-check.ts`: replace punctuation/topic
  classification assertions with strict intent, semantic, dedupe, and
  no-commit regression categories.
- `scripts/proactive-move-structured-qwen-eval.ts` (new): finite real-Qwen
  acceptance matrix described above.
- `scripts/interaction-move-envelope-check.ts`,
  `scripts/interaction-move-handoff-check.ts`,
  `scripts/interaction-move-handoff-planner-check.ts`,
  `scripts/interaction-move-handoff-turn-interpretation-qwen-eval.ts`, and
  `scripts/chat-execution-lifecycle-check.ts`: migrate every legacy
  `{greetingMove}` fixture to an explicit structured intent. These are the five
  exact remaining fixture files using the deprecated builder form.
- `scripts/proactive-move-structured-commit-check.ts` (new): loopback Qwen stub,
  public Auth/Guest parity, zero-commit failure cases, repair-loser/single-winner
  proof, and unique-session PostgreSQL late-transaction rollback with guarded
  cleanup.
- `package.json`: add exactly one standalone command,
  `check:proactive-move-structured-commit`, for the new integration script. Do
  not place it in `check:launch` until the launch environment provisions the
  explicit guarded test database URL; once provisioned, insert it immediately
  after `check:proactive-greeting-control`. Until then it is a required separate
  acceptance gate and its inability to run is a release blocker, not a pass.
- `docs/ARCHITECTURE_V1_FINAL.md` and
  `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md`: record the
  implemented structured proactive-move projection and explicitly retain the
  no-lifecycle-state boundary. No PRD postcondition is added.

`services/ai/modelProvider.ts`, ordinary Response Planner/Surface/Validator,
Memory, User Model, Batch 2, Prisma schema, and lifecycle-state code require no
change. The provider already supplies the required Qwen JSON-object capability.

## Risks

- `json_object` guarantees a JSON object at the provider boundary, not the local
  schema or semantic truth. Exact local parsing plus the separate bound semantic
  verdict are mandatory; trusting the generator's `proposition` or
  `complete=true` self-report would recreate the bug in structured form.
- Current structured-output support is intentionally Qwen-only. With another
  provider, this slice must fail closed instead of silently falling back to free
  text or a template. Supporting another provider is a separate provider-
  capability slice.
- A second semantic call increases greeting latency and availability exposure.
  The greeting service already treats generation failure as “no proactive
  greeting”; it must not convert failure into an unvalidated message.
- Semantic topic comparison can itself be uncertain. Uncertain/malformed
  duplicate verdicts should conservatively reject the candidate, not infer a
  topic from final text. This may reduce greeting frequency but preserves the
  contract.
- The parser must preserve v1 legacy reading rules while requiring every newly
  built proactive event to use v2. A v1 event must never be upgraded by
  `promptVersion`, punctuation, or text inference, and a malformed v2 event must
  not fall back to v1 parsing.
- The proactive-open extraction must discriminate on both `origin.kind` and
  `handoff.edge`. A manually copied `V1 | V2` control union would drift from the
  authoritative envelope; an origin-only extraction could admit a future
  proactive non-open member. The two-discriminant `Extract` avoids both risks
  without widening ordinary response/Safety types or removing runtime guards.
- The Guest client file currently contains unrelated work. Implementation must
  use one writer for that narrow projection and preserve unrelated changes.
- Prisma uses PostgreSQL and the existing persistence checks create one fixture
  User, work through its cascaded rows, delete that exact User in `finally`, and
  disconnect. However, the repository exposes only ordinary `DATABASE_URL`; no
  dedicated test-database variable or existing trigger/failure-injection pattern
  was found. The currently configured server at `localhost:5432` was unreachable,
  so database identity, DDL privileges, and trigger cleanup could not be safely
  verified. The rollback design must therefore remain fail-closed behind the
  explicit test-only URL and DDL acknowledgement above. It must not be tried
  against the ordinary configured database merely to obtain evidence.
- If a dedicated PostgreSQL test database with function/trigger privileges
  cannot be provisioned, the safe alternative requires a new, separately
  approved test-only persistence failure seam at the transaction boundary. A
  source-string assertion or an early foreign-key failure is not an acceptable
  substitute: neither proves rollback after the earlier writes. No such seam is
  authorized by this design, so absent the dedicated database the dynamic
  rollback acceptance remains blocked.
- This design prevents teaser-shaped false positives and user-obligation
  laundering. It cannot guarantee that a particular user finds a generated
  proposition interesting; treating engagement probability as a pass/fail
  contract would be a new product decision, not a defect repair.
