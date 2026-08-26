# P3 HardFacts Surface Authority V1

Status: local/default-off authority under authorization 48217. No production route, provider default, Qwen call, database write or deployment integration.

The authority imports `ASSISTANT_GROUNDING` and freezes its canonical assistant projection. Callers cannot provide or override facts. V1 binds `assistant.displayName=小慢` and `assistant.kind=AI聊天助手` to a canonical SHA-256 plan hash.

Before each complete provisional segment is emitted, and again for the whole final reply, an injected semantic provider must return an exact-schema decision bound to authority version, plan hash, scope, text hash, reply hash and UTF-16 range. `consistent`, `contradiction` and `uncertain` require one or more ordered, unique, non-overlapping evidence spans whose hashes are recomputed from the referenced UTF-16 slices; `not_applicable` requires zero evidence. Only `consistent` and `not_applicable` release text. Contradiction, uncertainty, malformed, misbound, timeout and provider failure stop before the affected text is appended. No name lexicon or regular expression decides semantics.

Structured Composer claims remain an additional binding check; they cannot override contradictory reply prose. Memory remains under `untrusted_memory_data`, and a memory-induced false identity in reply prose is blocked by the same surface authority.

Commit faults are classified separately from generation and Safety failures. A transient commit fault records `PERSISTENCE_ERROR` with `failed_retryable`; a second local run reacquires the same publication identity and can commit. Safety and generation failures remain terminal.
