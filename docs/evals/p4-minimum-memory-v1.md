# P4 Minimum Memory V1 — local candidate

Status: implemented for isolated local verification only. No production import,
runtime switch, Qwen call or production-data access is authorized.

## Eligibility & Read Integrity Authority V1

This new authority supersedes the historical stopped caller-supplied eligibility
candidate. Its frozen 41-case descriptor hash is
`a84734324a4ff7f64f79b854a0fabf6f800ee35213ef66e3db7228f7930f76f9`.
Only an opaque local-fixture principal may request an artifact. The injected
semantic provider receives a DB-bound, current, same-tenant source request and
must return an exact-schema decision bound to its request hash and exact UTF-16
evidence. Sensitive eligibility additionally requires the exact semantic
`explicit_sensitive_memory_opt_in`, the same source id and a recomputed evidence
span hash. There is no repair and no Qwen call.

Promotion and every retrieval/profile read revalidate the current source,
artifact hash and decision payload, plus Memory content, category, sensitivity
and vector. Profile reads additionally recompute every item. Any DB mutation,
stale/deleted source, malformed payload or tenant mismatch fails closed.

Production integration remains pending. P3, Composer and P2 are unchanged.

## Profile Cache Commitment Authority V1

The frozen descriptor `p4-profile-cache-commitment-authority-v1` has SHA-256
`c5ce3b2740a39871f43985f006cee72c946b172e7b4fc5e64558f819755ccdaa`.
The projector binds each exact item and the complete ordered profile envelope
with canonical, module-private keyed HMAC-SHA-256 commitments. The reader
independently recomputes both levels after exact-schema and live source/artifact
validation. Item, order, source, tenant, version, time, content, category,
sensitivity, extra-key or commitment changes degrade to empty. A valid
zero-item projection remains a usable empty profile; a cache miss remains empty.
The process-local key is intentionally not persisted: restart safely degrades
old local/default-off caches to empty. Production integration and Qwen remain
pending/zero.

## Historical P4 result

- Promotion authority: `p4_memory_promotion_authority_v2`.
- Fixed synthetic gold SHA-256:
  `6794e129a9626266b749e5548a523164af0f9cc2afa035e9933ada478bb82b36`.
- Promotion gates: precision >= 95%, recall >= 85%, and zero false promotion
  for Safety data, secrets and sensitive data without explicit opt-in.
- Retrieval: deterministic local cosine Top-K, `K=3`, Recall@3 >= 85%,
  irrelevant injection <= 5%. Invalid, zero or cross-user vectors are excluded.
- Context: raw recent committed conversation precedes optional Memory, with a
  4,096-token / 24-message cap. Current User content and its adjacent pair are
  retained, with explicit deterministic truncation when required.
  The local candidate uses UTF-8 byte count as a deterministic conservative
  ceiling because this slice does not add or call a model tokenizer.
- Profile cache minimum fields: `userId`, `version`,
  `sourceMemoryVersionIds`, `generatedAt`, `payload`, `invalidatedAt`.
  Empty, invalidated or older-than-budget cache returns empty and cannot block chat.

## Promotion boundary

Only the seven allowlisted categories in the Hot/Cold V1 contract can be
promoted. Each accepted record is bound to one existing, same-user
ACTIVE/current `SemanticMemoryVersion`, its snapshot, ACTIVE Evidence and visible
RawMemory source. Callers provide only a persisted eligibility-artifact id; they
cannot supply source text, content or eligibility booleans. A newer explicit source supersedes the prior mutable
Memory row but never rewrites Conversation or its source version. Greetings,
passing state, hypotheses, Safety data and secrets are dropped. Sensitive data
requires an exact consent span/hash and receives the frozen 30-day expiry.

## Schema and lifecycle boundary

`P4MinimumMemory` is source-version-bound and user-scoped. `P4ProfileCache` is a
rebuildable current-only projection. P5 retention/deletion propagation and P6
relationship/growth summaries remain outside this slice.
