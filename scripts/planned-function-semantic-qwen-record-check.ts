import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { AppError } from "../lib/errors";
import type {
  PlannedFunctionSemanticProviderInput,
  PlannedFunctionSemanticVerdict,
} from "../services/ai/plannedFunctionSemanticValidator";
import { defaultPlannedFunctionSemanticProvider } from "../services/ai/plannedFunctionSemanticValidator";
import {
  LATE_CONTRADICTION_AUTHORITY_VERSION,
  LATE_CONTRADICTION_CONTRACT_HASH,
  type LateContradictionProvider,
} from "./late-contradiction-authority";
import { cases, dualBranchCheckFor, evaluateCase, structuralRowFor } from "./planned-function-semantic-qwen-eval";

const caseById = (id: string) => {
  const found = cases.find((item) => item.id === id);
  assert(found, `missing Q case ${id}`);
  return found;
};

const POSITIVE_REASON = "正向分支理由（模拟）";
const HANDOFF_REASON = "交接分支理由（模拟）";
const LATE_REASON = "后置矛盾理由（模拟）";
const UNPARSED = "无法解析的模拟输出";

const verdictFor = (
  input: PlannedFunctionSemanticProviderInput,
  {
    positiveStatus = "satisfied",
    handoffStatus = "satisfied",
    positiveReason = POSITIVE_REASON,
  }: {
    positiveStatus?: "satisfied" | "not_satisfied";
    handoffStatus?: "satisfied" | "not_satisfied";
    positiveReason?: string;
  } = {}
): PlannedFunctionSemanticVerdict => {
  const evidence = (reason: string) => [{
    start: 0,
    end: input.candidateReply.length,
    text: input.candidateReply,
    reason,
  }];
  const positive = input.positiveFunctionBinding;
  const handoff = input.handoffBinding;
  assert(positive && positive.action !== "repair_previous_wording");
  return {
    schemaVersion: 1,
    planId: input.planId,
    handoff: handoff
      ? {
          binding: {
            sourceAssistantMoveId: handoff.sourceAssistantMoveId,
            sourceUserTurnId: handoff.sourceUserTurnId,
            selectedRelation: handoff.selectedRelation,
            requiredFunction: handoff.requiredFunction,
            completionIntent: handoff.completionIntent,
            questionPolicy: handoff.questionPolicy,
          },
          status: handoffStatus,
          realizedFunction: handoffStatus === "satisfied" ? "complete_reciprocal_contact" : null,
          targetAddressed: handoffStatus === "satisfied",
          relationAddressed: handoffStatus === "satisfied",
          requiredFunctionRealized: handoffStatus === "satisfied",
          containsContradictoryMove: false,
          handoffCompletionClaimed: false,
          optionalQuestionAfterRequiredFunction: false,
          evidence: evidence(HANDOFF_REASON),
        }
      : null,
    positiveFunction: {
      binding: positive.action === "establish_assistant_identity"
        ? {
            action: positive.action,
            mode: positive.mode,
            sourceTurnId: positive.sourceTurnId,
            targetProposition: positive.targetProposition,
          }
        : { action: positive.action, supportFunction: positive.supportFunction, sourceTurnId: positive.sourceTurnId },
      status: positiveStatus,
      realizedAction: positiveStatus === "satisfied" ? positive.action : null,
      targetAddressed: positiveStatus === "satisfied",
      contractRealized: positiveStatus === "satisfied",
      containsContradictoryMove: false,
      evidence: evidence(positiveReason),
    },
    semanticQuestionCount: 0,
  };
};

const lateClear: LateContradictionProvider = async (input) => ({
  schemaVersion: 1,
  authorityVersion: LATE_CONTRADICTION_AUTHORITY_VERSION,
  contractHash: LATE_CONTRADICTION_CONTRACT_HASH,
  caseId: input.caseId,
  planId: input.planId,
  candidateHash: createHash("sha256").update(input.candidateReply).digest("hex"),
  completedFunctions: ["complete_reciprocal_contact", "establish_assistant_identity:first_contact"],
  status: "clear",
  completedRitual: "first_contact_greeting_ritual",
  reopenedRitual: null,
  completionEvidence: { start: 0, end: input.candidateReply.length, text: input.candidateReply, reason: LATE_REASON },
  contradictionEvidence: null,
});

const localTexts = [POSITIVE_REASON, HANDOFF_REASON, LATE_REASON, UNPARSED];
const assertStructuralIsTextFree = (row: Parameters<typeof structuralRowFor>[0]) => {
  const structural = JSON.stringify(structuralRowFor(row));
  assert.equal(/[\u4e00-\u9fff]/u.test(structural), false, `${row.id}: structural copy contains CJK text`);
  assert.equal(structural.includes("\"text\""), false, `${row.id}: structural copy contains evidence text`);
  for (const text of localTexts) assert.equal(structural.includes(text), false, `${row.id}: structural leaks ${text}`);
};

const run = async () => {
  const dual = caseById("dual-both-satisfied");
  const focus = caseById("emotional-return_focus_control-two-targets-positive");
  const identity = caseById("first-contact-natural-entry");

  // Dual contract, both branches satisfied: identity, handoff and late-contradiction evidence and reasons are kept.
  {
    const { row, failure } = await evaluateCase(dual, {
      judgeProvider: async (input) => verdictFor(input),
      lateContradictionProvider: lateClear,
    });
    assert.equal(failure, null);
    assert.equal(row.actualPassed, true);
    assert.equal(row.verdict?.positiveFunction?.evidence[0].reason, POSITIVE_REASON);
    assert.equal(row.verdict?.positiveFunction?.evidence[0].text, dual.candidateReply);
    assert.equal(row.verdict?.handoff?.evidence[0].reason, HANDOFF_REASON);
    assert.equal(row.verdict?.handoff?.evidence[0].text, dual.candidateReply);
    assert.equal(row.lateContradiction?.status, "clear");
    assert.equal(row.lateContradiction?.completionEvidence?.reason, LATE_REASON);
    assert.equal(row.judgeAttempts.length, 1);
    assertStructuralIsTextFree(row);
    const structural = structuralRowFor(row);
    assert.deepEqual(structural.verdict?.handoff?.evidence, [{ start: 0, end: dual.candidateReply.length, ruleIds: [] }]);
  }

  // Dual contract, handoff rejected: the handoff branch reason is kept and late contradiction is not called.
  {
    const { row, failure } = await evaluateCase(dual, {
      judgeProvider: async (input) => verdictFor(input, { handoffStatus: "not_satisfied" }),
      lateContradictionProvider: async () => {
        throw new Error("late contradiction must not run after a failed first-stage verdict");
      },
    });
    assert.equal(row.actualPassed, false);
    assert.deepEqual(failure?.reasons, ["planned_function_semantic:handoff_not_satisfied"]);
    assert.equal(row.verdict?.handoff?.status, "not_satisfied");
    assert.equal(row.verdict?.handoff?.evidence[0].reason, HANDOFF_REASON);
    assert.equal(row.verdict?.positiveFunction?.status, "satisfied");
    assert.equal(row.lateContradiction, null);
    assertStructuralIsTextFree(row);
  }

  // Late contradiction with malformed output: the unparsed output is kept locally only.
  {
    const { row } = await evaluateCase(dual, {
      judgeProvider: async (input) => verdictFor(input),
      lateContradictionProvider: async () => UNPARSED,
    });
    assert.equal(row.actualPassed, false);
    assert.equal(row.lateContradiction?.reason, "late_contradiction:malformed_verdict");
    assert.equal(row.lateContradiction?.unparsedOutput, UNPARSED);
    assert.equal(structuralRowFor(row).lateContradiction?.unparsedOutput, "kept_locally");
    assertStructuralIsTextFree(row);
  }

  // Emotional support rejection: rule id and reason are kept; the structural copy keeps only positions and rule ids.
  {
    const reason = "ES-FOCUS: 模拟拒绝理由";
    const { row } = await evaluateCase(focus, {
      judgeProvider: async (input) => verdictFor(input, { positiveStatus: "not_satisfied", positiveReason: reason }),
    });
    assert.equal(row.actualPassed, false);
    assert.equal(row.verdict?.positiveFunction?.action, "offer_emotional_support");
    assert.equal(row.verdict?.positiveFunction?.evidence[0].reason, reason);
    assert.deepEqual(row.verdict?.ruleIds, ["ES-FOCUS"]);
    assert.deepEqual(structuralRowFor(row).verdict?.positiveFunction?.evidence[0].ruleIds, ["ES-FOCUS"]);
    assert.equal(JSON.stringify(structuralRowFor(row)).includes(reason), false);
  }

  // Identity branch pass: reason kept.
  {
    const { row } = await evaluateCase(identity, { judgeProvider: async (input) => verdictFor(input) });
    assert.equal(row.actualPassed, true);
    assert.equal(row.verdict?.positiveFunction?.evidence[0].reason, POSITIVE_REASON);
    assertStructuralIsTextFree(row);
  }

  // Malformed judge output: format failure recorded with the unparsed output kept locally.
  {
    const { row } = await evaluateCase(identity, { judgeProvider: async () => UNPARSED });
    assert.deepEqual(row.verdict?.failureReasons, ["planned_function_semantic:malformed_verdict"]);
    assert.equal(row.verdict?.unparsedOutput, UNPARSED);
    assert.equal(structuralRowFor(row).verdict?.unparsedOutput, "kept_locally");
    assertStructuralIsTextFree(row);
  }

  // Service failures: the existing single retry is recorded per attempt; no further attempts are made.
  {
    let calls = 0;
    const unavailable = async () => {
      calls += 1;
      throw new AppError("AI_GENERATION_FAILED", "provider unavailable", 502, { provider: "qwen", status: 503 });
    };
    const { row, failure } = await evaluateCase(identity, { judgeProvider: unavailable });
    assert.equal(calls, 2);
    assert.equal(row.actualPassed, null);
    assert.deepEqual(row.judgeAttempts.map((attempt) => attempt.errorCategory), ["provider_5xx", "provider_5xx"]);
    assert.equal(failure?.failureCategory, "provider_failure");

    calls = 0;
    const recovered = await evaluateCase(identity, {
      judgeProvider: async (input) => {
        calls += 1;
        if (calls === 1) throw new AppError("AI_GENERATION_FAILED", "provider unavailable", 502, { provider: "qwen", status: 503 });
        return verdictFor(input);
      },
    });
    assert.equal(recovered.row.actualPassed, true);
    assert.deepEqual(recovered.row.judgeAttempts.map((attempt) => attempt.errorCategory), ["provider_5xx", null]);
  }

  // Dual branch checks: a wrong handoff verdict is reported even when the identity branch or late contradiction
  // still produces the labelled final outcome.
  {
    const handoffOnly = caseById("dual-handoff-only");
    const positiveOnly = caseById("dual-positive-only");
    const lateDetected: LateContradictionProvider = async (input) => {
      const split = input.candidateReply.lastIndexOf("。") + 1;
      const clear = await lateClear(input) as Record<string, unknown>;
      return {
        ...clear,
        status: "late_contradiction",
        reopenedRitual: "first_contact_greeting_ritual",
        completionEvidence: { start: 0, end: split, text: input.candidateReply.slice(0, split), reason: LATE_REASON },
        contradictionEvidence: {
          start: split,
          end: input.candidateReply.length,
          text: input.candidateReply.slice(split),
          reason: LATE_REASON,
        },
      };
    };

    const maskedByLate = await evaluateCase(positiveOnly, {
      judgeProvider: async (input) => verdictFor(input),
      lateContradictionProvider: lateDetected,
    });
    assert.equal(maskedByLate.failure, null, "final outcome matches the label");
    assert.equal(maskedByLate.row.lateContradiction?.status, "late_contradiction");
    assert.deepEqual(dualBranchCheckFor(maskedByLate.row), {
      id: positiveOnly.id,
      expected: { handoff: false, positiveFunction: true },
      actual: { handoff: true, positiveFunction: true },
      matches: false,
    });

    const maskedByIdentity = await evaluateCase(handoffOnly, {
      judgeProvider: async (input) => verdictFor(input, { handoffStatus: "not_satisfied", positiveStatus: "not_satisfied" }),
    });
    assert.equal(maskedByIdentity.failure, null, "final outcome matches the label");
    assert.equal(dualBranchCheckFor(maskedByIdentity.row)?.matches, false);
    assert.deepEqual(dualBranchCheckFor(maskedByIdentity.row)?.actual, { handoff: false, positiveFunction: false });

    const handoffRejectedFirstStage = await evaluateCase(positiveOnly, {
      judgeProvider: async (input) => verdictFor(input, { handoffStatus: "not_satisfied" }),
      lateContradictionProvider: async () => {
        throw new Error("late contradiction must not run after a failed first-stage verdict");
      },
    });
    assert.equal(dualBranchCheckFor(handoffRejectedFirstStage.row)?.matches, true);

    const bothSatisfied = await evaluateCase(dual, {
      judgeProvider: async (input) => verdictFor(input),
      lateContradictionProvider: lateClear,
    });
    assert.equal(dualBranchCheckFor(bothSatisfied.row)?.matches, true);

    const unjudged = await evaluateCase(dual, { judgeProvider: async () => UNPARSED });
    assert.deepEqual(dualBranchCheckFor(unjudged.row)?.actual, null);
    assert.equal(dualBranchCheckFor(unjudged.row)?.matches, false);
    assert.equal(dualBranchCheckFor((await evaluateCase(identity, { judgeProvider: async (input) => verdictFor(input) })).row), null);
  }

  // Real default provider: outbound calls per attempt count the existing schema-repair call.
  {
    const envNames = ["AI_PROVIDER", "AI_MAIN_MODEL", "AI_SEMANTIC_VALIDATOR_MODEL", "QWEN_API_KEY"] as const;
    const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    const originalFetch = globalThis.fetch;
    try {
      process.env.AI_PROVIDER = "qwen";
      process.env.AI_MAIN_MODEL = "qwen3.7-max";
      process.env.AI_SEMANTIC_VALIDATOR_MODEL = "qwen3.8-max-0902";
      process.env.QWEN_API_KEY = "q-record-check-key";
      let fetchCalls = 0;
      let capturedInput: PlannedFunctionSemanticProviderInput | null = null;
      const judgeProvider: typeof defaultPlannedFunctionSemanticProvider = (input, inspect) => {
        capturedInput = input;
        return defaultPlannedFunctionSemanticProvider(input, inspect);
      };
      globalThis.fetch = async () => {
        fetchCalls += 1;
        assert(capturedInput);
        const content = fetchCalls === 1 ? "not json" : JSON.stringify(verdictFor(capturedInput));
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      const { row } = await evaluateCase(identity, { judgeProvider });
      assert.equal(fetchCalls, 2);
      assert.equal(row.actualPassed, true);
      assert.equal(row.judgeAttempts.length, 1);
      assert.equal(row.judgeAttempts[0].modelCalls, 2);
      assert(row.judgeAttempts[0].latencyMs >= 0);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  console.log("planned function semantic Qwen record checks passed");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
