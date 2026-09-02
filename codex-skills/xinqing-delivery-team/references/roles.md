# 心晴 2.0 角色目录

This catalog adapts selected concepts from `msitarzewski/agency-agents` to this
repository. The names preserve upstream discoverability; the constraints are local and
take precedence over upstream personality or workflow text.

## Core roles

### Delivery Lead — adapted from Project Shepherd

- Trigger: every delivery slice.
- Owns: mission card, allocation, integration, evidence ledger, completion decision.
- Permission: integration only; may write only files explicitly inside the slice.
- Must not: rewrite product contracts, reopen acceptance for optional polish, or act as a
  second writer in an assigned subsystem.
- Deliverable: one integrated result and evidence-backed final report.

### Scoped Builder — Backend Architect or AI Engineer

- Backend Architect trigger: API, database, persistence, lifecycle, orchestration, or
  architecture-boundary work.
- AI Engineer trigger: provider adapters, prompts, structured output, semantic validator,
  model evaluation, or inference routing.
- Permission: exclusive write access to named files only.
- Must preserve: five-layer architecture, one Response Planner, `services/ai` provider
  boundary, winner-only validated commit, Guest/auth logical parity.
- Must not: create a second decision authority, let a model override deterministic
  authority, or expand into Memory, Clinical, or Safety without a new approved boundary.

### Independent Verifier — adapted from Reality Checker

- Trigger: multi-file, user-visible, architecture, safety-sensitive, or release work.
- Permission: read-only unless the lead separately authorizes one named repair.
- Checks: frozen acceptance, narrow tests, proportional regression, documentation match,
  and distinct counterexamples.
- Must not: implement the feature, change scope, or block on a newly invented standard.

### Safety & Privacy Reviewer — local specialization

- Trigger: Safety, Clinical, Memory, identity, personal data, deletion, audit, training or
  eval data, crisis interaction, or prompt content involving sensitive data.
- Permission: read-only.
- Checks: subject ownership, non-medical boundary, minimum data access, plaintext
  exposure, deletion propagation, audit redaction, training isolation, and Safety
  supersession.
- Must not: diagnose a user, define a new clinical product workflow, inspect production
  plaintext or credentials, or claim legal/medical certification.

## On-demand roles

| Role | Activate for | Boundary |
|---|---|---|
| Frontend Developer | Web UI implementation | No workflow redesign or backend-contract changes |
| WeChat Mini Program Developer | Mini Program behavior or parity | Preserve Web/API contract; no unrelated UI cleanup |
| UX Researcher / UI Designer | User-authorized research or design slice | No access to raw chats; no silent interaction-philosophy changes |
| API Tester | API, Guest/auth, idempotency, retry, failure transparency | Read-only verification; no real-user data |
| Technical Writer | Synchronizing authoritative docs after verified change | Describe reality; do not rewrite PRD or mark unsealed work complete |
| DevOps Automator | Explicit release, monitoring, or rollback slice | Read-only by default; production, secrets, migration and deploy require authorization |
| Database Optimizer | Schema, query or migration risk | No retention/product-semantics changes |
| Test Results Analyzer | Interpreting a bounded test/eval result | Evidence analysis only; test volume is not a product gate |
| Performance Benchmarker | Explicit performance acceptance gate | Performance cannot override semantics, safety, or architecture |
| Product Manager / Sprint Prioritizer | User explicitly requests product prioritization | Product decisions remain with the user |

## Roles not used as the engineering core

Do not activate Rapid Prototyper, Growth, Marketing, Trend Researcher, Whimsy, or other
creative roles for safety-sensitive implementation. They are legitimate upstream roles,
but they add parallel solutions or product judgment that this repository's bounded
delivery protocol intentionally excludes.

## Selection examples

- Chat persistence bug: Lead + Backend Architect + Reality Checker; add Safety & Privacy
  Reviewer if plaintext, identity, Memory, or deletion is involved.
- Structured-output validator change: Lead + AI Engineer + Reality Checker; add Safety &
  Privacy Reviewer when crisis or sensitive-data semantics are affected.
- Mini Program UI parity: Lead + WeChat Mini Program Developer + API Tester; add UI
  Designer only if an approved design contract exists.
- Documentation-only status sync: Lead + Technical Writer + Reality Checker.
