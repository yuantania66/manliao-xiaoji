/**
 * One-shot live smoke (not part of CI). Requires QWEN_API_KEY in env.
 */
import {
  MemoryPublicationStore,
  resolveP2QwenStreamConfig,
  runP2PublicationStreamPipeline,
} from "../services/chat/assistantPublication";

async function main() {
  const cfg = resolveP2QwenStreamConfig();
  console.log(
    JSON.stringify(
      { configured: cfg.configured, model: cfg.model, missing: cfg.missing },
      null,
      2,
    ),
  );
  if (!cfg.configured) process.exit(2);

  const store = new MemoryPublicationStore({ now: Date.now() });
  const events: string[] = [];
  for await (const ev of runP2PublicationStreamPipeline({
    store,
    sessionId: "smoke-s1",
    clientTurnId: "smoke-turn-0001",
    workerId: "smoke-w1",
    userText: "今天有点累，只想随便说两句。",
  })) {
    events.push(ev.type);
    if (ev.type === "provisional") {
      console.log(
        "PROVISIONAL",
        JSON.stringify({
          len: ev.body.length,
          marker: ev.provisionalMarker,
          status: ev.publication.status,
        }),
      );
    }
    if (ev.type === "committed") {
      console.log(
        "COMMITTED",
        JSON.stringify({
          len: ev.finalContent.length,
          status: ev.publication.status,
          preview: ev.finalContent.slice(0, 120),
        }),
      );
    }
    if (ev.type === "error") {
      console.log(
        "ERROR",
        JSON.stringify({
          code: ev.code,
          message: ev.message,
          missingEnv: ev.missingEnv,
        }),
      );
    }
  }
  console.log("EVENT_TYPES", events.join(" -> "));
  console.log(
    "WINNERS",
    store.countAssistantPublications("smoke-s1", "smoke-turn-0001"),
  );

  const again: string[] = [];
  for await (const ev of runP2PublicationStreamPipeline({
    store,
    sessionId: "smoke-s1",
    clientTurnId: "smoke-turn-0001",
    workerId: "smoke-w2",
    userText: "今天有点累，只想随便说两句。",
  })) {
    again.push(ev.type);
  }
  console.log("RETRY_TYPES", again.join(" -> "));
  console.log(
    "WINNERS_AFTER_RETRY",
    store.countAssistantPublications("smoke-s1", "smoke-turn-0001"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
