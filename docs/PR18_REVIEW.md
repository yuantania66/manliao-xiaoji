# PR #18 Formal Review

## Review Header

- PR: `#18` — Diagnose EXP-BL-012A groundedness
- Reviewed head: `3bebf4e65ac63aeb97359165d189d532fca9373d`
- Review date: 2026-07-12
- Reviewer scope: diagnosis contract and evidence only
- CI: `launch-checks` passed
- Product implementation in PR: none
- Issue #19 A1/A2/A3 implementation in PR: none

## 1. Boundary Check

PR #18 currently changes one diagnosis document:

```text
docs/EXP-BL-012A_GROUNDEDNESS_REVIEW.md
```

It does not change Prompt, history construction, Selector, ClinicalPlan, Strategy, signals, schemas, model provider behavior, runner code, or product behavior. Issue #19 remains a later eval-only experiment issue.

Boundary result: **pass**.

## 2. Double-contract Review

The diagnosis explicitly defines:

```text
unsupportedMeaning = false
conversationMovement = true
```

It also preserves both Decision Owner criteria:

> 看用户期待的是什么，慢慢帮用户挖掘出来需求。

> 不猜、不封口、不逼解释，同时让用户仍然愿意继续。

The written contract correctly requires:

- no unsupported emotion, intent, score, direction, activity, or conversational purpose;
- no assistant-only hypothesis promoted to fact through history;
- no mechanical acknowledgement or unrequested pause/closure;
- no forced immediate explanation;
- a low-pressure path for the user to continue;
- established procedural meaning to remain usable for explicit scales, numbered choices, and counting.

Contract-definition result: **pass**.

Runtime-proof result: **not yet established**. PR #18 defines the contract but contains no A1/A2/A3 treatment implementation or comparison.

## 3. Manual Sample Review

### 3.1 Screenshot-confirmed original failure

| Input | Context | Current reply | Guesses meaning | Closes conversation | Forces explanation | Continuation entry | Result | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `1` | No meaning established | `1。像是还在刚才那个松口气的瞬间里。` | Yes | No | No | No grounded entry | fail | Invents an unsupported relief state. |
| `2` | Prior assistant invented `松口气`; user did not confirm it | `好，那就先在这个松口气的感觉里待一会儿。` | Yes | Yes/holds in invented state | No | No | fail | Promotes an assistant-only claim into shared context. |
| `3` | Consecutive free numeric input | `3在这里，我不急着定义它。想顺着这个数字说点什么可以，先不说也没关系。` | Partially | Partially | No | Yes, but assumes the number is a conversational path | fail | Withdraws certainty but still assigns possible purpose. |

### 3.2 A0 canonical repeat — run 1

| Input | Context | Current reply | Guesses meaning | Closes conversation | Forces explanation | Continuation entry | Result | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `1` | No meaning established | `看到了这个1，我不确定你想怎么用它。` | Yes: assumes intended use | No | Softly requests calibration | Limited | fail | Safer than the screenshot but still frames the token as something the user wants to “use”. |
| `2` | Consecutive free numeric input | `看到了2，我还是没太跟上节奏。` | Yes: attributes a rhythm | No | No | Weak | fail | “节奏” is not user-supplied. |
| `3` | Consecutive free numeric input | `嗯，是3。如果想让我换个方式理解，随时说就好。` | Yes: assumes an interpretation task | No | No | Yes | fail | Movement exists, but it presumes the user wants the assistant to interpret the token. |

### 3.3 A0 canonical repeat — run 2

| Input | Context | Current reply | Guesses meaning | Closes conversation | Forces explanation | Continuation entry | Result | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `1` | No meaning established | `看到这个1了，不确定你想怎么用它。` | Yes: assumes intended use | No | Softly requests calibration | Limited | fail | Same unsupported “use” frame. |
| `2` | Consecutive free numeric input | `看到2了，跟着你的节奏走。` | Yes: attributes a rhythm | No | No | Weak | fail | Sounds permissive but invents a user rhythm. |
| `3` | Consecutive free numeric input | `3也在这儿了，你想接着数还是先停一下都行。` | Yes: proposes counting | Partially | Presents a choice | Yes | fail | Converts unknown input into a counting/pause choice. |

### 3.4 A0 canonical repeat — run 3

| Input | Context | Current reply | Guesses meaning | Closes conversation | Forces explanation | Continuation entry | Result | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `1` | No meaning established | `看到这个1了，不确定你想怎么用它。` | Yes: assumes intended use | No | Softly requests calibration | Limited | fail | Same unsupported “use” frame. |
| `2` | Consecutive free numeric input | `嗯，又看到一个2。` | No semantic guess | No | No | No | fail | Pure acknowledgement; no movement. |
| `3` | Consecutive free numeric input | `又看到3了，想顺着这个数字聊一点，还是就先这样都行。` | Yes: assigns conversational purpose | Partially | Presents a choice | Yes | fail | Movement is offered through an unsupported frame. |

### 3.5 Follow-up over-restraint screenshot

| Input | Context | Current reply | Guesses meaning | Closes conversation | Forces explanation | Continuation entry | Result | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `1` | No meaning established | `看到你发了1，先停在这里。` | No | Yes | No | No | fail | Passes restraint only; fails conversation movement. |

### Manual review conclusion

- Free numeric cases with observed replies: **0 pass / 13 fail**.
- Some replies avoid high-severity invention, but none demonstrates the full double contract.
- The current evidence proves the problem and validates the diagnosis; it does not prove a treatment.

## 4. Four Numeric-context Classes

| Required class | Evidence in PR #18 | Result |
| --- | --- | --- |
| Free number | Screenshot and A0 evidence exist | fail under current behavior; no treatment evidence |
| Consecutive free numbers | Screenshot and three A0 repeats exist | fail under current behavior; no treatment evidence |
| Established-meaning number: scale / numbered choice / counting | Contract and future acceptance are written | not executed in PR #18 |
| History containing an earlier assistant misinterpretation | Screenshot shows `松口气` carry-over | current behavior fails; no A2/A3 treatment evidence |

Four-class merge gate result: **fail / incomplete**.

## 5. Locator and Normalization Review

PR #18 correctly requires:

- arbitrary normalized opening structures, not only known literals;
- token-slot normalization so `看到这个 1/2/3` becomes one candidate skeleton;
- detection of synonym substitution rather than literal-only avoidance.

The current merged runner does not yet prove that complete requirement:

- digits are normalized;
- a small fixed set of emotional content slots and known literal phrases is handled;
- arbitrary synonymous openings such as `看到这个 1`, `看到你发了 1`, and `先让这个数字留在这里` are not demonstrated as one semantic template family;
- no PR #18 code changes the locator, by design.

Locator-definition result: **pass**.

Locator-runtime result: **fail / not implemented**. This work belongs to Issue #19.

## 6. CI and Scope Result

- GitHub `launch-checks`: pass.
- Changed files before this review document: one documentation file.
- Issue #19 A1/A2/A3 implementation code: absent.
- Product behavior changes: absent.

CI/scope result: **pass**.

## 7. Merge-gate Decision

| Gate | Result |
| --- | --- |
| All free-number treatment cases avoid unsupported meaning | not demonstrated |
| All free-number treatment cases preserve conversation movement | not demonstrated |
| Established numeric contexts preserve their meaning | not executed |
| Locator catches repeated/synonymous templates | specified, not implemented |
| No synonym substitution masquerades as improvement | not demonstrated |
| CI passes | pass |
| No Issue #19 implementation in PR | pass |

## 8. Dependency Conflict

The requested sequence contains a circular gate:

```text
PR #18 may merge only after A1/A2/A3 treatment evidence passes
Issue #19 may start only after PR #18 merges
```

PR #18 is a diagnosis and experiment-authorization document. It cannot, while also excluding Issue #19 implementation, produce the treatment evidence demanded by gates 1–5.

One of the following process decisions is required:

1. Merge PR #18 based on diagnosis-contract correctness, then run Issue #19 and apply treatment gates to the future experiment closeout/product authorization; or
2. Allow Issue #19 eval-only work to begin while PR #18 remains Draft, then update this review with experiment results before merge.

This review does not choose between those process policies on behalf of the Decision Owner.

## 9. Known Risks

- Merging a diagnosis as if it proved runtime behavior creates false confidence.
- Blocking eval work on a diagnosis that requires eval results creates a deadlock.
- Literal-only locator improvements can miss synonym templates.
- Over-restraint can pass groundedness while failing conversation movement.
- Removing too much history can break explicit scales, numbered choices, and counting contexts.

## 10. Final Decision

```text
needs more eval
```

PR #18 correctly defines the double product contract and experiment boundary, but it does not satisfy the requested runtime merge gates. Keep PR #18 Draft. Do not merge and do not start Issue #19 until the Decision Owner resolves the circular sequencing policy.

## Next Unique Action

Decision Owner chooses one sequencing policy: merge the diagnosis before experiments, or authorize eval-only Issue #19 while PR #18 remains Draft.
