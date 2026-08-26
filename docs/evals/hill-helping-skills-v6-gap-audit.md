# Hill Helping Skills 6th Edition Gap Audit

Status: Phase 1 diagnostic complete; no runtime behavior change is authorized by
this document.

Date: 2026-07-31

## 1. Audit question

Does the current chat system preserve an executable representation of Clara E.
Hill's *Helping Skills: Facilitating Exploration, Insight, and Action*, using the
latest edition as the product-methodology baseline?

## 2. Evidence boundary

### 2.1 Book baseline

The latest edition is:

- Clara E. Hill, Harold Chui, and Judith A. Gerstenblith;
- sixth edition;
- American Psychological Association;
- published December 2024;
- 473 pages;
- ISBN 978-1-4338-4083-8.

Sources:

- Chinese University of Hong Kong publication record:
  https://research.cuhk.edu.hk/en/publications/helping-skills-facilitating-exploration-insight-and-action/
- Sixth-edition front matter and table of contents:
  https://urn.ub.unibe.ch/urn%3Ach%3Aslsp%3Azbz%3A9781433840838%3Aihv%3Apdf
- APA Higher Education webinar description:
  https://go.apa.org/higheredwebinars/

The sixth-edition description records a material change from a stage-based model
to a more fluid, goal-based model. Exploration, insight, and action therefore
must not be implemented as a mandatory linear state machine.

### 2.2 Repository evidence

This audit inspected:

- `docs/CLINICAL_LOGIC_LAYER.md`
- `docs/RESPONSE_STRATEGY_ENGINE.md`
- `docs/CONVERSATION_STATE_DESIGN.md`
- `docs/ARCHITECTURE_V1_FINAL.md`
- `docs/CONVERSATION_OS_V1.md`
- `docs/PRD_V1.md`
- `conversation-os/control/types.ts`
- `conversation-os/control/responsePlanner.ts`
- `conversation-os/state/conversationStateTypes.ts`
- `conversation-os/state/conversationStateService.ts`
- `services/clinical/clinicalTypes.ts`
- `services/clinical/clinicalAdviceService.ts`
- `services/clinical/clinicalPlanService.ts`
- `services/clinical/clinicalStrategyRegistry.ts`
- `services/clinical/responseGoalSelector.ts`
- `services/clinical/rogersStrategy.ts`
- `services/ai/chatOrchestrationService.ts`
- `services/ai/promptBuilder.ts`
- `services/ai/responsePlanValidator.ts`
- `services/ai/README.md`
- repository history searches for `Hill`, `希尔`, `探索阶段`, and `助人技术`.

The working tree already contained unrelated user changes. This audit does not
modify or reinterpret those changes.

## 3. Sixth-edition methodology baseline

### 3.1 Foundations that affect every helping turn

The sixth edition treats the following as part of the helping model rather than
optional tone guidance:

- client contributions and helper contributions;
- the therapeutic relationship;
- helper self-awareness and bias;
- cultural awareness, cultural humility, and critical consciousness;
- ethics, limits, boundaries, and avoidance of value imposition;
- outcomes of the helping process.

For an AI product, these concepts require an explicit product translation. They
cannot be assumed to appear merely because a prompt says "warm" or
"non-directive".

### 3.2 Moment-to-moment helping loop

The book's chapter 2 describes a turn-level loop:

```text
current client material and helping relationship
  -> helper goal/intention
  -> skill selected to serve that intention
  -> client reaction and behavior
  -> assessment of the reaction
  -> revised intention for the next helping move
```

This loop is the central control contract. A skill is not selected only from the
literal form of the latest message, and the success of a move is not established
merely because the response satisfied output constraints.

### 3.3 Exploration goals and skills

The exploration group includes:

- providing support;
- exploring thoughts, narratives, and nonaffective content;
- exploring and experiencing feelings;
- attending, listening, silence, and minimal encouragers;
- restatements and summaries;
- questions and probes for thoughts;
- questions and probes for feelings;
- reflections and disclosures of feelings;
- choosing goals and skills, then observing the client's reaction.

The book explicitly distinguishes when to focus on feelings and when not to.

### 3.4 Insight goals and skills

The insight group includes:

- markers of readiness for insight;
- fostering awareness through appropriate challenge;
- questions and probes for insight;
- interpretations and disclosures of insight;
- processing the therapeutic relationship;
- observing impact and integrating insight skills.

Insight work is not equivalent to summarizing the user's words or generating a
stable label about the user.

### 3.5 Action goals and skills

The action group includes:

- markers for knowing when to move to action;
- questions and probes for action;
- giving information;
- direct guidance, including cautions about its use;
- disclosure of strategies;
- relaxation and mindfulness;
- behavior change;
- behavioral rehearsal;
- decision making;
- assessment and revision during implementation.

An explicit request for advice can be one action marker, but it is not the whole
action model.

### 3.6 Fluidity requirement

Exploration, insight, and action are goal families in the sixth edition. The
helper may move among them according to the client's needs, readiness, reaction,
the helping relationship, and the task. A conversation can:

- use exploration during action work;
- return from action to exploration;
- move toward insight without requiring action;
- begin with action when the problem requires immediate practical help;
- avoid insight when the client is not ready;
- revise the current goal after a negative or unexpected reaction.

## 4. Current-system observations

### 4.1 Hill is not an explicit methodology source

`docs/CLINICAL_LOGIC_LAYER.md` permits Rogers, Egan, Motivational Interviewing,
CBT, ACT, and SFBT. It does not name Hill.

`docs/RESPONSE_STRATEGY_ENGINE.md` cites Egan as the primary book reference and
defines a product-created Need Resolution taxonomy. It does not derive that
taxonomy from Hill's exploration, insight, and action goals.

Repository and history searches found no explicit Hill or sixth-edition
implementation.

### 4.2 Conversation OS is the sole ordinary decision owner

`ResponsePlan.decisionOwner` is fixed to
`conversation_os.response_planner`.

The Response Planner chooses concrete response actions, question policy,
closure policy, tone, stance, and length. Clinical Logic can provide optional
advice but cannot own the helping goal or helping move.

### 4.3 Clinical Logic is invoked for only two activity labels

The production Response Planner invokes Clinical Logic only for:

- `supporting_emotion` -> `emotional_support`;
- `supporting_action` -> `action_support`.

Ordinary exploration, clarification, repair, direct questions, pauses, topic
development, and relationship events do not consult a general Hill helping
process.

### 4.4 Clinical advice is fixed to a thin Rogers plan

`createClinicalStrategyAdvice()` accepts only `emotional_support` or
`action_support` and always calls `createRogersClinicalPlan()`.

The advice returned to Response Planner contains:

- strategy;
- response intent;
- question function;
- tone constraints;
- intervention boundaries;
- evidence.

It contains no Hill goal family, helper intention, readiness marker, skill
choice, expected client reaction, observed client reaction, or next-intention
update.

### 4.5 The strategy registry is not an executable helping model

The registry still identifies its base entries as an engineering placeholder or
Rogers dry-run. Most named strategies have empty `whenToUse` and
`whenNotToUse` arrays.

The registry has no Hill exploration, insight, action, therapeutic-relationship
processing, readiness, or client-reaction contracts.

### 4.6 A five-state design is only a non-operative shadow

`docs/CONVERSATION_STATE_DESIGN.md` contains:

```text
opening / exploring / deepening / action / closing
```

This is not evidence that Hill is implemented:

- the document does not cite Hill;
- its `deepening` state does not implement Hill insight goals or skills;
- `action` is detected primarily from an explicit advice request;
- its approved implementation note says the five-state vocabulary was not
  promoted into a formal decision input;
- the sixth edition has moved away from a rigid stage model in any case.

The runtime still computes this legacy conversation state, but ordinary
Response Planner decisions are made from Interaction/Dialogue State activities.
The legacy state does not provide the missing Hill helping loop.

### 4.7 Output validation evaluates compliance, not helping impact

The current lifecycle validates a generated response against the same
ResponsePlan. It can detect constraint violations, but it cannot determine
whether the user's next reaction shows:

- feeling understood;
- increased exploration;
- useful new awareness;
- readiness or resistance;
- rupture in the helping relationship;
- movement toward a chosen action;
- need to revise the helper's intention.

The next user turn updates interaction state, common ground, obligations, and
repair state, but there is no Hill-specific assessment of the preceding helping
move and no revised helping intention.

## 5. Gap matrix

| Hill sixth-edition capability | Current evidence | Status | Architectural consequence |
| --- | --- | --- | --- |
| Fluid exploration / insight / action goals | Product-created activities and needs only | Absent | No book-grounded helping direction |
| Goal readiness markers | Explicit advice, affect, ambiguity, and interaction heuristics | Partial but not Hill | Goal movement is reduced to surface signals |
| Helper intention | Generic response action / response intent | Partial | Intention is not linked to Hill goal and client reaction |
| Skill selection for an intention | Optional fixed Rogers plan | Absent | Clinical technique is not genuinely selected |
| Exploration of thoughts and narratives | Topic development and optional questions | Partial | No exploration goal, rationale, or impact loop |
| Exploration and experiencing of feelings | Emotional-support activity and reflection | Partial | Emotion support is narrower than Hill exploration |
| Insight readiness and awareness | No production representation | Absent | System cannot deliberately facilitate insight |
| Challenge and interpretation | Generally prohibited or unrepresented | Absent | Safe limits exist, but no approved insight capability exists |
| Therapeutic-relationship processing | Common-ground repair only | Partial | Misunderstanding can be repaired, but the relationship cannot be used as helping material |
| Action readiness and tasks | Explicit action request and small scaffold | Partial | No behavior-change, rehearsal, decision, or iterative action process |
| Observe client reaction to a skill | Next turn is treated as a new interaction event | Absent | The system cannot learn whether its helping move worked |
| Revise next intention from reaction | Response Planner replans from interaction state | Partial but not Hill | It reacts structurally, not through a helping-process loop |
| Cultural awareness and humility | Generic non-assumption constraints | Partial | Culture has no explicit role in goal or skill choice |
| Helper self-awareness and bias | Grounding and prohibited claims | Partial | Limits are controlled, but helper bias/reaction is not represented |
| Ethics, limits, and safety | Strong safety and grounding boundaries | Present in product form | This is the strongest preserved foundation |
| Helping outcomes | Constraint and conversation-experience evaluations | Partial | Compliance is measurable; helping progress is not |

## 6. Root cause

### Observation

1. Hill was never encoded as a named, versioned methodology source in the
   accessible repository history.
2. The original Clinical Logic documents generalized multiple traditions into
   a small technique list.
3. Later architecture made Conversation OS the sole ordinary writer of intent
   and action.
4. Clinical Logic became an optional provider for two support activities.
5. Evaluation concentrated on isolated response failures, grounding,
   obligations, lifecycle, and constraint compliance.

### Interpretation

The book was not removed by one isolated deletion. Its methodology was lost in
successive translations:

```text
Hill helping process
  -> generic "mature helping frameworks"
  -> small technique taxonomy
  -> product-created need/activity labels
  -> optional Rogers advice inside Conversation OS
```

Each translation retained some vocabulary—reflection, exploration, action,
relationship repair—but removed the organizing contract that gives those
techniques their purpose and timing.

### Conclusion

The user's observation is substantively correct:

> The current system contains a few lexical and behavioral fragments that
> resemble helping skills, but it does not contain an executable Hill Helping
> Skills model.

The primary missing layer is not another response template, special-case rule,
or Validator check. It is the book-grounded helping-process decision contract.

This is the strongest architectural explanation for a system that increasingly
avoids unsupported claims yet can still produce safe, empty, or directionless
replies. This audit does not claim it is the only contributor to every observed
chat failure.

## 7. Counterevidence challenge

The audit challenged its own conclusion against the strongest apparent
counterexamples:

1. The repository has a five-state conversation model.
   - It is explicitly not a formal production decision input and is not the
     sixth-edition fluid goal model.
2. The system has `reflect`, `summarize`, and `support_action`.
   - These labels lack Hill readiness, intention, skill, reaction, and revision
     contracts.
3. Clinical Logic is still called in production.
   - It is called only for emotion/action support and always returns a Rogers
     compatibility plan.
4. The system updates state after each turn.
   - It updates interaction mechanics, not the impact of a selected helping
     skill.
5. Repair and common ground represent the relationship.
   - They protect epistemic and conversational correctness but do not implement
     processing of the helping relationship.
6. The Need Resolution draft is goal-driven.
   - Its direction is compatible with the sixth edition's rejection of rigid
     stages, but its goals are internally invented and omit Hill's three goal
     families and moment-to-moment process.

None of these counterexamples establishes an executable Hill model.

## 8. Twenty architectural probes

These probes challenge the gap conclusion across normal, edge, ambiguous,
context-switching, and adversarial interactions. They do not prescribe preferred
reply wording.

| # | Probe | Hill process information needed | Current executable representation |
| --- | --- | --- | --- |
| 1 | User narrates an event without naming a feeling | Exploration goal and cognition/narrative skill | Partial topic development only |
| 2 | User clearly expresses one feeling | Exploration goal, feeling skill, reaction monitoring | Emotional support without reaction loop |
| 3 | User cannot find words | Support versus exploration intention | Interaction/ambiguity policy only |
| 4 | User repeatedly sends fragments | Revise intention from prior unsuccessful moves | Structural replanning without helping-impact assessment |
| 5 | User asks why a pattern keeps happening | Insight readiness and insight goal | No insight capability |
| 6 | User offers a tentative insight | Assess and deepen or return to exploration | No Hill insight assessment |
| 7 | User rejects the assistant's interpretation | Relationship impact plus revised intention | Repair exists; helping-process revision does not |
| 8 | User requests advice in the first turn | Action readiness without mandatory prior exploration | Small action route only |
| 9 | User requests action after extended exploration | Transition to action using accumulated material | Explicit action request dominates |
| 10 | User becomes emotional during action planning | Fluid return to exploration or support | Concurrent activities exist; no Hill goal arbitration |
| 11 | User wants to practise a difficult conversation | Behavioral rehearsal task | No rehearsal representation |
| 12 | User is choosing between two options | Decision-making action task | Generic sorting scaffold only |
| 13 | User asks for information before deciding | Information-giving action skill and boundaries | Direct answer obligation, not a helping skill decision |
| 14 | User says the assistant does not understand them | Relationship processing versus simple repair | Common-ground repair only |
| 15 | User pauses after a meaningful disclosure | Silence/support intention and later reaction | Pause policy only |
| 16 | Cultural expectations shape the conflict | Cultural humility in goal and skill choice | No explicit cultural decision input |
| 17 | User's stated goal conflicts with their behavior | Readiness for awareness/challenge | Challenge capability absent |
| 18 | A reflection helps the user elaborate | Positive client reaction should update next intention | Elaboration becomes a new turn without skill-impact attribution |
| 19 | A question makes the user withdraw | Negative client reaction should change goal/skill | Withdrawal may alter interaction state, but the failed skill is not assessed |
| 20 | A factual question is embedded in distress | Answer obligation plus fluid helping goal | Obligation and emotion can coexist, but no Hill intention/skill integration |

All 20 probes preserve the same conclusion: the system contains useful
interaction mechanics, but no complete Hill helping-process contract.

## 9. Phase 1 acceptance decision

Phase 1 can be accepted if the product owner agrees with all four statements:

1. Hill sixth edition is the methodology baseline.
2. Exploration, insight, and action are fluid goal families, not mandatory
   linear stages.
3. The current system does not faithfully implement that methodology.
4. No case-level chat fix should proceed until a reviewed AI product contract
   translates the methodology into system responsibilities.

## 10. Next single phase

After Phase 1 acceptance, create an **AI-adapted Hill Helping Process Product
Contract**. It must define, without yet changing code:

- which sixth-edition concepts the product adopts, adapts, or excludes;
- the three fluid goal families;
- readiness and transition evidence;
- helper intention and skill-selection contracts;
- assessment of the user's next-turn reaction;
- relationship, culture, ethics, and safety boundaries;
- ownership boundaries among Conversation OS, Helping/Clinical Logic, Surface,
  Safety, and Memory;
- evaluation criteria based on helping-process quality rather than individual
  preferred replies.

Implementation planning must wait for product-owner acceptance of that contract.
