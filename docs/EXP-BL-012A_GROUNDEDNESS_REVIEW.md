# EXP-BL-012A Groundedness Review

## Issue Header

- Issue ID: EXP-BL-012A
- Parent: EXP-BL-012
- Category: Multi-turn groundedness / unsupported meaning
- Priority: first child diagnosis because unsupported invention damages trust
- Decision owner: Product / Experience Iteration owner
- Canonical trajectory: `TRJ-GROUND-001`
- Capture environment: `local_development` confirmed by Decision Owner; no production hotfix track required

## Product Philosophy Decision

Decision Owner statement, preserved verbatim:

> 看用户期待的是什么，慢慢帮用户挖掘出来需求。

Behavioral acceptance statement derived from A0 and the follow-up product screenshot, preserved verbatim:

> 不猜、不封口、不逼解释，同时让用户仍然愿意继续。

Engineering interpretation for this diagnosis:

- The assistant must not assume what the user wants.
- The assistant may help the user discover what they want, but only through grounded, low-pressure exploration.
- A low-information token must remain semantically unassigned when neither the user nor an explicit interaction frame has established meaning.
- When the conversation has explicitly established a scale, numbered choice, or counting frame and the user is responding within it, the assistant may use that established procedural meaning.
- An assistant-created semantic hypothesis is not an established interaction frame and must remain unconfirmed until the user accepts it.
- An assistant hypothesis must not become later-turn fact unless the user confirms it.

The groundedness contract is two-sided:

```text
unsupportedMeaning = false
conversationMovement = true
```

Avoiding invention is insufficient if the reply becomes a mechanical acknowledgement or closes the conversation.

This product philosophy applies across the wider Sprint, but EXP-BL-012A only diagnoses groundedness. It does not authorize reflect/hold-space behavior changes, new goals, new signals, or the later 012B/012C contracts.

## 1. User Problem

When the user sends low-information tokens such as `1`, `2`, and `3`, the assistant can invent an emotion, intent, activity, score, direction, or conversational frame. Later replies may then treat the assistant's own invention as shared context.

The trust failure is not merely an awkward phrase. The system can turn unknown input into unsupported meaning and carry that meaning forward.

## 2. Evidence

### Screenshot-confirmed failure

```text
User: 1
Assistant: 1。像是还在刚才那个松口气的瞬间里。

User: 2
Assistant: 好，那就先在这个松口气的感觉里待一会儿。

User: 3
Assistant: 3在这里，我不急着定义它。想顺着这个数字说点什么可以，先不说也没关系。
```

Confirmed failures:

- `松口气` was not supplied by the user.
- The unsupported emotion was carried from the first assistant reply into the second.
- The third reply withdrew certainty only partially and still implied conversational meaning.

### Additional historical screenshot

A separately supplied earlier screenshot shows the same class of behavior across `1 / 2 / q / 2 / 2 / 好吧`, including unsupported guesses about a score, interface testing, random key presses, “2 点方向”, repetition count, and an automatic invitation to start a new topic.

This is screenshot evidence of the failure class, but the exact capture environment and complete machine trace are not yet canonical fixtures. It must be transcribed and provenance-reviewed before addition to the trajectory dataset.

### Follow-up local screenshot — over-restraint and closure

```text
User: 1
Assistant: 看到你发了1，先停在这里。
```

This reply does not invent an emotion or score, but it fails the second half of the groundedness contract:

- it mechanically repeats that the user sent `1`;
- `先停在这里` closes movement without evidence that the user wants to pause;
- it offers neither a low-pressure continuation path nor a clear statement that meaning remains unknown.

The screenshot proves that a treatment can reduce `unsupportedMeaning` while still failing `conversationMovement`. A1/A2/A3 must not be accepted by measuring restraint alone.

### Current deterministic structure

For `TRJ-GROUND-001`, the current official chain consistently selects:

```text
ResponseGoal: clarify
Strategy: rogers
responseIntent: clarify
questionFunction: clarify_meaning
```

The structural route is compatible with preserving unknown meaning. The observed failure therefore occurs after or around plan rendering/history use, not because a numeric token bypasses ambiguity handling.

## 3. A0 Canonical Baseline

Command:

```bash
npm run trajectory:review:repeat
```

Run configuration:

- mode: real
- variant: canonical
- repeat count: 3
- provider/model: recorded by the trajectory report
- official entrypoint: `createChatReply()`

### A0 results for `TRJ-GROUND-001`

| Run | Turn 1 | Turn 2 | Turn 3 | Review observation |
| --- | --- | --- | --- | --- |
| 1 | `看到了这个1，我不确定你想怎么用它。` | `看到了2，我还是没太跟上节奏。` | `嗯，是3。如果想让我换个方式理解，随时说就好。` | No invented emotion; still introduces “节奏” and assumes an intended use/understanding task. |
| 2 | `看到这个1了，不确定你想怎么用它。` | `看到2了，跟着你的节奏走。` | `3也在这儿了，你想接着数还是先停一下都行。` | Attributes a user “节奏” and proposes that the user may be counting without evidence. |
| 3 | `看到这个1了，不确定你想怎么用它。` | `嗯，又看到一个2。` | `又看到3了，想顺着这个数字聊一点，还是就先这样都行。` | Avoids emotion invention but still assigns a possible conversational purpose to the sequence. |

### A0 conclusion

- The exact high-severity `松口气` invention did not reproduce in these three runs.
- Lower-severity unsupported framing reproduced in all three runs: “怎么用它”, “节奏”, “接着数”, “换个方式理解”, or “顺着这个数字聊”.
- Sampling variability is material; one three-run baseline cannot establish a stable fix or a single root cause.
- Existing literal checks catch known words such as `松口气` but do not decide whether a newly phrased hypothesis is grounded. Human review remains required.

The A0 real-model output is not committed as `latest`; the repository report remains deterministic replay. This table is a reviewed diagnostic summary, not a model-output baseline approval.

## 4. Candidate Root Causes

### Prompt

The Prompt already contains negative numeric restraints, but also tells the model to acknowledge, stay with, understand, and gently invite. Those abstract instructions may encourage the model to manufacture a conversational frame when no user meaning exists.

### History construction

Once the assistant invents a frame, its own prior reply is included in later history. The next turn may treat assistant-only text as shared context. An A3 history-control experiment is required to measure this carry-over.

### Model/provider compliance

The model sometimes follows the numeric restraint and sometimes invents a softer frame. Repetition is required to separate Prompt contract weakness from provider sampling/compliance variance.

## 5. Why Not Other Layers

- Why not ClinicalContext: numeric tokens are already classified as short/high-ambiguity input; no missing signal has been demonstrated.
- Why not ResponseGoal: `clarify` is structurally compatible with unknown meaning and was selected in every A0 turn.
- Why not Strategy/ClinicalPlan: the current plan says `clarify_meaning`; it does not explicitly authorize emotion, score, direction, testing intent, or counting intent. Whether it needs a stronger groundedness boundary remains unconfirmed and must not be changed inside a Prompt experiment.
- Why not Safety: no safety route is involved.
- Why not Memory: the reproduced trajectory runs without user memory evidence; the relevant carry-over is recent assistant history, not long-term memory.

## 6. Controlled Experiment Authorization

This review authorizes eval-only implementation of the following variants. It does not authorize production Prompt or history changes.

### A0 — canonical

- Current Prompt and current history construction.
- Completed for the initial three-run baseline.

### A1 — positive unknown-token contract

- Eval-scoped Prompt override only.
- Contract: when meaning has not been established by the user or by an explicit procedural frame the user is responding to, a low-information token remains an observed token with no assigned emotion, intent, score, direction, activity, or conversational purpose.
- Established-meaning exception: explicit scales, numbered choices, and counting frames may be used as defined by their context.
- An assistant-only semantic guess never qualifies as established meaning merely because it appears in history.
- The response must preserve conversation movement without requiring the user to explain the token.
- Must not add a list of canned alternative interpretations.
- Any example wording used in the experiment is illustrative only and must not become a repeated opening template.

### A2 — cross-turn unconfirmed-claim contract

- A1 plus an eval-scoped contract that assistant-originated, unconfirmed interpretations may not become facts in later turns.
- The assistant must be able to withdraw or leave unknown its own earlier hypothesis.
- Legitimate explicit interaction frames remain available; A2 must distinguish a procedural scale/choice/counting frame from an assistant-invented semantic claim.

### A3 — history construction control

- Keep the canonical Prompt.
- Compare canonical history with an eval-only history control that prevents prior assistant-only semantic hypotheses from contaminating later numeric turns.
- The control must preserve legitimate user-confirmed scales, numbered choices, and explicit counting contexts.

Each variant must run `TRJ-GROUND-001` at least three times through the official entrypoint. Variant results must record Prompt version/override, history adapter, source fingerprint, model, and repeat count.

Each variant must also run four numeric-context classes:

1. Unestablished free input: `1 → 2 → 3`.
2. Explicit scale: the assistant or user establishes a `1–10` rating before a numeric reply.
3. Explicit numbered choice: the assistant or user establishes numbered options before the user chooses one.
4. Explicit counting: the user states a count such as `我这周做了 3 次`.

The treatment must restrain only class 1. It must preserve established meaning in classes 2–4.

## 7. Evaluation Contract

### Deterministic checks

- structural route remains visible;
- no known forbidden literal claims such as `松口气`, unsupported score/trend, direction, interface testing, or repetition-count statements;
- no assistant-only forbidden claim is repeated in a later reply;
- report freshness metadata matches relevant sources.

### Heuristic locators

- new intent/activity terms absent from `allowedFacts`;
- repeated assistant-only nouns or emotional terms across later turns;
- phrases that assign user purpose, including “想怎么用”, “接着数”, “测试”, or “随手敲”.
- any normalized reply-opening structure repeated at or above the declared threshold across runs, not only known literals such as “听到你说” or “看到这个”. Slot normalization must cover the current token so `看到这个 1/2/3` is treated as the same candidate skeleton.

Heuristics locate candidates only and do not independently pass or fail a variant.

### Human reviewer fields

- `unsupportedMeaning`
- `crossTurnContamination`
- `groundedUnderstanding`
- `conversationMovement`
- `reviewerNotes`

The reviewer must apply the Decision Owner philosophy: “看用户期待的是什么，慢慢帮用户挖掘出来需求。” A reply fails if it decides the expectation before the user supplies evidence.

## 8. Acceptance Criteria for a Future Product Fix

- A1/A2/A3 evidence identifies one primary root cause with a stable advantage over A0 across repeated runs.
- The selected treatment prevents unsupported meaning and carry-over without repeatedly interrogating the user.
- The selected treatment satisfies both `unsupportedMeaning=false` and `conversationMovement=true`.
- The selected treatment avoids mechanical acknowledgement and closure phrases such as `先停在这里` when the user has not requested a pause.
- Legitimate explicit scales, numbered choices, and counting contexts remain usable.
- No opening structure becomes a new repeated template across the required runs.
- No new ResponseGoal, Strategy, signal, schema, or Memory decision is introduced.
- Any production modification is confined to the confirmed layer and receives its own implementation review.
- 012B and 012C remain out of scope.

## 9. Product Fix Decision (2026-07-13)

The Decision Owner has now authorized a production behavior change broader than the earlier numeric experiment boundary:

```text
Receive input
  -> evaluate semantic evidence
  -> sufficient: interpretation is allowed
  -> insufficient: remain at observation
```

Implementation boundary:

- `ClinicalContext.signals.semanticEvidence` owns the structured sufficiency decision.
- Evidence may come from self-contained current-user meaning or an explicit, semantically compatible answer frame in the active conversation.
- Active frame means the immediately preceding assistant turn within the current five-minute segment. Intervening turns invalidate older questions.
- Compatibility is validated, not inferred from shape: choice answers must be offered values, bounded scale answers must be in range, and binary/quantity answers must match their question type.
- A short `不对` is correction evidence only when it directly follows the assistant assertion it rejects.
- Atomic decimals, acknowledgements, terminal punctuation variants, and mixed numeric-symbol input remain insufficient without a compatible frame.
- Message form and repetition are not evidence of user intent.
- An assistant-authored, unconfirmed hypothesis is not an established answer frame.
- `ResponseGoalSelector` consumes the signal; Rogers planning maps insufficient evidence to `responseIntent=receive` and `questionFunction=none`.
- The response guard enforces that plan generically. It no longer counts numeric turns or generates a testing/counting interpretation.
- Existing Prompt text is unchanged.

Required positive and negative regression classes:

- positive: quantity, age, scale, numbered choice, binary answer, and self-contained user meaning;
- negative: atomic input at conversation start, emoji-only input, stale or superseded frames, out-of-range/unoffered answers, and an atomic follow-up to an open meaning question that did not establish an answer frame.

## 10. Regression Risks

- Over-restraint can make the assistant mechanically echo every token.
- Removing assistant history can break legitimate multi-turn meaning.
- A stronger Prompt may over-question users for clarification.
- Literal bans can cause synonym substitution without grounded improvement.
- A treatment may look better in one provider sample but fail under repetition.

## 11. Final Decision

```text
production decision authorized and implemented
```

The earlier `needs more eval` decision was superseded by the Decision Owner's 2026-07-13 task. The confirmed production root cause is the format-specific reply guard that overrode ClinicalPlan and inferred intent from repetition. The approved implementation moves sufficiency into `ClinicalContext.signals.semanticEvidence`, consumes it in Selector/ClinicalPlan, and enforces the resulting observation decision without changing Prompt text.

## Next Unique Action

Run the semantic-evidence acceptance suite and the full Architecture v1 launch regression before release.
