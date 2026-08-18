import type {
  AssistantPublicationRecord,
  Clock,
  ConversationMessage,
} from "./types";
import { ASSISTANT_ROLE } from "./types";

export function pubKey(sessionId: string, clientTurnId: string): string {
  return `${sessionId}::${clientTurnId}::${ASSISTANT_ROLE}`;
}

export function userKey(sessionId: string, clientTurnId: string): string {
  return `${sessionId}::${clientTurnId}::user`;
}

export interface PublicationStore {
  readonly clock: Clock;
  nextId(prefix: string): string;
  getUser(sessionId: string, clientTurnId: string): ConversationMessage | null;
  putUser(user: ConversationMessage): void;
  getPublication(
    sessionId: string,
    clientTurnId: string,
  ): AssistantPublicationRecord | null;
  putPublication(pub: AssistantPublicationRecord): void;
  getAssistantMessage(id: string): ConversationMessage | null;
  putAssistantMessage(msg: ConversationMessage): void;
  countAssistantPublications(sessionId: string, clientTurnId: string): number;
  countUsers(sessionId: string, clientTurnId: string): number;
  listLiveZombies(): AssistantPublicationRecord[];
}

export class MemoryPublicationStore implements PublicationStore {
  readonly users = new Map<string, ConversationMessage>();
  readonly assistants = new Map<string, ConversationMessage>();
  readonly publications = new Map<string, AssistantPublicationRecord>();
  seq = 0;

  constructor(readonly clock: Clock) {}

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  getUser(sessionId: string, clientTurnId: string): ConversationMessage | null {
    return this.users.get(userKey(sessionId, clientTurnId)) ?? null;
  }

  putUser(user: ConversationMessage): void {
    this.users.set(userKey(user.sessionId, user.clientTurnId), user);
  }

  getPublication(
    sessionId: string,
    clientTurnId: string,
  ): AssistantPublicationRecord | null {
    return this.publications.get(pubKey(sessionId, clientTurnId)) ?? null;
  }

  putPublication(pub: AssistantPublicationRecord): void {
    this.publications.set(pubKey(pub.sessionId, pub.clientTurnId), pub);
  }

  getAssistantMessage(id: string): ConversationMessage | null {
    return this.assistants.get(id) ?? null;
  }

  putAssistantMessage(msg: ConversationMessage): void {
    this.assistants.set(msg.id, msg);
  }

  countAssistantPublications(sessionId: string, clientTurnId: string): number {
    let n = 0;
    for (const p of this.publications.values()) {
      if (p.sessionId === sessionId && p.clientTurnId === clientTurnId) n += 1;
    }
    return n;
  }

  countUsers(sessionId: string, clientTurnId: string): number {
    let n = 0;
    for (const u of this.users.values()) {
      if (u.sessionId === sessionId && u.clientTurnId === clientTurnId && !u.deleted) {
        n += 1;
      }
    }
    return n;
  }

  listLiveZombies(): AssistantPublicationRecord[] {
    const now = this.clock.now;
    return [...this.publications.values()].filter(
      (p) =>
        (p.status === "reserved" || p.status === "streaming") &&
        p.leaseExpiresAt !== null &&
        p.leaseExpiresAt <= now,
    );
  }
}
