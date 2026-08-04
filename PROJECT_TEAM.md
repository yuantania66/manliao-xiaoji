# Project Team

## Project outcome

Ship a coherent, clinically safe Conversation OS in reviewable increments without mixing product redesign, implementation, and unbounded evaluation loops.

## Active delivery slice

- Outcome: Freeze Batch 2C as the authoritative Reaction Assessment Contract Gate without implementing reaction evaluation or changing runtime behavior.
- Acceptance: The new v1 contract and three authority/status documents consistently name `B2-Reaction-Shadow`, freeze the Reaction Candidate and `reactionEvidenceKnown` / `impactKnown` semantics, require fail-closed behavior, and prohibit every downstream integration.
- Allowed scope: `docs/HILL_HELPING_BATCH2C_REACTION_ASSESSMENT_CONTRACT_V1.md`, this project ledger, Architecture v1 and the Hill migration plan.
- Non-goals: Runtime, evaluator, fixtures/regression implementation, production/DB loader or writer, Planner, Prompt, Surface, Validator, Memory, User Model, Initiative, formal reaction state, Atomic Boundary, deployment or user-visible Hill behavior.
- Baseline: Branch `batch-2b-fixture-association`, HEAD `5b20ada64783401e28f9162cefe78e5b41eddc15`, clean at slice start.
- Round budget: 1 investigation + 1 implementation + at most 2 repairs per failed gate

## Team

| Role | Owner | Permission | Deliverable |
|---|---|---|---|
| Delivery lead | Main Codex task | integrate | Freeze the slice, assign work, integrate evidence, declare completion |
| Product and clinical contract reviewer | Team member when invoked | read-only | Identify the canonical PRD, clinical, and response contracts; flag true conflicts only |
| Architecture investigator | Team member when invoked | read-only | Classify the worktree and locate the first causal boundary for any failed gate |
| Builder | Team member when invoked | scoped write | Make the smallest fix inside named files; no cross-layer redesign |
| Independent verifier | Team member when invoked | read-only | Run frozen gates and report reproducible failures without inventing new requirements |

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

## Remaining

- No remaining implementation is authorized inside the Batch 1.5-E repair slice.
- One attempt-level pressure-repair Validator false positive remains recorded as a non-blocking observation; addressing it requires a new independently approved task.
- Batch 2A and the fixture-only Batch 2B association gate are complete. Batch 2C now has a frozen Reaction Assessment contract, but no evaluator, fixture regression implementation or reaction runtime exists.
- Production/DB loading, Atomic Boundary proof and formal Helping writes remain unimplemented and have no current Batch 2C authorization.
- Production ordinary flow still writes no `CommittedHelpingMove`; the positive formal serializer path remains fixture-only until a separately approved Atomic Boundary gate.
- Deployment, default-on, Batch 3 and User Model behavior remain unauthorized.

## Closure status

- Local containment slice: complete and included in the stable-baseline seal.
- Batch 1.5-E product-quality gate: passed and formally closed on 2026-08-04; this supersedes the earlier Candidate 6 current-status conclusion without rewriting historical evidence.
- Stable-baseline Git seal: the commit containing this ledger is the seal; its exact pushed SHA is recorded in the delivery report.
- Batch 2A Contract Gate: complete; v1 formal metadata and formal/Shadow isolation are frozen.
- Batch 2B Fixture Load and Association Gate: complete within fixture-only scope; no production consumer exists.
- Batch 2C Reaction Assessment Contract Gate: docs-only freeze complete under `B2-Reaction-Shadow`; evaluator/runtime implementation has not started.
- Atomic Boundary and later Batch 2 work do not inherit authorization for user-visible behavior, formal production writes or downstream integration.
- Further expansion of the Batch 1.5 repair round: stopped.

## Loop guards

- Freeze acceptance before implementation.
- Do not create a new candidate or artifact without a named failed gate.
- Stop after two repair passes for the same gate and request one decision.
- Finish when the frozen gates pass; optional improvements remain optional.
