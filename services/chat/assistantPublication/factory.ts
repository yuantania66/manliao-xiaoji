import path from "node:path";

import {
  getP2PublicationStoreMode,
  isP2PublicationEnabled,
} from "@/lib/p2-publication-flag";

import {
  FilePublicationStore,
  defaultP2PublicationFilePath,
} from "./fileStore";
import { MemoryPublicationStore } from "./store";
import type { PublicationStore } from "./store";
import type { Clock } from "./types";

export type CreatedStore = {
  store: PublicationStore;
  mode: "memory" | "file" | "prisma";
  persist?: () => void | Promise<void>;
};

/**
 * Build the store used by flagged P2 API.
 * Flag must be on before calling; prisma mode requires migrated DB + prisma import.
 */
export async function createPublicationStore(options?: {
  clock?: Clock;
  forceMode?: "memory" | "file" | "prisma";
}): Promise<CreatedStore> {
  if (!isP2PublicationEnabled() && !options?.forceMode) {
    throw new Error("P2 publication flag is off");
  }
  const mode = options?.forceMode ?? getP2PublicationStoreMode();
  const clock = options?.clock ?? { now: Date.now() };

  if (mode === "memory") {
    return { store: new MemoryPublicationStore(clock), mode };
  }

  if (mode === "file") {
    const fileStore = new FilePublicationStore(
      defaultP2PublicationFilePath(),
      clock,
    );
    return {
      store: fileStore,
      mode,
      persist: () => fileStore.persist(),
    };
  }

  // prisma
  const { prisma } = await import("@/lib/prisma");
  const { PrismaPublicationStore } = await import("./prismaStore");
  const prismaStore = new PrismaPublicationStore(prisma, clock);
  return {
    store: prismaStore,
    mode,
    persist: () => prismaStore.flush(),
  };
}

export function resolveEvalDataDir(): string {
  return path.dirname(defaultP2PublicationFilePath());
}
