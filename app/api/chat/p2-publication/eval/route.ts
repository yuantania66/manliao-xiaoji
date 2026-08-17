import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  getP2PublicationStoreMode,
  isP2PublicationCohortEnabled,
  isP2PublicationEnabled,
  getP2PublicationCohortAllowlist,
} from "@/lib/p2-publication-flag";
import { requireNonEmptyString } from "@/lib/validation";
import {
  P2_PUBLICATION_SAFETY_DEPTH,
  USER_COPY,
  appendProvisional,
  commitFinal,
  commitSafetyOwned,
  createPublicationStore,
  ingress,
  resolveP2QwenStreamConfig,
  runP2PublicationStreamPipeline,
  startStreaming,
} from "@/services/chat/assistantPublication";

/**
 * Flagged P2 publication eval / dry-run / real-model stream entry.
 * DEFAULT: flag off → 404 (production still uses V1 writer).
 * When P2_PUBLICATION_ENABLED=1:
 * - op ingress/start_streaming/append_provisional/commit — model-free controls
 * - op generate_stream — real Qwen streaming → provisional → commit (NDJSON)
 */

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const assertFlagOn = () => {
  if (!isP2PublicationEnabled()) {
    throw new AppError("NOT_FOUND", "P2 publication entry is disabled", 404);
  }
};

export async function GET() {
  const qwen = resolveP2QwenStreamConfig();
  return ok({
    enabled: isP2PublicationEnabled(),
    storeMode: getP2PublicationStoreMode(),
    defaultOff: true,
    productionWriter: "v1",
    cohort: {
      enabled: isP2PublicationCohortEnabled(),
      allowlistSize: getP2PublicationCohortAllowlist().length,
      siteWideDefault: false,
    },
    userCopy: USER_COPY,
    safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
    qwenStream: {
      configured: qwen.configured,
      model: qwen.model,
      missing: qwen.missing,
    },
  });
}

function ndjsonStreamResponse(
  iterator: AsyncGenerator<unknown, void, unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of iterator) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", code: "stream_crash", message })}\n`,
          ),
        );
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-P2-Publication-Stream": "1",
      "X-P2-Safety-Depth": P2_PUBLICATION_SAFETY_DEPTH,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    assertFlagOn();
    const body = (await readJson(request)) as Record<string, unknown>;
    const sessionId = requireNonEmptyString(body.sessionId, "sessionId", 120);
    const clientTurnId = requireNonEmptyString(body.clientTurnId, "clientTurnId", 160);
    if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(clientTurnId)) {
      throw new AppError("VALIDATION_ERROR", "clientTurnId 格式无效", 400, {
        field: "clientTurnId",
      });
    }
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 120)
        : `worker-${crypto.randomUUID()}`;
    const op = typeof body.op === "string" ? body.op.trim() : "ingress";
    const userText =
      typeof body.content === "string"
        ? body.content
        : typeof body.userText === "string"
          ? body.userText
          : "";

    const created = await createPublicationStore();
    const { store, persist } = created;

    if (op === "generate_stream") {
      if (!userText.trim()) {
        throw new AppError("VALIDATION_ERROR", "content 不能为空", 400, {
          field: "content",
        });
      }
      const userId =
        typeof body.userId === "string" && body.userId.trim()
          ? body.userId.trim().slice(0, 120)
          : null;
      const recentMessages = Array.isArray(body.recentMessages)
        ? body.recentMessages
            .filter(
              (item): item is { role: "user" | "assistant"; content: string } =>
                !!item &&
                typeof item === "object" &&
                ((item as { role?: string }).role === "user" ||
                  (item as { role?: string }).role === "assistant") &&
                typeof (item as { content?: unknown }).content === "string",
            )
            .map((item) => ({
              role: item.role,
              content: item.content.trim().slice(0, 2000),
            }))
            .filter((item) => item.content)
            .slice(-12)
        : [];
      const iterator = runP2PublicationStreamPipeline({
        store,
        sessionId,
        clientTurnId,
        workerId,
        userText: userText.trim().slice(0, 2000),
        userId,
        recentMessages,
        persist,
        storeMode: created.mode,
        signal: request.signal,
      });
      return ndjsonStreamResponse(iterator);
    }

    if (op === "ingress") {
      if (!userText.trim()) {
        throw new AppError("VALIDATION_ERROR", "content 不能为空", 400, {
          field: "content",
        });
      }
      const result = ingress(store, {
        sessionId,
        clientTurnId,
        userText: userText.trim().slice(0, 2000),
        workerId,
      });
      await persist?.();
      if (result.kind !== "ok") {
        return ok({ ...result, success: false, storeMode: created.mode });
      }
      return ok({
        success: result.success,
        action: result.action,
        regenerated: result.regenerated,
        body: result.body,
        provisional: result.provisional,
        provisionalMarkedTemporary: result.provisionalMarkedTemporary,
        provisionalMarker: USER_COPY.provisional,
        failureCode: result.failureCode ?? null,
        publication: result.publication,
        userMessageId: result.user.id,
        storeMode: created.mode,
        safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
      });
    }

    if (op === "start_streaming") {
      const pub = startStreaming(store, sessionId, clientTurnId, workerId);
      await persist?.();
      return ok({
        success: true,
        publication: pub,
        provisionalMarkedTemporary: pub.provisionalMarkedTemporary,
        storeMode: created.mode,
      });
    }

    if (op === "append_provisional") {
      const segment = requireNonEmptyString(body.segment, "segment", 2000);
      const safetyAccepted = body.safetyAccepted !== false;
      const emitted = appendProvisional(
        store,
        sessionId,
        clientTurnId,
        workerId,
        segment,
        safetyAccepted,
      );
      await persist?.();
      return ok({
        success: emitted.emitted,
        emitted: emitted.emitted,
        body: emitted.publication.draftContent,
        provisional: true,
        provisionalMarkedTemporary: emitted.provisionalMarkedTemporary,
        provisionalMarker: USER_COPY.provisional,
        publication: emitted.publication,
        storeMode: created.mode,
      });
    }

    if (op === "commit") {
      const finalContent = requireNonEmptyString(body.finalContent, "finalContent", 8000);
      const outputSafetyPass = body.outputSafetyPass !== false;
      const conversationCommitOk = body.conversationCommitOk !== false;
      const safetyOwned = body.safetyOwned === true;
      const outcome = safetyOwned
        ? commitSafetyOwned(store, {
            sessionId,
            clientTurnId,
            workerId,
            safetyReply: finalContent,
          })
        : commitFinal(store, {
            sessionId,
            clientTurnId,
            workerId,
            finalContent,
            outputSafetyPass,
            conversationCommitOk,
          });
      await persist?.();
      // Commit failure must not be reported as success.
      return ok({
        success: outcome.success,
        ...(outcome.success
          ? { finalContent: outcome.finalContent }
          : { reason: outcome.reason }),
        publication: outcome.publication,
        provisional: false,
        provisionalMarkedTemporary: outcome.publication.provisionalMarkedTemporary,
        storeMode: created.mode,
        safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
      });
    }

    throw new AppError("VALIDATION_ERROR", `未知 op: ${op}`, 400, { field: "op" });
  } catch (error) {
    return failFromError(error);
  }
}
