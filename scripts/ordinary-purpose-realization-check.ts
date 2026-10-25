import type { AiModelMessage } from "../services/ai/types";
import type { OrdinaryRegenerationFeedback } from "../services/ai/responsePlanValidator";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { projectAcknowledgmentScopeContract, formatAcknowledgmentScopeContract } from "../conversation-os/control/ordinaryPurpose";
import { buildChatPrompt, CHAT_PROMPT_VERSION } from "../services/ai/promptBuilder";
import { validatePlannedFunctionSemanticOutput, defaultPlannedFunctionSemanticProvider, plannedFunctionSemanticDeveloperContentFor } from "../services/ai/plannedFunctionSemanticValidator";
import { enforceResponsePlan, formatResponsePlanRegenerateConstraint } from "../services/ai/responsePlanValidator";
const fixture = JSON.parse(readFileSync(new URL("./ordinary-purpose-realization-fixture.json", import.meta.url), "utf8"));
// Saved wire fixtures stay immutable; only this approved shared sentence is adapted in comparison copies.
const legacySharedGuidance = '不要把“收到、我在、随时都在、记下了”当成完整回复，也不要声称一直在等用户。';
const currentSharedGuidance = '不要把“收到、我在、随时都在、记下了”自动当成完整回复，也不要声称一直在等用户。普通自然回应中，用户明确只需知悉时，简短确认收到可以完成这个要求；不得据此豁免其他已选功能或答复义务。';
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
assert.equal(sha(fixture.evidence.rawReplyProviderJson),fixture.evidence.rawReplySha256);
assert.equal(sha(fixture.evidence.rawJudgeProviderJson),fixture.evidence.rawJudgeSha256);
const realReplyProvider=JSON.parse(fixture.evidence.rawReplyProviderJson),realJudgeProvider=JSON.parse(fixture.evidence.rawJudgeProviderJson);
const realReply=realReplyProvider.choices[0].message.content;
const realVerdict=JSON.parse(realJudgeProvider.choices[0].message.content);
assert.equal(realVerdict.positiveFunction.status,"satisfied","Preserve the real false acceptance without rewriting it");
assert.equal(realVerdict.positiveFunction.acknowledgmentScopeObservation,undefined);
const {plan,semanticContext}=fixture;
const currentSource={turnId:plan.disclosureScope.turnId,text:semanticContext.currentUserText};
const contract=projectAcknowledgmentScopeContract(plan.ordinaryPosture,currentSource)!;assert(contract);
const contractText=formatAcknowledgmentScopeContract(contract);
assert.equal(contract.scopeObject,"treatment_acceptance");assert.equal(contract.requiredRelation,"not_required_by_acknowledgment");
const surface=buildChatPrompt({userMessage:semanticContext.currentUserText,recentMessages:semanticContext.ordinaryRecentMessages,responsePlan:plan});
assert(surface.messages.some(m=>m.content.includes(contractText)));
assert.equal(CHAT_PROMPT_VERSION,"chat-response-plan-v49-selected-experience-invitation");
const run=(verdict:unknown,reply=realReply,p=plan)=>validatePlannedFunctionSemanticOutput({plan:p,reply,semanticContext,provider:async()=>verdict});
// Every supplemented observation below is a HUMAN counterfactual, not the original provider result.
const humanVerdict=(scopeObject:string,implication:string,indices=[0],reply=realReply)=>{
 const v=structuredClone(realVerdict);const b=v.positiveFunction;
 b.acknowledgmentScopeObservation={scopeObject,implication,candidateEvidenceIndices:indices};
 b.evidence=[{start:0,end:reply.length,text:reply,reason:"Human-authored complete-schema combination check; not a real provider observation."}];
 return v;
};
const assertParsed=(r:Awaited<ReturnType<typeof run>>)=>{
 assert(r.verdict,"Must exercise parsed complete-schema evidence, not malformed/missing-field rejection");
 assert(!r.failureReasons.some(x=>["malformed_verdict","binding_mismatch","evidence_mismatch","provider_failure"].some(t=>x.endsWith(t))));
};
const main=async()=>{
 let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error("NO_EXTERNAL_CALLS")};
 const legacy=await run(realVerdict);assertParsed(legacy);assert.equal(legacy.passed,false);
 assert.deepEqual(legacy.acknowledgmentScopeAssessment?.uncertainFields,["observation"]);
 for(const [object,relation,field]of [
  ["feeling_legitimacy","not_required_by_acknowledgment","scopeObject"],
  ["treatment_acceptance","coexists","implication"],
  ["coexistence_only","coexists","scopeObject"],
  ["other_or_missing","other_or_missing","scopeObject"],
 ]){
  const r=await run(humanVerdict(object,relation));assertParsed(r);assert(!r.passed);
  assert.equal(r.verdict!.positiveFunction!.status,"satisfied");
  assert.deepEqual(r.ordinaryUseAssessment?.failedFields,[]);
  assert.equal(r.acknowledgmentScopeAssessment?.overallRejected,false);
  assert(r.acknowledgmentScopeAssessment?.failedFields.includes(field as "scopeObject"|"implication"));
  assert(r.hardFailureReasons.includes("planned_function_semantic:positive_function_not_satisfied"));
 }
 for(const indices of [[],[1]]){
  const r=await run(humanVerdict("treatment_acceptance","not_required_by_acknowledgment",indices));assertParsed(r);assert(!r.passed);
  assert(r.acknowledgmentScopeAssessment?.failedFields.includes("candidateEvidenceIndices"));
 }
 const uncertain=await run(humanVerdict("uncertain","not_required_by_acknowledgment"));assertParsed(uncertain);
 assert(uncertain.hardFailureReasons.includes("planned_function_semantic:positive_function_uncertain"));
 // A human-labeled boundary positive can use no question, advice, new fact or forced progression.
 const positiveReply="承认这处疏忽，不意味着你就得接受被当众批评的方式。";
 const positive=humanVerdict("treatment_acceptance","not_required_by_acknowledgment",[0],positiveReply);
 positive.positiveFunction.ordinaryUseObservation.useComparison.candidateAct="Human fixture: separates acknowledging the point from an obligation to accept the treatment.";
 const accepted=await run(positive,positiveReply);assertParsed(accepted);assert(accepted.passed);
 const noQuestions=structuredClone(plan);noQuestions.questionPolicy={mode:"none",reason:"Frozen local no-question boundary"};
 assert((await run(positive,positiveReply,noQuestions)).passed);
 const asks=structuredClone(positive);asks.semanticQuestionCount=1;
 assert((await run(asks,positiveReply,noQuestions)).hardFailureReasons.includes("planned_function_semantic:question_count_quality"));
 const contradicts=structuredClone(positive);contradicts.positiveFunction.containsContradictoryMove=true;
 assert(!(await run(contradicts,positiveReply)).passed,"New purpose evidence cannot override an independent boundary failure");
 const noPurpose=structuredClone(plan);noPurpose.ordinaryPosture.requiredContribution=null;
 assert((await run(positive,positiveReply,noPurpose)).failureReasons.includes("planned_function_semantic:malformed_verdict"),"Observation cannot create a purpose in an unselected branch");
 const invalidSource=structuredClone(plan);invalidSource.ordinaryPosture.sourceSpans[1].text="Not in the User source";
 assert.equal(projectAcknowledgmentScopeContract(invalidSource.ordinaryPosture,currentSource),null);
 let sourceCalls=0;
 const sourceResult=await validatePlannedFunctionSemanticOutput({plan:invalidSource,reply:realReply,semanticContext,provider:async()=>{sourceCalls++;return positive;}});
 assert.equal(sourceCalls,0);assert(!sourceResult.passed);assert.throws(()=>buildChatPrompt({userMessage:semanticContext.currentUserText,recentMessages:[],responsePlan:invalidSource}),/Invalid selected ordinary purpose/);
 let generationCalls=0,judgeCalls=0,secondConstraint="",secondFeedback:OrdinaryRegenerationFeedback|null|undefined;
 const badComplete=humanVerdict("feeling_legitimacy","coexists");
 const enforced=await enforceResponsePlan({plan,plannedFunctionSemanticContext:semanticContext,
  plannedFunctionSemanticProvider:async()=>++judgeCalls===1?badComplete:positive,
  generate:async(constraint,executionPlan,feedback)=>{
   generationCalls++;if(generationCalls===1){assert.equal(feedback,undefined);assert.equal(constraint,null);}
   else {secondConstraint=constraint!;secondFeedback=feedback;assert(Object.isFrozen(feedback));assert.equal(executionPlan.planId,plan.planId);}
   const text=generationCalls===1?realReply:positiveReply;
   return{text,rawLLMOutput:text,model:"local-fixed",promptVersion:CHAT_PROMPT_VERSION,finalReplySource:"llm",latencyMs:0,postProcessSteps:[]};
  }});
 assert.equal(enforced.outcome,"validated");assert.equal(generationCalls,2);assert.equal(judgeCalls,2);
 assert(secondConstraint.includes(contractText));assert(!secondConstraint.includes(realReply));
 assert.equal(secondFeedback!.acknowledgmentScopeObservation!.scopeObject,"feeling_legitimacy");
 assert(secondFeedback!.acknowledgmentScopeAssessment!.failedFields.includes("scopeObject"));
 assert(!JSON.stringify(secondFeedback).includes(badComplete.positiveFunction.evidence[0].reason));
 const failure=["planned_function_semantic:positive_function_not_satisfied"],fallback=formatResponsePlanRegenerateConstraint(plan,failure);
 for(const patch of [{planId:"wrong-plan"},{kind:"wrong-kind"},{candidateReply:""},{acknowledgmentScopeAssessment:{failedFields:"bad",uncertainFields:[]}},{acknowledgmentScopeAssessment:null}]){
  assert.equal(formatResponsePlanRegenerateConstraint(plan,failure,{...secondFeedback!,...patch} as OrdinaryRegenerationFeedback),fallback,"Malformed or cross-plan feedback cannot drive target-specific repair");
 }
 for(const item of fixture.unchangedWireCases){
  const ordinary=item.plan.responseActions.includes("acknowledge_without_psychologizing");
  const generated=buildChatPrompt({userMessage:item.text,recentMessages:[],responsePlan:item.plan}).messages;
  const expectedSurface = structuredClone(item.surfaceMessages);
  const sharedBefore = expectedSurface[0].content as string;
  assert.equal(sharedBefore.split(legacySharedGuidance).length, 2, "Each frozen shared prompt contains the unique legacy sentence");
  assert.equal(generated[0].content.split(currentSharedGuidance).length, 2, "Each actual shared prompt contains the unique current exception");
  expectedSurface[0].content = sharedBefore.replace(legacySharedGuidance, currentSharedGuidance);
  assert.deepEqual(generated[0], expectedSurface[0], "Shared prompt differs only by approved acknowledgement-only exception, including its other-obligation limit");
  const stripSurface=(messages:AiModelMessage[])=>messages.map(m=>({...m,content:m.content.split("\n").filter((line:string)=>!line.startsWith("surfaceConstraints:")).join("\n")}));
  if(ordinary){
   assert.deepEqual(stripSurface(generated),stripSurface(expectedSurface),"Only the ordinary surface guidance may differ");
   assert(generated.some(m=>m.content.includes("Natural emotional acknowledgment")));
   assert(formatResponsePlanRegenerateConstraint(item.plan,failure).includes("自然情绪确认"));
  }else{
   assert.deepEqual(generated,expectedSurface,"Nonordinary Surface bytes remain unchanged apart from the separately verified shared exception");
   assert.equal(formatResponsePlanRegenerateConstraint(item.plan,failure),item.regenerationConstraint);
  }
  let actualMessages:AiModelMessage[]|null=null;
  await validatePlannedFunctionSemanticOutput({plan:item.plan,reply:item.reply,semanticContext:item.semanticContext,
   provider:input=>defaultPlannedFunctionSemanticProvider(input,({messages})=>{actualMessages=messages;throw Error("LOCAL_BEFORE_DISPATCH_CAPTURE");})});
  const captured=actualMessages as unknown as AiModelMessage[];
  if(ordinary){
   const stripOrdinary=(content:string)=>content.split("\n").filter(line=>!line.startsWith("For acknowledge_without_psychologizing,")).join("\n");
   assert.equal(stripOrdinary(captured[0].content),stripOrdinary(item.judgeMessages[0].content),"Nonordinary judge rules are unchanged");
   const data=JSON.parse(captured[1].content),oldData=JSON.parse(item.judgeMessages[1].content);
   assert.equal(data.outputSchema.positiveFunction.ordinaryUseObservation.repetitionPurpose,
    oldData.outputSchema.positiveFunction.ordinaryUseObservation.repetitionPurpose.replace("organizing |", "organizing | emotional_acknowledgment |"));
   data.outputSchema.positiveFunction.ordinaryUseObservation.repetitionPurpose=oldData.outputSchema.positiveFunction.ordinaryUseObservation.repetitionPurpose;
   assert.deepEqual(data,oldData,"No other ordinary request field changes");
  }else assert.deepEqual(actualMessages,item.judgeMessages,"Nonordinary outbound messages remain byte-equivalent");
 }
 // Replay the original provider payload through the REAL default parser/normalizer with a local transport.
 let localReplayCalls=0;
 Object.assign(process.env,{AI_PROVIDER:"qwen",AI_MAIN_MODEL:"qwen3.7-max",AI_SEMANTIC_VALIDATOR_MODEL:"qwen3.7-max",QWEN_API_KEY:"offline-only"});
 globalThis.fetch=async(_url,init)=>{localReplayCalls++;const body=JSON.parse(init!.body as string);assert(body.messages[0].content.includes(contractText));
  assert(JSON.parse(body.messages[1].content).outputSchema.positiveFunction.acknowledgmentScopeObservation);
  return new Response(fixture.evidence.rawJudgeProviderJson,{status:200});};
 const replay=await validatePlannedFunctionSemanticOutput({plan,reply:realReply,semanticContext});
 assertParsed(replay);assert(!replay.passed);assert.equal(localReplayCalls,1,"Old format is uncertain, not an added schema-repair request");
 // Known limitation: code cannot detect a model that falsely labels the relation as correct.
 assert((await run(humanVerdict("treatment_acceptance","not_required_by_acknowledgment"))).passed,
  "Deliberately false observation demonstrates why local structure is not a model-quality proof");
 assert.equal(externalCalls,0);
 console.log(JSON.stringify({status:"PASS_LOCAL_ONLY",externalCalls,rawReplyHash:fixture.evidence.rawReplySha256,rawJudgeHash:fixture.evidence.rawJudgeSha256,
  completeSchemaWrongObjectAndRelationRejected:true,preservedWireCases:fixture.unchangedWireCases.length,ordinaryGuidanceOnlyCases:3,nonordinaryOtherBytesPreservedCases:1,sharedAcknowledgementExceptionOnlyCases:fixture.unchangedWireCases.length,existingRegenerationCount:1,modelBehaviorSolved:false}));
};
main().catch(error=>{console.error(error);process.exitCode=1;});
