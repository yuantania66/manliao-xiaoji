import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assembleConversationControlContext, buildDialogueState, createResponsePlan, createResponsePlanPreflightAuthoritySnapshot, interpretTurnDeterministically, mergeModelInterpretation } from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { locateInterpretationQuotes, buildInterpretationMessages } from "../services/ai/turnInterpretationAdapter";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import type { AiConversationMessage } from "../services/ai/types";

type Sample = {sequence:number;rawRequestJson:string;rawProviderJson:string;rawRequestSha256:string;rawProviderSha256:string};
const fixture = JSON.parse(readFileSync(new URL("./ordinary-move-fit-authority-fixture.json",import.meta.url),"utf8")) as {cases:Sample[];referenceRepairReply:string};
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw Error("Network forbidden in saved interpretation regression");};
function build(sample:Sample) {
 assert.equal(sha(sample.rawRequestJson),sample.rawRequestSha256);assert.equal(sha(sample.rawProviderJson),sample.rawProviderSha256);
 const request=JSON.parse(sample.rawRequestJson) as {messages:Array<{content:string}>};
 const input=JSON.parse(request.messages.at(-1)!.content) as {currentTurnId:string;currentUserMessage:string;adjacentTurns:AiConversationMessage[]};
 const context=assembleConversationControlContext({conversationId:"saved-ordinary-move-fit",currentTurnId:input.currentTurnId,userMessage:input.currentUserMessage,recentMessages:input.adjacentTurns,conversationState:determineConversationState({currentUserMessage:input.currentUserMessage,recentMessages:input.adjacentTurns})});
 assert.deepEqual(JSON.parse(buildInterpretationMessages(context).at(-1)!.content),JSON.parse(request.messages.at(-1)!.content),"Use exactly the real interpretation input");
 const raw=(JSON.parse(sample.rawProviderJson) as {choices:Array<{message:{content:string}}>}).choices[0].message.content;
 const model=locateInterpretationQuotes(raw,context);assert(model);
 const interpretation=mergeModelInterpretation(interpretTurnDeterministically(context),model,context);
 const dialogueState=buildDialogueState(context,interpretation);
 const plan=createResponsePlan({context,interpretation,dialogueState,clinicalAdviceProvider:()=>null});
 const authority=createResponsePlanPreflightAuthoritySnapshot({context,interpretation,dialogueState});
 return {context,interpretation,dialogueState,plan,authority};
}
async function main() {
const sample=fixture.cases.find(x=>x.sequence===258)!;
const result=build(sample);
const contract=result.plan.positiveFunctionContract;assert(contract?.action==="repair_previous_wording");
assert.equal(result.dialogueState.repairState.sourceRelation,"challenges_move_fit");
assert.equal(contract.repairMode,"interaction_move_withdrawal");assert.equal(contract.interactionMoveSubtype,null);
const preflight=preflightResponsePlan(result.plan,result.authority);
const before=process.env.ORDINARY_MOVE_FIT_EXPECT_PRE_FIX==="1";
if(before)assert.deepEqual(preflight.failureReasons,["missing_interaction_move_subtype_in_contract"]);
else {assert.deepEqual(preflight.failureReasons,[]);assert(!formatResponsePlanForPrompt(result.plan).includes("missing_subtype"));}
const results:Array<{name:string;passed:boolean;reasons?:string[]}> = [];
if (!before) {

// Complete-schema counterexamples mutate independent inputs or contract bindings, not old formats.
type Chain = ReturnType<typeof build>;
const targetOf = (chain:Chain) => chain.context.adjacentTurns.find(turn=>turn.id===contract.targetTurnId)!;
const negativeInputs: Array<[string,(chain:Chain)=>void]> = [
 ["missing model source",c=>{c.interpretation.evidenceSources=c.interpretation.evidenceSources.filter(x=>x!=="model_interpretation");}],
 ["different current user text",c=>{c.context.currentUserMessage="different current user";}],
 ["different current user turn",c=>{c.context.currentTurnId="different-user-turn";}],
 ["old interpretation user source",c=>{c.interpretation.contentMeaning.explicitPropositions[0].sourceTurnId="old-user-turn";}],
 ["missing adoption source",c=>{delete c.interpretation.stateUpdate.repairProposal!.sourceRelation;}],
 ["missing adoption evidence",c=>{c.interpretation.stateUpdate.repairProposal!.evidence=[];}],
 ["missing state source",c=>{delete c.dialogueState.repairState.sourceRelation;}],
 ["missing state adoption evidence",c=>{c.dialogueState.repairState.evidence=[];}],
 ["wrong proposal target",c=>{c.interpretation.stateUpdate.repairProposal!.targetTurnId="wrong-target";}],
 ["wrong state target",c=>{c.dialogueState.repairState.targetTurnId="wrong-target";}],
 ["below existing confidence threshold",c=>{c.interpretation.responseRelation.candidates.find(x=>x.relation==="challenges_move_fit")!.confidence=0.92;}],
 ["missing candidate evidence",c=>{c.interpretation.responseRelation.candidates.find(x=>x.relation==="challenges_move_fit")!.evidence=[];}],
 ["missing rejected target source",c=>{c.interpretation.stateUpdate.commonGround=[];}],
 ["changed target after interpretation",c=>{targetOf(c).content="different target text";}],
 ["target is User",c=>{targetOf(c).role="user";}],
 ["target not saved",c=>{targetOf(c).status=undefined;}],
 ["target blocked",c=>{targetOf(c).status="blocked";}],
 ["target is stale",c=>{c.context.adjacentTurns.push({...structuredClone(targetOf(c)),id:"newer-assistant"});}],
 ["unavailable committed move",c=>{delete targetOf(c).committedAssistantMove;}],
 ["invalid committed move with empty claims",c=>{Reflect.deleteProperty(targetOf(c).committedAssistantMove!,"purpose");}],
 ["nonempty committed claims",c=>{targetOf(c).committedAssistantMove!.claims=[{text:"a claim",provenance:["counterexample"]}];}],
 ["invalid second envelope cannot be hidden",c=>{Reflect.set(targetOf(c),"interactionMoveEnvelope",{schemaVersion:1,committedMove:{claims:[]}});}],
 ["safety owns current turn",c=>{c.context.safety.triggered=true;}],
 ["current factual replacement",c=>{c.context.currentUserMessage="不是同事，是我姐姐，你把人弄错了";c.interpretation.contentMeaning.literalText=c.context.currentUserMessage;c.interpretation.contentMeaning.explicitPropositions[0].text=c.context.currentUserMessage;}],
];
for(const [name,mutate] of negativeInputs) {
 const c=structuredClone(result);mutate(c);
 const authority=createResponsePlanPreflightAuthoritySnapshot(c);
 assert.equal(authority.ordinaryMoveFitRepairAuthority,null,name);
 const check=preflightResponsePlan(c.plan,authority);assert(!check.passed,name);
 assert(check.failureReasons.includes("missing_interaction_move_subtype_in_contract"),name);
 results.push({name,passed:true,reasons:check.failureReasons});
}
const authority=result.authority;
assert(authority.ordinaryMoveFitRepairAuthority);
assert(Object.isFrozen(authority.ordinaryMoveFitRepairAuthority));
assert.notEqual(authority.ordinaryMoveFitRepairAuthority,result.plan.positiveFunctionContract);
assert.equal(authority.ordinaryMoveFitRepairAuthority.confidence,0.95);
assert.equal(result.context.interactionMoveHandoffTarget,null);
assert.equal(result.plan.interactionMoveHandoffPlan,null);
for(const [name,mutate] of [
 ["wrong target id",(c:typeof contract)=>{c.targetTurnId="different";}],
 ["wrong target text",(c:typeof contract)=>{c.targetText="different";}],
 ["wrong source turn",(c:typeof contract)=>{c.sourceTurnId="different";}],
 ["wrong source text",(c:typeof contract)=>{c.sourceText="different";}],
 ["wrong replacement fact",(c:typeof contract)=>{c.replacementFact="invented";}],
 ["wrong repair mode",(c:typeof contract)=>{c.repairMode="proposition_withdrawal";}],
 ["missing subtype field",(c:typeof contract)=>{Reflect.deleteProperty(c,"interactionMoveSubtype");}],
] as Array<[string,(c:typeof contract)=>void]>) {
 const copy=structuredClone(result.plan);assert(copy.positiveFunctionContract?.action==="repair_previous_wording");mutate(copy.positiveFunctionContract);
 const check=preflightResponsePlan(copy,authority);assert(!check.passed,name);results.push({name,passed:true,reasons:check.failureReasons});
}
for(const [name,auth] of [
 ["no independent authority",undefined],
 ["plan labels cannot confer authority",{...authority,ordinaryMoveFitRepairAuthority:null}],
 ["wrong authority source",{...authority,ordinaryMoveFitRepairAuthority:{...authority.ordinaryMoveFitRepairAuthority,userTurnId:"different"}}],
 ["wrong authority target",{...authority,ordinaryMoveFitRepairAuthority:{...authority.ordinaryMoveFitRepairAuthority,assistantMoveId:"different"}}],
 ["authority below threshold",{...authority,ordinaryMoveFitRepairAuthority:{...authority.ordinaryMoveFitRepairAuthority,confidence:0.92}}],
] as const) {
 const check=preflightResponsePlan(result.plan,auth);assert(!check.passed,name);results.push({name,passed:true,reasons:check.failureReasons});
}
// A valid source remains detached if the caller later mutates its context.
const detached=structuredClone(result);const detachedAuthority=createResponsePlanPreflightAuthoritySnapshot(detached);targetOf(detached).content="mutated after snapshot";
assert.equal(detachedAuthority.ordinaryMoveFitRepairAuthority?.assistantText,contract.targetText);
results.push({name:"authority is frozen detached source evidence",passed:true});
for(const saved of fixture.cases.filter(x=>x.sequence!==258)) {
 const previous=build(saved);assert.equal(previous.plan.positiveFunctionContract?.action,"repair_previous_wording");
 assert.equal(previous.plan.positiveFunctionContract.repairMode,"proposition_withdrawal");
 assert.equal(previous.authority.ordinaryMoveFitRepairAuthority,null);
 assert(preflightResponsePlan(previous.plan,previous.authority).passed);
 results.push({name:"saved original proposition repair "+saved.sequence+" unchanged",passed:true});
}

const envelopeFor = (chain:Chain) => {
 const target=targetOf(chain),move=structuredClone(target.committedAssistantMove!);
 assert(target.id);
 return {schemaVersion:1 as const,assistantMoveId:target.id,origin:{kind:"response_plan" as const,planId:"existing-source-plan",sourceUserTurnId:move.sourceTurnId!},committedMove:move,handoff:null};
};
for(const [name,mutate] of [
 ["valid envelope cannot hide invalid legacy",(c:Chain)=>{targetOf(c).interactionMoveEnvelope=envelopeFor(c);Reflect.deleteProperty(targetOf(c).committedAssistantMove!,"purpose");}],
 ["valid legacy cannot hide envelope claims",(c:Chain)=>{const envelope=envelopeFor(c);envelope.committedMove.claims=[{text:"a claim",provenance:["counterexample"]}];targetOf(c).interactionMoveEnvelope=envelope;}],
 ["valid envelope cannot hide legacy claims",(c:Chain)=>{targetOf(c).interactionMoveEnvelope=envelopeFor(c);targetOf(c).committedAssistantMove!.claims=[{text:"a claim",provenance:["counterexample"]}];}],
] as Array<[string,(c:Chain)=>void]>) {
 const c=structuredClone(result);mutate(c);const a=createResponsePlanPreflightAuthoritySnapshot(c);assert.equal(a.ordinaryMoveFitRepairAuthority,null,name);assert(!preflightResponsePlan(c.plan,a).passed,name);results.push({name,passed:true});
}
for(const [name,mutate] of [
 ["existing threshold exactly0.93",(c:Chain)=>{c.interpretation.responseRelation.candidates.find(x=>x.relation==="challenges_move_fit")!.confidence=0.93;}],
 ["valid ordinary envelope without legacy",(c:Chain)=>{targetOf(c).interactionMoveEnvelope=envelopeFor(c);delete targetOf(c).committedAssistantMove;}],
 ["two valid claimless sources agree",(c:Chain)=>{targetOf(c).interactionMoveEnvelope=envelopeFor(c);}]
] as Array<[string,(c:Chain)=>void]>) {
 const c=structuredClone(result);mutate(c);const a=createResponsePlanPreflightAuthoritySnapshot(c);assert(a.ordinaryMoveFitRepairAuthority,name);assert(preflightResponsePlan(c.plan,a).passed,name);results.push({name,passed:true});
}
// The source authority never changes the complete semantic gate's decision.
const semanticCases=[
 {name:"saved actual repair reply",reply:fixture.referenceRepairReply,pass:true},
 {name:"generic apology is not completion",reply:"抱歉，我理解偏了。",pass:false},
 {name:"continuing the rejected move is not repair",reply:"但你还是在逃避面对这件事。",pass:false},
];
for(const item of semanticCases) {
 assert(preflightResponsePlan(result.plan,authority).passed);
 const checked=await validatePlannedFunctionSemanticOutput({plan:result.plan,reply:item.reply,
  semanticContext:{currentUserText:result.context.currentUserMessage,handoffTargetAssistantText:null},
  provider:async input=>({schemaVersion:1,planId:input.planId,handoff:null,semanticQuestionCount:0,
   positiveFunction:{binding:{action:contract.action,repairMode:contract.repairMode,sourceTurnId:contract.sourceTurnId,targetTurnId:contract.targetTurnId},
    status:item.pass?"satisfied":"not_satisfied",realizedAction:item.pass?contract.action:null,targetAddressed:item.pass,contractRealized:item.pass,containsContradictoryMove:false,
    evidence:[{start:0,end:item.reply.length,text:item.reply,reason:item.pass?"Authored local observation: owns and withdraws the exact target move.":"Authored local observation: does not own and withdraw the target move."}]}})});
 assert.equal(checked.providerFailure,undefined,item.name);assert(checked.verdict,item.name);assert.equal(checked.passed,item.pass,item.name);
 if(!item.pass)assert(checked.failureReasons.includes("planned_function_semantic:positive_function_not_satisfied"),item.name);
 results.push({name:item.name+" (complete authored verdict, not real model evidence)",passed:true,reasons:checked.failureReasons});
}
if(process.env.ORDINARY_MOVE_FIT_OLD_FORMATTER) {
 const old=await import(pathToFileURL(process.env.ORDINARY_MOVE_FIT_OLD_FORMATTER).href);
 const oldPrompt=old.formatResponsePlanForPrompt(result.plan) as string;
 const newPrompt=formatResponsePlanForPrompt(result.plan);
 assert(oldPrompt.includes("missing_subtype"));assert(!newPrompt.includes("missing_subtype"));assert(newPrompt.includes(contract.targetText));
 for(const saved of fixture.cases.filter(x=>x.sequence!==258)) {
  const previous=build(saved);assert.equal(old.formatResponsePlanForPrompt(previous.plan),formatResponsePlanForPrompt(previous.plan));
 }
 if(process.env.ORDINARY_MOVE_FIT_PROMPT_REPORT)writeFileSync(process.env.ORDINARY_MOVE_FIT_PROMPT_REPORT,JSON.stringify({source:"same reconstructed raw258 plan; actual old frozen formatter versus repaired formatter",before:oldPrompt,after:newPrompt},null,2)+"\n");
 results.push({name:"actual old/new prompt difference limited to new null route; original250/254 prompts identical",passed:true});
}

}
assert.equal(networkCalls,0);
const report={cases:results.length+1,results,status:before?"BASELINE_RAW258_PLAN_FAILURE_REPRODUCED":"PASS_RAW258_LOCAL_PLAN_ONLY",preflight:preflight.failureReasons,networkCalls};
if(process.env.ORDINARY_MOVE_FIT_REPORT)writeFileSync(process.env.ORDINARY_MOVE_FIT_REPORT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));

}
main().catch(error=>{console.error(error);process.exitCode=1;});
