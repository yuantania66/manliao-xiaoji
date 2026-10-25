import assert from "node:assert/strict";
import { assembleConversationControlContext, interpretTurnDeterministically, mergeModelInterpretation } from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { selectSupportedOrdinaryPurpose } from "../conversation-os/control/ordinaryPurpose";
import { buildInterpretationMessages, locateInterpretationQuotes, InterpretationQuoteLocationError } from "../services/ai/turnInterpretationAdapter";
const cases = [
  { actor: "family", acknowledgment: "我承认这次忘了约定", treatment: "家人在亲戚面前讽刺我让我难堪", history: [] },
  { actor: "service", acknowledgment: "确实是我把单号填错了", treatment: "客服拿这件事挖苦我让我难堪", history: [] },
  { actor: "adjacent-reference", acknowledgment: "这次确实是我迟到了", treatment: "他当众嘲笑我的方式让我难堪",
    history: [{id:"previous-user",role:"user" as const,content:"我刚才和邻居约好见面。"}] },
];
for (const item of cases) {
  const userMessage = item.acknowledgment + "，但" + item.treatment + "。";
  const context = assembleConversationControlContext({conversationId:"event-party-local",currentTurnId:"event:t1",userMessage,
    recentMessages:item.history,conversationState:determineConversationState({currentUserMessage:userMessage,recentMessages:item.history})});
  const instructions = buildInterpretationMessages(context)[0].content;
  const contract = instructions.split("\n").find(line=>line.startsWith("Report acknowledgmentTreatmentEvidence"))!;
  assert(contract.includes("any relevant party in the User-described event"));
  assert(contract.includes("never default to the Assistant"));
  assert(contract.includes("other than the Assistant is not a reason to return null"));
  assert(contract.includes("If the actor is not established, do not invent one"));
  assert(!contract.includes("leader") && !contract.includes("领导"),"Contract must not hardcode a real actor or incident");
  const raw = {literalMeaning:userMessage,responseRelation:{candidates:[{relation:"opens_new_thread",confidence:0.95,evidence:["Human-labeled local fixture."]}]},
    acknowledgmentTreatmentEvidence:{
      acknowledgment:{source:"current_user_turn",sourceTurnId:context.currentTurnId,text:item.acknowledgment},
      treatment:{source:"current_user_turn",sourceTurnId:context.currentTurnId,text:item.treatment}},ordinaryPostureProposal:null,confidence:0.95,notes:[]};
  const bytes = JSON.stringify(raw);
  const located = locateInterpretationQuotes(bytes,context)!;
  const interpreted = mergeModelInterpretation(interpretTurnDeterministically(context),located,context);
  const selected = selectSupportedOrdinaryPurpose(context,interpreted);
  assert.equal(selected,null,"Event roles do not independently authorize a response task");
  assert.equal(interpreted.acknowledgmentTreatmentEvidence?.treatment.text,item.treatment);
  assert.equal(interpreted.acknowledgmentTreatmentEvidence?.treatment.sourceTurnId,context.currentTurnId);
  assert.equal(JSON.stringify(raw),bytes,"Local source fixture must remain unchanged");
  const unsupportedActor = structuredClone(raw);unsupportedActor.acknowledgmentTreatmentEvidence.treatment.text="不存在的人对我做了没有说过的事";
  assert.throws(()=>locateInterpretationQuotes(JSON.stringify(unsupportedActor),context),InterpretationQuoteLocationError);
  const noRelation = {...raw,acknowledgmentTreatmentEvidence:null};
  assert.equal(selectSupportedOrdinaryPurpose(context,mergeModelInterpretation(interpretTurnDeterministically(context),locateInterpretationQuotes(JSON.stringify(noRelation),context),context)),null);
}
console.log("PASS event-party contract scope and exact User-source binding across human fixtures; factual roles remain data and null purpose remains null and fabricated quotes fail. No external calls; does not prove model actor recognition or response quality.");
