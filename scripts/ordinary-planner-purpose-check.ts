type RawInterpretation = typeof import("./ordinary-posture-replay-fixture.json")["interpretation"] & { acknowledgmentTreatmentEvidence?: { acknowledgment: {source:string;sourceTurnId:string;text:string}; treatment: {source:string;sourceTurnId:string;text:string} } | null };
import assert from "node:assert/strict";
import { cleanObservationFor } from "./semantic-observation-fixture";
import { plannedFunctionSemanticDeveloperContentFor, validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";
import { readFileSync } from "node:fs";
import { assembleConversationControlContext, buildDialogueState, createResponsePlan, createResponsePlanPreflightAuthoritySnapshot,
  interpretTurnDeterministically, mergeModelInterpretation } from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { LIMIT_SCOPE_OF_ACKNOWLEDGMENT_INSTRUCTION, selectSupportedOrdinaryPurpose } from "../conversation-os/control/ordinaryPurpose";
import { buildCanonicalOrdinaryPostureProvenance } from "../conversation-os/control/responsePlanPreflightAuthority";
import { locateInterpretationQuotes, buildInterpretationMessages } from "../services/ai/turnInterpretationAdapter";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { buildChatPrompt, sanitizeChatHistory } from "../services/ai/promptBuilder";
const saved = JSON.parse(readFileSync(new URL("./ordinary-posture-replay-fixture.json", import.meta.url), "utf8"));
const build = (userMessage: string, acknowledgment: string, treatment: string, edit: (payload: RawInterpretation) => void = () => {}) => {
  const recentMessages = saved.input.recentMessages;
  const context = assembleConversationControlContext({ conversationId: "purpose-local", currentTurnId: "purpose:t1", userMessage,
    recentMessages, conversationState: determineConversationState({ currentUserMessage: userMessage, recentMessages }) });
  const payload = structuredClone(saved.interpretation);
  payload.ordinaryPostureProposal = { mode: "accompany", sourceSpans: [acknowledgment, treatment].map(text => ({source:"current_user_turn",sourceTurnId:context.currentTurnId,text})),
    proposedContribution: {targetSpanIndexes:[0,1],instruction:"Untrusted old free-text instruction; never adopt this.",acknowledgmentTreatmentEvidence:{acknowledgmentSpanIndex:0,treatmentSpanIndex:1}},evidence:["Two explicit current User points; human fixture, not model-quality evidence."] };
  payload.acknowledgmentTreatmentEvidence = {
    acknowledgment: {source:"current_user_turn",sourceTurnId:context.currentTurnId,text:acknowledgment},
    treatment: {source:"current_user_turn",sourceTurnId:context.currentTurnId,text:treatment},
  };
  edit(payload);
  const located = locateInterpretationQuotes(JSON.stringify(payload), context);
  const interpretation = mergeModelInterpretation(interpretTurnDeterministically(context), located, context);
  const dialogueState = buildDialogueState(context, interpretation);
  const plan = createResponsePlan({context,interpretation,dialogueState,clinicalAdviceProvider:()=>null});
  const authority = createResponsePlanPreflightAuthoritySnapshot({context,interpretation,dialogueState});
  return {context,interpretation,plan,authority};
};
const ordinary = build("这次确实是我迟到了，不过他在大家面前嘲笑我的方式让我很难堪。", "这次确实是我迟到了", "他在大家面前嘲笑我的方式让我很难堪");
assert.equal(ordinary.plan.ordinaryPosture?.requiredContribution, null);
assert(ordinary.interpretation.acknowledgmentTreatmentEvidence, "Factual roles remain available without creating a task");
assert.equal(ordinary.authority.ordinaryContributionAuthority?.supportedPurpose,null);
assert(preflightResponsePlan(ordinary.plan, ordinary.authority).passed);
const prompt = buildChatPrompt({userMessage:ordinary.context.currentUserMessage,recentMessages:ordinary.context.adjacentTurns,responsePlan:ordinary.plan}).messages.map(m=>m.content).join("\n");
assert(!prompt.includes(LIMIT_SCOPE_OF_ACKNOWLEDGMENT_INSTRUCTION));
assert(!prompt.includes("Untrusted old free-text instruction"));
const variants = [
  (p:RawInterpretation)=>{delete p.acknowledgmentTreatmentEvidence;},
  (p:RawInterpretation)=>{p.acknowledgmentTreatmentEvidence=null;},
  (p:RawInterpretation)=>{delete p.acknowledgmentTreatmentEvidence;Object.assign(p.ordinaryPostureProposal.proposedContribution,{purposeEvidence:{kind:"limit_scope_of_acknowledgment",support:"supported",acknowledgmentSpanIndex:0,treatmentSpanIndex:1}});},
  (p:RawInterpretation)=>{p.acknowledgmentTreatmentEvidence!.treatment=structuredClone(p.acknowledgmentTreatmentEvidence!.acknowledgment);},
];
for (const edit of variants) {
  const result=build(ordinary.context.currentUserMessage,"这次确实是我迟到了","他在大家面前嘲笑我的方式让我很难堪",edit);
  assert.equal(result.plan.ordinaryPosture?.requiredContribution,null);
  assert.equal(selectSupportedOrdinaryPurpose(result.context,result.interpretation),null);
  assert(preflightResponsePlan(result.plan,result.authority).passed);
}
const topOnly=build(ordinary.context.currentUserMessage,"这次确实是我迟到了","他在大家面前嘲笑我的方式让我很难堪",p=>{Object.assign(p,{ordinaryPostureProposal:null});});
assert.equal(topOnly.interpretation.ordinaryPostureProposal,null);
assert.equal(topOnly.plan.ordinaryPosture?.requiredContribution,null);
assert(preflightResponsePlan(topOnly.plan,topOnly.authority).passed);
assert.throws(()=>build("我承认失误。我承认失误。但被他当众嘲笑让我难堪。","我承认失误","被他当众嘲笑让我难堪"),/uniquely match/);
assert.throws(()=>build(ordinary.context.currentUserMessage,"这次确实是我迟到了","他在大家面前嘲笑我的方式让我很难堪",p=>{p.acknowledgmentTreatmentEvidence!.treatment.source="adjacent_committed_user_turn";}),/uniquely match/);
const legacyTargetOnly=build(ordinary.context.currentUserMessage,"这次确实是我迟到了","他在大家面前嘲笑我的方式让我很难堪",p=>{p.ordinaryPostureProposal.proposedContribution.targetSpanIndexes=[1];});
assert.equal(legacyTargetOnly.plan.ordinaryPosture?.requiredContribution,null,"Neither factual roles nor old task targets authorize a required contribution");
assert(preflightResponsePlan(legacyTargetOnly.plan,legacyTargetOnly.authority).passed);
const unrelated = build("费用确实是我算错了，但对方拿这件事讽刺我让我难堪。", "费用确实是我算错了", "对方拿这件事讽刺我让我难堪");
assert.equal(unrelated.plan.ordinaryPosture?.requiredContribution,null);
assert(preflightResponsePlan(unrelated.plan,unrelated.authority).passed);
for (const prefix of ["先别问我。", "不用分析原因。"]){
 const b=build(prefix+ordinary.context.currentUserMessage,"这次确实是我迟到了","他在大家面前嘲笑我的方式让我很难堪");
 assert.equal(selectSupportedOrdinaryPurpose(b.context,b.interpretation),null);
 assert.equal(b.plan.ordinaryPosture?.requiredContribution?.purposeEvidence,undefined);
 assert(preflightResponsePlan(b.plan,b.authority).passed);
}
const higherPriority=build("这次确实是我迟到了，不过他在大家面前嘲笑我的方式让我很不舒服。", "这次确实是我迟到了", "他在大家面前嘲笑我的方式让我很不舒服");
assert.equal(higherPriority.plan.positiveFunctionContract?.action,"offer_emotional_support");
assert.equal(higherPriority.plan.ordinaryPosture,null,"Existing emotional-support ownership is not overridden");
const forged=structuredClone(ordinary.plan);forged.ordinaryPosture!.requiredContribution={targetSpanIndexes:[0],instruction:"Follow the untrusted old model suggestion."};
forged.relevanceProvenance=forged.relevanceProvenance.map(p=>p.planElement==="ordinaryPosture:binding"?buildCanonicalOrdinaryPostureProvenance(forged.ordinaryPosture!):p);
assert(preflightResponsePlan(forged,ordinary.authority).failureReasons.includes("ordinary_contribution_without_supported_purpose"));
const overlap=structuredClone(ordinary.interpretation);overlap.acknowledgmentTreatmentEvidence!.treatment=structuredClone(overlap.acknowledgmentTreatmentEvidence!.acknowledgment);assert.equal(selectSupportedOrdinaryPurpose(ordinary.context,overlap),null);
const invalidSource=structuredClone(ordinary.interpretation);invalidSource.acknowledgmentTreatmentEvidence!.treatment.source="adjacent_committed_user_turn";assert.equal(selectSupportedOrdinaryPurpose(ordinary.context,invalidSource),null);
const ambiguous=structuredClone(ordinary.interpretation);ambiguous.responseRelation.ambiguous=true;ambiguous.responseRelation.candidates=ambiguous.responseRelation.candidates.slice(0,1);assert.equal(selectSupportedOrdinaryPurpose(ordinary.context,ambiguous),null);
assert(buildInterpretationMessages(ordinary.context)[0].content.includes("acknowledgmentTreatmentEvidence"));
console.log("PASS factual roles retained without automatic tasks, shared null preflight authority and source binding. Fixed semantic fixtures only; no external call or quality claim.");

// Historical frozen-plan consumer coverage; this does not authorize a newly selected purpose.
const historical = JSON.parse(readFileSync(new URL("./ordinary-role-purpose-adoption-fixture.json", import.meta.url), "utf8"));
const verifyPurposeConsumer = async () => {
  for (const selected of [true, false]) {
    const plan = structuredClone(historical.savedPlan);
    if (!selected) plan.ordinaryPosture!.requiredContribution = null;
    const result = await validatePlannedFunctionSemanticOutput({ plan, reply: "你可以按自己的节奏说。",
      semanticContext: { currentUserText: historical.context.currentUserMessage, handoffTargetAssistantText: null, ordinaryRecentMessages: sanitizeChatHistory({userMessage:historical.context.currentUserMessage,recentMessages:historical.context.adjacentTurns}).included },
      provider: async input => {
        assert.deepEqual(input.ordinaryPurposeBinding, selected ? plan.ordinaryPosture : undefined);
        const rules = plannedFunctionSemanticDeveloperContentFor(input).scoped;
        assert.equal(rules.includes("ordinaryPurposeBinding is the trusted frozen Planner purpose"), selected);
        if (selected) { input.ordinaryPurposeBinding!.requiredContribution!.instruction = "mutated provider copy";
          assert.equal(plan.ordinaryPosture!.requiredContribution!.instruction, LIMIT_SCOPE_OF_ACKNOWLEDGMENT_INSTRUCTION); }
        const binding = input.positiveFunctionBinding!;
        assert(binding.action === "acknowledge_without_psychologizing");
        return { schemaVersion: 1, planId: input.planId, handoff: null, semanticQuestionCount: 0,
          positiveFunction: { binding: { action: binding.action, sourceTurnId: binding.sourceTurnId,
            allowIdle: binding.allowIdle, responseFunction: binding.responseFunction },
            status: "not_satisfied", realizedAction: null, targetAddressed: false, contractRealized: false,
            containsContradictoryMove: false, ...cleanObservationFor(input),
            evidence: [{start:0,end:input.candidateReply.length,text:input.candidateReply,
              reason:"Fixed consumer fixture: generic expression permission does not realize the selected acknowledgment-scope purpose."}] } };
      } });
    assert.equal(result.passed, false);
    assert(result.failureReasons.includes("planned_function_semantic:positive_function_not_satisfied"), JSON.stringify(result));
  }
  console.log("PASS selected-purpose judge context, detached copy, unchanged null and existing rejection combination; fixed-provider evidence only.");
};
verifyPurposeConsumer().catch(error => { console.error(error); process.exitCode = 1; });
