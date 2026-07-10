import {
  EvidenceRole,
  EvidenceTargetType,
  EvidenceType,
  MessageRole,
  MessageStatus,
  RawMemoryKind,
  RawMemorySourceType,
  RefinementStatus,
  RefinementStep,
  RelationshipStatus,
  RelationshipType,
  SemanticMemoryKind,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { listEvidenceForTarget } from "../services/memory/evidenceService";
import { dispatchEvidenceToProjections } from "../services/memory/projection/projectionDispatcher";
import { createRawMemoryFromChatMessage } from "../services/memory/rawMemoryService";
import { claimPendingRefinementJob, createRefinementJobForRawMemory } from "../services/memory/refinementJobService";
import {
  processPendingRefinementJobs,
  processRawCapturedJob,
  processRawToSegmentationJob,
} from "../services/memory/refinementWorkerService";
import { listSemanticMemoriesForUser } from "../services/memory/semanticMemoryService";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const createChatRawMemory = async ({ userId, content }: { userId: string; content: string }) => {
  const session = await prisma.chatSession.create({
    data: { userId, title: "memory-v2-raw-worker-check" },
    select: { id: true },
  });

  const message = await prisma.chatMessage.create({
    data: {
      userId,
      sessionId: session.id,
      role: MessageRole.USER,
      status: MessageStatus.SAVED,
      content,
    },
    select: { id: true },
  });

  return createRawMemoryFromChatMessage({ chatMessageId: message.id });
};

const createStructuredRawMemoryWithPersonCandidate = async ({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) => {
  const rawMemory = await prisma.rawMemory.create({
    data: {
      userId,
      kind: RawMemoryKind.METADATA,
      sourceType: RawMemorySourceType.SYSTEM,
      sourceId: `relationship-candidate-${Date.now()}`,
      sourceRevision: 1,
      content: `structured person candidate: ${displayName}`,
      payload: {
        personCandidates: [{ displayName }],
        content: "structured deterministic relationship projection check",
      },
      occurredAt: new Date(),
    },
  });

  await createRefinementJobForRawMemory({ rawMemoryId: rawMemory.id });

  return rawMemory;
};

const main = async () => {
  const user = await prisma.user.create({
    data: {
      phone: `memory-v2-worker-${Date.now()}`,
      nickname: "memory-v2-worker-check",
    },
    select: { id: true },
  });

  try {
    const successRaw = await createChatRawMemory({
      userId: user.id,
      content: "今天先验证 RAW_CAPTURED worker 成功路径。",
    });
    const successJob = await prisma.refinementJob.findFirstOrThrow({
      where: {
        rawMemoryId: successRaw.id,
        step: RefinementStep.RAW_CAPTURED,
      },
    });
    assert(successJob.status === RefinementStatus.PENDING, "Worker success job should start as PENDING");

    const pendingResults = await processPendingRefinementJobs({ take: 1000 });
    assert(
      pendingResults.some((result) => result.jobId === successJob.id && result.outcome === "succeeded"),
      "processPendingRefinementJobs should mark the pending RAW_CAPTURED job succeeded"
    );

    const succeededJob = await prisma.refinementJob.findUniqueOrThrow({
      where: { id: successJob.id },
    });
    assert(succeededJob.status === RefinementStatus.SUCCEEDED, "Worker success job should be SUCCEEDED");
    assert(succeededJob.attempt === successJob.attempt + 1, "Worker success job should increment attempt once");
    assert(Boolean(succeededJob.outputSnapshot), "Worker success job should store processing metadata");

    const segmentationJob = await prisma.refinementJob.findFirstOrThrow({
      where: {
        rawMemoryId: successRaw.id,
        step: RefinementStep.RAW_TO_SEGMENTATION,
      },
    });
    assert(
      segmentationJob.status === RefinementStatus.PENDING,
      "RAW_CAPTURED success should create a pending RAW_TO_SEGMENTATION job"
    );

    const skippedResult = await processRawCapturedJob({ jobId: successJob.id });
    assert(skippedResult.outcome === "skipped", "Succeeded job should be skipped on repeat processing");
    assert(
      skippedResult.outcome === "skipped" && skippedResult.reason === "already_succeeded",
      "Succeeded job skip reason should be already_succeeded"
    );
    const repeatedJob = await prisma.refinementJob.findUniqueOrThrow({
      where: { id: successJob.id },
    });
    assert(repeatedJob.attempt === succeededJob.attempt, "Repeated succeeded job should not increment attempt");
    const segmentationJobCount = await prisma.refinementJob.count({
      where: {
        rawMemoryId: successRaw.id,
        step: RefinementStep.RAW_TO_SEGMENTATION,
      },
    });
    assert(segmentationJobCount === 1, `Expected 1 segmentation job, got ${segmentationJobCount}`);

    const segmentationResults = await processPendingRefinementJobs({
      step: RefinementStep.RAW_TO_SEGMENTATION,
      take: 1000,
    });
    assert(
      segmentationResults.some((result) => result.jobId === segmentationJob.id && result.outcome === "succeeded"),
      "RAW_TO_SEGMENTATION job should succeed"
    );
    const succeededSegmentationJob = await prisma.refinementJob.findUniqueOrThrow({
      where: { id: segmentationJob.id },
    });
    assert(
      succeededSegmentationJob.status === RefinementStatus.SUCCEEDED,
      "Segmentation job should be SUCCEEDED"
    );
    assert(
      Boolean(succeededSegmentationJob.outputSnapshot),
      "Segmentation job should store deterministic segmentation metadata"
    );
    const segmentationOutput = succeededSegmentationJob.outputSnapshot as {
      projectionResults?: Array<{ projectionName: string; status: string }>;
    } | null;
    assert(
      segmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "SemanticProjection" && result.status === "created"
      ),
      "RAW_TO_SEGMENTATION should project Evidence through SemanticProjection"
    );
    assert(
      segmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "TimelineProjection" && result.status === "created"
      ),
      "RAW_TO_SEGMENTATION should project Evidence through TimelineProjection"
    );
    assert(
      segmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "UnderstandingProjection" && result.status === "created"
      ),
      "RAW_TO_SEGMENTATION should project Evidence through UnderstandingProjection"
    );
    assert(
      segmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "RelationshipProjection" && result.status === "skipped"
      ),
      "RelationshipProjection should remain skipped"
    );

    const evidence = await prisma.evidence.findFirstOrThrow({
      where: {
        rawMemoryId: successRaw.id,
        evidenceType: EvidenceType.RAW_SEGMENTATION,
      },
    });
    assert(evidence.sourceId === successRaw.id, "Evidence sourceId should point to RawMemory");
    assert(Boolean(evidence.evidenceText), "Evidence should store segmentation metadata text");

    const evidenceLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.RAW_SEGMENTATION,
      targetId: segmentationJob.id,
      role: EvidenceRole.SOURCE,
    });
    assert(evidenceLinks.length === 1, `Expected 1 evidence link, got ${evidenceLinks.length}`);
    assert(evidenceLinks[0]?.evidence.id === evidence.id, "Evidence link target query should include evidence");

    const skippedSegmentationResult = await processRawToSegmentationJob({ jobId: segmentationJob.id });
    assert(
      skippedSegmentationResult.outcome === "skipped" &&
        skippedSegmentationResult.reason === "already_succeeded",
      "Succeeded segmentation job should be skipped on repeat processing"
    );
    const evidenceCount = await prisma.evidence.count({
      where: {
        rawMemoryId: successRaw.id,
        evidenceType: EvidenceType.RAW_SEGMENTATION,
      },
    });
    assert(evidenceCount === 1, `Expected 1 Evidence, got ${evidenceCount}`);
    const evidenceLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.RAW_SEGMENTATION,
        targetId: segmentationJob.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(evidenceLinkCount === 1, `Expected 1 Evidence Link, got ${evidenceLinkCount}`);

    const semanticMemory = await prisma.semanticMemory.findFirstOrThrow({
      where: {
        projectionEvidenceId: evidence.id,
        kind: SemanticMemoryKind.RAW_SEGMENT,
      },
    });
    const semanticMemoryCurrentVersionId = semanticMemory.currentVersionId;
    if (!semanticMemoryCurrentVersionId) throw new Error("SemanticMemory should point to a current version");
    const semanticMemoryVersion = await prisma.semanticMemoryVersion.findUniqueOrThrow({
      where: { id: semanticMemoryCurrentVersionId },
    });
    assert(
      semanticMemoryVersion.semanticMemoryId === semanticMemory.id,
      "Current SemanticMemoryVersion should belong to SemanticMemory"
    );
    assert(semanticMemoryVersion.version === 1, "Initial SemanticMemoryVersion should be version 1");

    const semanticMemoryLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.SEMANTIC_MEMORY,
      targetId: semanticMemory.id,
      role: EvidenceRole.SOURCE,
    });
    assert(semanticMemoryLinks.length === 1, `Expected 1 semantic memory evidence link, got ${semanticMemoryLinks.length}`);
    assert(
      semanticMemoryLinks[0]?.evidence.id === evidence.id,
      "Evidence link target query should include SemanticMemory evidence"
    );
    const semanticVersionLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
      targetId: semanticMemoryVersion.id,
      role: EvidenceRole.SOURCE,
    });
    assert(
      semanticVersionLinks.length === 1,
      `Expected 1 semantic memory version evidence link, got ${semanticVersionLinks.length}`
    );
    assert(
      semanticVersionLinks[0]?.evidence.id === evidence.id,
      "Evidence link target query should include SemanticMemoryVersion evidence"
    );

    const timelineEventLink = await prisma.memoryEvidenceLink.findFirstOrThrow({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.TIMELINE_EVENT,
        role: EvidenceRole.SOURCE,
      },
    });
    const timelineEvent = await prisma.timelineEvent.findUniqueOrThrow({
      where: { id: timelineEventLink.targetId },
    });
    const timelineEventCurrentVersionId = timelineEvent.currentVersionId;
    if (!timelineEventCurrentVersionId) throw new Error("TimelineEvent should point to a current version");
    assert(
      timelineEvent.startDate?.getTime() === successRaw.occurredAt.getTime(),
      "TimelineEvent startDate should come from RawMemory.occurredAt"
    );
    assert(timelineEvent.confidence === evidence.confidence, "TimelineEvent confidence should come from Evidence");
    const timelineEventVersion = await prisma.timelineEventVersion.findUniqueOrThrow({
      where: { id: timelineEventCurrentVersionId },
    });
    assert(
      timelineEventVersion.timelineEventId === timelineEvent.id,
      "Current TimelineEventVersion should belong to TimelineEvent"
    );
    assert(timelineEventVersion.version === 1, "Initial TimelineEventVersion should be version 1");

    const timelineEventLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.TIMELINE_EVENT,
      targetId: timelineEvent.id,
      role: EvidenceRole.SOURCE,
    });
    assert(timelineEventLinks.length === 1, `Expected 1 timeline event evidence link, got ${timelineEventLinks.length}`);
    assert(
      timelineEventLinks[0]?.evidence.id === evidence.id,
      "Evidence link target query should include TimelineEvent evidence"
    );
    const timelineVersionLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.TIMELINE_EVENT_VERSION,
      targetId: timelineEventVersion.id,
      role: EvidenceRole.SOURCE,
    });
    assert(
      timelineVersionLinks.length === 1,
      `Expected 1 timeline event version evidence link, got ${timelineVersionLinks.length}`
    );
    assert(
      timelineVersionLinks[0]?.evidence.id === evidence.id,
      "Evidence link target query should include TimelineEventVersion evidence"
    );

    const understandingLink = await prisma.memoryEvidenceLink.findFirstOrThrow({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.UNDERSTANDING,
        role: EvidenceRole.SOURCE,
      },
    });
    const understanding = await prisma.understanding.findUniqueOrThrow({
      where: { id: understandingLink.targetId },
    });
    const understandingCurrentVersionId = understanding.currentVersionId;
    if (!understandingCurrentVersionId) throw new Error("Understanding should point to a current version");
    assert(understanding.category === "RAW_SEGMENT", "Understanding category should carry RAW_SEGMENT hypothesis type");
    assert(
      understanding.understanding === semanticMemoryVersion.content,
      "Understanding summary should come from SemanticMemory currentVersion content"
    );
    assert(understanding.confidence === evidence.confidence, "Understanding confidence should come from Evidence");
    const understandingVersion = await prisma.understandingVersion.findUniqueOrThrow({
      where: { id: understandingCurrentVersionId },
    });
    assert(
      understandingVersion.understandingId === understanding.id,
      "Current UnderstandingVersion should belong to Understanding"
    );
    assert(understandingVersion.version === 1, "Initial UnderstandingVersion should be version 1");

    const understandingLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.UNDERSTANDING,
      targetId: understanding.id,
      role: EvidenceRole.SOURCE,
    });
    assert(understandingLinks.length === 1, `Expected 1 understanding evidence link, got ${understandingLinks.length}`);
    assert(
      understandingLinks[0]?.evidence.id === evidence.id,
      "Evidence link target query should include Understanding evidence"
    );
    const understandingVersionLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.UNDERSTANDING_VERSION,
      targetId: understandingVersion.id,
      role: EvidenceRole.SOURCE,
    });
    assert(
      understandingVersionLinks.length === 1,
      `Expected 1 understanding version evidence link, got ${understandingVersionLinks.length}`
    );
    assert(
      understandingVersionLinks[0]?.evidence.id === evidence.id,
      "Evidence link target query should include UnderstandingVersion evidence"
    );

    const duplicateProjectionResults = await dispatchEvidenceToProjections({ evidence });
    const duplicateProjection = duplicateProjectionResults.find(
      (result) => result.projectionName === "SemanticProjection"
    );
    const duplicateTimelineProjection = duplicateProjectionResults.find(
      (result) => result.projectionName === "TimelineProjection"
    );
    const duplicateUnderstandingProjection = duplicateProjectionResults.find(
      (result) => result.projectionName === "UnderstandingProjection"
    );
    if (!duplicateProjection) throw new Error("Duplicate SemanticProjection result should exist");
    if (!duplicateTimelineProjection) throw new Error("Duplicate TimelineProjection result should exist");
    if (!duplicateUnderstandingProjection) throw new Error("Duplicate UnderstandingProjection result should exist");
    assert(
      duplicateProjection.status === "skipped" && duplicateProjection.projectionId === semanticMemory.id,
      "Duplicate SemanticProjection dispatch should return existing SemanticMemory without rewriting"
    );
    assert(
      duplicateProjection.versionId === semanticMemoryVersion.id,
      "Duplicate SemanticProjection dispatch should return existing version"
    );
    assert(
      duplicateTimelineProjection.status === "skipped" &&
        duplicateTimelineProjection.projectionId === timelineEvent.id,
      "Duplicate TimelineProjection dispatch should return existing TimelineEvent without rewriting"
    );
    assert(
      duplicateTimelineProjection.versionId === timelineEventVersion.id,
      "Duplicate TimelineProjection dispatch should return existing version"
    );
    assert(
      duplicateUnderstandingProjection.status === "skipped" &&
        duplicateUnderstandingProjection.projectionId === understanding.id,
      "Duplicate UnderstandingProjection dispatch should return existing Understanding without rewriting"
    );
    assert(
      duplicateUnderstandingProjection.versionId === understandingVersion.id,
      "Duplicate UnderstandingProjection dispatch should return existing version"
    );
    assert(
      duplicateProjectionResults.some(
        (result) => result.projectionName === "RelationshipProjection" && result.status === "skipped"
      ),
      "Duplicate dispatch should keep RelationshipProjection skipped"
    );
    const noCandidateRelationshipLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.RELATIONSHIP,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(
      noCandidateRelationshipLinkCount === 0,
      `Expected no Relationship link without person candidates, got ${noCandidateRelationshipLinkCount}`
    );
    const semanticMemoryCount = await prisma.semanticMemory.count({
      where: { projectionEvidenceId: evidence.id },
    });
    assert(semanticMemoryCount === 1, `Expected 1 SemanticMemory, got ${semanticMemoryCount}`);
    const semanticMemoryVersionCount = await prisma.semanticMemoryVersion.count({
      where: { semanticMemoryId: semanticMemory.id },
    });
    assert(
      semanticMemoryVersionCount === 1,
      `Expected 1 SemanticMemoryVersion, got ${semanticMemoryVersionCount}`
    );
    const semanticMemoryLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.SEMANTIC_MEMORY,
        targetId: semanticMemory.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(semanticMemoryLinkCount === 1, `Expected 1 SemanticMemory link, got ${semanticMemoryLinkCount}`);
    const semanticVersionLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
        targetId: semanticMemoryVersion.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(
      semanticVersionLinkCount === 1,
      `Expected 1 SemanticMemoryVersion link, got ${semanticVersionLinkCount}`
    );
    const timelineEventCount = await prisma.timelineEvent.count({
      where: { id: timelineEvent.id },
    });
    assert(timelineEventCount === 1, `Expected 1 TimelineEvent, got ${timelineEventCount}`);
    const timelineEventVersionCount = await prisma.timelineEventVersion.count({
      where: { timelineEventId: timelineEvent.id },
    });
    assert(
      timelineEventVersionCount === 1,
      `Expected 1 TimelineEventVersion, got ${timelineEventVersionCount}`
    );
    const timelineEventLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.TIMELINE_EVENT,
        targetId: timelineEvent.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(timelineEventLinkCount === 1, `Expected 1 TimelineEvent link, got ${timelineEventLinkCount}`);
    const timelineVersionLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.TIMELINE_EVENT_VERSION,
        targetId: timelineEventVersion.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(
      timelineVersionLinkCount === 1,
      `Expected 1 TimelineEventVersion link, got ${timelineVersionLinkCount}`
    );
    const understandingCount = await prisma.understanding.count({
      where: { id: understanding.id },
    });
    assert(understandingCount === 1, `Expected 1 Understanding, got ${understandingCount}`);
    const understandingVersionCount = await prisma.understandingVersion.count({
      where: { understandingId: understanding.id },
    });
    assert(
      understandingVersionCount === 1,
      `Expected 1 UnderstandingVersion, got ${understandingVersionCount}`
    );
    const understandingLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.UNDERSTANDING,
        targetId: understanding.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(understandingLinkCount === 1, `Expected 1 Understanding link, got ${understandingLinkCount}`);
    const understandingVersionLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: evidence.id,
        targetType: EvidenceTargetType.UNDERSTANDING_VERSION,
        targetId: understandingVersion.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(
      understandingVersionLinkCount === 1,
      `Expected 1 UnderstandingVersion link, got ${understandingVersionLinkCount}`
    );

    const semanticMemories = await listSemanticMemoriesForUser({ userId: user.id });
    assert(
      semanticMemories.some((memory) => memory.id === semanticMemory.id),
      "listSemanticMemoriesForUser should include SemanticMemory projection"
    );

    const relationshipRaw = await createStructuredRawMemoryWithPersonCandidate({
      userId: user.id,
      displayName: "Alex",
    });
    const relationshipRawCapturedJob = await prisma.refinementJob.findFirstOrThrow({
      where: {
        rawMemoryId: relationshipRaw.id,
        step: RefinementStep.RAW_CAPTURED,
      },
    });
    const relationshipRawCapturedResult = await processRawCapturedJob({
      jobId: relationshipRawCapturedJob.id,
    });
    assert(
      relationshipRawCapturedResult.outcome === "succeeded",
      "Relationship candidate RAW_CAPTURED should succeed"
    );
    const relationshipSegmentationJob = await prisma.refinementJob.findFirstOrThrow({
      where: {
        rawMemoryId: relationshipRaw.id,
        step: RefinementStep.RAW_TO_SEGMENTATION,
      },
    });
    const relationshipSegmentationResult = await processRawToSegmentationJob({
      jobId: relationshipSegmentationJob.id,
    });
    assert(
      relationshipSegmentationResult.outcome === "succeeded",
      "Relationship candidate RAW_TO_SEGMENTATION should succeed"
    );
    const relationshipSegmentationJobAfter = await prisma.refinementJob.findUniqueOrThrow({
      where: { id: relationshipSegmentationJob.id },
    });
    const relationshipSegmentationOutput = relationshipSegmentationJobAfter.outputSnapshot as {
      projectionResults?: Array<{ projectionName: string; status: string }>;
    } | null;
    assert(
      relationshipSegmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "SemanticProjection" && result.status === "created"
      ),
      "Relationship candidate flow should still run SemanticProjection"
    );
    assert(
      relationshipSegmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "TimelineProjection" && result.status === "created"
      ),
      "Relationship candidate flow should still run TimelineProjection"
    );
    assert(
      relationshipSegmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "RelationshipProjection" && result.status === "created"
      ),
      "Relationship candidate flow should create RelationshipProjection"
    );
    assert(
      relationshipSegmentationOutput?.projectionResults?.some(
        (result) => result.projectionName === "UnderstandingProjection" && result.status === "created"
      ),
      "Relationship candidate flow should keep UnderstandingProjection behavior"
    );

    const relationshipEvidence = await prisma.evidence.findFirstOrThrow({
      where: {
        rawMemoryId: relationshipRaw.id,
        evidenceType: EvidenceType.RAW_SEGMENTATION,
      },
    });
    const relationshipLink = await prisma.memoryEvidenceLink.findFirstOrThrow({
      where: {
        evidenceId: relationshipEvidence.id,
        targetType: EvidenceTargetType.RELATIONSHIP,
        role: EvidenceRole.SOURCE,
      },
    });
    const relationship = await prisma.relationship.findUniqueOrThrow({
      where: { id: relationshipLink.targetId },
    });
    assert(relationship.displayName === "Alex", "Relationship displayName should come from person candidate");
    assert(
      relationship.relationshipType === RelationshipType.OTHER,
      "Relationship unknown type should use current schema OTHER"
    );
    assert(relationship.status === RelationshipStatus.ACTIVE, "Relationship status should be ACTIVE");
    assert(relationship.confidence === relationshipEvidence.confidence, "Relationship confidence should come from Evidence");
    const relationshipCurrentVersionId = relationship.currentVersionId;
    if (!relationshipCurrentVersionId) throw new Error("Relationship should point to a current version");
    const relationshipVersion = await prisma.relationshipVersion.findUniqueOrThrow({
      where: { id: relationshipCurrentVersionId },
    });
    assert(
      relationshipVersion.relationshipId === relationship.id,
      "Current RelationshipVersion should belong to Relationship"
    );
    assert(relationshipVersion.version === 1, "Initial RelationshipVersion should be version 1");

    const relationshipLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.RELATIONSHIP,
      targetId: relationship.id,
      role: EvidenceRole.SOURCE,
    });
    assert(relationshipLinks.length === 1, `Expected 1 relationship evidence link, got ${relationshipLinks.length}`);
    assert(
      relationshipLinks[0]?.evidence.id === relationshipEvidence.id,
      "Evidence link target query should include Relationship evidence"
    );
    const relationshipVersionLinks = await listEvidenceForTarget({
      targetType: EvidenceTargetType.RELATIONSHIP_VERSION,
      targetId: relationshipVersion.id,
      role: EvidenceRole.SOURCE,
    });
    assert(
      relationshipVersionLinks.length === 1,
      `Expected 1 relationship version evidence link, got ${relationshipVersionLinks.length}`
    );
    assert(
      relationshipVersionLinks[0]?.evidence.id === relationshipEvidence.id,
      "Evidence link target query should include RelationshipVersion evidence"
    );

    const duplicateRelationshipProjectionResults = await dispatchEvidenceToProjections({
      evidence: relationshipEvidence,
    });
    const duplicateRelationshipProjection = duplicateRelationshipProjectionResults.find(
      (result) => result.projectionName === "RelationshipProjection"
    );
    if (!duplicateRelationshipProjection) throw new Error("Duplicate RelationshipProjection result should exist");
    assert(
      duplicateRelationshipProjection.status === "skipped" &&
        duplicateRelationshipProjection.projectionId === relationship.id,
      "Duplicate RelationshipProjection dispatch should return existing Relationship without rewriting"
    );
    assert(
      duplicateRelationshipProjection.versionId === relationshipVersion.id,
      "Duplicate RelationshipProjection dispatch should return existing version"
    );
    const relationshipCount = await prisma.relationship.count({
      where: { id: relationship.id },
    });
    assert(relationshipCount === 1, `Expected 1 Relationship, got ${relationshipCount}`);
    const relationshipVersionCount = await prisma.relationshipVersion.count({
      where: { relationshipId: relationship.id },
    });
    assert(
      relationshipVersionCount === 1,
      `Expected 1 RelationshipVersion, got ${relationshipVersionCount}`
    );
    const relationshipLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: relationshipEvidence.id,
        targetType: EvidenceTargetType.RELATIONSHIP,
        targetId: relationship.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(relationshipLinkCount === 1, `Expected 1 Relationship link, got ${relationshipLinkCount}`);
    const relationshipVersionLinkCount = await prisma.memoryEvidenceLink.count({
      where: {
        evidenceId: relationshipEvidence.id,
        targetType: EvidenceTargetType.RELATIONSHIP_VERSION,
        targetId: relationshipVersion.id,
        role: EvidenceRole.SOURCE,
      },
    });
    assert(
      relationshipVersionLinkCount === 1,
      `Expected 1 RelationshipVersion link, got ${relationshipVersionLinkCount}`
    );

    const repeatedPendingResults = await processPendingRefinementJobs({ take: 1000 });
    assert(
      !repeatedPendingResults.some((result) => result.jobId === successJob.id),
      "Repeated pending worker run should not reprocess succeeded job"
    );
    assert(
      !repeatedPendingResults.some((result) => result.jobId === segmentationJob.id),
      "Repeated pending worker run should not reprocess succeeded segmentation job"
    );

    const runningRaw = await createChatRawMemory({
      userId: user.id,
      content: "这条 job 会保持 RUNNING，用来验证 stale job 暂不自动重试。",
    });
    const runningJob = await prisma.refinementJob.findFirstOrThrow({
      where: {
        rawMemoryId: runningRaw.id,
        step: RefinementStep.RAW_CAPTURED,
      },
    });
    const claimedRunningJob = await claimPendingRefinementJob({ jobId: runningJob.id });
    assert(claimedRunningJob, "Pending job should be claimable for RUNNING stale check");
    const runningResult = await processRawCapturedJob({ jobId: runningJob.id });
    assert(
      runningResult.outcome === "skipped" && runningResult.reason === "already_running",
      "RUNNING job should be skipped because stale retry is not implemented"
    );

    const missingRaw = await createChatRawMemory({
      userId: user.id,
      content: "这条 RawMemory 会被删除，用来模拟 worker 缺失来源。",
    });
    const missingJob = await prisma.refinementJob.findFirstOrThrow({
      where: {
        rawMemoryId: missingRaw.id,
        step: RefinementStep.RAW_CAPTURED,
      },
    });

    await prisma.rawMemory.delete({ where: { id: missingRaw.id } });
    const failedResult = await processRawCapturedJob({ jobId: missingJob.id });
    assert(failedResult.outcome === "failed", "Missing RawMemory job should fail");

    const failedJob = await prisma.refinementJob.findUniqueOrThrow({
      where: { id: missingJob.id },
    });
    assert(failedJob.status === RefinementStatus.FAILED, "Missing RawMemory job should be FAILED");
    assert(failedJob.rawMemoryId === null, "Missing RawMemory job should keep job row with null rawMemoryId");
    assert(Boolean(failedJob.error), "Missing RawMemory job should store error text");

    console.log("Memory V2 raw worker checks passed");
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
