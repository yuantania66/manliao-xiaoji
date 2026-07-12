# EXP-BL-012 Multi-turn Experience Diagnosis

## Issue Header

- Issue ID: EXP-BL-012
- Evidence type: local multi-turn product self-test
- Priority: diagnosis required before prioritization
- Decision owner: Experience Iteration owner
- Format: umbrella multi-turn variant of `BACKLOG_ISSUE_TEMPLATE.md`

This document does not authorize implementation. It records three distinct failures that only become fully visible across turns. Each child issue must independently confirm exactly one primary root cause before product code changes.

## 1. User Problem

The current system can pass deterministic routing checks while producing replies that invent unsupported meaning, fall into a repeated recorder-like template, or fail to explain its understanding when the user challenges it. This breaks trust even when `ResponseGoal` and `ClinicalPlan` are structurally correct.

## 2. Evidence Provenance

### Screenshot-confirmed trajectories

The following text is transcribed from product screenshots submitted on 2026-07-12. At submission time, the ambient browser context showed `http://localhost:3001/chat`, so local development is the presumed capture environment, but the screenshots themselves do not prove their runtime origin. The Decision Owner must confirm whether any evidence came from production before 012A, 012B, or 012C implementation begins. If production impact is confirmed, hotfix priority must be assessed separately; this diagnosis does not authorize a hotfix.

#### Trajectory A — unsupported meaning carried across numeric turns

```text
User: 1
Assistant: 1。像是还在刚才那个松口气的瞬间里。

User: 2
Assistant: 好，那就先在这个松口气的感觉里待一会儿。

User: 3
Assistant: 3在这里，我不急着定义它。想顺着这个数字说点什么可以，先不说也没关系。
```

Observed failure:

- The first reply invents a prior “松口气” moment not supplied by the user.
- The second reply carries that unsupported interpretation forward as conversation context.
- The third reply partially withdraws the interpretation but still treats the number as a conversational object with implied meaning.

#### Trajectory B — recorder-like emotional reflection

```text
User: 我今天有点不太高兴
Assistant: 听到你说今天有点不太高兴，就先让这句话在这里。
```

Observed failure:

- The reply repeats the input without adding grounded understanding.
- “让这句话在这里” closes movement while sounding like an internal support instruction rendered as dialogue.

#### Trajectory C — structurally routed repair remains shallow

```text
User: 你一点都不懂我
Assistant: 是我没跟上，让你觉得没被懂。
```

Observed result:

- The system accepts responsibility and does not argue, which is a structural improvement.
- The reply still does not state what it currently understands, what it may have misunderstood, or what remains unknown.
- “让你觉得没被懂” risks reframing a direct criticism as only the user's feeling.

### User-reported additional local probes

The following probes were reported in the follow-up review but were not all visible in the three retained screenshots. They are candidates for reproduction, not screenshot-confirmed fixtures:

```text
我累了
我一个人在家里，现在好害怕
我明天面试，我好紧张
你接住了什么
```

Reported pattern:

- Multiple emotional inputs received variants of “听到你说 X / 让这句话在这里 / 我接住了”.
- After “你接住了什么”, the system reportedly answered by replaying the earlier user statement rather than explaining its understanding.

These probes must be reproduced through the official reply entrypoint before their exact outputs become regression fixtures.

## 3. Why the Current Single-turn Package Is Insufficient

The existing Golden Dataset remains valid for single-turn structural and experience review. It must not be polluted with independent cases that only make sense as a sequence.

Single-turn cases cannot fully expose:

- unsupported interpretations carried into later turns;
- repeated syntax or template slots across several replies;
- a user's meta-challenge to a specific prior assistant reply;
- whether repair withdraws an earlier interpretation or merely changes wording.

The repository already contains some multi-turn direct probes. EXP-BL-012 must first determine why those probes did not protect the observed product trajectory before adding overlapping coverage.

## 4. Child Problem Boundaries

### EXP-BL-012A — Multi-turn groundedness for low-information input

- Failure: the assistant assigns unsupported emotional meaning to numeric input and carries it forward.
- Trust impact: critical; later replies become grounded in invented context.
- Candidate layers: Prompt, history construction/filtering, model/provider compliance.
- Not yet confirmed: whether a Prompt-only change is sufficient.

### EXP-BL-012B — Emotional-response template rut

- Hypothesis: different emotional inputs may receive the same recorder-like sentence skeleton.
- Experience impact: the product appears to log the user rather than understand them.
- Candidate layers: Prompt examples, Prompt meta-language leakage, model compliance, recent assistant-history handling.
- Relation to EXP-BL-010: overlap must be reviewed before reprioritizing or merging scope; this document does not change EXP-BL-010 priority.
- Evidence strength: one screenshot-confirmed recorder-like reply plus several user-reported probes; this is not yet sufficient to establish a repeated rut.
- Reproduction gate: before the B0/B1/B2/B3 experiment set starts, the official reply entrypoint must reproduce a materially similar sentence skeleton for at least three semantically distinct emotional inputs in the same trajectory, across repeated real-model runs. A deterministic skeleton heuristic may locate candidates, but a human reviewer must confirm that the pattern is a substantive template rut rather than ordinary lexical overlap.

### EXP-BL-012C — Meta-repair when the user audits understanding

- Failure: after the user challenges the assistant's understanding, the reply accepts blame or repeats the prior input without making current understanding and uncertainty visible.
- Trust impact: high; the user cannot verify whether repair actually occurred.
- Candidate layers: ResponseGoal/ClinicalPlan contract for meta-repair, Prompt rendering, conversation/history representation.
- Existing evidence: ordinary correction routing is structurally correct, but structural correctness does not prove experiential repair.

## 5. Responsibility Matrix

This matrix records hypotheses, not final root causes.

| Child | Conversation/history | ClinicalContext | ResponseGoal | Strategy/ClinicalPlan | Prompt | Model/provider | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 012A | inspect carry-over and filtering | current numeric ambiguity signal appears correct | current `clarify` appears correct | current `clarify_meaning` appears correct | explicit restraint exists but may be weak/conflicted | compliance may be weak | needs controlled eval |
| 012B | inspect repeated assistant history | no confirmed signal defect | no confirmed goal defect | positive response-value contract may be underspecified | concrete example and meta-language are primary suspects | compliance may amplify template | needs controlled eval |
| 012C | prior reply is essential evidence | correction recognition appears correct for direct challenge | `clarify` is structurally plausible | repair contract may not expose understanding/unknown boundary | rendering may collapse into apology or repetition | compliance remains possible | needs controlled eval |

No child may enter implementation with more than one selected primary root cause. Cross-layer observations must be split into prerequisite or follow-up issues rather than bundled into one product PR.

## 6. Evaluation Boundary

EXP-BL-012 requires a separate trajectory evaluation format. The format and runner contract are defined in `docs/CONVERSATION_TRAJECTORY_EVAL_SPEC.md`.

The evaluation must separate:

- deterministic structural and lexical checks;
- heuristic machine signals that only locate review candidates;
- human reviewer decisions about invention, understanding value, and repair quality.

An LLM judge may assist triage but must not be the sole merge gate.

## 7. Controlled Experiment Sets

These variants are experimental hypotheses. None is pre-approved for production.

### 012A experiment set — unsupported meaning

- A0: current Prompt and current history construction.
- A1: replace negative numeric-guessing language with a positive contract that low-information tokens remain unassigned until the user supplies meaning.
- A2: add a cross-turn groundedness contract: an unconfirmed interpretation from an earlier assistant reply may not become a fact in later turns.
- A3: keep Prompt unchanged and vary only history filtering/construction to test contamination.

### 012B experiment set — template rut

- B0: current Prompt.
- B1: remove the concrete “我听到你说今天好累” replacement example without adding new literal bans.
- B2: B1 plus a positive semantic-value contract: add grounded understanding beyond repetition without introducing unsupported content.
- B3: B2 plus an explicit cross-turn variation contract, evaluated for substance rather than synonym replacement.

### 012C experiment set — meta-repair

- C0: current repair contract and Prompt.
- C1: require repair output to distinguish current understanding, uncertainty, and any withdrawn assumption.
- C2: vary only Prompt rendering while keeping the ClinicalPlan unchanged.
- C3: if C2 is insufficient, evaluate a narrowly expanded meta-repair ClinicalPlan contract in a separate diagnosis.

Each experiment must run the same trajectories multiple times with provider, model, Prompt version, code commit, and generation settings recorded. A single improved sample is not sufficient evidence.

## 8. Acceptance Criteria for Diagnosis

- Screenshot-confirmed evidence remains distinct from reported probes.
- At least one official-entrypoint reproduction exists for each child problem.
- 012B does not enter controlled experiments until its three-input, same-trajectory, repeated-run reproduction gate is satisfied and human-confirmed.
- Existing multi-turn probes are inventoried before new runner behavior is designed.
- Machine checks and reviewer fields are explicitly separated.
- Each child issue selects exactly one root cause before implementation.
- Prompt, Selector, ClinicalPlan, Golden Dataset, global Backlog template, and product code remain unchanged in this diagnosis task.
- No child implementation begins from this umbrella document alone.

## 9. Risks

- Literal phrase bans can produce synonym substitution without better understanding.
- A more active response can over-interpret or over-question the user.
- Removing a concrete Prompt example may reintroduce emotional amplification.
- History filtering can remove context that is necessary for legitimate numeric choices or scales.
- A deterministic check can create false confidence for semantic qualities it cannot judge.

## 10. Final Decision

```text
needs more eval
```

The three failures are accepted as valid product evidence, but their primary root causes are not yet confirmed. No product implementation is authorized.

## Next Unique Action

Review and approve the trajectory schema and runner contract in `docs/CONVERSATION_TRAJECTORY_EVAL_SPEC.md`; then implement the evaluation harness in an independent task before opening 012A, 012B, or 012C product fixes.
