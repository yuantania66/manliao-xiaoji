import type { PlannedFunctionSemanticVerdict, OrdinaryUseObservation, OrdinaryUseComparison, PlannedFunctionSemanticContext, InvitationUseObservation } from "../services/ai/plannedFunctionSemanticValidator";
import type { AiModelMessage } from "../services/ai/types";
// Mutable local transport fixtures; raw records remain unchanged and are validated by the real parser.
type FixtureVerdict = PlannedFunctionSemanticVerdict & { positiveFunction: NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]> & {
 ordinaryUseObservation: OrdinaryUseObservation & { useComparison: OrdinaryUseComparison };
 invitationObservation: NonNullable<NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]>["invitationObservation"]>;
 invitationUseObservation: InvitationUseObservation;
} };
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizePlannedFunctionSemanticEvidence, validatePlannedFunctionSemanticOutput, defaultPlannedFunctionSemanticProvider } from '../services/ai/plannedFunctionSemanticValidator';
import { buildChatPrompt } from '../services/ai/promptBuilder';
const fixtures = JSON.parse(readFileSync(new URL('./contextual-response-completion-fixture.json', import.meta.url),'utf8'));
let attempts=0;const fetchBefore=globalThis.fetch;globalThis.fetch=async()=>{attempts++;throw Error('NO_NETWORK');};
const rows: Array<{name:string;expected:boolean;passed:boolean;assessment?:unknown;useAssessment?:unknown;invitationUseAssessment?:unknown}>=[];
const source=(text:string)=>({source:'current_user' as const,messageIndex:null,start:0,end:text.length,text});
const observation=(text:string,relation:OrdinaryUseComparison['relation']='supported_conversational_act',act='Completes the current explicit acknowledgement-only request.'):OrdinaryUseObservation & {useComparison:OrdinaryUseComparison}=>({contentRelation:'other_response',repetitionPurpose:'not_applicable',purposeEvidence:[source(text)],useComparison:{userMeaning:text,candidateAct:act,candidateEvidenceIndices:[0],relation}});
function raw(caseName:string): FixtureVerdict {const f=fixtures[caseName];const v=normalizePlannedFunctionSemanticEvidence(structuredClone(f.judgment),f.reply,f.semanticContext.currentUserText,f.history);assert(v);return v as FixtureVerdict;}
async function check(name:string,caseName:string,v:unknown,expected:boolean,reply=fixtures[caseName].reply,override?:Partial<PlannedFunctionSemanticContext>){
 const f=fixtures[caseName],context={...f.semanticContext,ordinaryRecentMessages:f.history,...override};let calls=0;
 const out=await validatePlannedFunctionSemanticOutput({plan:f.plan,reply,semanticContext:context,provider:async()=>{calls++;return structuredClone(v)}});
 assert.equal(calls,1,name);assert(!out.providerFailure,name);assert(out.verdict,name+': must consume complete parsed judgment');assert.equal(out.passed,expected,name+': '+out.failureReasons);rows.push({name,passed:out.passed,expected,assessment:out.ordinaryUseAssessment});return out;
}
async function main(){
 for(const f of Object.values(fixtures) as Array<typeof import("./contextual-response-completion-fixture.json")["friend-event"]>)for(const record of Object.values(f.originalProviderResponses))assert.equal(createHash('sha256').update(record.text).digest('hex'),record.sha256);
 // Original real judgments are preserved; replay is separate from new human-labelled observations.
 await check('original-friend-pass-now-unproven-not-proof-of-fix','friend-event',raw('friend-event'),false);
 await check('original-ending-rejection-preserved','natural-ending',raw('natural-ending'),false);
 const friend=raw('friend-event');friend.positiveFunction.invitationUseObservation={contextualUse:"useful_in_context",candidateEvidenceIndices:[0],priorInvitation:null};friend.positiveFunction.ordinaryUseObservation=observation(fixtures['friend-event'].semanticContext.currentUserText,'no_supported_act','Repeats the prior optional invitation without responding to what the User added.');
 const rejected=await check('complete-schema-repeated-generic-invitation-rejected-despite-overall-pass','friend-event',friend,false);assert(rejected.ordinaryUseAssessment?.failedFields.includes('useComparison'));assert.equal(rejected.verdict?.positiveFunction?.status,'satisfied');
 const uncertain=structuredClone(friend);uncertain.positiveFunction.ordinaryUseObservation.useComparison.relation='uncertain';await check('ambiguous-use-not-forced-to-pass','friend-event',uncertain,false);
 const firstInvitation=structuredClone(friend);firstInvitation.positiveFunction.ordinaryUseObservation=observation(fixtures['friend-event'].semanticContext.currentUserText,'supported_conversational_act','First optional invitation to elaborate the stated concern; no prior invitation is repeated.');await check('first-relevant-invitation-no-specific-entry-mandate','friend-event',firstInvitation,true,undefined,{ordinaryRecentMessages:[]});
 // Pure contextual confirmation remains allowed; no invitation or question is required.
 const confirm='说错话被当众调侃，确实会让人不舒服。';const standalone=structuredClone(friend);standalone.positiveFunction.evidence=[{start:0,end:confirm.length,text:confirm,reason:'Human-labelled supported contextual confirmation, not a model result.'}];standalone.positiveFunction.ordinaryUseObservation=observation(fixtures['friend-event'].semanticContext.currentUserText,'supported_conversational_act','Confirms the expressed discomfort without dismissing it because the mistake was real.');standalone.positiveFunction.ordinaryUseObservation.contentRelation='repeats_or_normalizes_only';standalone.positiveFunction.ordinaryUseObservation.repetitionPurpose='emotional_acknowledgment';standalone.positiveFunction.invitationObservation={invitationCount:'none',invitationTarget:'not_applicable',affectDrift:'none'};standalone.positiveFunction.invitationUseObservation={contextualUse:"not_applicable",candidateEvidenceIndices:[],priorInvitation:null};standalone.semanticQuestionCount=0;await check('supported-confirmation-alone-no-opening-required','friend-event',standalone,true,confirm);
 const ending=raw('natural-ending');ending.positiveFunction.status='satisfied';ending.positiveFunction.realizedAction='acknowledge_without_psychologizing';ending.positiveFunction.contractRealized=true;ending.positiveFunction.ordinaryUseObservation=observation(fixtures['natural-ending'].semanticContext.currentUserText);
 const ended=await check('explicit-acknowledgement-request-completed-with-allowIdle-false','natural-ending',ending,true);assert.equal(ended.verdict?.positiveFunction?.binding.action,'acknowledge_without_psychologizing');assert.equal(fixtures['natural-ending'].plan.positiveFunctionContract.allowIdle,false);
 const receipt=structuredClone(ending);receipt.positiveFunction.ordinaryUseObservation={contentRelation:'receipt_only',repetitionPurpose:'not_applicable',purposeEvidence:[],useComparison:null} as unknown as FixtureVerdict['positiveFunction']['ordinaryUseObservation'];await check('bare-receipt-still-rejected-in-nonidle','natural-ending',receipt,false);
 const noAct=structuredClone(ending);noAct.positiveFunction.ordinaryUseObservation.useComparison.relation='no_supported_act';await check('receipt-relabeled-other-response-without-use-still-rejected','natural-ending',noAct,false);
 const invented=structuredClone(ending);invented.positiveFunction.ordinaryUseObservation.purposeEvidence=[source('用户没说过的话')];await check('fabricated-purpose-source-rejected','natural-ending',invented,false);
 const assistant=structuredClone(friend);assistant.positiveFunction.ordinaryUseObservation.purposeEvidence=[{source:'history',messageIndex:1,start:0,end:fixtures['friend-event'].history[1].content.length,text:fixtures['friend-event'].history[1].content}];await check('assistant-invitation-cannot-be-user-purpose-evidence','friend-event',assistant,false);
 const bad=structuredClone(ending);bad.positiveFunction.containsContradictoryMove=true;await check('purpose-does-not-waive-factual-safety-contradiction','natural-ending',bad,false);
 const excessive=structuredClone(ending);excessive.semanticQuestionCount=2;await check('purpose-does-not-grant-question-budget','natural-ending',excessive,false);
 for(const c of ['declined-question','expression-burden'])await check('preserved-boundary:'+c,c,raw(c),true);
 // Capture actual default-provider messages, blocking before any network. History and schema must be present.
 for(const c of ['friend-event','natural-ending']){
  const f=fixtures[c];let messages:AiModelMessage[]|undefined;
  await validatePlannedFunctionSemanticOutput({plan:f.plan,reply:f.reply,semanticContext:{...f.semanticContext,ordinaryRecentMessages:f.history},provider:async input=>defaultPlannedFunctionSemanticProvider(input,({messages:m})=>{messages=m;throw Error('LOCAL_CAPTURE_ONLY')})});
  assert(messages);const data=JSON.parse(messages[1].content);assert.deepEqual(data.ordinaryRecentMessages,f.history);assert(data.outputSchema.positiveFunction.ordinaryUseObservation);
  assert(messages[0].content.includes(c==='friend-event'?'Repeating the same generic permission':'explicit acknowledgement-only request'));
  const prompt=buildChatPrompt({userMessage:f.semanticContext.currentUserText,recentMessages:f.history,responsePlan:f.plan});const text=prompt.messages.map(m=>m.content).join('\n');
  // Saved plans are immutable; current natural-response instructions are rendered from current shared mapping.
  assert(text.includes(c==='friend-event'?'Compare with the previous invitation':'用户明确只需知悉'));
 }
 assert.equal(attempts,0);console.log(JSON.stringify({status:'PASS_LOCAL_ONLY',cases:rows.length,rows,originalProviderPayloadsBytePreserved:true,externalCalls:attempts,modelObservationAccuracyEstablished:false,realReplyQualityEstablished:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{globalThis.fetch=fetchBefore});
