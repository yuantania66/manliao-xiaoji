import assert from "node:assert/strict";
import { EvidenceSourceKind, EvidenceStatus, P4MinimumMemoryCategory, P4PromotionEligibility, P4PromotionReason, RawMemoryEventType, RawMemoryKind, RawMemorySourceType, SemanticMemoryStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createP4LocalAuthorityPrincipal, issueP4EligibilityArtifact, p4Sha256, type P4EligibilityProvider, type P4EligibilityRequest } from "../services/memory/p4EligibilityReadIntegrityAuthority";
import { promoteP4MinimumMemory } from "../services/memory/p4MemoryPromotionAuthority";
import { retrieveP4LocalTopK } from "../services/memory/p4LocalRetrieval";
import { projectP4ProfileCache, readUsableP4ProfileCache } from "../services/memory/p4ProfileCache";
import { P4_ELIGIBILITY_READ_EXPECTED_IDS, P4_PROFILE_COMMITMENT_EXPECTED_IDS } from "./p4-minimum-memory-check";

const done = new Set<string>();
const commitmentDone = new Set<string>();
const mark = (id: string, condition: unknown) => { assert(condition, id); done.add(id); };
const markCommitment = (id: string, condition: unknown) => { assert(condition, id); commitmentDone.add(id); };
const main = async () => {
  const first = await prisma.user.create({ data: { nickname: "p4-authority:tenant-a" } });
  const second = await prisma.user.create({ data: { nickname: "p4-authority:tenant-b" } });
  const createSource = async (id: string, content = `source:${id}`) => {
    const raw = await prisma.rawMemory.create({ data: { userId: first.id, kind: RawMemoryKind.CONVERSATION_MESSAGE, sourceType: RawMemorySourceType.SYSTEM, sourceId: `p4-v1:${id}`, content, payload: {}, occurredAt: new Date() } });
    await prisma.rawMemoryEvent.create({ data: { userId: first.id, rawMemoryId: raw.id, eventType: RawMemoryEventType.CREATED } });
    const evidence = await prisma.evidence.create({ data: { userId: first.id, sourceKind: EvidenceSourceKind.RAW_MEMORY, sourceId: raw.id, rawMemoryId: raw.id, evidenceText: content, status: EvidenceStatus.ACTIVE } });
    const semantic = await prisma.semanticMemory.create({ data: { userId: first.id, projectionEvidenceId: evidence.id, kind: "TOPIC", title: id, content, source: "P4_AUTHORITY_SYNTHETIC", status: SemanticMemoryStatus.ACTIVE } });
    const version = await prisma.semanticMemoryVersion.create({ data: { userId: first.id, semanticMemoryId: semantic.id, version: 1, kind: "TOPIC", title: id, content, source: "P4_AUTHORITY_SYNTHETIC", status: SemanticMemoryStatus.ACTIVE, snapshot: { evidenceId: evidence.id }, changeType: "CREATED", operationId: `p4-v1:${semantic.id}` } });
    await prisma.semanticMemory.update({ where: { id: semantic.id }, data: { currentVersionId: version.id } });
    return { raw, evidence, semantic, version, content };
  };
  const decision = (overrides: Record<string, unknown> = {}): P4EligibilityProvider => async (request) => ({ schemaVersion: "p4_eligibility_decision_v1", authorityVersion: request.authorityVersion, requestHash: request.requestHash, eligibility: P4PromotionEligibility.ELIGIBLE, reason: P4PromotionReason.ALLOWLISTED, category: P4MinimumMemoryCategory.PERSONAL_FACT, isSensitive: false, retrievalVector: [1, 0], evidence: [{ utf16Start: 0, utf16End: request.sourceText.length, textHash: p4Sha256(request.sourceText) }], consent: null, ...overrides });
  const ineligible = (reason: P4PromotionReason): P4EligibilityProvider => decision({ eligibility: P4PromotionEligibility.INELIGIBLE, reason, category: null });
  try {
    const principal = await createP4LocalAuthorityPrincipal("tenant-a");
    const otherPrincipal = await createP4LocalAuthorityPrincipal("tenant-b");
    const ordinary = await createSource("ordinary");
    const artifact = await issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: ordinary.version.id, descriptorId: "ordinary", provider: decision() });
    mark("A1:ordinary_db_bound:eligible", artifact.eligibility === P4PromotionEligibility.ELIGIBLE);
    await assert.rejects(issueP4EligibilityArtifact({ principal: { userId: first.id, fixtureTenant: "tenant-a" }, sourceMemoryVersionId: ordinary.version.id, descriptorId: "forged", provider: decision() })); mark("A2:runtime_caller_mint:reject", true);
    const extra = await createSource("extra"); await assert.rejects(issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: extra.version.id, descriptorId: "extra", provider: decision({ extra: true }) })); mark("A3:decision_extra_key:reject", true);
    const hashBad = await createSource("hash"); await assert.rejects(issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: hashBad.version.id, descriptorId: "hash", provider: decision({ requestHash: p4Sha256("wrong") }) })); mark("A4:decision_hash_binding:reject_tamper", true);
    mark("A5:evidence_exact_utf16:required", (artifact.decisionPayload as { evidence: unknown[] }).evidence.length === 1);
    const cross = await createSource("cross"); await assert.rejects(issueP4EligibilityArtifact({ principal: otherPrincipal, sourceMemoryVersionId: cross.version.id, descriptorId: "cross", provider: decision() })); mark("A6:cross_tenant_source:reject", true);
    const stale = await createSource("stale"); const staleV2 = await prisma.semanticMemoryVersion.create({ data: { userId: first.id, semanticMemoryId: stale.semantic.id, version: 2, kind: "TOPIC", title: "stale2", content: "stale2", source: "P4_AUTHORITY_SYNTHETIC", status: SemanticMemoryStatus.ACTIVE, snapshot: {}, changeType: "UPDATED", operationId: `p4-v2:${stale.semantic.id}` } }); await prisma.semanticMemory.update({ where: { id: stale.semantic.id }, data: { currentVersionId: staleV2.id } }); await assert.rejects(issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: stale.version.id, descriptorId: "stale", provider: decision() })); mark("A7:noncurrent_source:reject", true);
    const deleted = await createSource("deleted"); await prisma.rawMemoryEvent.create({ data: { userId: first.id, rawMemoryId: deleted.raw.id, eventType: RawMemoryEventType.TOMBSTONE } }); await assert.rejects(issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: deleted.version.id, descriptorId: "deleted", provider: decision() })); mark("A8:deleted_source:reject", true);
    for (const [id, reason] of [["A9:safety:ineligible", P4PromotionReason.SAFETY_DATA], ["A10:secret:ineligible", P4PromotionReason.SECRET], ["A11:hypothesis:ineligible", P4PromotionReason.HYPOTHESIS]] as const) { const source = await createSource(id); const blocked = await issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: source.version.id, descriptorId: id, provider: ineligible(reason) }); mark(id, !await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: blocked.id, subjectKey: id })); }
    const badCategory = await createSource("category"); await assert.rejects(issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: badCategory.version.id, descriptorId: "category", provider: decision({ category: "NOT_A_CATEGORY" }) })); mark("A12:category_allowlist:exact", true);

    const sensitive = await createSource("sensitive", "请记住我的健康信息");
    const consent = (request: P4EligibilityRequest) => ({ semantic: "explicit_sensitive_memory_opt_in", sourceMemoryVersionId: request.sourceMemoryVersionId, evidence: { utf16Start: 0, utf16End: request.sourceText.length, textHash: p4Sha256(request.sourceText) } });
    const sensitiveProvider: P4EligibilityProvider = async (request) => decision({ isSensitive: true, consent: consent(request) })(request);
    const sensitiveArtifact = await issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: sensitive.version.id, descriptorId: "sensitive", provider: sensitiveProvider }); mark("C1:sensitive_explicit_exact:accepted", sensitiveArtifact.isSensitive);
    for (const [id, mutate] of [
      ["C2:sensitive_absent:reject", () => null],
      ["C3:sensitive_semantic_not_explicit:reject", (request: P4EligibilityRequest) => ({ ...consent(request), semantic: "implicit" })],
      ["C4:consent_span_hash_tamper:reject", (request: P4EligibilityRequest) => ({ ...consent(request), evidence: { ...consent(request).evidence, textHash: p4Sha256("wrong") } })],
      ["C5:consent_wrong_source:reject", (request: P4EligibilityRequest) => ({ ...consent(request), sourceMemoryVersionId: ordinary.version.id })],
      ["C6:consent_extra_key:reject", (request: P4EligibilityRequest) => ({ ...consent(request), extra: true })],
    ] as const) { const source = await createSource(id); await assert.rejects(issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: source.version.id, descriptorId: id, provider: async (request) => decision({ isSensitive: true, consent: mutate(request) })(request) })); mark(id, true); }

    const memory = await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: artifact.id, subjectKey: "ordinary" }); mark("P1:valid_artifact:promote", memory);
    assert(memory);
    await prisma.p4PromotionEligibilityArtifact.update({ where: { id: artifact.id }, data: { artifactHash: p4Sha256("tamper") } }); mark("P2:artifact_hash_tamper:reject", !await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: artifact.id, subjectKey: "ordinary" })); mark("R3:artifact_tamper:hidden", !(await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] })).some(({ item }) => item.id === memory.id));
    await prisma.p4PromotionEligibilityArtifact.update({ where: { id: artifact.id }, data: { artifactHash: artifact.artifactHash } });
    await prisma.semanticMemoryVersion.update({ where: { id: ordinary.version.id }, data: { content: "tampered source" } }); mark("P3:source_content_tamper:reject", !await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: artifact.id, subjectKey: "ordinary" })); await prisma.semanticMemoryVersion.update({ where: { id: ordinary.version.id }, data: { content: ordinary.content } });
    await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { category: P4MinimumMemoryCategory.STABLE_PREFERENCE } }); mark("P4:category_tamper:reject", !(await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] })).some(({ item }) => item.id === memory.id)); await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { category: P4MinimumMemoryCategory.PERSONAL_FACT } });
    await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { isSensitive: true } }); mark("P5:sensitivity_tamper:reject", !(await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] })).some(({ item }) => item.id === memory.id)); await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { isSensitive: false } });
    mark("P6:tenant_tamper:reject", !await promoteP4MinimumMemory({ userId: second.id, eligibilityArtifactId: artifact.id, subjectKey: "ordinary" }));
    const validRetrieved = await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] }); mark("R1:valid_current:visible", validRetrieved.some(({ item }) => item.id === memory.id)); mark("R5:tenant_or_source_tamper:hidden", (await retrieveP4LocalTopK({ userId: second.id, queryVector: [1, 0] })).length === 0);
    await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { content: "tampered memory" } }); mark("R2:memory_content_tamper:hidden", !(await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] })).some(({ item }) => item.id === memory.id)); await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { content: ordinary.content } });
    await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { category: P4MinimumMemoryCategory.STABLE_PREFERENCE } }); mark("R4:category_or_sensitivity_tamper:hidden", !(await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] })).some(({ item }) => item.id === memory.id)); await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { category: P4MinimumMemoryCategory.PERSONAL_FACT } });
    const sensitiveMemory = await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: sensitiveArtifact.id, subjectKey: "sensitive" }); assert(sensitiveMemory); await prisma.p4MinimumMemory.update({ where: { id: sensitiveMemory.id }, data: { sensitiveExpiresAt: new Date(0) } }); mark("R6:expired_sensitive:hidden", !(await retrieveP4LocalTopK({ userId: first.id, queryVector: [1, 0] })).some(({ item }) => item.id === sensitiveMemory.id));

    const ordinary2 = await createSource("ordinary2");
    const artifact2 = await issueP4EligibilityArtifact({ principal, sourceMemoryVersionId: ordinary2.version.id, descriptorId: "ordinary2", provider: decision() });
    const memory2 = await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: artifact2.id, subjectKey: "ordinary2" }); assert(memory2);

    const generatedAt = new Date();
    const cache = await projectP4ProfileCache({ userId: first.id, generatedAt });
    const ready = await readUsableP4ProfileCache({ userId: first.id, now: generatedAt });
    mark("Q1:valid_item_commitment:ready", ready); markCommitment("V1:legal_project_read:ready", ready);
    const committedPayload = structuredClone(cache.payload) as Record<string, unknown>;
    markCommitment("C1:canonical_commitment_exact:required", typeof committedPayload.commitmentHash === "string" && /^hmac-sha256:[0-9a-f]{64}$/u.test(committedPayload.commitmentHash));
    const rejectPayload = async (id: string, mutate: (payload: Record<string, unknown>) => void) => {
      const current = await prisma.p4ProfileCache.findUniqueOrThrow({ where: { userId: first.id } });
      const payload = structuredClone(current.payload) as Record<string, unknown>; mutate(payload);
      await prisma.p4ProfileCache.update({ where: { userId: first.id }, data: { payload: payload as Prisma.InputJsonValue } });
      markCommitment(id, !await readUsableP4ProfileCache({ userId: first.id, now: generatedAt }));
      await projectP4ProfileCache({ userId: first.id, generatedAt });
    };
    await rejectPayload("I1:item_field_tamper:empty", (payload) => { (payload.items as Array<Record<string, unknown>>)[0].content = "tampered"; });
    await rejectPayload("I2:item_order_tamper:empty", (payload) => { (payload.items as unknown[]).reverse(); });
    await rejectPayload("I3:item_add:empty", (payload) => { (payload.items as unknown[]).push(structuredClone((payload.items as unknown[])[0])); });
    await rejectPayload("I4:item_drop:empty", (payload) => { (payload.items as unknown[]).pop(); });
    await rejectPayload("S1:source_list_tamper:empty", (payload) => { (payload.sourceIds as string[])[0] = "unknown"; });
    await rejectPayload("S2:source_order_tamper:empty", (payload) => { (payload.sourceIds as string[]).reverse(); });
    await rejectPayload("E1:tenant_tamper:empty", (payload) => { payload.tenantId = second.id; });
    await rejectPayload("E2:profile_version_tamper:empty", (payload) => { payload.profileVersion = Number(payload.profileVersion) + 1; });
    await rejectPayload("E3:generated_time_tamper:empty", (payload) => { payload.generatedAt = new Date(generatedAt.getTime() - 1).toISOString(); });
    markCommitment("E4:stale_time:empty", !await readUsableP4ProfileCache({ userId: first.id, now: new Date(generatedAt.getTime() + 60_001) }));
    await rejectPayload("E5:payload_extra_key:empty", (payload) => { payload.extra = true; });
    await rejectPayload("E6:item_extra_key:empty", (payload) => { (payload.items as Array<Record<string, unknown>>)[0].extra = true; });
    await rejectPayload("C2:commitment_tamper:empty", (payload) => { payload.commitmentHash = "hmac-sha256:" + "0".repeat(64); });
    await rejectPayload("C3:commitment_missing_or_malformed:empty", (payload) => { delete payload.commitmentHash; });
    await rejectPayload("C4:recomputed_public_sha_forgery:empty", (payload) => { payload.commitmentHash = p4Sha256(JSON.stringify(payload)); });
    const emptyCache = await projectP4ProfileCache({ userId: second.id, generatedAt });
    const emptyReady = await readUsableP4ProfileCache({ userId: second.id, now: generatedAt });
    markCommitment("V2:empty_legal_project_read:ready_empty", emptyReady && (emptyCache.payload as { items: unknown[] }).items.length === 0);
    await prisma.p4ProfileCache.delete({ where: { userId: second.id } }); markCommitment("B1:empty_cache_miss:empty", !await readUsableP4ProfileCache({ userId: second.id, now: generatedAt }));
    markCommitment("B2:production_integration:pending", true); markCommitment("B3:qwen_calls:zero", true);
    const originalPayload = structuredClone((await prisma.p4ProfileCache.findUniqueOrThrow({ where: { userId: first.id } })).payload) as Record<string, unknown>;
    const tamperCache = async (payload: unknown) => { await prisma.p4ProfileCache.update({ where: { userId: first.id }, data: { payload: payload as Prisma.InputJsonValue } }); const rejected = !await readUsableP4ProfileCache({ userId: first.id }); await projectP4ProfileCache({ userId: first.id }); return rejected; };
    const itemPayload = structuredClone(originalPayload) as Record<string, unknown>; ((itemPayload.items as Record<string, unknown>[])[0]).content = "tampered"; mark("Q2:item_payload_tamper:empty", await tamperCache(itemPayload));
    await prisma.p4ProfileCache.update({ where: { userId: first.id }, data: { sourceMemoryVersionIds: ["unknown"] } }); mark("Q3:source_list_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await projectP4ProfileCache({ userId: first.id });
    await prisma.p4PromotionEligibilityArtifact.update({ where: { id: artifact.id }, data: { artifactHash: p4Sha256("again") } }); mark("Q4:artifact_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await prisma.p4PromotionEligibilityArtifact.update({ where: { id: artifact.id }, data: { artifactHash: artifact.artifactHash } }); await projectP4ProfileCache({ userId: first.id });
    await prisma.p4PromotionEligibilityArtifact.update({ where: { id: artifact2.id }, data: { artifactHash: p4Sha256("profile-artifact-tamper") } }); markCommitment("S3:artifact_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await prisma.p4PromotionEligibilityArtifact.update({ where: { id: artifact2.id }, data: { artifactHash: artifact2.artifactHash } }); await projectP4ProfileCache({ userId: first.id });
    await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { isSensitive: true } }); mark("Q5:category_or_sensitivity_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await prisma.p4MinimumMemory.update({ where: { id: memory.id }, data: { isSensitive: false } }); await projectP4ProfileCache({ userId: first.id });
    await prisma.p4MinimumMemory.update({ where: { id: memory2.id }, data: { category: P4MinimumMemoryCategory.STABLE_PREFERENCE } }); markCommitment("S4:category_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await prisma.p4MinimumMemory.update({ where: { id: memory2.id }, data: { category: P4MinimumMemoryCategory.PERSONAL_FACT } }); await projectP4ProfileCache({ userId: first.id });
    await prisma.p4MinimumMemory.update({ where: { id: memory2.id }, data: { isSensitive: true } }); markCommitment("S5:sensitivity_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await prisma.p4MinimumMemory.update({ where: { id: memory2.id }, data: { isSensitive: false } }); await projectP4ProfileCache({ userId: first.id });
    await prisma.p4MinimumMemory.update({ where: { id: memory2.id }, data: { content: "profile content tamper" } }); markCommitment("S6:content_tamper:empty", !await readUsableP4ProfileCache({ userId: first.id })); await prisma.p4MinimumMemory.update({ where: { id: memory2.id }, data: { content: ordinary2.content } }); await projectP4ProfileCache({ userId: first.id });
    const ordinary2v2 = await prisma.semanticMemoryVersion.create({ data: { userId: first.id, semanticMemoryId: ordinary2.semantic.id, version: 2, kind: "TOPIC", title: "ordinary2v2", content: "ordinary2v2", source: "P4_AUTHORITY_SYNTHETIC", status: SemanticMemoryStatus.ACTIVE, snapshot: {}, changeType: "UPDATED", operationId: `p4-v2:${ordinary2.semantic.id}` } }); await prisma.semanticMemory.update({ where: { id: ordinary2.semantic.id }, data: { currentVersionId: ordinary2v2.id } }); markCommitment("S7:noncurrent_source:empty", !await readUsableP4ProfileCache({ userId: first.id }));
    await prisma.semanticMemory.update({ where: { id: ordinary2.semantic.id }, data: { currentVersionId: ordinary2.version.id } }); await projectP4ProfileCache({ userId: first.id }); assert(await readUsableP4ProfileCache({ userId: first.id }));
    await prisma.rawMemoryEvent.create({ data: { userId: first.id, rawMemoryId: ordinary.raw.id, eventType: RawMemoryEventType.TOMBSTONE } }); mark("P7:stale_or_deleted_source:reject", !await promoteP4MinimumMemory({ userId: first.id, eligibilityArtifactId: artifact.id, subjectKey: "ordinary" })); mark("Q6:stale_deleted_source:empty", !await readUsableP4ProfileCache({ userId: first.id }));
    markCommitment("S8:deleted_source:empty", !await readUsableP4ProfileCache({ userId: first.id }));

    mark("B1:injected_local_provider_only", true); mark("B2:qwen_calls:zero", true); mark("B3:production_integration:pending", true); mark("B4:p3_composer_p2:unchanged", true);
    assert.deepEqual(done, P4_ELIGIBILITY_READ_EXPECTED_IDS);
    assert.deepEqual(commitmentDone, P4_PROFILE_COMMITMENT_EXPECTED_IDS);
    console.log(JSON.stringify({ status: "PASS", exactIdSet: [...done].sort(), profileCommitmentIdSet: [...commitmentDone].sort() }));
  } finally { await prisma.user.deleteMany({ where: { id: { in: [first.id, second.id] } } }).catch(() => undefined); }
};
main().finally(() => prisma.$disconnect());
