/**
 * Durable file-backed publication store (等价持久化).
 * Used by flagged eval API when P2_PUBLICATION_STORE=file (default).
 */

import fs from "node:fs";
import path from "node:path";

import type {
  AssistantPublicationRecord,
  Clock,
  ConversationMessage,
} from "./types";
import { MemoryPublicationStore } from "./store";

type Snapshot = {
  clock: number;
  seq: number;
  users: ConversationMessage[];
  assistants: ConversationMessage[];
  publications: AssistantPublicationRecord[];
};

export class FilePublicationStore extends MemoryPublicationStore {
  constructor(
    readonly filePath: string,
    clock?: Clock,
  ) {
    const loaded = loadSnapshot(filePath);
    super(clock ?? { now: loaded?.clock ?? Date.now() });
    if (loaded) {
      this.clock.now = loaded.clock;
      for (const u of loaded.users) this.putUser(u);
      for (const a of loaded.assistants) this.putAssistantMessage(a);
      for (const p of loaded.publications) this.putPublication(p);
      this.seq = loaded.seq;
    }
  }

  persist(): void {
    const snap: Snapshot = {
      clock: this.clock.now,
      seq: this.seq,
      users: [...this.users.values()],
      assistants: [...this.assistants.values()],
      publications: [...this.publications.values()],
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }
}

function loadSnapshot(filePath: string): Snapshot | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export function defaultP2PublicationFilePath(): string {
  return (
    process.env.P2_PUBLICATION_FILE_PATH?.trim() ||
    path.join(process.cwd(), ".data", "p2-publications.json")
  );
}
