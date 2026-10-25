import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Authored transport fixtures only. These fixed observations do not evaluate model quality.
const safeText = "我有点累，local-smoke-chat";
const failureText = "我有点累，local-smoke-safety-failure";
const reply = "有点累啊，愿意的话可以说说吗？";
const invitation = "愿意的话可以说说吗？";
const greeting = "你好，我是小慢，一个AI聊天助手。你可以在这里随便聊，也可以和我一起慢慢理清一些事情；不用先想好完整话题，想到什么就从什么开始。";
const neutralGreetings = [
  { topic: "cloud shapes", proposition: "云的形状常常让熟悉的天空显得像一张不断改写的草稿。" },
  { topic: "map symbols", proposition: "地图用很小的符号，把很大的地方放在同一张纸上。" },
];
const calls: string[] = [];
const errors: string[] = [];
type Message = { role: string; content: string };
const scripted = (model: string, messages: Message[]) => {
  assert(Array.isArray(messages) && messages.length >= 2 && messages.every((m) => typeof m.content === "string"));
  const developer = messages[0].content;
  const user = messages.at(-1)!.content;
  if (model === "fixture-safety") {
    assert(developer.includes("Safety 风险分诊器"));
    const text = user.split("当前用户消息：\n")[1];
    if (text === failureText) { calls.push("safety-failure"); return null; }
    assert.equal(text, safeText, "Safety fixture only accepts its one fixed safe case");
    calls.push("safety-safe");
    return JSON.stringify({ schemaVersion: 1, riskLevel: "none", categories: [], currentness: "current", evidence: [], requiresSafetyResponse: false });
  }
  if (model === "fixture-extractor") {
    if (developer.includes("结构化理解抽取器")) {
      calls.push("understanding");
      return JSON.stringify({ facts: [], experiences: [], interpretations: [], people: [], topics: [], occurredAt: null });
    }
    assert(developer.includes("体验抽取器"), "Unknown extraction request");
    calls.push("experience");
    return JSON.stringify({ events: [], emotionSlices: [], eventRelations: [], noteCandidate: { shouldGenerate: false } });
  }
  if (model === "fixture-greeting") {
    const line = user.split("\n").find((s) => s.startsWith("UNTRUSTED_DATA_JSON="));
    assert(line, "Greeting uses the existing untrusted-data envelope");
    const data = JSON.parse(line.slice("UNTRUSTED_DATA_JSON=".length));
    if (data.dataKind === "proactive_intent_generation_input") {
      assert(developer.includes("选择已冻结为 open_statement"));
      const item = neutralGreetings[calls.filter((v) => v === "greeting-intent").length];
      assert(item, "Only the two fixed smoke greeting contexts are supported");
      calls.push("greeting-intent");
      return JSON.stringify({ move: "open_statement", requiredFunction: "offer_self_contained_conversation_entry",
        realization: { kind: "self_contained_entry", ...item }, expectedUserContribution: "none", userBurden: "none" });
    }
    if (data.dataKind === "proactive_surface_input") {
      const proposition = data.value.frozenProactiveIntent.realization.proposition;
      assert([greeting, ...neutralGreetings.map((v) => v.proposition)].includes(proposition));
      calls.push("greeting-surface"); return proposition;
    }
    assert.equal(data.dataKind, "proactive_semantic_verdict_input");
    const candidate = data.value.surfaceCandidate;
    assert([greeting, ...neutralGreetings.map((v) => v.proposition)].includes(candidate));
    const intent = data.value.frozenProactiveIntent;
    assert.equal(intent.realization.proposition, candidate, "Exact intent from actual request");
    calls.push("greeting-judge");
    return JSON.stringify({ intent, candidate, evidenceSpan: candidate, verdict: "accept", intentFaithfullyRealized: true,
      propositionDelivered: true, semanticClarity: true, anchoredCommunicativePoint: true, selfContained: true,
      requiresSecondAssistantReveal: false, createsUserObligation: false, groundingObeyed: true, contradictoryMove: false, topicDistinct: data.value.committedProactiveHistory.length ? true : null });
  }
  if (model === "fixture-surface") {
    if (developer.startsWith("Create one evidence-bound conversation episode summary")) {
      const input = JSON.parse(user);
      assert(input.committedMessages.some((m: Message) => m.role === "user" && m.content === safeText));
      calls.push("episode-summary");
      return JSON.stringify({ naturalSummary: "用户说有点累。", people: [], topics: [], emotions: ["累"],
        openThreads: [], confirmedFacts: [], hypotheses: [], sourceMessageIds: input.committedMessages.map((m: { id: string }) => m.id) });
    }
    assert.equal(user, safeText, "No generation fixture for failure or unknown input");
    calls.push("surface"); return reply;
  }
  assert.equal(model, "fixture-semantic", "Unknown model must not receive a permissive default");
  const input = JSON.parse(user);
  assert.equal(input.currentUserText, safeText);
  assert.equal(input.candidateReply, reply);
  assert.equal(input.handoffBinding.requiredFunction, "continue_user_introduced_content");
  assert.equal(input.handoffBinding.selectedRelation, "opens_or_redirects_thread");
  assert.equal(input.handoffBinding.completionIntent, "fulfill");
  assert.equal(input.handoffBinding.questionPolicy, "optional_after_completion");
  assert.equal(input.handoffBinding.evidence[0].text, safeText);
  assert.equal(input.positiveFunctionBinding.action, "offer_emotional_support");
  assert.equal(input.positiveFunctionBinding.supportFunction, "invite_optional_sharing");
  assert.equal(input.outputSchema.positiveFunction.binding.action, "offer_emotional_support");
  calls.push("semantic");
  return JSON.stringify({ schemaVersion: 1, planId: input.planId, semanticQuestionCount: 1,
    handoff: { binding: input.outputSchema.handoff.binding, status: "satisfied",
      realizedFunction: "continue_user_introduced_content", targetAddressed: true, relationAddressed: true,
      requiredFunctionRealized: true, containsContradictoryMove: false, handoffCompletionClaimed: false,
      optionalQuestionAfterRequiredFunction: true,
      evidence: [{ start: 0, end: reply.length, text: reply, reason: "Fixed fixture responds to the current User's introduced tiredness" }] },
    positiveFunction: { binding: input.outputSchema.positiveFunction.binding, status: "satisfied", realizedAction: "offer_emotional_support",
      targetAddressed: true, contractRealized: true, containsContradictoryMove: false,
      evidence: [{ start: reply.indexOf(invitation), end: reply.length, text: invitation, reason: "Fixed fixture invitation span" },
        { start: 0, end: "有点累啊".length, text: "有点累啊", reason: "Fixed fixture confirmation span" }],
      invitationObservation: { invitationCount: "one", invitationTarget: "open_sharing", affectDrift: "none" },
      invitationUseObservation: { contextualUse: "useful_in_context", candidateEvidenceIndices: [0], priorInvitation: null },
      ordinaryUseObservation: { contentRelation: "other_response", repetitionPurpose: "not_applicable",
        purposeEvidence: [{ source: "current_user", messageIndex: null, start: 0, end: safeText.length, text: safeText }],
        useComparison: { userMeaning: "Fixed safe fixture disclosure", candidateAct: "Fixed first optional invitation after confirmation",
          candidateEvidenceIndices: [0, 1], relation: "supported_conversational_act" } } } });
};

const probeMessages = [{ role: "developer", content: "Safety 风险分诊器" }, { role: "user", content: "当前用户消息：\nunsupported fixture input" }];
assert.throws(() => scripted("unexpected-model", probeMessages), /Unknown model/);
assert.throws(() => scripted("fixture-safety", probeMessages), /one fixed safe case/);
assert.throws(() => scripted("fixture-surface", []), /AssertionError/);

const run = async () => {
  const database = process.env.DATABASE_URL;
  assert(database && /(?:_|-)test(?:_|-)/.test(new URL(database).pathname), "Dedicated test database required");
  assert.equal(new URL(database).hostname, "localhost");
  const temporary = mkdtempSync(join(tmpdir(), "xq-api-offline-"));
  const guard = join(temporary, "local-only.cjs");
  // Same loopback-only transport guard used by release validation; no external artifact is required.
  writeFileSync(guard, String.raw`'use strict';
const fs=require('node:fs');
const local=new Set(['localhost','127.0.0.1','::1','[::1]']);
const stats={pid:process.pid,loopbackFetches:0,blockedExternalAttempts:0,blockedDestinations:[]};
function deny(kind,target){stats.blockedExternalAttempts++;stats.blockedDestinations.push({kind,target:String(target)});throw new Error('RELEASE_OFFLINE_GUARD: external transport forbidden: '+kind+' '+target);}
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='object'&&input?.url?input.url:String(input));if(u.protocol!=='http:'||!local.has(u.hostname))return Promise.reject(new Error((()=>{try{deny('fetch',u.origin)}catch(e){return e.message}})()));stats.loopbackFetches++;return nativeFetch(input,{...init,redirect:'error'});};
for(const name of ['node:http','node:https']){const m=require(name);for(const method of ['request','get']){const original=m[method];m[method]=function(...args){const x=args[0];const host=typeof x==='string'||x instanceof URL?new URL(x).hostname:(x?.hostname||x?.host||'localhost');if(name==='node:https'||!local.has(host))deny(name,host);return original.apply(this,args);};}}
const net=require('node:net'), connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args;const x=a[0];if(typeof x==='object'&&x!==null){if(!x.path&&!local.has(x.host||'localhost'))deny('net',x.host);}else if(!(typeof x==='string'&&!/^\d+$/.test(x))&&!local.has(typeof a[1]==='string'?a[1]:'localhost'))deny('net',a[1]);return connect.apply(this,args);};
process.on('exit',()=>{if(process.env.RELEASE_NETWORK_LOG)fs.appendFileSync(process.env.RELEASE_NETWORK_LOG,JSON.stringify(stats)+'\n',{mode:0o600});});
`, { mode: 0o600 });
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/compatible-mode/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer synthetic-local-api-fixture-key");
      let text = "";
      for await (const chunk of request) { text += chunk; assert(text.length < 500_000); }
      const input = JSON.parse(text);
      const content = scripted(input.model, input.messages);
      response.setHeader("Content-Type", "application/json");
      if (content === null) { response.writeHead(400); response.end(JSON.stringify({ error: "Deliberate nonretryable local safety provider failure" })); return; }
      response.end(JSON.stringify({ model: input.model, choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    } catch (error) {
      errors.push(String(error)); response.writeHead(500); response.end(JSON.stringify({ error: "Unexpected fixture request" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert(address && typeof address !== "string");
    const inherited = ["PATH", "HOME", "USER", "TMPDIR", "DATABASE_URL", "SESSION_SECRET", "ACCOUNT_CANCELLATION_CLEANUP_SECRET", "UPLOAD_DIR", "UPLOAD_PUBLIC_BASE_URL", "LOCAL_API_PORT", "RELEASE_NETWORK_LOG"];
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(
      inherited.flatMap((k) => process.env[k] ? [[k, process.env[k]!]] : [])) };
    Object.assign(env, { NODE_OPTIONS: `--require=${guard}`, APP_ENV: "development", AI_PROVIDER: "qwen", QWEN_API_KEY: "synthetic-local-api-fixture-key",
      QWEN_BASE_URL: `http://127.0.0.1:${address.port}/compatible-mode/v1`, AI_MAIN_MODEL: "fixture-surface", AI_SAFETY_MODEL: "fixture-safety",
      AI_EXTRACTOR_MODEL: "fixture-extractor", AI_SEMANTIC_VALIDATOR_MODEL: "fixture-semantic", AI_PROACTIVE_GREETING_MODEL: "fixture-greeting",
      CONVERSATION_OS_INTERPRETER_MODEL_ENABLED: "false", AI_TIMEOUT_MS: "5000", ALLOW_WEB_MOCK_LOGIN: "true",
      NEXT_TELEMETRY_DISABLED: "1", LOCAL_API_SMOKE_PROVIDER_FIXTURE: "1", LOCAL_API_SMOKE_VERBOSE: "1" });
    const child = spawn(process.execPath, ["scripts/local-api-smoke.mjs"], { env, stdio: "inherit" });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    assert.deepEqual(errors, [], "Unknown requests must fail the runner even if runtime catches them");
    assert.equal(code, 0, "Original full smoke requirements must pass");
    for (const stage of ["safety-safe", "safety-failure", "surface", "semantic"]) assert.equal(calls.filter((v) => v === stage).length, 1, `${stage}: no hidden repairs/retries`);
    const failure = calls.indexOf("safety-failure"), safe = calls.indexOf("safety-safe");
    assert(failure < safe && !calls.slice(failure + 1, safe).some((s) => s === "surface" || s === "semantic"));
    console.log("PASS fixed local provider stages and fail-closed control; transport evidence only, not model-quality evidence");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(temporary, { recursive: true, force: true });
    if (process.env.LOCAL_API_FIXTURE_EVIDENCE) writeFileSync(process.env.LOCAL_API_FIXTURE_EVIDENCE, JSON.stringify({ calls, errors, scope: "Authored local transport fixtures, no real model judgment" }, null, 2) + "\n");
  }
};
void run().catch((error) => { console.error(error); process.exitCode = 1; });
