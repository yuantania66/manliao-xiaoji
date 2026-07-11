# Backlog Issue Diagnosis Template

Use this template before implementing any Experience Backlog issue.

Root Cause must be confirmed before code starts. A review cannot stop at "reviewed"; it must end in one of the final decision states below.

## Issue Header

- Issue ID:
- Golden Dataset cases:
- Priority:
- Decision owner:

## 1. User Problem

What does the user actually experience?

```text

```

## 2. Evidence

Include the concrete case output that supports this issue.

- Input:
- Selected ResponseGoal:
- Selected Strategy:
- Baseline reply:
- Treatment reply:
- Relevant trace/debug:

## 3. True Root Cause

Choose exactly one:

- Conversation
- ClinicalContext
- ResponseGoal
- Strategy
- Prompt
- Memory
- Safety

Selected Root Cause:

```text

```

## 4. Why Not Other Layers

Explain why the issue is not caused by each plausible alternative layer.

- Why not Conversation:
- Why not ClinicalContext:
- Why not ResponseGoal:
- Why not Strategy:
- Why not Prompt:
- Why not Memory:
- Why not Safety:

## 5. Minimal Fix

One sentence only.

```text

```

## 6. Impact Scope

What user experience changes if this is fixed?

```text

```

## 7. Regression Risk

What could get worse?

```text

```

## 8. Acceptance Criteria

- 
- 
- 

## 9. Re-eval Command

```bash
npm run experience:review
```

Add any required deterministic checks:

```bash

```

## 10. Final Decision

Choose exactly one:

- implement
- reclassify
- downgrade
- close
- needs more eval

Decision:

```text

```
