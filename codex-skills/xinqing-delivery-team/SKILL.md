---
name: xinqing-delivery-team
description: Assemble and govern the smallest safe delivery team for the xinqing 2.0 repository. Use when a task is complex, multi-file, safety-sensitive, stalled, asks for Agency Agents roles, or needs bounded delegation, implementation, verification, clinical/privacy review, or release coordination.
---

# 心晴交付团队

Use this skill together with the global `$project-team` skill. Treat this skill as
project-specific role selection and `$project-team` as the delivery-control protocol.

## Start

1. Read `/Users/yuanyuanyuan/projects/xinqing 2.0/AGENTS.md` and the directly related
   product, architecture, safety, clinical, and delivery-state documents.
2. Inspect the worktree. Preserve unrelated changes and assign only one writer to a file
   or overlapping subsystem.
3. Freeze one delivery slice: outcome, acceptance, allowed scope, non-goals, baseline,
   and round budget.
4. Read [roles.md](references/roles.md) and activate only the roles justified by the
   slice's risks.

## Select the team

- Keep the delivery lead in the main thread. Only the lead may change scope, integrate
  results, or declare completion.
- Use one scoped builder. Choose Backend Architect for API, persistence, lifecycle, or
  architecture work; choose AI Engineer for model adapters, structured outputs, semantic
  validation, or eval work. Do not activate both as competing writers.
- Add Reality Checker for independent acceptance on multi-file or behavior changes.
- Add Safety & Privacy Reviewer whenever Safety, Clinical, Memory, personal data,
  training/eval data, crisis interaction, or deletion behavior may change.
- Add other roles only when the trigger in `roles.md` is present.

## Assign work

Every assignment must state:

1. Deliverable.
2. Allowed files or systems.
3. Read-only or write permission.
4. Required evidence.
5. Integration boundary and dependencies.
6. Stop condition.

Never delegate product ownership. Report a product-contract conflict and wait for the
user instead of letting a role redesign the workflow.

## Preserve product authority

- Do not use these delivery roles as runtime conversation agents.
- Preserve one Response Planner and the existing Conversation OS ownership boundaries.
- Route model-provider calls through `services/ai`.
- Treat Safety as higher priority than ordinary planning and Clinical compatibility.
- Do not diagnose, claim medical authority, or turn internal prompts, traces, datasets,
  or role personas into product concepts.
- Permit formal state only through the repository's validated commit boundary.

## Verify and finish

Run the narrowest frozen check first, then proportionate regressions. Challenge the
change with distinct normal, edge, ambiguous, context-switching, and adversarial cases.
The Reality Checker verifies the frozen contract and must not invent new gates.

Finish with Completed, Evidence, Remaining, Blocking Reason, and exactly one useful
Recommended Next Step. Do not install roles globally, deploy, access production data,
or change credentials without explicit user authorization.
