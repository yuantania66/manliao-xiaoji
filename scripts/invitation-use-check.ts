import type { PlannedFunctionSemanticVerdict, OrdinaryUseObservation, OrdinaryUseComparison, PlannedFunctionSemanticContext, InvitationUseObservation } from "../services/ai/plannedFunctionSemanticValidator";
import type { AiModelMessage } from "../services/ai/types";
// Mutable local transport fixtures; raw records remain unchanged and are validated by the real parser.
type FixtureVerdict = PlannedFunctionSemanticVerdict & { positiveFunction: NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]> & {
 ordinaryUseObservation: OrdinaryUseObservation & { useComparison: OrdinaryUseComparison };
 invitationObservation: NonNullable<NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]>["invitationObservation"]>;
 invitationUseObservation: InvitationUseObservation;
} };
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizePlannedFunctionSemanticEvidence, validatePlannedFunctionSemanticOutput, defaultPlannedFunctionSemanticProvider} from '../services/ai/plannedFunctionSemanticValidator';
const saved=JSON.parse(readFileSync(new URL('./invitation-use-regression-fixture.json',import.meta.url),'utf8'));
const controls=JSON.parse(readFileSync(new URL('./contextual-response-completion-fixture.json',import.meta.url),'utf8'));
const f=saved.frozenContext,reply=f.candidateReply,current=f.semanticContext.currentUserText;
const raw=JSON.parse(JSON.parse(saved.rawProviderJson).choices[0].message.content),original=JSON.stringify(raw);
const normalized=normalizePlannedFunctionSemanticEvidence(raw,reply,current,f.semanticContext.ordinaryRecentMessages);assert(normalized);
const priorText=f.semanticContext.ordinaryRecentMessages[1].content;
const prior={messageIndex:1,start:0,end:priorText.length,text:priorText};
const cut=reply.indexOf('要是愿意');assert(cut>0);
const source=(text:string)=>({source:'current_user' as const,messageIndex:null,start:0,end:text.length,text});
function base():FixtureVerdict{
 const v=structuredClone(normalized) as FixtureVerdict;v.positiveFunction.ordinaryUseObservation.repetitionPurpose='not_applicable';
 v.semanticQuestionCount=1; // Correct the recorded incidental count; not a model re-judgment.
 v.positiveFunction.evidence=[{start:0,end:cut,text:reply.slice(0,cut),reason:'Human-labelled confirmation evidence; preserved model judgment remains separate.'},{start:cut,end:reply.length,text:reply.slice(cut),reason:'Human-labelled invitation comparison: repeats prior generic permission after User elaboration; no supported current use.'}];
 v.positiveFunction.ordinaryUseObservation.useComparison.candidateEvidenceIndices=[0];
 v.positiveFunction.invitationUseObservation={contextualUse:'repeats_prior_permission_without_use',candidateEvidenceIndices:[1],priorInvitation:structuredClone(prior)};
 return v;
}
let externalCalls=0;const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>{externalCalls++;throw Error('NO_NETWORK')};
const rows: Array<{name:string;expected:boolean;passed:boolean;assessment?:unknown;useAssessment?:unknown;invitationUseAssessment?:unknown}>=[];
async function check(name:string,v:unknown,expected:boolean,options:{reply?:string;plan?:Parameters<typeof validatePlannedFunctionSemanticOutput>[0]["plan"];context?:PlannedFunctionSemanticContext}={}){
 const text=options.reply??reply,plan=options.plan??f.originalPlan,context=options.context??f.semanticContext;let calls=0;
 const result=await validatePlannedFunctionSemanticOutput({plan,reply:text,semanticContext:context,provider:async()=>{calls++;return structuredClone(v)}});
 assert.equal(calls,1,name);assert(!result.providerFailure,name);assert(result.verdict,name+': must be parsed, not a format rejection');assert.equal(result.passed,expected,name+': '+result.failureReasons);
 rows.push({name,expected,passed:result.passed,useAssessment:result.ordinaryUseAssessment,invitationUseAssessment:result.invitationUseAssessment});return result;
}
async function main(){
 assert.equal(createHash('sha256').update(saved.rawProviderJson).digest('hex'),saved.sha256);
 await check('preserved-real-judgment-still-rejected-for-recorded-evidence-error',raw,false);
 const noiseFree=structuredClone(normalized) as FixtureVerdict;noiseFree.positiveFunction.ordinaryUseObservation.repetitionPurpose='not_applicable';
 const old=await check('offsets-and-enum-conflict-removed-missing-observation-only-unproven',noiseFree,false);assert.deepEqual(old.invitationUseAssessment?.uncertainFields,['observation']);
 const rejected=await check('full-schema-repeated-invitation-independent-of-accepted-confirmation',base(),false);
 assert.deepEqual(rejected.ordinaryUseAssessment?.failedFields,[]);assert.deepEqual(rejected.ordinaryUseAssessment?.uncertainFields,[]);assert.deepEqual(rejected.invitationUseAssessment?.failedFields,['contextualUse']);assert.equal(rejected.verdict?.positiveFunction?.status,'satisfied');
 for(const contextualUse of ['no_supported_use','uncertain','not_applicable'] as const){const v=base();v.positiveFunction.invitationUseObservation.contextualUse=contextualUse;await check('invitation-own-use:'+contextualUse,v,false);}
 const first=base();first.positiveFunction.invitationUseObservation={contextualUse:'useful_in_context',candidateEvidenceIndices:[1],priorInvitation:null};
 await check('first-related-generic-invitation-can-pass-no-specific-entry-required',first,true,{context:{...f.semanticContext,ordinaryRecentMessages:[]}});
 // Same words with existing history may qualify only if the semantic observer really establishes use.
 // This positive transport label is NOT a human claim that this saved repeated invitation is useful.
 for(const [name,mutate] of [
  ['candidate-index-missing',(v:FixtureVerdict)=>v.positiveFunction.invitationUseObservation.candidateEvidenceIndices=[]],
  ['candidate-index-outside',(v:FixtureVerdict)=>v.positiveFunction.invitationUseObservation.candidateEvidenceIndices=[9]],
  ['prior-is-user-role',(v:FixtureVerdict)=>{const t=f.semanticContext.ordinaryRecentMessages[0].content;v.positiveFunction.invitationUseObservation.priorInvitation={messageIndex:0,start:0,end:t.length,text:t}}],
  ['prior-is-fabricated',(v:FixtureVerdict)=>v.positiveFunction.invitationUseObservation.priorInvitation!.text='没有说过的邀请'],
  ['prior-location-wrong',(v:FixtureVerdict)=>v.positiveFunction.invitationUseObservation.priorInvitation!.start=1],
 ] as Array<[string,(v:FixtureVerdict)=>void]>){const v=base();v.positiveFunction.invitationUseObservation.contextualUse='useful_in_context';mutate(v);await check(name,v,false);}
 const switched=structuredClone(first);switched.positiveFunction.invitationUseObservation.priorInvitation=structuredClone(prior);await check('context-switch-cannot-reuse-stale-assistant-invitation',switched,false,{context:{...f.semanticContext,ordinaryRecentMessages:[f.semanticContext.ordinaryRecentMessages[0],{role:'assistant',content:'前面讨论的是一道数学题。'}]}});
 const standalone=base(),confirmation=reply.slice(0,cut);standalone.semanticQuestionCount=0;standalone.positiveFunction.evidence=[{start:0,end:confirmation.length,text:confirmation,reason:'Human-labelled contextual confirmation without another invitation.'}];
 standalone.positiveFunction.invitationObservation={invitationCount:'none',invitationTarget:'not_applicable',affectDrift:'none'};
 standalone.positiveFunction.invitationUseObservation={contextualUse:'not_applicable',candidateEvidenceIndices:[],priorInvitation:null};
 standalone.positiveFunction.ordinaryUseObservation={contentRelation:'repeats_or_normalizes_only',repetitionPurpose:'emotional_acknowledgment',purposeEvidence:[source(current)],useComparison:{userMeaning:current,candidateAct:'Responds to discomfort without requiring it to disappear because the mistake was real.',candidateEvidenceIndices:[0],relation:'supported_conversational_act'}};
 await check('natural-confirmation-alone-can-pass',standalone,true,{reply:confirmation});
 const contradictoryNone=structuredClone(standalone);contradictoryNone.positiveFunction.invitationUseObservation.contextualUse='useful_in_context';await check('absent-invitation-cannot-claim-invitation-use',contradictoryNone,false,{reply:confirmation});
 const knowledge=controls['natural-ending'];const ack=normalizePlannedFunctionSemanticEvidence(knowledge.judgment,knowledge.reply,knowledge.semanticContext.currentUserText,knowledge.history) as FixtureVerdict;assert(ack);
 ack.positiveFunction.status='satisfied';ack.positiveFunction.realizedAction='acknowledge_without_psychologizing';ack.positiveFunction.contractRealized=true;
 ack.positiveFunction.ordinaryUseObservation={contentRelation:'other_response',repetitionPurpose:'not_applicable',purposeEvidence:[source(knowledge.semanticContext.currentUserText)],useComparison:{userMeaning:knowledge.semanticContext.currentUserText,candidateAct:'Completes explicit acknowledgement-only request.',candidateEvidenceIndices:[0],relation:'supported_conversational_act'}};
 await check('acknowledgement-only-can-pass-with-allowIdle-false',ack,true,{plan:knowledge.plan,reply:knowledge.reply,context:{...knowledge.semanticContext,ordinaryRecentMessages:knowledge.history}});assert.equal(knowledge.plan.positiveFunctionContract.allowIdle,false);
 for(const id of ['declined-question','expression-burden']){const c=controls[id];const v=normalizePlannedFunctionSemanticEvidence(c.judgment,c.reply,c.semanticContext.currentUserText,c.history);await check('preserved:'+id,v,true,{plan:c.plan,reply:c.reply,context:{...c.semanticContext,ordinaryRecentMessages:c.history}});}
 for(const [name,mutate] of [['facts',(v:FixtureVerdict)=>v.positiveFunction.containsContradictoryMove=true],['affect',(v:FixtureVerdict)=>v.positiveFunction.invitationObservation.affectDrift='stronger_intensity']] as Array<[string,(v:FixtureVerdict)=>void]>){const v=structuredClone(first);mutate(v);await check('use-does-not-override:'+name,v,false,{context:{...f.semanticContext,ordinaryRecentMessages:[]}});}
 let captured:AiModelMessage[]|undefined;await validatePlannedFunctionSemanticOutput({plan:f.originalPlan,reply,semanticContext:f.semanticContext,provider:async input=>defaultPlannedFunctionSemanticProvider(input,({messages})=>{captured=messages;throw Error('LOCAL_CAPTURE_ONLY')})});assert(captured);
 const data=JSON.parse(captured[1].content);assert(data.outputSchema.positiveFunction.invitationUseObservation);assert.deepEqual(data.ordinaryRecentMessages,f.semanticContext.ordinaryRecentMessages);assert(captured[0].content.includes('Judge the invitation clause itself, not confirmation before it.'));assert(captured[0].content.includes('No novel fact, named unknown, mandatory question or universal specific entry is required.'));
 assert.equal(JSON.stringify(raw),original);assert.equal(externalCalls,0);
 console.log(JSON.stringify({status:'PASS_LOCAL_CONTRACT_ONLY',cases:rows.length,rows,rawProviderPayloadBytePreserved:true,incidentalEnumAndEvidenceErrorsExcludedInSemanticRegression:true,allNewObservationLabelsHumanAuthored:true,externalCalls,modelAccuracyEstablished:false,realGenerationQualityEstablished:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{globalThis.fetch=fetchBefore});
