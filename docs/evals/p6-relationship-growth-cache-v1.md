# P6 Relationship/Growth Cache V1 — local candidate

Status: isolated local candidate only. Production integration, real P4/P5
runtime wiring, scheduler activation, real-user data and provider calls remain
explicitly pending/forbidden.

## Frozen authority and gate

- Preaudit version: `p6-preaudit-gold-v1`.
- Exact descriptor SHA-256:
  `9b3a15b4de5c5f59a3a9f9ca99a45f622acff3ea4c2386d56ee116a100fcf75c`.
- Principal & Cache Time Integrity Authority descriptor SHA-256:
  `22926f8792dd8d59a8eb6d7d8ab0128789aa53a8603fca2a0338da4f6c839169`.
- Principal & Cache Time repair1 descriptor SHA-256:
  `dfc34c18069a749f6591c64342f6b678948c68d28e70628314c835f690194236`.
- The verifier records each descriptor ID only after its matching assertion and
  requires exact set equality with all 47 frozen IDs.
- Input authority: `p6_local_fixture_snapshot_v1`. Fixtures have exact keys,
  tenant, source id/version, current/accepted state and artifact hash. Callers
  cannot provide user id, source id/version, free-form content or classification.
  Every API accepts only session credentials. A module-private factory derives
  the stable User id from an exact, unexpired Session id/token-hash pair;
  mismatched, expired or cross-tenant credentials fail. No public API mints a
  principal and fixture classification/source version remain catalog-owned.
  Authentication expiry always uses the module-private process clock; caller
  evaluation timestamps can neither extend nor revive an expired session.

## Cache-only boundary

Relationship and Growth outputs are current-only derived caches. They carry
cache version, exact source Memory version ids, UTC cycle and an explicit
`derived_optional` authority label. Facts remain facts; hypotheses remain
`HYPOTHESIS` and cannot be rewritten as facts. Safety, secret and credential
fixtures contribute zero cache items.

Read validation rebinds every payload item one-to-one to an accepted, current,
visible snapshot of the same tenant and projection. Source ids must be unique,
sorted and cardinality-exact; item order, source version, claim kind and text
must all match. Recomputed payloads that add, drop, reorder, reclassify or move
items across Relationship/Growth projections degrade to empty.

Each cache commits canonical payload bytes with an authority-keyed HMAC-SHA-256.
The process-local key is module-private and never stored in the database or
exposed through an audit/recompute helper. The commitment
includes authority version, `generatedAt`, `staleAt`, frozen TTL and each source
snapshot artifact hash. Reads require `generatedAt <= now` and
`staleAt === generatedAt + TTL`; DB-time, payload-time, TTL, commitment or
snapshot tampering degrades to empty.

The implementation writes only P6 fixture snapshots, P6 caches and P6 targeted
recompute requests. It does not write Conversation, SemanticMemory, Planner,
Surface, event or commitment authority.

## Degradation and deletion

Cache miss, stale/current-cycle mismatch, malformed or extra-key payload,
timeout, deleted source and unknown source visibility all return the same empty
optional enhancement. None changes chat state or blocks ordinary chat.

Local deletion marks only caches sourced by the deleted version, invalidates
that cache and creates an idempotent targeted recompute request. This proves
the mechanism locally; real P5 deletion-event integration remains pending.

Relationship current cycle is the UTC hour. Growth current cycle is the UTC
calendar month. Relationship cache is stale after one hour; Growth cache uses
the daily rebuild target while retention remains governed by the parent
Hot/Cold contract.
