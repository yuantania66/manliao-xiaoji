# Purpose Subject-Ownership Authority V1

## Status and owner

- Owner: `services/ai/purposeSubjectOwnershipAuthority.ts`
- Authority version: `purpose-subject-ownership-authority-v1`
- Schema version: `1`
- Contract SHA-256: `36b6ecc428bfc51b1c031e2779655f015a8068fd77301713cc2640e39125e749`
- Runtime status: local/eval injection only. Production orchestration does not select an
  external provider implicitly and therefore does not send real User text to this
  authority.

## Decision boundary

The authority is eligible only for one unbound `reason_or_contradiction` question
after Safety and committed-claim binding. Safety-owned, pause, repair, correction,
non-reason, and committed-claim turns make zero calls.

It classifies the semantic subject as:

- `current_user_self`: the question explicitly concerns the current User's own
  experience, action, pattern, emotion, choice, or reaction;
- `external_or_other`: the subject is another person, the Assistant, an object,
  event, system, fact, or other external subject;
- `uncertain`: the current turn does not establish the subject.

Only a strict-valid `current_user_self` decision removes the direct answer
obligation and supplies the existing turn-local `explore` proposal. Every other
decision or failure retains the direct obligation and leaves ordinary posture
unselected.

## Binding and failure behavior

Input and output bind schema version, authority version, contract hash,
conversation ID, turn ID, and the exact question. Evidence is exactly one item
equal to the complete echoed question object; models do not select a substring
or calculate a second offset. Question and evidence use JavaScript/UTF-16 offsets
and must reproduce the exact current-User-turn slice. Root and nested objects
reject extra or missing keys.

There is one provider attempt and no repair attempt. Malformed JSON, schema,
version, hash, conversation, turn, question, evidence, or provider failures all
fail closed by preserving the direct obligation. The authority is turn-local,
does not persist state, and cannot invoke Planner or Surface.

## Verification

- `scripts/purpose-subject-ownership-authority-check.ts`: local nine-class
  structural/ownership coverage, strict failures, call budgets, and fail-closed
  behavior.
- `scripts/purpose-subject-ownership-qwen-eval.ts`: explicitly authorized nine
  synthetic Qwen cases; it is never part of the production path.
- Conversation OS relational, natural-chat, architecture, AI orchestration, and
  chat lifecycle regression gates remain required.
