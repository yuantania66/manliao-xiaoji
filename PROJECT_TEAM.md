# Project Team

> 项目专属角色档案、当前交付切片和轻量证据台账位于 [`.project-team/`](./.project-team/PROJECT_TEAM.md)。本文件继续保存既有实现切片的历史交付账本，两者不得相互覆盖。

## Project outcome

Ship a coherent, clinically safe Conversation OS in reviewable increments without mixing product redesign, implementation, and unbounded evaluation loops.

## Active delivery slice

- Outcome: Write a target-bound `supersedes` edge only when a validated Safety winner commits against the strict adjacent active proactive target, and expose pure superseded/resolved/active queries.
- Acceptance: Exact execution-turn/source binding; no-target, mismatch, failure, retry-loser and rollback isolation; Guest/authenticated parity; malformed, mismatched, duplicate-id and non-adjacent query inputs fail closed; dedicated, adjacent, TypeScript, ESLint, independent and full launch gates pass.
- Allowed scope: PHM-E strict Safety supersession projection, pure resolved/active queries, focused verification and direct status documentation.
- Non-goals: Planner or PHM-A/B/C/D semantic changes; Memory, User Model, Batch 2, schema/migration, deployment, persistent lifecycle state, aggregate or wording-rule expansion.
- Baseline: Branch `codex/planner-handoff-migration`, HEAD `ea20480`; the only pre-existing dirty path is the user's unrelated `AGENTS.md` change, which is preserved and excluded.
- Round budget: one implementation pass and at most two evidence-driven repair passes for the same frozen PHM-E gate.
- Status: PHM-E repair pass 1 closed execution-turn binding and duplicate-source ambiguity and added Safety-specific rollback/retry evidence; independent Reviewer returned `PASS`, and focused, TypeScript, ESLint, diff and final `npm run check:launch` (exit 0) gates pass. PHM-E is sealed pending the main-thread Git seal.

## Team

| Role | Owner | Permission | Deliverable |
|---|---|---|---|
| Delivery lead | `PM 总控台｜慢聊小记` | integrate | Freeze each slice, assign work, integrate evidence and declare completion |
| Product and clinical contract reviewer | `慢聊小记｜产品与临床合同审查` | read-only | Check PRD, clinical, Safety and response contracts; flag true conflicts only |
| Architecture investigator | `慢聊小记｜架构调查` | read-only | Locate the first causal boundary and smallest valid modification surface |
| Builder | `慢聊小记｜实现工程师` | scoped write | Own the exclusive implementation file set for one frozen slice |
| Independent verifier | `慢聊小记｜独立验收` | read-only | Verify frozen gates and reproducible regressions without inventing requirements |
| Release steward | `慢聊小记｜发布与基线` | read-only until authorized | Classify checkpoints, verify release evidence and prepare rollback boundaries |

## Evidence ledger

| Gate | Evidence | Status | Owner |
|---|---|---|---|
| Classify all 199 baseline paths into current slice / evidence / governance | 62 reviewable source/contract paths; 136 verification/evidence paths; 1 repository-governance path | pass | Delivery lead |
| Name the canonical product and clinical contracts for this slice | PRD V1; Hill product contract; Conversation OS control closure; time-ordered batch 1.5 positive-function contracts | pass | Product and clinical reviewer |
| Freeze the smallest relevant check set before another implementation pass | stage2, preservation, post-candidate4, `git diff --check`, then `check:launch` | pass | Delivery lead |
| Pass the frozen narrow checks | stage2, preservation, and post-candidate4 exit 0; `git diff --check` exit 0 | pass | Independent verifier |
| Pass the full local engineering gate | `npm run check:launch` exit 0, including 12 applied Prisma migrations and a successful 39-page production build | pass | Delivery lead |
| Confirm no product-boundary drift or unrelated overwrite | No contract conflict; batch 1.5 remains default-off; no runtime code changed during containment | pass | Independent verifier |
| Pass the Batch 1.5-E complete frozen gate | Qwen `qwen3.7-max`, frozen dataset SHA `12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243`, 60/60 Functional and Machine pass, 0 constraint failures, 5/60 regeneration | pass | Delivery lead |
| Unify authoritative Batch 1.5 status | Architecture v1, PRD, Clinical Logic and migration plan point to Batch 1.5-E `passed_and_closed`; historical failures preserved | pass | Delivery lead |
| Classify and scan the baseline upload | 62 source/contract paths, 136 verification/evidence paths, 1 governance path; no private key/token/real `.env`; largest file about 2.3 MB | pass | Release steward |
| Re-run frozen and full engineering gates for the seal | Batch 1.5, preservation, Stage 2, post-candidate4 and Conversation OS architecture pass; `check:launch` exit 0 with 12 migrations, 27 Miniapp JS files and 39-page production build | pass | Delivery lead |
| Authorize commit and push of the stable baseline | User explicitly authorized stage/commit/push; all pre-commit gates passed; the commit containing this ledger is the seal | pass | Delivery lead |
| Freeze v1 formal Helping metadata schema | `schemaVersion=1`, `state=formal`, strict `CommittedHelpingMove` structural and Hill compatibility validation | pass | Delivery lead |
| Prove legacy and Shadow isolation | Legacy ordinary projects with `helping=null`; unversioned Helping, unknown version/field, `state=shadow`, `mode=shadow`, nested Shadow markers and complete Shadow trace all fail closed | pass | Delivery lead |
| Remove the chat-history blind cast without decision-state injection | Session message history uses the strict parser and projects only `assistantMove`; `parsedMetadata.helping` is not consumed | pass | Delivery lead |
| Pass the Batch 2A contract regression | `npm run check:hill-helping-batch2a` exit 0, including serializer pre-validation counterexample | pass | Delivery lead |
| Preserve existing architecture and lifecycle | Batch 1, Batch 1.5, Conversation OS control/architecture, AI orchestration and chat execution lifecycle checks exit 0 | pass | Delivery lead |
| Pass the full engineering gate after Batch 2A | `npm run check:launch` exit 0; 12 Prisma migrations current, 27 Miniapp JS files valid, 39-page production build succeeds | pass | Delivery lead |
| Load formal fixtures in a bounded committed-order window | 10 valid formal fixtures; default latest 8; reversed input still loads in committed order | pass | Delivery lead |
| Retain an explicit older formal target | Target at order 1 is loaded with latest 7; total remains bounded at 8 | pass | Delivery lead |
| Require target-bound semantic association | direct response, continuation and correction/rejection pass; missing, stale, ambiguous, conflicting, topic-shift and unclear evidence fail closed | pass | Delivery lead |
| Preserve formal/Shadow/ordinary isolation in Batch 2B | `state=shadow`, complete Shadow trace, unknown version, legacy ordinary, User role, cross-session and identity mismatch load 0 Helping moves | pass | Delivery lead |
| Pass `B2-Initiative-Isolation` | No production consumer; no initiative/model/memory inputs in association module; natural-chat and proactive-greeting checks exit 0 | pass | Delivery lead |
| Preserve Batch 2A and visible behavior | Batch 2A, Batch 1, Batch 1.5, preservation, Conversation OS and AI orchestration checks exit 0 | pass | Delivery lead |
| Pass the full engineering gate after Batch 2B | `npm run check:launch` exit 0; 12 Prisma migrations current, 27 Miniapp JS files valid, 39-page production build succeeds | pass | Delivery lead |
| Freeze Batch 2C authority and scope | `Batch 2C — Reaction Assessment Contract Gate`, gate id `B2-Reaction-Shadow`, shadow-only and fixture-only | pass | Delivery lead |
| Freeze reaction epistemic boundaries | Strict Reaction Candidate schema; `reactionEvidenceKnown` separated from `impactKnown`; causality and success are not inferred | pass | Delivery lead |
| Preserve zero downstream integration | Contract prohibits Memory, User Model, Planner, Prompt, Surface, Validator, Initiative, formal persistence and production consumers | pass | Delivery lead |
| Pass Batch 2C-A semantic derivation | 10 reaction fixtures cover acceptance, action result, pressure, correction, no-attribution, awareness, causal counterevidence, topic shift, unclear and complementary reactions | pass | Delivery lead |
| Pass Batch 2C-A binding and fail-closed gate | 24 counterexamples cover strict keys/types, formal target/session/plan uniqueness, source turn, provenance, relation compatibility and invalid envelopes | pass | Delivery lead |
| Preserve Shadow and production isolation | Fixture evaluator is absent from the Helping production barrel and has 0 production consumers; user-visible behavior changes = 0 | pass | Delivery lead |
| Preserve adjacent Batch 2 and Conversation OS gates | Batch 2A, Batch 2B, Conversation OS architecture and natural-chat control checks exit 0 | pass | Delivery lead |
| Freeze the seven Interaction Move Handoff boundaries | Authoritative v1 contract covers envelope, User relation, greeting function, completion, Planner, Validator and Guest/authenticated parity | pass | Delivery lead |
| Preserve architecture and domain isolation | Completion is an immutable committed-event edge projection; no persistent lifecycle state, Memory, Batch 2 or User Model integration is authorized | pass | Delivery lead |
| Preserve the docs-only boundary | Change inventory contains four documentation paths and zero runtime, schema, migration or test paths | pass | Independent verifier |
| Create the envelope only at the committed boundary | Auth transaction binds envelope identity to the real message id; Guest creates it only after `VALIDATED`; failed and rejected executions return none | pass | Delivery lead |
| Prove retry-loser and rollback isolation | Two distinct concurrent generation attempts yield one Assistant message and exactly one persisted envelope; invalid commit and transaction rollback yield none | pass | Delivery lead |
| Preserve Guest/authenticated logical parity | Both proactive and ordinary paths project the same v1 logical shape and round-trip it through history/client cache | pass | Delivery lead |
| Preserve adjusted slice boundary | Planner legacy `promptVersion` remains; no Planner, Memory, User Model, Batch 2 or schema path is modified | pass | Independent verifier |
| Implement PHM-A Context and User relation projection | Strict adjacent committed `opens` target, eight relation kinds, exact current-User spans, ambiguity preservation and Guest/authenticated logical parity pass the dedicated gate | pass | Delivery lead |
| Pass PHM-A-R independent repair verification | One private proactive-open type guard removes three compile errors without changing target, relation, parser or fail-closed semantics; all frozen narrow gates pass independently | pass | Independent verifier |
| Pass the full engineering gate before PHM-A seal | `npm run check:launch` exits 0 with 12 current migrations, 27 Miniapp JS files and a successful 39-page production build | pass | Delivery lead |
| Locate the PHM-B causal boundary | PHM-A reaches `createResponsePlan`, but the Planner ignores `userMoveRelation` and still detects greetings from `promptVersion`; `ResponsePlan` and preflight contain no handoff plan | pass | Architecture investigator |
| Freeze the complete PHM-B transition tuple | Authoritative contract covers activation, all supported relation/source-function pairs, completion intent, question policy, ordinary-action composition and typed defer | pass | Delivery lead |
| Freeze ambiguity and reciprocal-contact semantics | Compatible candidate collapse, incompatible defer, trace-only selection on defer and the positive reciprocal-contact postcondition are explicit without wording rules | pass | Product and clinical reviewer |
| Preserve the PHM-B docs-only boundary | Seven PHM-B documentation/governance paths only; concurrent project-team initialization artifacts remain separately classified; runtime, schema, migration and verification source are unchanged | pass | Independent verifier |
| Implement the PHM-B Planner transition | Sole `createResponsePlan` consumes PHM-A projection; complete tuple, priority, ambiguity, typed defer and Guest/authenticated-equivalent cases pass | pass | Builder |
| Close the detached authority trust boundary | Snapshot precedes Planner, is deep-cloned and recursively frozen, and exact nullable plan/obligation/canonical-provenance comparisons reject coordinated mutation | pass | Independent verifier |
| Preserve downstream boundaries | No Prompt/Surface, semantic Validator, committed edge, persistence, Memory, User Model or Batch 2 implementation change | pass | Architecture investigator |
| Pass PHM-B/AUTH full engineering gate | Dedicated and adjacent gates, TypeScript, focused ESLint and `check:launch` exit 0; 12 migrations, 27 Miniapp JS files and 39-page production build pass | pass | Delivery lead |
| Implement PHM-C Surface and semantic validation | Exact tuple/history projection, strict semantic verdict, frozen execution plan, bounded same-plan retry and external prompt inspection pass | pass | Builder |
| Close PHM-C independent attacks | Mutable-plan drift, architecture whitelist and loose JSON parser attacks are independently reversed with no P0-P3 | pass | Independent verifier |
| Pass PHM-C full engineering gate | Dedicated/adjacent/TypeScript/ESLint plus `check:launch`; 12 migrations, 27 Miniapp JS files and 39-page production build pass | pass | Delivery lead |
| Implement PHM-D validated committed completion | Exact frozen target/function, final-attempt and plan/turn bindings produce winner-only `fulfills`; defer/null/reject/failure/Safety/rollback produce none | pass | Builder |
| Close PHM-D independent attacks | Outer same-plan-id target/function mutation and REJECTED-final-attempt attacks reversed; no P0-P3 | pass | Independent verifier |
| Preserve PHM-D isolation | Pure `handoffCompleted`; no lifecycle persistence, schema, Memory, User Model, Batch 2 or Planner/Surface/Validator semantic change | pass | Delivery lead |
| Pass PHM-D full engineering gate | `check:launch` exit 0; 12 migrations, 27 Miniapp JS files and 39-page production build pass | pass | Delivery lead |
| Close PHM-E repair pass 1 | Execution-turn misbinding and duplicate-source ambiguity are fail closed; Safety retry-loser and transaction rollback evidence pass | pass | Builder / Independent verifier |
| Pass PHM-E independent review | Final independent Reviewer verdict is `PASS`; original Safety supersession and pure-query acceptance is satisfied without unnecessary changes | pass | Independent verifier |
| Pass PHM-E full engineering gate | Final `npm run check:launch` exits 0; 12 migrations, 27 Miniapp JS files and 39-page production build pass | pass | Delivery lead |

## Change inventory

Batch 2A slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Runtime and contract source | 3 | Helping metadata module/export; chat-history read boundary | Review for fail-closed parsing and zero decision-state injection |
| Verification wiring | 2 | Batch 2A regression script; package gate registration | Review as executable acceptance evidence; no generated model output |
| Contract and status docs | 6 | Batch 2A contract plus architecture, PRD, Clinical, migration and project ledger updates | Review for authority/status consistency |

Batch 2B slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Fixture-only infrastructure | 2 | Helping association module/export | Verify no production consumer or decision-state injection |
| Verification wiring | 3 | Formal fixtures, Batch 2B check, package gate | Executable association/isolation evidence only |
| Status documentation | 5 | Implementation report, architecture, Clinical, migration and project ledger | Keep Batch 2A frozen and Batch 2C explicitly out of scope |

Batch 2C Contract Freeze slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Authoritative contract | 1 | Batch 2C Reaction Assessment Contract v1 | Verify reaction-only, Shadow-only, fixture-only and fail-closed semantics |
| Authority/status documentation | 3 | Project ledger, Architecture v1 and Hill migration plan | Verify the Batch 2C name and zero downstream integration are consistent |
| Runtime or verification source | 0 | None | No evaluator, fixture runner, production consumer or formal reaction state is authorized |

Batch 2C-A fixture implementation slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Fixture-only evaluator | 1 | `services/helping/reactionAssessmentFixture.ts` | Verify strict parsing, bindings, known derivation, fail-closed output and no export to production barrel |
| Verification wiring | 3 | semantic fixtures, Batch 2C-A check and package gate | Executable fixture evidence only; no generated model output or runtime entry point |
| Status documentation | 4 | implementation report, architecture, migration plan and project ledger | Record fixture gate completion without claiming runtime/formal state or downstream integration |

Interaction Move Handoff Contract v1 freeze slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Authoritative contract | 1 | `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` | Verify all seven boundaries, event-edge completion and explicit implementation status |
| Authority/status documentation | 3 | Project ledger, Architecture v1 and Conversation State Design v1 | Keep the authoritative contract linked and phase state separate from handoff lifecycle |
| Runtime, schema, migration or verification source | 0 | None | No implementation or behavior claim is authorized by the freeze |

Interaction Move Envelope implementation slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Envelope and delivery runtime | 12 | Conversation OS envelope/export; AI lifecycle, generation and commit services; Guest/authenticated API and client projections | Verify committed-only identity, logical parity and namespace isolation |
| Verification wiring | 4 | Envelope check, lifecycle and proactive checks, package gate | Verify strict parsing, preselected greeting function, retry loser and failure/rollback isolation |
| Status documentation | 3 | Contract, Architecture v1 and project ledger | Record partial implementation without claiming Planner handoff completion |

PHM-A Context and User relation projection slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Context and relation runtime | 7 | Conversation message/control types, Context Assembly, Turn Interpretation, handoff projection, control export and interpretation adapter | Verify strict adjacent target, exact spans, ambiguity and zero Planner selection |
| Verification wiring | 2 | PHM-A dedicated check and package gate registration | Verify normal, edge, ambiguous, context-switching and adversarial fail-closed cases |
| Status documentation | 4 | Interaction Move contract, Architecture v1, Conversation State Design and project ledger | Record PHM-A completion without claiming Planner, Validator or committed-edge completion |

PHM-B Planner Handoff Transition Contract Freeze slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Authoritative contract refinement | 1 | `docs/CONVERSATION_OS_INTERACTION_MOVE_HANDOFF_CONTRACT_V1.md` | Freeze the executable Planner transition mapping inside the existing single authority; create no parallel contract |
| Architecture and governance status | 2 | `docs/ARCHITECTURE_V1_FINAL.md`; `PROJECT_TEAM.md` | Record PHM-B as frozen docs-only and runtime/Validator/edges as pending |
| Project-team current-slice synchronization | 4 | `.project-team/ACTIVE_SLICE.md`; `.project-team/EVIDENCE.md`; `.project-team/DECISIONS.md`; `.project-team/REMAINING.md` | Replace the completed team-initialization slice as current without modifying reusable role profiles |
| Runtime, schema, migration or verification source | 0 | None | No production behavior or test claim is authorized by the freeze |

PHM-B Planner runtime plus PHM-B-AUTH seal:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Conversation OS / AI runtime | 8 | Context presence projection, control types/exports, handoff projector, Response Planner, detached authority, execution preflight and production orchestration | Verify one Planner owner, pre-plan snapshot timing, exact authority and no mutable alias |
| Verification wiring | 4 | PHM-B dedicated gate, two adjacent fixture updates and package registration | Verify total mapping, Guest/Auth parity, invalid-v1 isolation and adversarial fail-closed cases |
| Authority/status documentation | 8 | Contract, Architecture v1, AI service README, root ledger and four `.project-team` ledgers | Record PHM-B/AUTH completion without claiming Surface, semantic Validator or committed completion |
| Out-of-scope runtime/schema | 0 | None | No Prompt/Surface, semantic Validator, edges, persistence, Memory, User Model or Batch 2 changes |

PHM-D validated committed completion slice:

| Class | Count | Paths | Review treatment |
|---|---:|---|---|
| Conversation OS / delivery runtime | 6 | Envelope/query/export; Auth and Guest commit projection; frozen execution-plan pass-through | Verify exact validated-plan/final-winner binding without decision-semantic changes |
| Verification wiring | 2 | Envelope and database lifecycle regressions | Verify fulfill/defer/query, outer-plan mutation, retry loser, rollback and final-attempt fail-closed cases |
| Authority/status documentation | 9 | Contract, Architecture, State Design, AI README, root ledger and four `.project-team` ledgers | Record ordinary completion without claiming Safety supersession or persistent lifecycle state |
| Out-of-scope schema/domain | 0 | None | No schema/migration, Memory, User Model, Batch 2, Safety edge or Planner/Surface/Validator semantic change |

Stable-baseline seal inventory (historical):

| Class | Count | Path rule | Review treatment |
|---|---:|---|---|
| Reviewable source and contracts | 62 | Runtime/persistence source, product/architecture docs and `docs/HILL_HELPING_*.md` contracts | Review as the Conversation OS / Batch 1.5 source increment |
| Verification and evidence | 136 | Check/eval scripts, `clinical-evals/**`, `docs/evals/**`, and this ledger | Review separately from runtime source; generated evidence is not a new product requirement |
| Repository governance | 1 | `AGENTS.md` | Preserve as repository instruction; exclude from product behavior claims |

## Decisions

| Date | Decision | Evidence | Consequence |
|---|---|---|---|
| 2026-08-03 | Enter containment before creating another candidate or evaluation artifact | Large mixed worktree plus repeated candidate and preservation artifacts | Next round begins with inventory and frozen gates, not more implementation |
| 2026-08-03 | Close the local increment without claiming batch 1.5 external quality acceptance | Local gates pass, while candidate 6 remains 53/60 with 40% regeneration and 10/60 true functional failures | Stop candidate 7 and regex patches; keep the feature default-off |
| 2026-08-03 | Locate the next causal boundary at Surface realization | Candidate 5 and 6 audits show free-text Surface can add unsupported topics, events, pause, and normalization despite same-plan validation | A structured finite-action Surface requires a new product/architecture contract and is outside this slice |
| 2026-08-04 | Mark Batch 1.5-E complete frozen gate as passed and close the repair slice | Batch 1.5-E achieves 60/60 Functional and Machine pass, 0 constraint failures, 8.33% regeneration, and no final Surface drift or Validator FP/FN | Supersede the earlier Candidate 6 external-gate status; stop expanding this repair round |
| 2026-08-04 | Seal and upload the complete stable baseline | User authorized authoritative status synchronization, baseline sealing and Git upload | Commit only after classification, secret scan and frozen/full gates pass |
| 2026-08-04 | Approve Batch 2 infrastructure-only | Stable-baseline architecture review is Go for state/association/commit infrastructure | No user-visible Hill behavior, User Model integration, deployment or Batch 3 authorization |
| 2026-08-04 | Freeze Batch 2A `B2-Contract` | Strict v1 round-trip, fail-closed counterexamples, Shadow isolation, runtime ordinary-only projection and full launch gate pass | Batch 2B may begin only as fixture load/association infrastructure; formal production writes remain unauthorized |
| 2026-08-04 | Pass Batch 2B fixture load/association gate | 17 fixture records, bounded chronological load, explicit older target, target-bound semantic association, Shadow/ordinary isolation and visible-behavior preservation | No production loader/writer or reaction state; Batch 2C is not created by this slice |
| 2026-08-04 | Freeze Batch 2C `B2-Reaction-Shadow` contract | User authorized a docs-only Reaction Assessment Contract Freeze after Batch 2B association | Batch 2C now means reaction-only, Shadow-only and fixture-only; prior Atomic Boundary naming is superseded for the current roadmap, while implementation and downstream integration remain unauthorized |
| 2026-08-04 | Pass Batch 2C-A fixture Reaction Shadow evaluator | 10 semantic fixtures, 24 fail-closed cases, strict parser/typecheck and adjacent architecture gates pass with zero production consumers | Fixture evaluation is now executable evidence only; runtime, formal reaction state, downstream consumers and Batch 2D remain unauthorized |
| 2026-08-04 | Freeze Conversation OS Interaction Move Handoff Contract v1 | Architecture review found that proactive greeting provenance did not establish a positive completion postcondition | Handoff completion is now defined by target-bound relation, Planner-selected function, semantic validation and an immutable committed-event edge; runtime implementation remains separately unauthorized |
| 2026-08-04 | Implement the committed Assistant move envelope foundation | Strict envelope checks, Guest/authenticated projections and database-backed commit/retry/rollback regressions pass | Planner legacy remains; User relation, `fulfills`, Safety `supersedes` and completion validation are deferred to Planner Handoff Migration |
| 2026-08-04 | Seal PHM-A Context and target-bound User relation projection | Dedicated and adjacent gates, TypeScript, independent PHM-A-R verification and full `check:launch` pass | Planner selection, `promptVersion` migration, Validator proof and committed completion edges remain separate later slices |
| 2026-08-05 | Freeze PHM-B Planner Handoff Transition Contract | Runtime audit locates the first remaining causal boundary at the sole `createResponsePlan`; contract review identifies and closes tuple, ambiguity and reciprocal-contact gaps | A later Planner-only implementation may consume PHM-A and remove `promptVersion` from the v1 transition path, but this freeze changes no runtime behavior |
| 2026-08-05 | Seal PHM-B runtime with independent PHM-B-AUTH | The user approved a separate authority slice after two PHM-B exact-preflight failures; detached recursive freeze, exact comparison, independent adversarial review and full launch gate now pass | Seal the runtime and trust-boundary changes as one checkpoint against `bb38951`; Surface, semantic Validator and committed edges remain separate |
| 2026-08-05 | Seal PHM-C Surface and same-plan semantic validation | Full tuple projection, strict independent verdict, frozen execution plan, repair-pass adversarial verification and full launch gate pass | User-visible candidates can no longer pass through legacy presence-confirmation semantics; committed completion edges remain separate |
| 2026-08-05 | Implement PHM-D ordinary committed completion | User authorized only validated committed completion edges and query; independent repair verifies exact frozen-plan and final-winner binding | Ordinary `fulfills` and pure `handoffCompleted` are implemented without lifecycle state; Safety supersession remains separate |
| 2026-08-05 | Implement PHM-E Safety supersession and pure resolved/active queries | User authorized this as one isolated slice while continuing to prohibit persistent lifecycle state | Active adjacent Safety winners write immutable `supersedes`; no-target Safety remains envelope-free and all lifecycle answers are reconstructed |
| 2026-08-05 | Seal PHM-E pending Git seal | Repair pass 1 closes the named adversarial gates; independent Reviewer returns `PASS`; final `npm run check:launch` exits 0 | PHM-E acceptance is closed without persistent lifecycle state; the main thread owns staging and commit |

## Remaining

- No remaining implementation is authorized inside the Batch 1.5-E repair slice.
- One attempt-level pressure-repair Validator false positive remains recorded as a non-blocking observation; addressing it requires a new independently approved task.
- Batch 2A, Batch 2B association and Batch 2C-A fixture Reaction Assessment gates are complete. No production Reaction Assessment runtime exists.
- Production/DB loading, Atomic Boundary proof and formal Helping writes remain unimplemented and have no current Batch 2C authorization.
- Production ordinary flow still writes no `CommittedHelpingMove`; the positive formal serializer path remains fixture-only until a separately approved Atomic Boundary gate.
- Interaction Move Handoff Contract v1 envelope foundation and PHM-A through PHM-E are implemented without persistent lifecycle state.
- Deployment, default-on, Batch 3 and User Model behavior remain unauthorized.

## Closure status

- Local containment slice: complete and included in the stable-baseline seal.
- Batch 1.5-E product-quality gate: passed and formally closed on 2026-08-04; this supersedes the earlier Candidate 6 current-status conclusion without rewriting historical evidence.
- Stable-baseline Git seal: the commit containing this ledger is the seal; its exact pushed SHA is recorded in the delivery report.
- Batch 2A Contract Gate: complete; v1 formal metadata and formal/Shadow isolation are frozen.
- Batch 2B Fixture Load and Association Gate: complete within fixture-only scope; no production consumer exists.
- Batch 2C Reaction Assessment Contract Gate: frozen under `B2-Reaction-Shadow`; Batch 2C-A fixture-only evaluator and regressions pass, while runtime and downstream integration remain absent.
- Interaction Move Handoff Contract v1: frozen as the authoritative Conversation OS target; envelope and PHM-A through PHM-E are implemented without persistent lifecycle state or schema migration.
- Atomic Boundary and later Batch 2 work do not inherit authorization for user-visible behavior, formal production writes or downstream integration.
- Further expansion of the Batch 1.5 repair round: stopped.

## Loop guards

- Freeze acceptance before implementation.
- Do not create a new candidate or artifact without a named failed gate.
- Stop after two repair passes for the same gate and request one decision.
- Finish when the frozen gates pass; optional improvements remain optional.
