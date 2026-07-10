import {
  EvidenceRole,
  EvidenceTargetType,
  EvidenceType,
  MessageRole,
  MessageStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createEvidenceFromRawMemory } from "@/services/memory/evidenceService";
import { createRawMemoryFromChatMessage } from "@/services/memory/rawMemoryService";

import { dispatchEvidenceToProjections } from "./projectionDispatcher";
import {
  createDefaultProjectionRegistry,
  semanticProjection,
} from "./projectionRegistry";
import { runProjection } from "./projectionRunner";
import { MemoryProjection, ProjectionLogger } from "./projectionTypes";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const silentLogger: ProjectionLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const extensionStubProjection: MemoryProjection = {
  projectionName: "ExtensionStubProjection",
  supportedEvidenceTypes: () => [],
  shouldProject: () => false,
  project: async () => {
    throw new Error("Extension stub should not project.");
  },
  createVersion: async () => {
    throw new Error("Extension stub should not create versions.");
  },
  updateCurrentVersion: async () => {
    throw new Error("Extension stub should not update current versions.");
  },
};

const main = async () => {
  const user = await prisma.user.create({
    data: {
      phone: `projection-framework-${Date.now()}`,
      nickname: "projection-framework-check",
    },
    select: { id: true },
  });

  try {
    const session = await prisma.chatSession.create({
      data: { userId: user.id, title: "projection-framework-check" },
      select: { id: true },
    });
    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        role: MessageRole.USER,
        status: MessageStatus.SAVED,
        content: "Projection framework check raw memory.",
      },
      select: { id: true },
    });
    const rawMemory = await createRawMemoryFromChatMessage({
      chatMessageId: message.id,
      metadata: { check: "projection-framework" },
    });
    const evidence = await createEvidenceFromRawMemory({
      rawMemoryId: rawMemory.id,
      evidenceType: EvidenceType.RAW_SEGMENTATION,
      evidenceText: JSON.stringify({
        algorithm: "projection_framework_check",
        rawMemoryId: rawMemory.id,
        segmentCount: 1,
      }),
      confidence: 0.5,
      weight: 0.5,
    });

    const registry = createDefaultProjectionRegistry();
    const registeredNames = registry.list().map((projection) => projection.projectionName).sort();
    assert(registeredNames.includes("SemanticProjection"), "Registry should include SemanticProjection");
    assert(registeredNames.includes("TimelineProjection"), "Registry should include TimelineProjection");
    assert(registeredNames.includes("UnderstandingProjection"), "Registry should include UnderstandingProjection");
    assert(registeredNames.includes("RelationshipProjection"), "Registry should include RelationshipProjection");

    registry.register(extensionStubProjection);
    assert(
      registry.get("ExtensionStubProjection")?.projectionName === "ExtensionStubProjection",
      "Registry should support extension registration"
    );

    const semanticRun = await runProjection({
      evidenceId: evidence.id,
      projection: semanticProjection,
      logger: silentLogger,
    });
    assert(semanticRun.status === "created", "Runner should create semantic projection");
    assert(semanticRun.projectionId, "Semantic projection should return projectionId");
    assert(semanticRun.versionId, "Semantic projection should return versionId");
    assert(semanticRun.evidenceLinks.length === 2, "Semantic projection should create parent and version evidence links");

    const semanticMemory = await prisma.semanticMemory.findUniqueOrThrow({
      where: { projectionEvidenceId: evidence.id },
      include: { currentVersionRecord: true },
    });
    assert(semanticMemory.currentVersionId === semanticRun.versionId, "Semantic currentVersionId should point to version");
    assert(semanticMemory.currentVersionRecord?.id === semanticRun.versionId, "Semantic current version should load");

    const duplicateRun = await runProjection({
      evidenceId: evidence.id,
      projection: semanticProjection,
      logger: silentLogger,
    });
    assert(duplicateRun.status === "skipped", "Duplicate semantic projection should skip");
    assert(duplicateRun.reason === "already_projected", "Duplicate semantic projection should be idempotent");

    const dispatchResults = await dispatchEvidenceToProjections({
      evidence,
      registry,
      logger: silentLogger,
    });
    const semanticDispatch = dispatchResults.find((result) => result.projectionName === "SemanticProjection");
    const timelineDispatch = dispatchResults.find((result) => result.projectionName === "TimelineProjection");
    const understandingDispatch = dispatchResults.find((result) => result.projectionName === "UnderstandingProjection");
    const relationshipDispatch = dispatchResults.find((result) => result.projectionName === "RelationshipProjection");
    const extensionDispatch = dispatchResults.find((result) => result.projectionName === "ExtensionStubProjection");
    if (!semanticDispatch) throw new Error("SemanticProjection dispatch result should exist");
    if (!timelineDispatch) throw new Error("TimelineProjection dispatch result should exist");
    if (!understandingDispatch) throw new Error("UnderstandingProjection dispatch result should exist");
    if (!relationshipDispatch) throw new Error("RelationshipProjection dispatch result should exist");
    if (!extensionDispatch) throw new Error("ExtensionStubProjection dispatch result should exist");

    assert(semanticDispatch.status === "skipped", "Dispatcher should route SemanticProjection idempotently");
    assert(timelineDispatch.status === "created", "Dispatcher should route TimelineProjection");
    assert(timelineDispatch.projectionId, "TimelineProjection should return projectionId");
    assert(timelineDispatch.versionId, "TimelineProjection should return versionId");
    assert(
      timelineDispatch.evidenceLinks.length === 2,
      "TimelineProjection should create parent and version evidence links"
    );
    assert(understandingDispatch.status === "created", "Dispatcher should route UnderstandingProjection");
    assert(understandingDispatch.projectionId, "UnderstandingProjection should return projectionId");
    assert(understandingDispatch.versionId, "UnderstandingProjection should return versionId");
    assert(
      understandingDispatch.evidenceLinks.length === 2,
      "UnderstandingProjection should create parent and version evidence links"
    );
    assert(relationshipDispatch.status === "skipped", "RelationshipProjection without person candidates should skip");
    assert(extensionDispatch.status === "skipped", "Unsupported extension projection should skip");

    const timelineEvent = await prisma.timelineEvent.findUniqueOrThrow({
      where: { id: timelineDispatch.projectionId },
      include: { currentVersionRecord: true },
    });
    assert(
      timelineEvent.currentVersionId === timelineDispatch.versionId,
      "Timeline currentVersionId should point to version"
    );
    assert(timelineEvent.currentVersionRecord?.id === timelineDispatch.versionId, "Timeline current version should load");
    const timelineLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.TIMELINE_EVENT,
        targetId: timelineEvent.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(timelineLinkCount === 1, "TimelineProjection should create a TimelineEvent evidence link");

    const understanding = await prisma.understanding.findUniqueOrThrow({
      where: { id: understandingDispatch.projectionId },
      include: { currentVersionRecord: true },
    });
    assert(
      understanding.currentVersionId === understandingDispatch.versionId,
      "Understanding currentVersionId should point to version"
    );
    assert(
      understanding.currentVersionRecord?.id === understandingDispatch.versionId,
      "Understanding current version should load"
    );
    assert(
      understanding.understanding === semanticMemory.currentVersionRecord?.content,
      "Understanding summary should come from SemanticMemory current version"
    );
    const understandingLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.UNDERSTANDING,
        targetId: understanding.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(understandingLinkCount === 1, "UnderstandingProjection should create an Understanding evidence link");

    const duplicateDispatchResults = await dispatchEvidenceToProjections({
      evidence,
      registry,
      logger: silentLogger,
    });
    const duplicateTimelineDispatch = duplicateDispatchResults.find(
      (result) => result.projectionName === "TimelineProjection"
    );
    const duplicateUnderstandingDispatch = duplicateDispatchResults.find(
      (result) => result.projectionName === "UnderstandingProjection"
    );
    assert(duplicateTimelineDispatch?.status === "skipped", "Duplicate TimelineProjection should skip");
    assert(
      duplicateTimelineDispatch?.projectionId === timelineEvent.id,
      "Duplicate TimelineProjection should return existing TimelineEvent"
    );
    assert(duplicateUnderstandingDispatch?.status === "skipped", "Duplicate UnderstandingProjection should skip");
    assert(
      duplicateUnderstandingDispatch?.projectionId === understanding.id,
      "Duplicate UnderstandingProjection should return existing Understanding"
    );

    console.log("Projection framework checks passed");
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
