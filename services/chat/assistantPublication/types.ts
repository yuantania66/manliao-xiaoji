export const LEASE_MS = 30_000;
export const MAX_ATTEMPT = 3;
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ASSISTANT_ROLE = "assistant" as const;

export type PublicationStatus =
  | "reserved"
  | "streaming"
  | "committed"
  | "failed_retryable"
  | "failed_terminal";

export type ConversationRole = "user" | "assistant";

export type ConversationMessage = {
  id: string;
  sessionId: string;
  clientTurnId: string;
  role: ConversationRole;
  content: string;
  deleted: boolean;
  createdAt: number;
};

export type AssistantPublicationRecord = {
  id: string;
  sessionId: string;
  clientTurnId: string;
  role: typeof ASSISTANT_ROLE;
  status: PublicationStatus;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  draftContent: string;
  finalContent: string | null;
  failureCode: string | null;
  linkedConversationMessageId: string | null;
  provisionalMarkedTemporary: boolean;
  tombstoneUntil: number | null;
  createdAt: number;
  updatedAt: number;
};

export type IngressResult =
  | {
      kind: "ok";
      action:
        | "created"
        | "attached"
        | "takeover"
        | "replay_committed"
        | "deleted"
        | "retry_same_row"
        | "terminal";
      publication: AssistantPublicationRecord;
      user: ConversationMessage;
      success: boolean;
      regenerated: boolean;
      body: string | null;
      /** Client-facing: provisional segments are temporary until committed. */
      provisional: boolean;
      provisionalMarkedTemporary: boolean;
      failureCode?: string | null;
    }
  | {
      kind: "error";
      success: false;
      code: string;
    };

export type CommitOutcome =
  | {
      success: true;
      finalContent: string;
      publication: AssistantPublicationRecord;
    }
  | {
      success: false;
      reason: string;
      publication: AssistantPublicationRecord;
    };

export type Clock = { now: number };

export const USER_COPY = Object.freeze({
  reconnect: "连接恢复中，正在同步未确认回复…",
  takeover: "回复中断，正在重新接上（仍是同一条回复）…",
  provisional: "临时内容，确认后才会保留",
  terminal: "这次回复没能完成，请稍后再试",
  deleted: "这条回复已被删除",
});
