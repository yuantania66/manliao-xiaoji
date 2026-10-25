import type { ResponsePlan } from "../conversation-os/control";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildDialogueState, createResponsePlan, createResponsePlanPreflightAuthoritySnapshot } from "../conversation-os/control";
import { selectSupportedOrdinaryPurpose } from "../conversation-os/control/ordinaryPurpose";
import { buildCanonicalOrdinaryPostureProvenance } from "../conversation-os/control/responsePlanPreflightAuthority";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { buildChatPrompt } from "../services/ai/promptBuilder";
const f=JSON.parse(readFileSync(new URL("./ordinary-role-purpose-adoption-fixture.json",import.meta.url),"utf8"));
let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error("NO_EXTERNAL_CALLS");};
const build=(interpretation=structuredClone(f.interpretation))=>{
 const context=structuredClone(f.context),dialogueState=buildDialogueState(context,interpretation);
 const plan=createResponsePlan({context,interpretation,dialogueState,clinicalAdviceProvider:()=>null});
 const authority=createResponsePlanPreflightAuthoritySnapshot({context,interpretation,dialogueState});
 return {context,interpretation,plan,authority};
};
const originalBytes=JSON.stringify(f),original=build();
assert(original.interpretation.acknowledgmentTreatmentEvidence,"Keep the saved real factual-role report");
assert.equal(original.plan.ordinaryPosture?.requiredContribution,null,"Role references alone must not create a required task");
assert.equal(original.authority.ordinaryContributionAuthority?.supportedPurpose,null,"Preflight independently agrees there is no task authority");
assert(preflightResponsePlan(original.plan,original.authority).passed);
assert.deepEqual(original.interpretation,f.interpretation,"Planning must not erase or rewrite factual evidence");
const {context,plan,authority}=original;
const actualPrompt=buildChatPrompt({userMessage:context.currentUserMessage,recentMessages:context.adjacentTurns,responsePlan:plan});
const historicalPrompt=buildChatPrompt({userMessage:context.currentUserMessage,recentMessages:context.adjacentTurns,responsePlan:f.savedPlan});
assert.equal(actualPrompt.messages[0].content,historicalPrompt.messages[0].content,"Shared evidence and factual/psychological boundaries unchanged");
assert.deepEqual(actualPrompt.messages.slice(2),historicalPrompt.messages.slice(2),"Conversation history unchanged");
assert(!actualPrompt.messages[1].content.includes('"kind":"limit_scope_of_acknowledgment"'));
assert(actualPrompt.messages[1].content.includes('"requiredContribution":null'));
for(const key of ["responseActions","questionPolicy","closurePolicy","stance","tone","groundingFacts","requiredDisclosure","prohibitedClaims","safetyConstraints","answerObligations"]){
 assert.deepEqual(plan[key as keyof typeof plan],f.savedPlan[key],key);
}
assert.equal(plan.positiveFunctionContract?.action, "acknowledge_without_psychologizing");
assert.equal((plan.positiveFunctionContract as Extract<NonNullable<ResponsePlan["positiveFunctionContract"]>,{action:"acknowledge_without_psychologizing"}>).responseFunction,"invite_optional_sharing");
const selectedContract=structuredClone(plan.positiveFunctionContract) as Extract<NonNullable<ResponsePlan["positiveFunctionContract"]>,{action:"acknowledge_without_psychologizing"}>;
selectedContract.responseFunction=f.savedPlan.positiveFunctionContract.responseFunction;
assert.deepEqual(selectedContract,f.savedPlan.positiveFunctionContract,"Only evidence-supported function selection changes");
// Legacy descriptions, even with an old supported flag, are not independent purpose authority.
for(const kind of ["summary","nested_supported","top_roles_only","nested_only"]){
 const i=structuredClone(f.interpretation);
 if(kind==="top_roles_only")i.ordinaryPostureProposal=null;
 else{
  const spans=[i.acknowledgmentTreatmentEvidence.acknowledgment,i.acknowledgmentTreatmentEvidence.treatment];
  i.ordinaryPostureProposal={mode:"accompany",sourceSpans:structuredClone(spans),proposedContribution:{targetSpanIndexes:[0,1],instruction:"Old proposal must never be restored as a hard task.",...(kind!=="summary"?{purposeEvidence:{kind:"limit_scope_of_acknowledgment",support:"supported",acknowledgmentSpanIndex:0,treatmentSpanIndex:1}}:{})},evidence:["Legacy suggestion is data, not independent purpose authority."]};
  if(kind==="nested_only")i.acknowledgmentTreatmentEvidence=null;
 }
 const r=build(i);assert.equal(selectSupportedOrdinaryPurpose(r.context,r.interpretation),null);
 assert.equal(r.plan.ordinaryPosture?.requiredContribution,null,kind);
 assert.equal(r.authority.ordinaryContributionAuthority?.supportedPurpose,null);
 assert(preflightResponsePlan(r.plan,r.authority).passed,kind);
}
// A valid-looking frozen old task cannot authorize a new plan or bypass preflight.
const forged=structuredClone(plan);forged.ordinaryPosture=structuredClone(f.savedPlan.ordinaryPosture);
forged.relevanceProvenance=forged.relevanceProvenance.map(item=>item.planElement==="ordinaryPosture:binding"?buildCanonicalOrdinaryPostureProvenance(forged.ordinaryPosture!):item);
assert(preflightResponsePlan(forged,authority).failureReasons.includes("ordinary_contribution_without_supported_purpose"));
assert(preflightResponsePlan(f.savedPlan,authority).failureReasons.includes("ordinary_contribution_without_supported_purpose"));
// These are exact provider records and user-rejected complete replies, not new synthetic passing labels.
assert.equal(f.rawReplies.length,4);
for(const entry of f.rawReplies){
 assert.equal(createHash("sha256").update(entry.rawProviderJson).digest("hex"),entry.sha256);
 const raw=JSON.parse(entry.rawProviderJson);assert.equal(raw.choices[0].finish_reason,"stop");
 assert.equal(entry.expectedUserOverallAcceptance,"REJECTED_BY_USER");
 assert(raw.choices[0].message.content.trim());
}
assert.equal(JSON.stringify(f),originalBytes);assert.equal(externalCalls,0);
console.log(JSON.stringify({status:"PASS_LOCAL_ADOPTION_ONLY",roleEvidenceRetained:true,requiredContribution:null,preflightAligned:true,oldTaskInjectionRejected:true,legacySuggestionsNotRestored:true,unchangedConversationAndBoundaries:true,preservedRawReplies:4,externalCalls,modelBehaviorSolved:false}));
