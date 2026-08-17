/**
 * Real-model streaming pipeline through P2 publication five-state + lease.
 * Opt-in / eval only — does not switch production V1 writer.
 */

import type { AiModelMessage } from "@/services/ai/types";
import { streamChatCompletionDeltas } from "@/services/ai/streamChatCompletions";

import {
  P2_PUBLICATION_SAFETY_DEPTH,
  hardGuardFinal,
  hardGuardInput,
  hardGuardOutputSegment,
  safetyOwnedReplyForInput,
} from "./hardGuard";
import {
  type AssistantNameStore,
  type ChatTurnSnippet,
  buildP2PreviewSystemPrompt,
  resolveAssistantDisplayName,
  resolveUserScopeId,
} from "./assistantIdentity";
import {
  buildIntentAwareSystemPrompt,
  resolveP2TurnIntent,
} from "./intentResolver";
import { resolveP2QwenStreamConfig } from "./qwenConfig";
import { SentenceSegmentBuffer } from "./sentenceBuffer";
import {
  appendProvisional,
  clonePub,
  commitFinal,
  commitSafetyOwned,
  ingress,
  markFailedRetryable,
  replaceProvisionalDraft,
  startStreaming,
} from "./service";
import type { PublicationStore } from "./store";
import type { AssistantPublicationRecord } from "./types";
import { USER_COPY } from "./types";

export type StreamPipelineEvent =
  | {
      type: "meta";
      safetyDepth: string;
      storeMode?: string;
      model?: string;
      assistantDisplayName?: string;
      userScopeId?: string;
      intentKind?: string;
      publication: AssistantPublicationRecord;
    }
  | {
      type: "provisional";
      body: string;
      segment: string;
      provisional: true;
      provisionalMarkedTemporary: true;
      provisionalMarker: string;
      publication: AssistantPublicationRecord;
    }
  | {
      type: "committed";
      finalContent: string;
      provisional: false;
      provisionalMarkedTemporary: boolean;
      publication: AssistantPublicationRecord;
      safetyOwned?: boolean;
    }
  | {
      type: "error";
      code: string;
      message: string;
      publication?: AssistantPublicationRecord | null;
      missingEnv?: string[];
    }
  | {
      type: "done";
    };

export type StreamDeltaSource = (args: {
  messages: AiModelMessage[];
  model: string;
  signal?: AbortSignal;
}) => AsyncIterable<string> | Promise<AsyncIterable<string>>;

export type RunP2StreamPipelineArgs = {
  store: PublicationStore;
  sessionId: string;
  clientTurnId: string;
  workerId: string;
  userText: string;
  /** Logged-in user id; guests fall back to session-scoped isolation. */
  userId?: string | null;
  /** Recent turns (oldest→newest), excluding the current userText. */
  recentMessages?: ChatTurnSnippet[];
  nameStore?: AssistantNameStore;
  persist?: () => void | Promise<void>;
  storeMode?: string;
  /** Injectable for checks; default = live Qwen stream. */
  deltaSource?: StreamDeltaSource;
  signal?: AbortSignal;
};

function buildMessages(args: {
  displayName: string;
  userText: string;
  recentMessages?: ChatTurnSnippet[];
  intentPosturePrompt: string;
}): AiModelMessage[] {
  const messages: AiModelMessage[] = [
    { role: "developer", content: args.intentPosturePrompt },
  ];
  const recent = (args.recentMessages ?? []).slice(-12);
  for (const turn of recent) {
    const content = turn.content.trim().slice(0, 2000);
    if (!content) continue;
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content });
    }
  }
  messages.push({ role: "user", content: args.userText });
  return messages;
}

function isBarePresenceReply(text: string): boolean {
  const t = text.trim();
  return /^(?:嗯|哦|喔)?[，,]?\s*我在(?:呢|呀|啊)?[。.!！]?\s*$/u.test(t)
    || /^(?:我在呢|我在|在的|我在这(?:里|儿)?)[。.!！]?\s*$/u.test(t);
}

/** Last-resort continuation when model ignores soft-ack intent (not a general style rule). */
function softAckFallbackFromPrior(priorAssistant: string): string {
  if (/安静|待着/u.test(priorAssistant)) return "好，那就先这样待着。";
  if (/随时|叫我|需要我/u.test(priorAssistant)) return "好，需要的时候再找我。";
  return "好。";
}

function priorAssistantText(recent?: ChatTurnSnippet[]): string {
  const list = recent ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "assistant") return list[i].content;
  }
  return "";
}

async function collectDeltaText(
  deltaSource: StreamDeltaSource,
  messages: AiModelMessage[],
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  let out = "";
  const deltas = await deltaSource({ messages, model, signal });
  for await (const delta of deltas) {
    if (signal?.aborted) break;
    out += delta;
  }
  return out.trim();
}

async function defaultQwenDeltaSource(args: {
  messages: AiModelMessage[];
  model: string;
  signal?: AbortSignal;
}): Promise<AsyncIterable<string>> {
  const config = resolveP2QwenStreamConfig();
  if (!config.configured || !config.apiKey) {
    throw Object.assign(new Error("Qwen not configured"), {
      code: "QWEN_NOT_CONFIGURED",
      missing: config.missing,
    });
  }
  return streamChatCompletionDeltas({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    messages: args.messages,
    model: args.model || config.model,
    temperature: 0.7,
    extraBody: { enable_thinking: false },
    signal: args.signal,
  });
}

export async function* runP2PublicationStreamPipeline(
  args: RunP2StreamPipelineArgs,
): AsyncGenerator<StreamPipelineEvent, void, unknown> {
  const {
    store,
    sessionId,
    clientTurnId,
    workerId,
    userText,
    persist,
    storeMode,
    signal,
  } = args;

  const userScopeId = resolveUserScopeId({
    userId: args.userId,
    sessionId,
  });
  const identity = resolveAssistantDisplayName({
    userScopeId,
    userText,
    recentMessages: args.recentMessages,
    nameStore: args.nameStore,
  });
  const intent = resolveP2TurnIntent({
    userText,
    recentMessages: args.recentMessages,
    renamedThisTurn: Boolean(identity.renamedTo),
  });
  const intentPosturePrompt = buildIntentAwareSystemPrompt({
    basePrompt: buildP2PreviewSystemPrompt(identity.displayName),
    intent,
  });

  const ingressResult = ingress(store, {
    sessionId,
    clientTurnId,
    userText,
    workerId,
  });
  await persist?.();

  if (ingressResult.kind !== "ok") {
    yield {
      type: "error",
      code: ingressResult.code,
      message: "ingress failed",
      publication: null,
    };
    yield { type: "done" };
    return;
  }

  const pub0 = ingressResult.publication;

  // Idempotent replay: already committed → no second winner / no provider call.
  if (ingressResult.action === "replay_committed" && pub0.status === "committed") {
    yield {
      type: "meta",
      safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
      storeMode,
      assistantDisplayName: identity.displayName,
      userScopeId: identity.userScopeId,
      intentKind: intent.kind,
      publication: clonePub(pub0),
    };
    yield {
      type: "committed",
      finalContent: pub0.finalContent || ingressResult.body || "",
      provisional: false,
      provisionalMarkedTemporary: pub0.provisionalMarkedTemporary,
      publication: clonePub(pub0),
    };
    yield { type: "done" };
    return;
  }

  if (
    ingressResult.action === "terminal" ||
    ingressResult.action === "deleted" ||
    !ingressResult.success
  ) {
    yield {
      type: "error",
      code: ingressResult.failureCode || "terminal",
      message:
        ingressResult.failureCode === "deleted"
          ? USER_COPY.deleted
          : USER_COPY.terminal,
      publication: clonePub(pub0),
    };
    yield { type: "done" };
    return;
  }

  // Attach to live stream: replay safe draft only (no parallel generation / no second winner).
  if (ingressResult.action === "attached" && pub0.status === "streaming") {
    yield {
      type: "meta",
      safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
      storeMode,
      assistantDisplayName: identity.displayName,
      userScopeId: identity.userScopeId,
      intentKind: intent.kind,
      publication: clonePub(pub0),
    };
    if (pub0.draftContent) {
      yield {
        type: "provisional",
        body: pub0.draftContent,
        segment: "",
        provisional: true,
        provisionalMarkedTemporary: true,
        provisionalMarker: USER_COPY.provisional,
        publication: clonePub(pub0),
      };
    }
    yield {
      type: "error",
      code: "stream_in_progress",
      message: USER_COPY.reconnect,
      publication: clonePub(pub0),
    };
    yield { type: "done" };
    return;
  }

  const inputGuard = hardGuardInput(userText);
  const config = resolveP2QwenStreamConfig();
  const deltaSource = args.deltaSource ?? ((a) => defaultQwenDeltaSource(a));
  const needsLiveModel = inputGuard.accept && !args.deltaSource;

  if (needsLiveModel && !config.configured) {
    const failed = markFailedRetryable(
      store,
      sessionId,
      clientTurnId,
      "qwen_not_configured",
    );
    await persist?.();
    yield {
      type: "meta",
      safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
      storeMode,
      model: config.model,
      assistantDisplayName: identity.displayName,
      userScopeId: identity.userScopeId,
      intentKind: intent.kind,
      publication: failed,
    };
    yield {
      type: "error",
      code: "QWEN_NOT_CONFIGURED",
      message:
        "缺少 Qwen 流式所需环境变量；未生成未校验内容，也不会标成已确认。",
      publication: failed,
      missingEnv: config.missing,
    };
    yield { type: "done" };
    return;
  }

  let pub = startStreaming(store, sessionId, clientTurnId, workerId);
  await persist?.();

  yield {
    type: "meta",
    safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
    storeMode,
    model: config.model,
    assistantDisplayName: identity.displayName,
    userScopeId: identity.userScopeId,
    intentKind: intent.kind,
    publication: clonePub(pub),
  };

  if (!inputGuard.accept) {
    const safetyReply = safetyOwnedReplyForInput(userText);
    // Safety-owned still uses the same publication row; emit as provisional then commit.
    const emitted = appendProvisional(
      store,
      sessionId,
      clientTurnId,
      workerId,
      safetyReply,
      true,
    );
    await persist?.();
    yield {
      type: "provisional",
      body: emitted.publication.draftContent,
      segment: safetyReply,
      provisional: true,
      provisionalMarkedTemporary: true,
      provisionalMarker: USER_COPY.provisional,
      publication: clonePub(emitted.publication),
    };
    const outcome = commitSafetyOwned(store, {
      sessionId,
      clientTurnId,
      workerId,
      safetyReply,
    });
    await persist?.();
    if (!outcome.success) {
      yield {
        type: "error",
        code: outcome.reason,
        message: "safety commit failed",
        publication: clonePub(outcome.publication),
      };
      yield { type: "done" };
      return;
    }
    yield {
      type: "committed",
      finalContent: outcome.finalContent,
      provisional: false,
      provisionalMarkedTemporary: outcome.publication.provisionalMarkedTemporary,
      publication: clonePub(outcome.publication),
      safetyOwned: true,
    };
    yield { type: "done" };
    return;
  }

  const buffer = new SentenceSegmentBuffer();
  let abortedForSafety = false;

  try {
    const deltas = await deltaSource({
      messages: buildMessages({
        displayName: identity.displayName,
        userText,
        recentMessages: args.recentMessages,
        intentPosturePrompt,
      }),
      model: config.model,
      signal,
    });

    for await (const delta of deltas) {
      if (signal?.aborted) break;
      const segments = buffer.push(delta);
      for (const segment of segments) {
        const guard = hardGuardOutputSegment(pub.draftContent + segment);
        if (!guard.accept) {
          abortedForSafety = true;
          break;
        }
        const emitted = appendProvisional(
          store,
          sessionId,
          clientTurnId,
          workerId,
          segment,
          true,
        );
        await persist?.();
        pub = emitted.publication;
        if (emitted.emitted) {
          yield {
            type: "provisional",
            body: emitted.publication.draftContent,
            segment,
            provisional: true,
            provisionalMarkedTemporary: true,
            provisionalMarker: USER_COPY.provisional,
            publication: clonePub(emitted.publication),
          };
        }
      }
      if (abortedForSafety) break;
    }

    if (!abortedForSafety) {
      const rest = buffer.flush();
      if (rest) {
        const guard = hardGuardOutputSegment(pub.draftContent + rest);
        if (guard.accept) {
          const emitted = appendProvisional(
            store,
            sessionId,
            clientTurnId,
            workerId,
            rest,
            true,
          );
          await persist?.();
          pub = emitted.publication;
          if (emitted.emitted) {
            yield {
              type: "provisional",
              body: emitted.publication.draftContent,
              segment: rest,
              provisional: true,
              provisionalMarkedTemporary: true,
              provisionalMarker: USER_COPY.provisional,
              publication: clonePub(emitted.publication),
            };
          }
        } else {
          abortedForSafety = true;
        }
      }
    }
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code || "AI_GENERATION_FAILED")
        : "AI_GENERATION_FAILED";
    const missing =
      err && typeof err === "object" && "missing" in err
        ? ((err as { missing?: string[] }).missing ?? undefined)
        : undefined;
    yield {
      type: "error",
      code,
      message: err instanceof Error ? err.message : "model stream failed",
      publication: clonePub(pub),
      missingEnv: missing,
    };
    yield { type: "done" };
    return;
  }

  const finalContent = pub.draftContent.trim();
  if (!finalContent) {
    const outcome = commitFinal(store, {
      sessionId,
      clientTurnId,
      workerId,
      finalContent: "",
      outputSafetyPass: false,
      conversationCommitOk: true,
    });
    await persist?.();
    yield {
      type: "error",
      code: abortedForSafety ? "output_safety_reject" : "empty_generation",
      message: abortedForSafety
        ? "输出未通过 Hard Guard，未标成已确认"
        : "模型未产出可用文本",
      publication: clonePub(outcome.publication),
    };
    yield { type: "done" };
    return;
  }

  // Intent-conditioned rewrite (not a quality hard-fail gate): if discourse intent
  // was soft-ack but draft is bare presence, regenerate once on the same winner row.
  let commitText = finalContent;
  if (
    !abortedForSafety &&
    intent.kind === "acknowledge_prior_offer" &&
    isBarePresenceReply(finalContent)
  ) {
    let nextText = "";
    try {
      const rewritePrompt = buildIntentAwareSystemPrompt({
        basePrompt: buildP2PreviewSystemPrompt(identity.displayName),
        intent: {
          ...intent,
          posture: `${intent.posture}上一稿把这轮理解成了“需要确认你在场”；请按正确意图重写一句自然承接。`,
        },
      });
      const rewritten = await collectDeltaText(
        deltaSource,
        buildMessages({
          displayName: identity.displayName,
          userText,
          recentMessages: args.recentMessages,
          intentPosturePrompt: rewritePrompt,
        }),
        config.model,
        signal,
      );
      if (rewritten && hardGuardFinal(rewritten).accept && !isBarePresenceReply(rewritten)) {
        nextText = rewritten;
      }
    } catch {
      // fall through to discourse fallback
    }
    if (!nextText) {
      nextText = softAckFallbackFromPrior(priorAssistantText(args.recentMessages));
    }
    if (nextText && hardGuardFinal(nextText).accept) {
      const replaced = replaceProvisionalDraft(
        store,
        sessionId,
        clientTurnId,
        workerId,
        nextText,
        true,
      );
      await persist?.();
      pub = replaced.publication;
      commitText = nextText;
      yield {
        type: "provisional",
        body: nextText,
        segment: nextText,
        provisional: true,
        provisionalMarkedTemporary: true,
        provisionalMarker: USER_COPY.provisional,
        publication: clonePub(replaced.publication),
      };
    }
  }

  const finalGuard = hardGuardFinal(commitText);
  const outcome = commitFinal(store, {
    sessionId,
    clientTurnId,
    workerId,
    finalContent: commitText,
    outputSafetyPass: finalGuard.accept && !abortedForSafety,
    conversationCommitOk: true,
  });
  await persist?.();

  if (!outcome.success) {
    yield {
      type: "error",
      code: outcome.reason,
      message:
        outcome.reason === "output_safety_reject"
          ? "输出未通过 Hard Guard，未标成已确认"
          : "确认失败，临时内容未保留为终稿",
      publication: clonePub(outcome.publication),
    };
    yield { type: "done" };
    return;
  }

  yield {
    type: "committed",
    finalContent: outcome.finalContent,
    provisional: false,
    provisionalMarkedTemporary: outcome.publication.provisionalMarkedTemporary,
    publication: clonePub(outcome.publication),
  };
  yield { type: "done" };
}
