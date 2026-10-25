import { cleanObservationFor } from "./semantic-observation-fixture";
import { buildCanonicalOrdinaryPostureProvenance } from "../conversation-os/control/responsePlanPreflightAuthority";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleConversationControlContext, buildDialogueState, createResponsePlan, createResponsePlanPreflightAuthoritySnapshot,
  interpretTurnDeterministically, mergeModelInterpretation, ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS,
  type ResponsePlan, type OrdinaryResponseFunction } from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { buildChatPrompt, sanitizeChatHistory } from "../services/ai/promptBuilder";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { plannedFunctionSemanticDeveloperContentFor, validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticProviderInput, type PlannedFunctionSemanticVerdict } from "../services/ai/plannedFunctionSemanticValidator";
const saved=JSON.parse(readFileSync(new URL('./ordinary-posture-replay-fixture.json',import.meta.url),'utf8'));
const build=(userMessage:string,recentMessages=saved.input.recentMessages,payload?:Parameters<typeof mergeModelInterpretation>[1])=>{
 const context=assembleConversationControlContext({conversationId:'ordinary-function-local',currentTurnId:saved.input.currentTurnId,userMessage,recentMessages,
  conversationState:determineConversationState({currentUserMessage:userMessage,recentMessages})});
 const base=interpretTurnDeterministically(context);const interpretation=payload?mergeModelInterpretation(base,payload,context):base;
 const dialogueState=buildDialogueState(context,interpretation);
 const plan=createResponsePlan({context,interpretation,dialogueState,clinicalAdviceProvider:()=>null});
 return {context,interpretation,dialogueState,plan,authority:createResponsePlanPreflightAuthoritySnapshot({context,interpretation,dialogueState})};
};
const shared=build(saved.input.userMessage,saved.input.recentMessages,saved.interpretation);
const selected=(r:ReturnType<typeof build>)=>r.plan.positiveFunctionContract?.action==='acknowledge_without_psychologizing'?r.plan.positiveFunctionContract.responseFunction:undefined;
assert.equal(selected(shared),'invite_optional_sharing');
const natural=build('这件事已经处理好了，你知道就行。',[]);
assert.equal(selected(natural),'respond_naturally');
const refuse=build('先不用问，我只是说一下。',[]);
assert.equal(selected(refuse),'respect_declined_sharing');assert.equal(refuse.plan.questionPolicy.mode,'none');
const burden=build('不用分析，先听我说。',[]);
assert.equal(selected(burden),'reduce_expression_burden');
const minimal=build('嗯。',[]);assert.equal(selected(minimal),'respond_naturally');assert.equal(minimal.plan.questionPolicy.mode,'none');
const direct=build('2加2等于几？',[]);assert(direct.plan.responseActions.includes('answer_directly'));assert.equal(selected(direct),undefined);
const plainFact=build('这款手机有两个摄像头。',[]);assert.equal(selected(plainFact),'respond_naturally');
const factualContinuation=build('这款手机有两个摄像头。',saved.input.recentMessages.slice(1));
assert.equal(selected(factualContinuation),'respond_naturally');
assert(!ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS.invite_optional_sharing.includes('自身经历'));
const oldBoundary=build('现在继续说一点。',[{id:'prior-u',role:'user',content:'先不用问我。',status:'saved'},
 {id:'prior-a',role:'assistant',content:'好。',status:'saved'}]);
// Existing reopening semantics remain authoritative, not a new refusal keyword list.
for(const r of [shared,natural,refuse,burden,minimal,plainFact,oldBoundary,factualContinuation]){
 assert(preflightResponsePlan(r.plan,r.authority).passed);
 const text=buildChatPrompt({userMessage:r.context.currentUserMessage,recentMessages:r.context.adjacentTurns,responsePlan:r.plan}).messages.map(m=>m.content).join('\n');
 const fn=selected(r)!;assert(text.includes(ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS[fn]));
 assert(text.includes('不得编造事件、动机或心理状态'));
 assert(!text.includes('Complete exactly the selected ordinary support function:'),'Do not import emotional-support action rules');
 assert(ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS[fn].includes('不')&&(ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS[fn].includes('回应')||ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS[fn].includes('确认')));
}
// Recorded suggestions remain intact; neither invitation permission nor an
// apparently concrete free-text suggestion creates a required task.
assert.equal(shared.plan.ordinaryPosture?.requiredContribution,null);
assert.equal(natural.plan.ordinaryPosture?.requiredContribution,null);
for(const r of [refuse,burden])assert(r.plan.ordinaryPosture?.requiredContribution);
for(const mode of ['accompany','explore']){
 const payload=structuredClone(saved.interpretation);payload.ordinaryPostureProposal.mode=mode;
 payload.responseRelation.candidates=payload.responseRelation.candidates.slice(0,1);
 const original=JSON.stringify(payload);
 const r=build(saved.input.userMessage,saved.input.recentMessages,payload);
 assert.equal(r.plan.ordinaryPosture?.requiredContribution,null);
 assert.equal(r.plan.ordinaryPosture?.mode,'accompany');
 assert.equal(JSON.stringify(payload),original);
 const prompt=buildChatPrompt({userMessage:r.context.currentUserMessage,recentMessages:r.context.adjacentTurns,responsePlan:r.plan}).messages.map(m=>m.content).join('\n');
 assert(prompt.includes('"requiredContribution":null'));
 assert(!prompt.includes(payload.ordinaryPostureProposal.proposedContribution.instruction));
 assert(!prompt.includes('本轮普通承接作用：'));
 assert(!prompt.includes('每轮必须完成 ResponsePlan 指定的具体会话功能'));
}
const forged=structuredClone(shared.plan);forged.ordinaryPosture!.requiredContribution={targetSpanIndexes:[0],instruction:'邀请用户继续分享'};
assert(preflightResponsePlan(forged,shared.authority).failureReasons.includes('ordinary_contribution_without_supported_purpose'));
for(const responseFunction of ['reduce_expression_burden','respect_declined_sharing'] as const){
 const plain=build('今天买了一本书。',[]);const forged=structuredClone(plain.plan);
 assert(forged.positiveFunctionContract?.action==='acknowledge_without_psychologizing');
 forged.positiveFunctionContract.responseFunction=responseFunction;
 assert(!preflightResponsePlan(forged,plain.authority).passed,'A forged manner cannot restore a purpose even when requiredContribution is null');
 forged.ordinaryPosture!.requiredContribution={targetSpanIndexes:[0],instruction:ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS[responseFunction]};
 forged.relevanceProvenance=forged.relevanceProvenance.map(p=>p.planElement==='ordinaryPosture:binding'?buildCanonicalOrdinaryPostureProvenance(forged.ordinaryPosture!):p);
 assert(preflightResponsePlan(forged,plain.authority).failureReasons.includes('ordinary_contribution_without_supported_purpose'),'Manner and provenance cannot authorize their own purpose');
}
const missing=structuredClone(shared.plan);delete (missing.ordinaryPosture as Partial<NonNullable<ResponsePlan["ordinaryPosture"]>>).requiredContribution;
assert(!preflightResponsePlan(missing,shared.authority).passed,'Missing is not an explicit null');
const c=shared.plan.positiveFunctionContract;assert(c?.action==='acknowledge_without_psychologizing');
assert(preflightResponsePlan({...shared.plan,positiveFunctionContract:{...c,responseFunction:'bad' as OrdinaryResponseFunction}},shared.authority).failureReasons.includes('invalid_ordinary_acknowledgement_contract'));
assert(!preflightResponsePlan({...shared.plan,questionPolicy:{mode:'none',reason:'fixed no question'}},shared.authority).passed, 'Cannot retain a selected invitation when question permission is withdrawn');
const verdict=(input:PlannedFunctionSemanticProviderInput,status:'satisfied'|'not_satisfied',questions:number,reason:string):PlannedFunctionSemanticVerdict=>{
 const binding=input.positiveFunctionBinding;assert(binding?.action==='acknowledge_without_psychologizing');
 return {schemaVersion:1,planId:input.planId,handoff:null,positiveFunction:{binding:{action:binding.action,sourceTurnId:binding.sourceTurnId,allowIdle:binding.allowIdle,
  ...(binding.responseFunction?{responseFunction:binding.responseFunction}:{})},status,realizedAction:status==='satisfied'?binding.action:null,targetAddressed:status==='satisfied',contractRealized:status==='satisfied',containsContradictoryMove:false,
  ...cleanObservationFor(input),
  ...(binding.responseFunction==='invite_optional_sharing'?{ordinaryInvitationObservation:{confirmation:'missing' as const,opening:'missing' as const,confirmationEvidenceIndices:[],openingEvidenceIndices:[]}}:{}),evidence:[{start:0,end:input.candidateReply.length,text:input.candidateReply,reason}]},semanticQuestionCount:questions};
};
// Expectations are human labels. Fixed providers exercise routing/binding, NOT model quality.
const cases=[
 {id:'saved-bad-normalization',r:shared,reply:'问题归问题，但被当众点出来确实让人难堪，这种感受很正常。',ok:false,q:0,reason:'在用户已经说明疏忽与难堪的上下文中，只重组已知信息并正常化，未完成实际承接。'},
 {id:'saved-bad-scope-comparison',r:shared,reply:'疏忽归疏忽，当众被说确实让人难堪，这两件事本来就不冲突。',ok:false,q:0,reason:'与完整当前消息相比，仍只复述两者关系，功能字段存在不能使其通过。'},
 {id:'relation-paraphrase-acceptance-wording',r:shared,reply:'承认这处疏忽，和此刻仍觉得难堪，可以同时在这里。',ok:false,q:0,reason:'与已表达的疏忽及难堪相比，只换说法确认两者共存；接纳措辞本身不证明当前用途。'},
 {id:'grounded-permission-without-question',r:shared,reply:'承认这处疏忽，不意味着你就得接受被当众批评的方式。',ok:false,q:0,reason:'人工候选：区分认领疏忽与接受反馈方式的许可，不断言隐藏心理、不归责、不要求继续；只作合同接线检查，不代表用户偏好或模型质量已证实。'},
 {id:'repeated-invitation',r:shared,reply:'想聊的话随时可以说说。',ok:false,q:1,reason:'上一轮已经邀请且用户正在展开，再次空泛邀请增加表达负担。'},
 {id:'human-relevant-invitation',r:shared,reply:'那会儿你是怎么应对的？',ok:false,q:1,reason:'人工候选：了解尚未说明的当时应对，给用户讲述经历的空间，未预设自责或自卑。'},
 {id:'human-natural-no-progression',r:natural,reply:'好，这里不必再解释经过了。',ok:true,q:0,reason:'人工候选：回应用户只需告知的明确用途，不要求复盘、分析或推进。'},
 {id:'burdensome-analysis',r:shared,reply:'你先完整回顾一下经过，再解释你为什么难堪。',ok:false,q:1,reason:'要求完整整理和解释已表达情绪，增加负担，不是低负担的经历承接。'},
 {id:'unsupported-psychology',r:shared,reply:'你是因为自卑才这么在意别人的看法。',ok:false,q:0,reason:'用户没有表达自卑或在意他人看法的心理原因，不能编造内心来制造增量。'},
 {id:'refusal-must-not-reinvite',r:refuse,reply:'那你再多说一点吧。',ok:false,q:1,reason:'用户已拒绝追问，不得再次索取展开。'},
];
const main=async()=>{
 for(const item of cases){
  const plan=item.r.plan;const context={currentUserText:item.r.context.currentUserMessage,handoffTargetAssistantText:null,
    ordinaryRecentMessages:sanitizeChatHistory({userMessage:item.r.context.currentUserMessage,recentMessages:item.r.context.adjacentTurns}).included};
  const result=await validatePlannedFunctionSemanticOutput({plan,reply:item.reply,semanticContext:context,provider:async input=>{
   assert(input.positiveFunctionBinding?.action==='acknowledge_without_psychologizing');assert.equal(input.positiveFunctionBinding.responseFunction,selected(item.r));
   const rules=plannedFunctionSemanticDeveloperContentFor(input).scoped;
   assert(rules.includes(ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS[selected(item.r)!]));
   assert(rules.includes('Respect the selected refusal or expression-burden boundary'));assert(!rules.includes('ES-SCOPE:'));
   assert(rules.includes('First report ordinaryUseObservation independently of status'));
   assert(rules.includes('code combines ordinaryUseObservation'));
   assert(rules.includes('exact nonempty UTF-16 offsets'));
   return verdict(input,item.ok?'satisfied':'not_satisfied',item.q,item.reason);
  }});
  assert.equal(result.providerFailure,undefined,item.id+': fixed provider must actually return a verdict');
  assert(result.verdict,item.id+': rejection must not come from a broken fixture');
  assert.equal(result.passed,item.ok,item.id);
 }
 const legacyContract={...c};delete legacyContract.responseFunction;
 const legacyPlan={...shared.plan,positiveFunctionContract:legacyContract};
 const legacyResult=await validatePlannedFunctionSemanticOutput({plan:legacyPlan,reply:'人工兼容检查',semanticContext:{currentUserText:saved.input.userMessage,handoffTargetAssistantText:null,ordinaryRecentMessages:saved.input.recentMessages},provider:async input=>verdict(input,'satisfied',0,'Fixed legacy compatibility only')});
 assert.equal(legacyResult.passed,true,'Legacy recorded contracts remain readable');
 for(const mismatch of ['omit','wrong'] as const){
  const result=await validatePlannedFunctionSemanticOutput({plan:shared.plan,reply:'人工检查',semanticContext:{currentUserText:saved.input.userMessage,handoffTargetAssistantText:null,ordinaryRecentMessages:saved.input.recentMessages},
   provider:async input=>{const v=verdict(input,'satisfied',0,'Fixed binding check');const b=v.positiveFunction!.binding;if(b.action==='acknowledge_without_psychologizing'){if(mismatch==='omit')delete b.responseFunction;else b.responseFunction='respect_declined_sharing';}return v;}});
  assert.equal(result.passed,false,'New function binding must not be omitted or substituted');
 }
 console.log(JSON.stringify({passed:true,externalRequests:0,selectionCases:9,qualityExpectations:cases.map(c=>({id:c.id,expected:c.ok?'accept':'reject'})),reasonSource:'human-labelled expectations',modelQualityEstablished:false,noQuestionOrProgressionRequired:true}));
};main().catch(e=>{console.error(e);process.exitCode=1;});
