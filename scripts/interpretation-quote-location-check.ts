import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleConversationControlContext, interpretTurnDeterministically, mergeModelInterpretation, buildDialogueState, createResponsePlan } from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { locateInterpretationQuotes, InterpretationQuoteLocationError, enrichTurnInterpretation } from "../services/ai/turnInterpretationAdapter";
import { buildChatPrompt } from "../services/ai/promptBuilder";
const saved = JSON.parse(readFileSync(new URL('./ordinary-posture-replay-fixture.json', import.meta.url), 'utf8'));
const fixtures = JSON.parse(readFileSync(new URL('./interpretation-quote-location-fixture.json', import.meta.url), 'utf8'));
const context = assembleConversationControlContext({ ...saved.input, conversationState: determineConversationState({currentUserMessage:saved.input.userMessage,recentMessages:saved.input.recentMessages}) });
const deterministic = interpretTurnDeterministically(context);
for (const fixture of fixtures) {
  const original = JSON.parse(fixture.rawOutput);
  const fixed = locateInterpretationQuotes(fixture.rawOutput, context)!;
  const span = fixed.ordinaryPostureProposal!.sourceSpans[0];
  assert.deepEqual([span.start,span.end], fixture.label === 'contribution-goal-preparation' ? [0,33] : [16,32]);
  const restored = structuredClone(fixed);
  restored.ordinaryPostureProposal!.sourceSpans = original.ordinaryPostureProposal.sourceSpans;
  assert.deepEqual(restored, original, 'Only positions change');
  const interpreted = mergeModelInterpretation(deterministic, fixed, context);
  const plan = createResponsePlan({context,interpretation:interpreted,dialogueState:buildDialogueState(context,interpreted),clinicalAdviceProvider:()=>null});
  assert.deepEqual(interpreted.ordinaryPostureProposal?.proposedContribution, original.ordinaryPostureProposal.proposedContribution);
  assert.notEqual(plan.ordinaryPosture?.requiredContribution?.instruction, original.ordinaryPostureProposal.proposedContribution.instruction);
  assert.deepEqual(plan.ordinaryPosture?.sourceSpans, fixed.ordinaryPostureProposal!.sourceSpans);
  assert(!buildChatPrompt({...saved.input,responsePlan:plan}).messages.some(m=>m.content.includes(original.ordinaryPostureProposal.proposedContribution.instruction)));
  const noOffsets = structuredClone(original);
  delete noOffsets.ordinaryPostureProposal.sourceSpans[0].start; delete noOffsets.ordinaryPostureProposal.sourceSpans[0].end;
  assert.deepEqual(locateInterpretationQuotes(JSON.stringify(noOffsets),context),fixed);
}
const payload = JSON.parse(fixtures[0].rawOutput);
const checkReject = (change: (p: typeof import("./ordinary-posture-replay-fixture.json")["interpretation"])=>void, ctx=context) => {
  const p=structuredClone(payload);change(p);const raw=JSON.stringify(p);
  assert.throws(()=>locateInterpretationQuotes(raw,ctx),(e:unknown)=>e instanceof InterpretationQuoteLocationError && e.rawOutput===raw);
};
checkReject(p=>p.ordinaryPostureProposal.sourceSpans[0].text='不存在的原话');
checkReject(p=>p.ordinaryPostureProposal.sourceSpans[0].text='');
checkReject(p=>p.ordinaryPostureProposal.sourceSpans[0].text='我'); // multiple, even though legacy offsets supplied
checkReject(p=>p.ordinaryPostureProposal.sourceSpans[0].sourceTurnId='wrong');
checkReject(p=>p.ordinaryPostureProposal.sourceSpans[0].source='assistant');
checkReject(p=>Object.assign(p.ordinaryPostureProposal.sourceSpans[0],{extra:'unexpected'}));
checkReject(p=>Object.assign(p.ordinaryPostureProposal.sourceSpans[0],{source:'adjacent_committed_user_turn',sourceTurnId:saved.input.recentMessages[1].id,text:saved.input.recentMessages[1].content}));
const unicode=structuredClone(context);unicode.currentUserMessage='🙂我难过🙂';
const p=structuredClone(payload);p.ordinaryPostureProposal.sourceSpans[0].text='我难过';
assert.deepEqual(locateInterpretationQuotes(JSON.stringify(p),unicode)!.ordinaryPostureProposal!.sourceSpans[0],{source:'current_user_turn',sourceTurnId:context.currentTurnId,text:'我难过',start:2,end:5});
const main=async()=>{
 Object.assign(process.env,{AI_PROVIDER:'qwen',AI_MAIN_MODEL:'qwen3.7-max',QWEN_API_KEY:'offline-only',CONVERSATION_OS_INTERPRETER_MODEL_ENABLED:'true'});
 let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:fixtures[0].rawOutput}}]}),{status:200});};
 const result=await enrichTurnInterpretation(context,deterministic);
 assert.equal(calls,1);assert.equal(result.rawModelOutput,fixtures[0].rawOutput);
 assert.equal(result.interpretation.ordinaryPostureProposal?.sourceSpans[0].end,33);
 const bad=structuredClone(payload);bad.ordinaryPostureProposal.sourceSpans[0].text='我';
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(bad)}}]}),{status:200});};
 await assert.rejects(enrichTurnInterpretation(context,deterministic),InterpretationQuoteLocationError);
 assert.equal(calls,2,'No retry or fallback');
 console.log(JSON.stringify({passed:true,savedFailures:2,externalCalls:0,rawPreserved:true,ambiguousStops:true,modelQualityEstablished:false}));
};
main().catch(e=>{console.error(e);process.exitCode=1;});
