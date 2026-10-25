import type { ConversationControlContext, TurnInterpretation, DialogueState, ResponsePlan } from "../conversation-os/control";
import type { AiModelMessage } from "../services/ai/types";
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildDialogueState,createResponsePlan,createResponsePlanPreflightAuthoritySnapshot,ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS,interpretTurnDeterministically} from '../conversation-os/control';
import {supportsOrdinaryExperienceInvitation} from '../conversation-os/control/ordinaryResponseBoundary';
import {buildChatPrompt} from '../services/ai/promptBuilder';
import {preflightResponsePlan} from '../services/ai/chatExecutionLifecycle';
import {validatePlannedFunctionSemanticOutput,defaultPlannedFunctionSemanticProvider,plannedFunctionSemanticDeveloperContentFor} from '../services/ai/plannedFunctionSemanticValidator';
import {formatResponsePlanRegenerateConstraint} from '../services/ai/responsePlanValidator';
const f=JSON.parse(readFileSync(new URL('./ordinary-role-purpose-adoption-fixture.json',import.meta.url),'utf8'));
const base=JSON.stringify(f);let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error('NO_EXTERNAL_CALLS')};
const build=(mutate?:(c:ConversationControlContext,i:TurnInterpretation,s:DialogueState)=>void)=>{
 const c=structuredClone(f.context),i=structuredClone(f.interpretation),s=buildDialogueState(c,i);mutate?.(c,i,s);
 const p=createResponsePlan({context:c,interpretation:i,dialogueState:s,clinicalAdviceProvider:()=>null});
 return {c,i,s,p,a:createResponsePlanPreflightAuthoritySnapshot({context:c,interpretation:i,dialogueState:s})};
};
const selected=build();assert.equal((selected.p.positiveFunctionContract as Extract<NonNullable<ResponsePlan['positiveFunctionContract']>,{action:'acknowledge_without_psychologizing'}>).responseFunction,'invite_optional_sharing');
assert.equal(selected.p.ordinaryPosture?.requiredContribution,null);assert(preflightResponsePlan(selected.p,selected.a).passed);
const boundaries:Array<[string,(c:ConversationControlContext,i:TurnInterpretation,s:DialogueState)=>void]>=[
 ['no-previous-invitation',c=>c.adjacentTurns.at(-1)!.content='我知道了。'],
 ['no-personal-concern',c=>{c.adjacentTurns[0].content='这款手机有两个摄像头。';c.currentUserMessage='还支持广角。';}],
 ['non-user-concern',c=>{c.adjacentTurns[0].content='朋友说觉得他很难过。';c.currentUserMessage='这是他的经历。';}],
 ['context-switch',(_c,i)=>i.responseRelation.candidates=[{...i.responseRelation.candidates[0],relation:'opens_new_thread'}]],
 ['wrong-relation-source',(_c,i)=>i.responseRelation.candidates.forEach((x)=>x.targetTurnId='other')],
 ['ambiguous-other-relation',(_c,i)=>i.responseRelation.candidates.push({...i.responseRelation.candidates[0],relation:'requests_answer'})],
 ['current-refusal',c=>c.currentUserMessage='先不用问，我只是说一下。'],
 ['previous-refusal',c=>c.adjacentTurns[0].content='我很难过，先不要问。'],
 ['expression-burden',c=>c.currentUserMessage='不用分析，先听我说。'],
 ['paused-initiative',(_c,_i,s)=>s.initiativeOwner='paused'],
 ['shared-initiative',(_c,_i,s)=>s.initiativeOwner='shared'],
 ['answer-existing-question',(_c,_i,s)=>s.lastCommittedAssistantMove!.expectedUserContribution='answer'],
 ['task-obligation',(_c,_i,s)=>s.openObligations.push({id:'test-obligation',sourceTurnId:'current',sourceConversationId:'test',status:'open',question:'2加2等于几？',triggeringUserAct:'ask_information',targetProposition:'2加2的结果',kind:'other',priority:'must_answer_first',requiredDisclosure:[],evidence:[]})],
 ['safety',c=>c.safety.triggered=true],
 ['stale-current-source',(_c,i)=>i.contentMeaning.explicitPropositions.forEach((x)=>x.sourceTurnId='other')],
 ['role-evidence-alone',c=>c.adjacentTurns=[]],
];
for(const [name,mutate] of boundaries){const x=build(mutate);assert(!supportsOrdinaryExperienceInvitation(x.c,x.i,x.s),name);assert.notEqual((x.p.positiveFunctionContract as Extract<NonNullable<ResponsePlan['positiveFunctionContract']>,{action:'acknowledge_without_psychologizing'}> | null)?.responseFunction,'invite_optional_sharing',name);}
// Fresh deterministic interpretation, not an edited saved label: mere adjacency
// cannot carry an earlier personal concern across a factual or third-party turn.
for(const message of ['换个话题，木星是太阳系最大的行星。','我同事今天觉得很难堪，和我没有关系。','这款手机有两个摄像头。']){
 const c=structuredClone(f.context);c.currentUserMessage=message;
 const i=interpretTurnDeterministically(c),state=buildDialogueState(c,i);
 assert(!supportsOrdinaryExperienceInvitation(c,i,state),message);
 const p=createResponsePlan({context:c,interpretation:i,dialogueState:state,clinicalAdviceProvider:()=>null});
 assert.notEqual((p.positiveFunctionContract as Extract<NonNullable<ResponsePlan['positiveFunctionContract']>,{action:'acknowledge_without_psychologizing'}> | null)?.responseFunction,'invite_optional_sharing',message);
 assert(preflightResponsePlan(p,createResponsePlanPreflightAuthoritySnapshot({context:c,interpretation:i,dialogueState:state})).passed,message);
}
// A different event/person uses the same source-bound selection, no example words.
const other=build((c,i)=>{c.adjacentTurns[0].content='活动上被朋友拿我的口误开玩笑，我有点尴尬。';
 c.adjacentTurns[1].content='想聊的话可以说说。';c.currentUserMessage='确实说错了，但被拿来逗大家笑让我不舒服。';
 i.contentMeaning.explicitPropositions=[{id:'other',text:c.currentUserMessage,sourceTurnId:c.currentTurnId,confidence:1,evidence:[]}];
 i.ordinaryPostureProposal=null;i.acknowledgmentTreatmentEvidence=null;});
assert.equal((other.p.positiveFunctionContract as Extract<NonNullable<ResponsePlan['positiveFunctionContract']>,{action:'acknowledge_without_psychologizing'}> | null)?.responseFunction,'invite_optional_sharing');
assert(preflightResponsePlan(other.p,other.a).passed);
const forged=structuredClone(selected.p);(forged.positiveFunctionContract as Extract<NonNullable<ResponsePlan['positiveFunctionContract']>,{action:'acknowledge_without_psychologizing'}>).responseFunction='respond_naturally';assert(!preflightResponsePlan(forged,selected.a).passed,'Cannot downgrade selected completion');
const noQuestion=structuredClone(selected.p);noQuestion.questionPolicy.mode='none';assert(!preflightResponsePlan(noQuestion,selected.a).passed);
const reference='知道自己有疏忽，和被当众指出来觉得难堪，是可以同时存在的。不是承认他说得对，就得把自己的不舒服也收回去。那一刻，最让你难受的是什么？';
const natural=structuredClone(selected.p);(natural.positiveFunctionContract as Extract<NonNullable<ResponsePlan['positiveFunctionContract']>,{action:'acknowledge_without_psychologizing'}>).responseFunction='respond_naturally';
const source=selected.c.currentUserMessage;
const observations=(reply:string)=>({schemaVersion:1,planId:selected.p.planId,handoff:null,semanticQuestionCount:reply.includes('？')?1:0,positiveFunction:{
 binding:{action:'acknowledge_without_psychologizing',sourceTurnId:source&&selected.c.currentTurnId,allowIdle:false,responseFunction:'invite_optional_sharing'},
 ordinaryUseObservation:{contentRelation:'other_response',repetitionPurpose:'not_applicable',purposeEvidence:[{source:'current_user',messageIndex:null,start:0,end:source.length,text:source}],useComparison:{userMeaning:'用户承认疏忽并表达当众被指出的难堪。',candidateAct:'人工固定观察：当前感受确认和具体开放入口。',candidateEvidenceIndices:[0],relation:'supported_conversational_act'}},
 ordinaryInvitationObservation:{confirmation:'contextual_confirmation',opening:'specific_optional_opening',confirmationEvidenceIndices:[0],openingEvidenceIndices:[0]},
 status:'satisfied',realizedAction:'acknowledge_without_psychologizing',targetAddressed:true,contractRealized:true,containsContradictoryMove:false,
 evidence:[{start:0,end:reply.length,text:reply,reason:'Human-labelled local observation; not a model judgment or claim of live quality.'}]}});
const rows:Array<{name:string;expected:boolean;passed:boolean;reasons:string[]}>=[];
async function check(name:string,reply:string,mutate:(v:Omit<ReturnType<typeof observations>,"positiveFunction"> & {positiveFunction: Omit<ReturnType<typeof observations>["positiveFunction"],"ordinaryInvitationObservation"> & {ordinaryInvitationObservation?:ReturnType<typeof observations>["positiveFunction"]["ordinaryInvitationObservation"]}})=>void,expected:boolean,p=selected.p){
 const v=observations(reply);mutate(v);const original=JSON.stringify(v);
 const out=await validatePlannedFunctionSemanticOutput({plan:p,reply,semanticContext:{currentUserText:source,handoffTargetAssistantText:null,ordinaryRecentMessages:selected.c.adjacentTurns},provider:async()=>v});
 assert(out.verdict,name+': consume fully parsed observations');assert(!out.providerFailure,name);assert.equal(out.passed,expected,name+': '+out.failureReasons.join(','));assert.equal(JSON.stringify(v),original);
 rows.push({name,expected,passed:out.passed,reasons:out.failureReasons});return out;
}
async function main(){
 await check('reference-combined-act',reference,()=>{},true);
 for(const field of ['confirmation','opening'] as const)await check('missing-'+field,reference,v=>v.positiveFunction.ordinaryInvitationObservation![field]='missing',false);
 for(const val of ['generic_invitation','reasks_known_content','requires_self_analysis','pressures_response','peripheral_or_leading','uncertain'])await check(val,reference,v=>v.positiveFunction.ordinaryInvitationObservation!.opening=val,false);
 for(const field of ['confirmationEvidenceIndices','openingEvidenceIndices'] as const)for(const indices of [[],[99]])await check(field+indices,reference,v=>v.positiveFunction.ordinaryInvitationObservation![field]=indices,false);
 for(const entry of f.rawReplies){assert.equal(createHash('sha256').update(entry.rawProviderJson).digest('hex'),entry.sha256);const reply=JSON.parse(entry.rawProviderJson).choices[0].message.content;
  await check('preserved-failed-original:'+entry.sha256.slice(0,8),reply,v=>{v.positiveFunction.ordinaryInvitationObservation!.opening='missing';v.positiveFunction.ordinaryInvitationObservation!.openingEvidenceIndices=[]},false);}
 const actualFailed='问题归问题，但被当众指出来确实让人难堪，这种感受很正常。';
 await check('actual-confirmation-only',actualFailed,v=>{v.positiveFunction.ordinaryInvitationObservation!.opening='missing';v.positiveFunction.ordinaryInvitationObservation!.openingEvidenceIndices=[]},false);
 await check('natural-can-end-after-confirmation',actualFailed,v=>{delete v.positiveFunction.ordinaryInvitationObservation;v.positiveFunction.binding.responseFunction='respond_naturally'},true,natural);
 await check('factual-psychological-contradiction',reference,v=>v.positiveFunction.containsContradictoryMove=true,false);
 await check('over-question-budget',reference,v=>v.semanticQuestionCount=2,false);
 const statement='承认那处疏忽，也不必收回自己的不舒服。那一刻最在意的部分，可以按你想说的来。';
 await check('opening-without-question-mark',statement,v=>v.semanticQuestionCount=1,true);
 const prompt=buildChatPrompt({userMessage:source,recentMessages:selected.c.adjacentTurns,responsePlan:selected.p});
 const text=prompt.messages.map(m=>m.content).join('\n');assert(text.includes(ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS.invite_optional_sharing));assert(!text.includes(reference));assert(!text.includes('confirmation alone remains valid'));assert(!text.includes('When bounded recent history shows'));
 assert(text.includes('"requiredContribution":null'));
 const regen=formatResponsePlanRegenerateConstraint(selected.p,['planned_function_semantic:positive_function_not_satisfied']);assert(regen.includes(ORDINARY_RESPONSE_FUNCTION_INSTRUCTIONS.invite_optional_sharing));assert(!regen.includes('自然情绪确认，本身可以完成'));
 let captured:AiModelMessage[]|undefined;await validatePlannedFunctionSemanticOutput({plan:selected.p,reply:reference,semanticContext:{currentUserText:source,handoffTargetAssistantText:null,ordinaryRecentMessages:selected.c.adjacentTurns},provider:async input=>defaultPlannedFunctionSemanticProvider(input,({messages})=>{captured=messages;throw Error('LOCAL_CAPTURE_ONLY')})});
 assert(captured);assert(JSON.parse(captured[1].content).outputSchema.positiveFunction.ordinaryInvitationObservation);
 const rules=plannedFunctionSemanticDeveloperContentFor({planId:selected.p.planId,handoffBinding:null,positiveFunctionBinding:selected.p.positiveFunctionContract,currentUserText:source,handoffTargetAssistantText:null,candidateReply:reference,ordinaryQuestionIndependentlySupported:true}).scoped;assert(rules.includes('ordinaryInvitationObservation'));
 assert.equal(JSON.stringify(f),base);assert.equal(externalCalls,0);
 const report={status:'PASS_LOCAL_CONTRACT_ONLY',selectionBoundaries:boundaries.length+4,completionCases:rows.length,rows,externalCalls,rawRepliesPreserved:f.rawReplies.length,realGenerationQualityEstablished:false};
 if(process.env.ORDINARY_LOCAL_EVIDENCE_DIR){writeFileSync(process.env.ORDINARY_LOCAL_EVIDENCE_DIR+'/results.json',JSON.stringify(report,null,2));writeFileSync(process.env.ORDINARY_LOCAL_EVIDENCE_DIR+'/actual-prompts.json',JSON.stringify({generation:prompt.messages,judge:captured,regeneration:regen},null,2));}
 console.log(JSON.stringify({...report,rows:undefined}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
