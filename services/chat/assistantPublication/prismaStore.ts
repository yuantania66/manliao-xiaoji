/**
 * Prisma-backed durable mirror for AssistantPublication.
 * Keeps an in-process MemoryPublicationStore for service semantics, and
 * flushes each publication upsert to Postgres via $executeRaw once migrated.
 */

import type { PrismaClient } from "@prisma/client";

import type { AssistantPublicationRecord, Clock } from "./types";
import { ASSISTANT_ROLE } from "./types";
import { MemoryPublicationStore } from "./store";

export class PrismaPublicationStore extends MemoryPublicationStore {
  constructor(
    private readonly prisma: PrismaClient,
    clock: Clock = { now: Date.now() },
  ) {
    super(clock);
  }

  override putPublication(pub: AssistantPublicationRecord): void {
    super.putPublication(pub);
    // Fire-and-forget flush is unsafe for commit semantics; callers must await flush.
    this._pending = pub;
  }

  private _pending: AssistantPublicationRecord | null = null;

  async flush(): Promise<void> {
    const pub = this._pending;
    if (!pub) return;
    await this.prisma.$executeRaw`
      INSERT INTO "AssistantPublication" (
        "id", "sessionId", "clientTurnId", "role", "status", "attempt",
        "leaseOwner", "leaseExpiresAt", "draftContent", "finalContent",
        "failureCode", "linkedConversationMessageId", "provisionalMarkedTemporary",
        "tombstoneUntil", "createdAt", "updatedAt"
      ) VALUES (
        ${pub.id}, ${pub.sessionId}, ${pub.clientTurnId}, ${pub.role},
        ${pub.status}::"AssistantPublicationStatus", ${pub.attempt},
        ${pub.leaseOwner},
        ${pub.leaseExpiresAt ? new Date(pub.leaseExpiresAt) : null},
        ${pub.draftContent}, ${pub.finalContent}, ${pub.failureCode},
        ${pub.linkedConversationMessageId}, ${pub.provisionalMarkedTemporary},
        ${pub.tombstoneUntil ? new Date(pub.tombstoneUntil) : null},
        ${new Date(pub.createdAt)}, ${new Date(pub.updatedAt)}
      )
      ON CONFLICT ("sessionId", "clientTurnId", "role") DO UPDATE SET
        "status" = EXCLUDED."status",
        "attempt" = EXCLUDED."attempt",
        "leaseOwner" = EXCLUDED."leaseOwner",
        "leaseExpiresAt" = EXCLUDED."leaseExpiresAt",
        "draftContent" = EXCLUDED."draftContent",
        "finalContent" = EXCLUDED."finalContent",
        "failureCode" = EXCLUDED."failureCode",
        "linkedConversationMessageId" = EXCLUDED."linkedConversationMessageId",
        "provisionalMarkedTemporary" = EXCLUDED."provisionalMarkedTemporary",
        "tombstoneUntil" = EXCLUDED."tombstoneUntil",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
    this._pending = null;
  }

  async hydrate(sessionId: string, clientTurnId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sessionId: string;
        clientTurnId: string;
        role: string;
        status: AssistantPublicationRecord["status"];
        attempt: number;
        leaseOwner: string | null;
        leaseExpiresAt: Date | null;
        draftContent: string;
        finalContent: string | null;
        failureCode: string | null;
        linkedConversationMessageId: string | null;
        provisionalMarkedTemporary: boolean;
        tombstoneUntil: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT * FROM "AssistantPublication"
      WHERE "sessionId" = ${sessionId}
        AND "clientTurnId" = ${clientTurnId}
        AND "role" = ${ASSISTANT_ROLE}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return;
    const pub: AssistantPublicationRecord = {
      id: row.id,
      sessionId: row.sessionId,
      clientTurnId: row.clientTurnId,
      role: ASSISTANT_ROLE,
      status: row.status,
      attempt: row.attempt,
      leaseOwner: row.leaseOwner,
      leaseExpiresAt: row.leaseExpiresAt ? row.leaseExpiresAt.getTime() : null,
      draftContent: row.draftContent,
      finalContent: row.finalContent,
      failureCode: row.failureCode,
      linkedConversationMessageId: row.linkedConversationMessageId,
      provisionalMarkedTemporary: row.provisionalMarkedTemporary,
      tombstoneUntil: row.tombstoneUntil ? row.tombstoneUntil.getTime() : null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
    super.putPublication(pub);
  }

  async countDbPublications(sessionId: string, clientTurnId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "AssistantPublication"
      WHERE "sessionId" = ${sessionId} AND "clientTurnId" = ${clientTurnId}
    `;
    return Number(rows[0]?.count ?? 0);
  }
}
