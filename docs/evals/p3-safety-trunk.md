# P3 Safety Trunk — local/default-off slice

Status: isolated local implementation under authorization 48217. It is not connected to a production route, database, P2 service, real provider, UI stream or deployment flag.

`services/ai/p3SafetyTrunk.ts` is the only P3 orchestration owner. The public runner defaults off and returns without reserving a publication or calling Safety, Composer or Guard unless `enabled: true` is supplied explicitly by a local caller.

## Frozen chain

```text
local turn + in-memory five-state publication identity
  -> existing triageSafety input gate
  -> strict injected Composer stream (ordinary only)
     or existing Safety-owned generation
  -> top-level reply incremental decoder
  -> complete segment OutputSafetyGuard
  -> safe provisional append
  -> strict final output binding + final OutputSafetyGuard + HardFactsGuard
  -> commit the same in-memory publication identity
```

The output Guard has zero repair attempts. Timeout, exception, malformed result or `safe:false` fails closed. Raw provider chunks are never exposed by the result or publication port. A final fragment without terminal punctuation is one segment at provider completion.

The independent HardFacts Surface Authority imports the canonical `ASSISTANT_GROUNDING` projection; callers cannot supply replacement facts. Its injected semantic decision runs before Output Safety for every complete provisional segment and once over the whole final reply. Contradiction, uncertainty, malformed or unavailable semantic evidence fails closed. A transient commit fault is `PERSISTENCE_ERROR / failed_retryable` and may reacquire the same publication identity; Safety and generation failures remain terminal.

`firstSafeSegmentMs` uses the injected monotonic clock:

```text
first segment OutputSafety acceptance - input Safety release
```

It is not P1 candidate timing and does not freeze `[SLO-FIRST-SAFE]`.

## Data and authority boundaries

- `assistant_grounding_v3` typed canonical facts are separate from model text and Memory. Final structured claims and refs must exactly reproduce every canonical fact.
- accepted Memory categories remain under the literal `untrusted_memory_data` field. Prompt-like text stays data and has no control path.
- Safety, secret, credential, unknown, source-less or malformed Memory is excluded. Empty/error/timeout Memory degrades to empty and does not block ordinary chat.
- the local publication port mirrors P2's five states, stable `(sessionId, clientTurnId)` identity, lease owner/attempt fence, draft version, provisional versus committed distinction and replay. It is not evidence of P2 database integration.

## Explicit remaining boundary

No existing V1 or P2 file is changed. No production module imports P3. The local port cannot authorize route integration, DB writes, provisional UI, real Qwen calls, real Safety measurements or `[SLO-FIRST-SAFE]`. Those require separate slices.
