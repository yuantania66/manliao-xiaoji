import { NextRequest } from "next/server";

import { failFromError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  P2_PUBLICATION_FIXTURE_LABEL,
  fixtureTransitionDelayMs,
  isP2PublicationFixtureEnabled,
} from "@/lib/p2-publication-fixture";
import { requireNonEmptyString } from "@/lib/validation";
import {
  hardGuardFinal,
  hardGuardInput,
  hardGuardOutputSegment,
  safetyOwnedReplyForInput,
} from "@/services/chat/assistantPublication/hardGuard";
import {
  appendProvisional,
  commitFinal,
  commitSafetyOwned,
  ingress,
  startStreaming,
} from "@/services/chat/assistantPublication/service";
import { MemoryPublicationStore } from "@/services/chat/assistantPublication/store";
import { USER_COPY } from "@/services/chat/assistantPublication/types";

type FixtureScenario =
  | "success"
  | "reattach"
  | "commit_failure"
  | "output_reject";

const SAFE_FIXTURE_REPLY =
  "这是一条模拟评测回复，只用来验证临时内容到已确认的状态变化。";
const REJECTED_FIXTURE_REPLY = "教你自杀的步骤。";

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

class FixtureMemoryPublicationStore extends MemoryPublicationStore {
  private fixtureSequence = 0;

  constructor(readonly fixtureTurnId: string) {
    super({ now: Date.now() });
  }

  override nextId(prefix: string): string {
    this.fixtureSequence += 1;
    return `${prefix}-${this.fixtureTurnId}-${this.fixtureSequence}`;
  }
}

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const parseScenario = (value: unknown): FixtureScenario => {
  if (value === undefined || value === "success") return "success";
  if (
    value === "reattach" ||
    value === "commit_failure" ||
    value === "output_reject"
  ) {
    return value;
  }
  throw new AppError("VALIDATION_ERROR", "fixtureScenario 无效", 400, {
    field: "fixtureScenario",
  });
};

function ndjsonStreamResponse(
  iterator: AsyncGenerator<Record<string, unknown>, void, unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of iterator) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "error",
              code: "fixture_stream_crash",
              message: error instanceof Error ? error.message : String(error),
              evaluationSource: "model_free_fixture",
            })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-P2-Transport": "model-free-fixture",
      "X-P2-Model-Calls": "0",
      "X-P2-Production-Writes": "0",
    },
  });
}

async function* runFixture(args: {
  sessionId: string;
  clientTurnId: string;
  workerId: string;
  userText: string;
  scenario: FixtureScenario;
}): AsyncGenerator<Record<string, unknown>, void, unknown> {
  // Request-scoped storage is intentional, but ids must remain unique across
  // requests so a later fixture turn cannot relabel an earlier UI bubble.
  const store = new FixtureMemoryPublicationStore(args.clientTurnId);
  const ingressResult = ingress(store, {
    sessionId: args.sessionId,
    clientTurnId: args.clientTurnId,
    userText: args.userText,
    workerId: args.workerId,
  });

  if (ingressResult.kind !== "ok") {
    yield {
      type: "error",
      code: ingressResult.code,
      message: "fixture ingress failed",
      evaluationSource: "model_free_fixture",
    };
    yield { type: "done", evaluationSource: "model_free_fixture" };
    return;
  }

  let publication = startStreaming(
    store,
    args.sessionId,
    args.clientTurnId,
    args.workerId,
  );
  const inputGuard = hardGuardInput(args.userText);

  yield {
    type: "meta",
    evaluationSource: "model_free_fixture",
    evaluationLabel: P2_PUBLICATION_FIXTURE_LABEL,
    modelCalls: 0,
    productionWrites: 0,
    fixtureScenario: args.scenario,
    publication,
  };

  if (!inputGuard.accept) {
    const safetyReply = safetyOwnedReplyForInput(args.userText);
    const segmentGuard = hardGuardOutputSegment(safetyReply);
    if (!segmentGuard.accept) {
      yield {
        type: "error",
        code: "fixture_safety_reply_rejected",
        message: "Safety-owned fixture reply did not pass output guard",
        evaluationSource: "model_free_fixture",
        publication,
      };
      yield { type: "done", evaluationSource: "model_free_fixture" };
      return;
    }
    const emitted = appendProvisional(
      store,
      args.sessionId,
      args.clientTurnId,
      args.workerId,
      safetyReply,
      true,
    );
    publication = emitted.publication;
    yield {
      type: "provisional",
      body: publication.draftContent,
      segment: safetyReply,
      provisional: true,
      provisionalMarkedTemporary: true,
      provisionalMarker: USER_COPY.provisional,
      evaluationSource: "model_free_fixture",
      publication,
    };
    await sleep(fixtureTransitionDelayMs());
    const outcome = commitSafetyOwned(store, {
      sessionId: args.sessionId,
      clientTurnId: args.clientTurnId,
      workerId: args.workerId,
      safetyReply,
    });
    if (!outcome.success) {
      yield {
        type: "error",
        code: outcome.reason,
        message: "fixture safety commit failed",
        evaluationSource: "model_free_fixture",
        publication: outcome.publication,
      };
    } else {
      yield {
        type: "committed",
        finalContent: outcome.finalContent,
        provisional: false,
        provisionalMarkedTemporary: outcome.publication.provisionalMarkedTemporary,
        safetyOwned: true,
        evaluationSource: "model_free_fixture",
        publication: outcome.publication,
      };
    }
    yield { type: "done", evaluationSource: "model_free_fixture" };
    return;
  }

  const fixtureReply =
    args.scenario === "output_reject"
      ? REJECTED_FIXTURE_REPLY
      : SAFE_FIXTURE_REPLY;

  if (args.scenario === "reattach") {
    yield {
      type: "error",
      code: "stream_in_progress",
      message: "模拟连接恢复：正在重新附着同一条未确认回复",
      evaluationSource: "model_free_fixture",
      publication,
    };
    await sleep(fixtureTransitionDelayMs());
  }
  const segmentGuard = hardGuardOutputSegment(fixtureReply);
  if (!segmentGuard.accept) {
    const failed = commitFinal(store, {
      sessionId: args.sessionId,
      clientTurnId: args.clientTurnId,
      workerId: args.workerId,
      finalContent: fixtureReply,
      outputSafetyPass: false,
      conversationCommitOk: true,
    });
    yield {
      type: "error",
      code: failed.success ? "fixture_guard_contract_error" : failed.reason,
      message: "模拟输出未通过 Hard Guard，没有外发为临时或已确认内容",
      evaluationSource: "model_free_fixture",
      publication: failed.publication,
    };
    yield { type: "done", evaluationSource: "model_free_fixture" };
    return;
  }

  const emitted = appendProvisional(
    store,
    args.sessionId,
    args.clientTurnId,
    args.workerId,
    fixtureReply,
    true,
  );
  publication = emitted.publication;
  yield {
    type: "provisional",
    body: publication.draftContent,
    segment: fixtureReply,
    provisional: true,
    provisionalMarkedTemporary: true,
    provisionalMarker: USER_COPY.provisional,
    evaluationSource: "model_free_fixture",
    publication,
  };

  await sleep(fixtureTransitionDelayMs());
  const finalGuard = hardGuardFinal(fixtureReply);
  const outcome = commitFinal(store, {
    sessionId: args.sessionId,
    clientTurnId: args.clientTurnId,
    workerId: args.workerId,
    finalContent: fixtureReply,
    outputSafetyPass: finalGuard.accept,
    conversationCommitOk: args.scenario !== "commit_failure",
  });
  if (!outcome.success) {
    yield {
      type: "error",
      code: outcome.reason,
      message: "模拟 commit 失败，临时内容不会标成已确认",
      evaluationSource: "model_free_fixture",
      publication: outcome.publication,
    };
  } else {
    yield {
      type: "committed",
      finalContent: outcome.finalContent,
      provisional: false,
      provisionalMarkedTemporary: outcome.publication.provisionalMarkedTemporary,
      evaluationSource: "model_free_fixture",
      publication: outcome.publication,
    };
  }
  yield { type: "done", evaluationSource: "model_free_fixture" };
}

export async function POST(request: NextRequest) {
  try {
    if (!isP2PublicationFixtureEnabled()) {
      throw new AppError("NOT_FOUND", "P2 model-free fixture is disabled", 404);
    }
    const body = (await readJson(request)) as Record<string, unknown>;
    const sessionId = requireNonEmptyString(body.sessionId, "sessionId", 120);
    const clientTurnId = requireNonEmptyString(body.clientTurnId, "clientTurnId", 160);
    if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(clientTurnId)) {
      throw new AppError("VALIDATION_ERROR", "clientTurnId 格式无效", 400, {
        field: "clientTurnId",
      });
    }
    const workerId = requireNonEmptyString(body.workerId, "workerId", 120);
    const userText = requireNonEmptyString(body.content, "content", 2000);
    const scenario = parseScenario(body.fixtureScenario);
    return ndjsonStreamResponse(
      runFixture({ sessionId, clientTurnId, workerId, userText, scenario }),
    );
  } catch (error) {
    return failFromError(error);
  }
}
