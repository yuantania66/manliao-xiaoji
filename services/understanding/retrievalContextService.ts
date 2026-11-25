import { MessageStatus, Prisma, RelationshipStatus } from "@prisma/client";

import type { RecalledContext, RecalledEvidence } from "@/conversation-os/control/types";
import { prisma } from "@/lib/prisma";
import type { AiConversationMessage } from "@/services/ai/types";

import type { RetrievalCues } from "./understandingTypes";

const COMMITTED_STATUSES: MessageStatus[] = [MessageStatus.SAVED, MessageStatus.REWRITTEN, MessageStatus.FALLBACK];
const RELATIONSHIP_STATUSES: RelationshipStatus[] = [RelationshipStatus.ACTIVE, RelationshipStatus.WEAKENED, RelationshipStatus.USER_CORRECTED];
const SOURCE_SELECT = {
  id: true, userId: true, sessionId: true, role: true, status: true, content: true, createdAt: true, contentDeletedAt: true,
} as const;
const SOURCE_LIMIT = 24;
const CANDIDATE_LIMIT = 3;

type SourceMessage = Prisma.ChatMessageGetPayload<{ select: typeof SOURCE_SELECT }>;

const visibleUserTurns = (userId: string): Prisma.ChatMessageWhereInput => ({
  userId,
  user: { status: "ACTIVE" },
  session: { userId },
  role: "USER",
  status: { in: COMMITTED_STATUSES },
  contentDeletedAt: null,
});

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const explicitPeople = (text: string) => unique(text.match(/妈妈|母亲|爸爸|父亲|女朋友|男朋友|前任|伴侣|丈夫|妻子|同事|领导|朋友/gu) ?? []);
const quotePattern = /[“「『"]([^”」』"\n]{2,48})[”」』"]/gu;
const quotedTerms = (text: string) => [...text.matchAll(quotePattern)].map((match) => match[1]);
const eventTerms = (text: string) => [...text.matchAll(/(?:之前|以前|上次|那次|刚才|还记得|记不记得|记得|引用)(?:提过|说过|提到|说的|聊过|聊的|那个|那件)?的?([^，。！？；\n]{2,24})/gu)]
  .map((match) => match[1].replace(/(?:怎么样|怎么了|现在|后来|了吗|了呢|吗|呢|呀|啊|吧).*$/u, "").replace(/(?:那件事|这件事|的事情|的事)$/u, "").trim())
  .filter((term) => term.length >= 2 && !/^(?:她|他|那个人|那件事|什么|事情|说的|提过)/u.test(term));
const lexicalFragments = (terms: string[]) => unique(terms.flatMap((term) => {
  if (term.length <= 4) return [term];
  const fragments = Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2))
    .filter((fragment) => !/[的我你他她这那]/u.test(fragment));
  return [term, ...fragments];
}));
const recallRequest = /^(?:(?:请|麻烦|能不能|能|可以|你|帮我)\s*){0,4}(?:找回|找一下|找找|查找|查一下|翻一下|翻看|回顾|回忆|复述|还记得|记不记得|继续聊|接着聊)(?:一下)?\s*(?:我们?|你)?(?:之前|以前|更早|上次|那次|刚才)(?=说|提|聊|谈|发|写)/u;
const cancelledRecall = /(?:不要|不用|不必|别)(?:再|帮我)*(?:查|找|翻|回顾|回忆|复述)|算了[。！!\s]*$/u;

const confirmationAfterDays = () => {
  const value = Number(process.env.CHAT_RECALL_CONFIRM_AFTER_DAYS ?? "7");
  return Number.isFinite(value) && value > 0 ? value : 7;
};

/** Re-read original records and their latest raw lifecycle before exposing recall evidence. */
const visibleSources = async (
  userId: string,
  sources: SourceMessage[],
  cutoff: Date,
  currentId: string,
  db: Pick<Prisma.TransactionClient, "chatMessage" | "rawMemory"> = prisma,
) => {
  if (!sources.length) return [];
  const ids = unique(sources.map((source) => source.id));
  const [reread, rawMemories] = await Promise.all([
    db.chatMessage.findMany({
      where: { ...visibleUserTurns(userId), id: { in: ids, not: currentId }, createdAt: { lt: cutoff } },
      select: SOURCE_SELECT,
      take: ids.length,
    }),
    db.rawMemory.findMany({
      where: { userId, sourceType: "CHAT_MESSAGE", sourceId: { in: ids } },
      orderBy: [{ sourceId: "asc" }, { sourceRevision: "desc" }, { createdAt: "desc" }],
      distinct: ["sourceId"],
      take: ids.length,
      select: {
        sourceId: true,
        sourceRevision: true,
        content: true,
        events: {
          where: { userId, eventType: { in: ["TOMBSTONE", "REDACTION", "REDACTION_REQUESTED", "RESTORED"] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { eventType: true },
        },
      },
    }),
  ]);
  const sourceById = new Map(reread.map((source) => [source.id, source]));
  const rawBySource = new Map(rawMemories.map((raw) => [raw.sourceId, raw]));
  return sources.flatMap((candidate) => {
    const source = sourceById.get(candidate.id);
    if (!source || source.userId !== userId || source.sessionId !== candidate.sessionId || source.id === currentId ||
      source.role !== "USER" || !COMMITTED_STATUSES.includes(source.status) || source.contentDeletedAt !== null ||
      !source.content.trim() || source.createdAt >= cutoff || source.content !== candidate.content ||
      source.createdAt.getTime() !== candidate.createdAt.getTime()) return [];
    const raw = rawBySource.get(source.id);
    const lifecycle = raw?.events[0]?.eventType;
    if (raw && (raw.content !== source.content || lifecycle === "TOMBSTONE" || lifecycle === "REDACTION" || lifecycle === "REDACTION_REQUESTED")) return [];
    return [source];
  });
};

/** Local/DB retrieval only: hints and original sources never claim an extracted fact or identity. */
export const buildConversationRetrievalContext = async ({
  userId,
  sessionId,
  currentMessage,
  recentMessages,
}: {
  userId: string;
  sessionId: string;
  currentMessage: { id: string; content: string; createdAt: Date | string };
  recentMessages: AiConversationMessage[];
}): Promise<{ cues: RetrievalCues; recalledContext: RecalledContext | null }> => {
  const text = currentMessage.content;
  const quotes = quotedTerms(text);
  const namedTopics = eventTerms(text).filter((topic) => !explicitPeople(topic).includes(topic));
  const explicitTopics = unique([...quotes, ...namedTopics]).slice(0, 6);
  const localCues: RetrievalCues = { people: explicitPeople(text), topics: explicitTopics, emotions: [], text };
  const empty = (cues = localCues) => ({ cues, recalledContext: null });

  // A mention of the past is not itself a request to read additional messages.
  if (!recallRequest.test(text.trimStart()) || cancelledRecall.test(text.replace(quotePattern, " ")) || !explicitTopics.length) return empty();
  const hasVisibleOriginals = quotes.length > 0 && quotes.every((quote) => recentMessages.some((message) =>
    message.role === "user" && message.status !== "blocked" && message.content.trim() === quote.trim()
  ));
  if (hasVisibleOriginals) return empty();

  const cutoff = new Date(currentMessage.createdAt);
  if (!userId || !sessionId || !currentMessage.id || !text.trim() || !Number.isFinite(cutoff.getTime())) return empty();

  try {
    // Accept historical lookups only for the active account's exact persisted current turn.
    const currentScope: Prisma.ChatMessageWhereInput = {
      ...visibleUserTurns(userId),
      id: currentMessage.id,
      sessionId,
      content: text,
      createdAt: cutoff,
    };
    const findCurrent = (db: Pick<Prisma.TransactionClient, "chatMessage"> = prisma) =>
      db.chatMessage.findFirst({ where: currentScope, select: { id: true } });
    if (!await findCurrent()) return empty();

    const cues = { ...localCues };
    const relationships = await prisma.relationship.findMany({
      where: { userId, user: { status: "ACTIVE" }, status: { in: RELATIONSHIP_STATUSES }, currentVersionId: { not: null } },
      select: { id: true, userId: true, status: true, currentVersionId: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 40,
    });
    const versionIds = relationships.flatMap(({ currentVersionId }) => currentVersionId ? [currentVersionId] : []);
    const versions = versionIds.length ? await prisma.relationshipVersion.findMany({
      where: {
        id: { in: versionIds },
        userId,
        user: { status: "ACTIVE" },
        relationship: { userId },
        status: { in: RELATIONSHIP_STATUSES },
      },
      select: { id: true, userId: true, relationshipId: true, status: true, displayName: true, identityLabel: true },
      take: versionIds.length,
    }) : [];
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const storedNames = unique(relationships.flatMap((relationship) => {
      const version = relationship.currentVersionId ? versionById.get(relationship.currentVersionId) : undefined;
      if (relationship.userId !== userId || !RELATIONSHIP_STATUSES.includes(relationship.status) || !version ||
        version.id !== relationship.currentVersionId || version.userId !== userId || version.relationshipId !== relationship.id ||
        !RELATIONSHIP_STATUSES.includes(version.status)) return [];
      return [version.displayName, version.identityLabel ?? ""].filter((name) => name.length >= 2 && name.length <= 48);
    }));
    const directNames = storedNames.filter((name) => text.includes(name));
    cues.people = unique([...cues.people, ...directNames]).slice(0, 12);

    const beforeCurrent: Prisma.ChatMessageWhereInput = {
      ...visibleUserTurns(userId),
      id: { not: currentMessage.id },
      createdAt: { lt: cutoff },
    };
    const recentIds = unique(recentMessages.slice(-24).filter((message) => message.role === "user" && message.id !== currentMessage.id)
      .flatMap((message) => message.id ? [message.id] : []));
    const recent = recentIds.length ? await prisma.chatMessage.findMany({
      where: { ...beforeCurrent, sessionId, id: { in: recentIds, not: currentMessage.id } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: SOURCE_SELECT,
      take: SOURCE_LIMIT,
    }) : [];
    const recentVisible = await visibleSources(userId, recent, cutoff, currentMessage.id);
    const recentText = recentVisible.map((source) => source.content).join("\n");
    const recentPeople = unique([...explicitPeople(recentText), ...storedNames.filter((name) => recentText.includes(name))]);
    // These are competing retrieval names, never a pronoun resolution or a current relationship.
    // Literal fragments can find a name without a Relationship index; they do not become person identities.
    const directTerms = unique([...cues.people, ...lexicalFragments(explicitTopics)]).slice(0, 8);
    const terms = unique([...directTerms, ...recentPeople]).slice(0, 12);
    const matching = (source: SourceMessage) => {
      const anchors = directTerms.length ? directTerms : terms;
      return anchors.length === 0 || anchors.some((term) => source.content.includes(term));
    };
    let candidates = recentVisible.filter(matching);
    if (candidates.length === 0 || /之前|以前|更早|上次|那次|还记得/u.test(text)) {
      const older = await prisma.chatMessage.findMany({
        where: {
          ...beforeCurrent,
          sessionId,
          id: { notIn: [...recentIds, currentMessage.id] },
          ...(terms.length ? { OR: terms.map((term) => ({ content: { contains: term } })) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: SOURCE_SELECT,
        take: SOURCE_LIMIT,
      });
      candidates.push(...await visibleSources(userId, older, cutoff, currentMessage.id));
    }
    candidates = candidates.filter(matching);
    if (candidates.length === 0 && directTerms.length > 0) {
      const crossSession = await prisma.chatMessage.findMany({
        where: {
          ...beforeCurrent,
          sessionId: { not: sessionId },
          OR: directTerms.map((term) => ({ content: { contains: term } })),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: SOURCE_SELECT,
        take: SOURCE_LIMIT,
      });
      candidates = await visibleSources(userId, crossSession, cutoff, currentMessage.id);
    }
    const matchedTerms = (source: SourceMessage) => terms.filter((term) => source.content.includes(term));
    const seen = new Set<string>();
    candidates = candidates.filter((source) => {
      if (seen.has(source.id)) return false;
      seen.add(source.id);
      return matching(source);
    }).sort((left, right) => {
      const directScore = (source: SourceMessage) => directTerms.filter((term) => source.content.includes(term)).length;
      return directScore(right) - directScore(left) || matchedTerms(right).length - matchedTerms(left).length ||
        right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
    }).slice(0, CANDIDATE_LIMIT);
    if (!candidates.length) return empty(cues);
    // Original turns and raw privacy events must agree at the final retrieval boundary.
    const verified = await prisma.$transaction(async (tx) => {
      if (!await findCurrent(tx)) return null;
      return visibleSources(userId, candidates, cutoff, currentMessage.id, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!verified) return empty();
    if (!verified.length) return empty(cues);
    candidates = verified;
    const personCandidates = unique([...cues.people, ...recentPeople]).filter((name) =>
      text.includes(name) || candidates.some((source) => source.content.includes(name)));
    cues.people = personCandidates.slice(0, 12);
    const evidence: RecalledEvidence[] = candidates.map((source) => ({
      sourceTurnId: source.id,
      sourceConversationId: source.sessionId,
      role: "user",
      text: source.content,
      createdAt: source.createdAt.toISOString(),
      matchedTerms: matchedTerms(source),
    }));
    return {
      cues,
      recalledContext: {
        referenceText: text,
        currentTurnCreatedAt: cutoff.toISOString(),
        candidates: evidence,
        personCandidates,
        confirmationAfterDays: confirmationAfterDays(),
      },
    };
  } catch {
    // Optional recall cannot turn a database enhancement failure into a failed chat turn.
    return empty();
  }
};
