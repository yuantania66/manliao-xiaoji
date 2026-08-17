import assert from "node:assert/strict";

import type {
  AssistantPublicationRecord,
  CommitOutcome,
  ConversationMessage,
  IngressResult,
} from "./types";
import {
  ASSISTANT_ROLE,
  LEASE_MS,
  MAX_ATTEMPT,
  TOMBSTONE_RETENTION_MS,
} from "./types";
import type { PublicationStore } from "./store";
import { pubKey } from "./store";

export function clonePub(p: AssistantPublicationRecord): AssistantPublicationRecord {
  return { ...p };
}

function touch(pub: AssistantPublicationRecord, now: number): void {
  pub.updatedAt = now;
}

export function leaseLive(pub: AssistantPublicationRecord, now: number): boolean {
  return pub.leaseExpiresAt !== null && pub.leaseExpiresAt > now;
}

function ensureUser(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  userText: string,
): ConversationMessage {
  const existing = store.getUser(sessionId, clientTurnId);
  if (existing) return existing;
  const user: ConversationMessage = {
    id: store.nextId("user"),
    sessionId,
    clientTurnId,
    role: "user",
    content: userText,
    deleted: false,
    createdAt: store.clock.now,
  };
  store.putUser(user);
  return user;
}

function createReserved(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  workerId: string,
): AssistantPublicationRecord {
  assert.equal(
    store.getPublication(sessionId, clientTurnId),
    null,
    "second assistant publication forbidden",
  );
  const pub: AssistantPublicationRecord = {
    id: store.nextId("pub"),
    sessionId,
    clientTurnId,
    role: ASSISTANT_ROLE,
    status: "reserved",
    attempt: 1,
    leaseOwner: workerId,
    leaseExpiresAt: store.clock.now + LEASE_MS,
    draftContent: "",
    finalContent: null,
    failureCode: null,
    linkedConversationMessageId: null,
    provisionalMarkedTemporary: true,
    tombstoneUntil: null,
    createdAt: store.clock.now,
    updatedAt: store.clock.now,
  };
  store.putPublication(pub);
  return pub;
}

function acquireSameRow(
  pub: AssistantPublicationRecord,
  workerId: string,
  now: number,
  opts?: { clearDraft?: boolean },
): void {
  assert(pub.attempt < MAX_ATTEMPT, "max attempt must be enforced before acquire");
  pub.attempt += 1;
  pub.leaseOwner = workerId;
  pub.leaseExpiresAt = now + LEASE_MS;
  pub.status = "reserved";
  pub.failureCode = null;
  if (opts?.clearDraft) pub.draftContent = "";
  touch(pub, now);
}

function okIngress(
  action: Extract<IngressResult, { kind: "ok" }>["action"],
  pub: AssistantPublicationRecord,
  user: ConversationMessage,
  extras: Partial<Extract<IngressResult, { kind: "ok" }>>,
): IngressResult {
  const provisional = pub.status === "streaming" || pub.status === "reserved";
  return {
    kind: "ok",
    action,
    publication: clonePub(pub),
    user,
    success: extras.success ?? true,
    regenerated: extras.regenerated ?? false,
    body: extras.body ?? null,
    provisional,
    provisionalMarkedTemporary: pub.provisionalMarkedTemporary,
    failureCode: extras.failureCode,
  };
}

/**
 * Idempotent ingress + retry/takeover table (§9).
 * Safety-owned turns share the same Assistant publication row (§14.1).
 */
export function ingress(
  store: PublicationStore,
  args: {
    sessionId: string;
    clientTurnId: string;
    userText: string;
    workerId: string;
  },
): IngressResult {
  const { sessionId, clientTurnId, userText, workerId } = args;
  const user = ensureUser(store, sessionId, clientTurnId, userText);
  let pub = store.getPublication(sessionId, clientTurnId);
  const now = store.clock.now;

  if (!pub) {
    pub = createReserved(store, sessionId, clientTurnId, workerId);
    return okIngress("created", pub, user, { body: null });
  }

  if (
    pub.tombstoneUntil !== null &&
    pub.tombstoneUntil > now &&
    pub.status === "failed_terminal" &&
    pub.failureCode === "deleted"
  ) {
    return okIngress("deleted", pub, user, {
      body: null,
      failureCode: "deleted",
    });
  }

  switch (pub.status) {
    case "reserved":
    case "streaming": {
      if (leaseLive(pub, now)) {
        return okIngress("attached", pub, user, {
          body: pub.draftContent || null,
        });
      }
      if (pub.attempt >= MAX_ATTEMPT) {
        pub.status = "failed_terminal";
        pub.failureCode = "max_attempt";
        pub.leaseOwner = null;
        pub.leaseExpiresAt = null;
        touch(pub, now);
        store.putPublication(pub);
        return okIngress("terminal", pub, user, {
          success: false,
          body: null,
          failureCode: "max_attempt",
        });
      }
      acquireSameRow(pub, workerId, now, { clearDraft: pub.status === "streaming" });
      store.putPublication(pub);
      return okIngress("takeover", pub, user, { body: null });
    }
    case "committed": {
      const linked = pub.linkedConversationMessageId
        ? store.getAssistantMessage(pub.linkedConversationMessageId)
        : null;
      if (!linked || linked.deleted) {
        return okIngress("deleted", pub, user, {
          body: null,
          failureCode: "deleted",
        });
      }
      return okIngress("replay_committed", pub, user, {
        body: pub.finalContent,
        provisional: false,
      });
    }
    case "failed_retryable": {
      if (pub.attempt >= MAX_ATTEMPT) {
        pub.status = "failed_terminal";
        pub.failureCode = "max_attempt";
        pub.leaseOwner = null;
        pub.leaseExpiresAt = null;
        touch(pub, now);
        store.putPublication(pub);
        return okIngress("terminal", pub, user, {
          success: false,
          body: null,
          failureCode: "max_attempt",
        });
      }
      acquireSameRow(pub, workerId, now);
      store.putPublication(pub);
      return okIngress("retry_same_row", pub, user, { body: null });
    }
    case "failed_terminal": {
      return okIngress("terminal", pub, user, {
        success: false,
        body: null,
        failureCode: pub.failureCode,
      });
    }
  }
}

export function startStreaming(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  workerId: string,
): AssistantPublicationRecord {
  const pub = store.getPublication(sessionId, clientTurnId);
  assert(pub, "publication missing");
  assert.equal(pub.leaseOwner, workerId, "only lease owner may stream");
  assert(leaseLive(pub, store.clock.now), "lease must be live to stream");
  assert(pub.status === "reserved" || pub.status === "streaming");
  pub.status = "streaming";
  pub.leaseExpiresAt = store.clock.now + LEASE_MS;
  touch(pub, store.clock.now);
  store.putPublication(pub);
  return pub;
}

/** Only Safety-accepted provisional segments may append. */
export function appendProvisional(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  workerId: string,
  segment: string,
  safetyAccepted: boolean,
): {
  emitted: boolean;
  publication: AssistantPublicationRecord;
  provisionalMarkedTemporary: boolean;
} {
  const pub = store.getPublication(sessionId, clientTurnId);
  assert(pub);
  assert.equal(pub.leaseOwner, workerId);
  assert.equal(pub.status, "streaming");
  assert(pub.provisionalMarkedTemporary, "provisional must be marked temporary");
  if (!safetyAccepted) {
    return {
      emitted: false,
      publication: clonePub(pub),
      provisionalMarkedTemporary: true,
    };
  }
  pub.draftContent = pub.draftContent ? `${pub.draftContent}${segment}` : segment;
  pub.leaseExpiresAt = store.clock.now + LEASE_MS;
  touch(pub, store.clock.now);
  store.putPublication(pub);
  return {
    emitted: true,
    publication: clonePub(pub),
    provisionalMarkedTemporary: true,
  };
}

/** Replace streaming draft (same lease / same winner row) — used for intent-conditioned rewrite. */
export function replaceProvisionalDraft(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  workerId: string,
  nextDraft: string,
  safetyAccepted: boolean,
): {
  emitted: boolean;
  publication: AssistantPublicationRecord;
  provisionalMarkedTemporary: boolean;
} {
  const pub = store.getPublication(sessionId, clientTurnId);
  assert(pub);
  assert.equal(pub.leaseOwner, workerId);
  assert.equal(pub.status, "streaming");
  assert(pub.provisionalMarkedTemporary, "provisional must be marked temporary");
  if (!safetyAccepted) {
    return {
      emitted: false,
      publication: clonePub(pub),
      provisionalMarkedTemporary: true,
    };
  }
  pub.draftContent = nextDraft;
  pub.leaseExpiresAt = store.clock.now + LEASE_MS;
  touch(pub, store.clock.now);
  store.putPublication(pub);
  return {
    emitted: true,
    publication: clonePub(pub),
    provisionalMarkedTemporary: true,
  };
}

export function commitFinal(
  store: PublicationStore,
  args: {
    sessionId: string;
    clientTurnId: string;
    workerId: string;
    finalContent: string;
    outputSafetyPass: boolean;
    conversationCommitOk: boolean;
  },
): CommitOutcome {
  const pub = store.getPublication(args.sessionId, args.clientTurnId);
  assert(pub);
  assert.equal(pub.leaseOwner, args.workerId);
  assert(pub.status === "streaming" || pub.status === "reserved");

  if (!args.outputSafetyPass) {
    pub.status = "failed_terminal";
    pub.failureCode = "output_safety_reject";
    pub.leaseOwner = null;
    pub.leaseExpiresAt = null;
    touch(pub, store.clock.now);
    store.putPublication(pub);
    return {
      success: false,
      reason: "output_safety_reject",
      publication: clonePub(pub),
    };
  }

  if (!args.conversationCommitOk) {
    // Commit failure must never report success.
    pub.status = "failed_retryable";
    pub.failureCode = "conversation_commit_failed";
    pub.leaseOwner = null;
    pub.leaseExpiresAt = null;
    touch(pub, store.clock.now);
    store.putPublication(pub);
    return {
      success: false,
      reason: "conversation_commit_failed",
      publication: clonePub(pub),
    };
  }

  const assistantMsg: ConversationMessage = {
    id: store.nextId("asst"),
    sessionId: args.sessionId,
    clientTurnId: args.clientTurnId,
    role: "assistant",
    content: args.finalContent,
    deleted: false,
    createdAt: store.clock.now,
  };
  store.putAssistantMessage(assistantMsg);

  pub.status = "committed";
  pub.finalContent = args.finalContent;
  pub.linkedConversationMessageId = assistantMsg.id;
  pub.leaseOwner = null;
  pub.leaseExpiresAt = null;
  pub.failureCode = null;
  touch(pub, store.clock.now);
  store.putPublication(pub);
  return {
    success: true,
    finalContent: args.finalContent,
    publication: clonePub(pub),
  };
}

/** Mark live reserved/streaming as retryable failure (e.g. missing model config). */
export function markFailedRetryable(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  failureCode: string,
): AssistantPublicationRecord {
  const pub = store.getPublication(sessionId, clientTurnId);
  assert(pub);
  assert(pub.status === "reserved" || pub.status === "streaming");
  pub.status = "failed_retryable";
  pub.failureCode = failureCode;
  pub.leaseOwner = null;
  pub.leaseExpiresAt = null;
  touch(pub, store.clock.now);
  store.putPublication(pub);
  return clonePub(pub);
}

/** Safety-owned reply still uses the same Assistant publication row. */
export function commitSafetyOwned(
  store: PublicationStore,
  args: {
    sessionId: string;
    clientTurnId: string;
    workerId: string;
    safetyReply: string;
  },
): CommitOutcome {
  return commitFinal(store, {
    sessionId: args.sessionId,
    clientTurnId: args.clientTurnId,
    workerId: args.workerId,
    finalContent: args.safetyReply,
    outputSafetyPass: true,
    conversationCommitOk: true,
  });
}

export function deleteCommittedAssistant(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
): void {
  const pub = store.getPublication(sessionId, clientTurnId);
  assert(pub);
  assert.equal(pub.status, "committed");
  if (pub.linkedConversationMessageId) {
    const msg = store.getAssistantMessage(pub.linkedConversationMessageId);
    if (msg) {
      msg.deleted = true;
      store.putAssistantMessage(msg);
    }
  }
  pub.draftContent = "";
  pub.finalContent = null;
  pub.tombstoneUntil = store.clock.now + TOMBSTONE_RETENTION_MS;
  // Keep status committed for linked-deleted replay path; failureCode not required
  // for deleted committed retry (ingress checks linked message).
  touch(pub, store.clock.now);
  store.putPublication(pub);
}

export function expireLease(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
): void {
  const pub = store.getPublication(sessionId, clientTurnId);
  assert(pub);
  assert(pub.leaseExpiresAt !== null);
  store.clock.now = pub.leaseExpiresAt;
}

export function assertInvariants(
  store: PublicationStore,
  sessionId: string,
  clientTurnId: string,
  label: string,
): void {
  assert.equal(
    store.countAssistantPublications(sessionId, clientTurnId),
    1,
    `${label}: exactly one assistant publication`,
  );
  assert.equal(store.countUsers(sessionId, clientTurnId), 1, `${label}: user row must exist`);
}

export { pubKey, LEASE_MS, MAX_ATTEMPT, TOMBSTONE_RETENTION_MS };
