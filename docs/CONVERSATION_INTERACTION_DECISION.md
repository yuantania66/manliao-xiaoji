# Conversation Interaction Decision Contract

## Approved scope

This document records the 2026-07-23 repair for the case where a user has no topic but is still participating in the conversation. It does not alter the earlier TA-009 boundary: the semantic-evidence guard constrains generation and does not author normal chat copy.

## Root cause and propagation

Before this repair, `我想不到说什么耶` after an assistant invitation produced:

```text
semanticEvidence=sufficient (content has a literal meaning)
expressionDifficulty=false (wording variant was not recognised)
ConversationState=exploring
ResponseGoal=reflect
ClinicalPlan=responseIntent: empathic_reflection
ClinicalPlan Prompt=not rendered by default
```

The base prompt then treated “不知道聊什么” as a reason to stay with the absence of a topic. That incorrectly collapsed content availability into engagement and led to passive, closing-sounding replies.

The earliest incorrect classification was the missing Conversation-owned interaction decision. `semanticEvidence` correctly answers only whether content is interpretable; it must not decide engagement, affect, initiative, or pause intent.

After the repair, the same input produces:

```text
semanticEvidence=sufficient (the literal no-topic statement is understandable)
interaction={ contentAvailability:no_topic, engagement:engaged,
  initiativeDirection:assistant_invited, affect:neutral_or_light, stopIntent:false }
ResponseGoal=help_continue_expression
ClinicalPlan=responseIntent:initiate_topic, questionFunction:open_gentle_invitation
Prompt=bounded ClinicalPlan + Interaction Decision rendered
```

## Minimal contract

`ConversationStateResult.interaction`, copied into `ClinicalContext.signals.interaction`, holds:

| Field | Values / boundary |
| --- | --- |
| `contentAvailability` | `has_topic`, `no_topic`, `fragmentary`, `unknown` |
| `engagement` | `engaged`, `open`, `disengaging`, `stop_requested` |
| `initiativeDirection` | `user_leads`, `assistant_invited`, `shared`, `pause` |
| `affect` | `negative`, `neutral_or_light`, `unknown`; information amount never establishes negative affect |
| `stopIntent` | true only for explicit stop language or a recent explicit pause that remains unreopened |

The immediately preceding assistant invitation is interaction evidence, not an answer frame. The semantic answer-frame evaluator remains responsible only for compatibility of procedural answers such as scales, choices, quantities, and ages.

## Selection rules

1. `no_topic` does not mean low engagement or a stop request.
2. A response to the immediately preceding assistant invitation is engagement evidence.
3. `no_topic + engaged/open + stopIntent=false` uses existing `help_continue_expression` with `responseIntent=initiate_topic`.
4. `initiate_topic` means the assistant supplies one light, low-pressure entry. It is not a fixed reply, topic list, or requirement that the user choose or explain a topic.
5. Explicit stop evidence selects `hold_space` and prohibits a follow-up question.
6. Explicit distress/fatigue may lower interaction intensity, but low information alone may not.
7. A recent explicit pause remains active for a later bare “不知道说什么” unless the user explicitly reopens interaction, for example by asking the assistant to lead.

## Automated acceptance

`npm run check:conversation-interaction` covers 26 assertions, including the five no-topic inputs, four explicit stop inputs, three distress/fatigue cases, four same-text context variants, and eleven normal/adversarial counterexamples. It also verifies that the Prompt receives the structured interaction decision for the bounded production paths.
