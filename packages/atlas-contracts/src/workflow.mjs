import { hash, hashBytes, requireThat as check, validate, parseBounded, immutable } from './strict.mjs';
import { MACHINE_TOOLS, TOOL_NAMES, TOOLS_HASH, evidenceSchema, runManifestSchema, machineCapabilitySchema, humanContextSchema, approvalSchema, auditSchema } from './contracts.mjs';

export const STAGES = immutable(['EVIDENCE_VERIFIED', 'IDENTITY_PROPOSED', 'GEOMETRY_VALIDATED_FOR_DRAFT', 'DETECTION_COMPLETE', 'AI_REVIEW_PROPOSALS', 'DRAFT_PACKAGE_READY', 'READY_FOR_HUMAN', 'HUMAN_REVIEW', 'HUMAN_APPROVED']);
const DRAFT_STATES = STAGES.slice(0, 6);
export function revisionHash(card) {
  return hash({ revision: card.revision, evidenceHash: card.evidenceHash, runManifestHash: card.runManifestHash, proposals: card.proposals, humanOverrides: card.humanOverrides, receipts: card.receipts, package: card.package });
}
function event(card, type, operationId, actorRef, atMs, payload) {
  const prior = card.audit.at(-1);
  const body = { schemaVersion: 'atlas-audit-v1', sequence: card.audit.length + 1, previousHash: prior?.hash ?? null, event: type, operationId, actorRef, revision: card.revision, atMs, payloadHash: hash(payload) };
  validate(auditSchema, body);
  card.audit.push({ body, hash: hash(body) });
}
export function verifyAudit(card) {
  let previousHash = null;
  card.audit.forEach((entry, i) => {
    validate(auditSchema, entry.body);
    check(entry.body.sequence === i + 1 && entry.body.previousHash === previousHash && entry.hash === hash(entry.body), 'AUDIT_INTEGRITY');
    previousHash = entry.hash;
  });
  check(hash(card.evidence) === card.evidenceHash && hash(card.manifest) === card.runManifestHash, 'MANIFEST_INTEGRITY');
  card.history.forEach((snapshot, index) => {
    check(snapshot.revision === index && snapshot.hash === revisionHash({ ...card, ...snapshot }), 'REVISION_HISTORY_INTEGRITY');
  });
  check(card.history.at(-1).hash === revisionHash(card), 'REVISION_INTEGRITY');
  return true;
}
function saveRevision(card) {
  card.history.push({ revision: card.revision, hash: revisionHash(card), proposals: structuredClone(card.proposals), humanOverrides: structuredClone(card.humanOverrides), receipts: structuredClone(card.receipts), package: structuredClone(card.package) });
}
function changeRevision(card) {
  card.revision += 1;
  card.approval = null;
  card.package = null;
  card.receipts = {};
  card.assignment = null;
  card.lease = null;
  card.state = 'AI_REVIEW_PROPOSALS';
}
export function createCard(store, evidence, manifest, now) {
  validate(evidenceSchema, evidence); validate(runManifestSchema, manifest);
  check(manifest.evidenceHash === hash(evidence) && manifest.toolsHash === TOOLS_HASH, 'MANIFEST_BINDING');
  check(new Set(evidence.originals.map(a => a.side)).size === 2, 'PAIRED_ORIGINALS_REQUIRED');
  const assets = [...evidence.originals, ...evidence.assets];
  check(new Set(assets.map(a => a.assetId)).size === assets.length, 'DUPLICATE_ASSET');
  check(new Set(evidence.rawFindings.map(f => f.findingId)).size === evidence.rawFindings.length, 'DUPLICATE_FINDING');
  for (const a of evidence.originals) check(a.kind === 'ORIGINAL' && a.sourceAssetId === a.assetId && a.sourceSha256 === a.sha256 && a.sourceRect === null, 'ORIGINAL_LINEAGE');
  for (const a of evidence.assets) {
    const source = evidence.originals.find(o => o.assetId === a.sourceAssetId);
    check(source && source.sha256 === a.sourceSha256 && source.side === a.side, 'DERIVED_LINEAGE');
    if (a.sourceRect) validRect(a.sourceRect, source);
  }
  for (const f of evidence.rawFindings) check(evidence.originals.some(a => a.side === f.side && a.sha256 === f.sourceSha256), 'FINDING_LINEAGE');
  return store.transaction(db => {
    check(db.batchId === manifest.batchId, 'BATCH_SCOPE');
    if (db.cards[evidence.cardId]) {
      const old = db.cards[evidence.cardId];
      check(old.evidenceHash === hash(evidence) && old.runManifestHash === hash(manifest), 'CREATE_CONFLICT');
      return old;
    }
    check(!Object.values(db.cards).some(c => c.specimenId === evidence.specimenId || c.runId === manifest.runId), 'SPECIMEN_OR_RUN_DUPLICATE');
    const card = {
      cardId: evidence.cardId, specimenId: evidence.specimenId, runId: manifest.runId, createdAtMs: now,
      evidence: structuredClone(evidence), manifest: structuredClone(manifest), evidenceHash: hash(evidence), runManifestHash: hash(manifest),
      state: 'EVIDENCE_VERIFIED', revision: 0, proposals: [], humanOverrides: [], receipts: {}, package: null, approval: null, approvals: [], assignment: null,
      crops: [], coverage: [], history: [], audit: [], lease: null, leaseCounter: 0, assignmentCounter: 0, toolCalls: 0, spentMicroUsd: 0, reservedMicroUsd: 0,
    };
    saveRevision(card); event(card, 'CREATED', 'create', 'system', now, { evidenceHash: card.evidenceHash });
    db.cards[card.cardId] = card;
    return card;
  });
}
export function validRect(rect, source) {
  check([rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger), 'RECT_INTEGER');
  check(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= source.width && rect.y + rect.height <= source.height, 'RECT_BOUNDS');
}
export function checkBinding(card, args) {
  check(card && args.cardId === card.cardId && args.runId === card.runId && args.evidenceHash === card.evidenceHash && args.runManifestHash === card.runManifestHash, 'SOURCE_SCOPE');
  check(args.expectedRevision === card.revision, 'STALE_REVISION');
  verifyAudit(card);
}
function authorizedScope(card, capability, now) {
  // capability is supplied by trusted application middleware, never parsed from model arguments.
  try { validate(machineCapabilitySchema, capability); } catch { check(false, 'CAPABILITY_SCOPE'); }
  check(capability?.audience === 'atlas-machine' && capability.cardId === card.cardId && capability.runId === card.runId && capability.specimenId === card.specimenId && capability.runManifestHash === card.runManifestHash && capability.evidenceHash === card.evidenceHash, 'CAPABILITY_SCOPE');
  check(capability.expiresAtMs > now && capability.notBeforeMs <= now, 'CAPABILITY_SCOPE');
}
function authorized(card, capability, tool, now) {
  authorizedScope(card, capability, now);
  check(capability.tools.includes(tool), 'CAPABILITY_DENIED');
}
function validateEvidence(card, refs) {
  for (const ref of refs) {
    const asset = [...card.evidence.originals, ...card.evidence.assets, ...card.crops].find(a => a.assetId === ref.assetId);
    check(asset && asset.sha256 === ref.sha256 && asset.side === ref.side, 'EVIDENCE_REFERENCE');
  }
}
function proposalSemantics(card, name, args) {
  if (args.evidence) validateEvidence(card, args.evidence);
  if (name === 'propose_identity') {
    check(new Set(args.fields.map(f => f.field)).size === args.fields.length, 'DUPLICATE_IDENTITY_FIELD');
    args.fields.forEach(f => validateEvidence(card, f.evidence));
  }
  if (name === 'propose_geometry' || name === 'request_sam_trace') {
    const source = card.evidence.originals.find(a => a.assetId === args.sourceAssetId);
    check(source && source.sha256 === args.sourceSha256 && source.side === args.side, 'GEOMETRY_SOURCE');
    if (args.evidence) for (const ref of args.evidence) {
      const cited = [...card.evidence.originals, ...card.evidence.assets, ...card.crops].find(a => a.assetId === ref.assetId);
      check(cited.side === source.side && cited.sourceAssetId === source.assetId && cited.sourceSha256 === source.sha256, 'GEOMETRY_EVIDENCE_SOURCE');
    }
    for (const p of args.points) check(p.x < source.width && p.y < source.height, 'POINT_BOUNDS');
    if (args.rect) validRect(args.rect, source);
    // Convex/ordering/physical calibration remain the owned deterministic adapter's
    // job. A structurally valid proposal cannot itself create a geometry receipt.
  }
  if (name === 'propose_finding_change') {
    const target = card.evidence.rawFindings.find(f => f.findingId === args.findingId);
    check(args.action === 'ADD' ? args.findingId === null : Boolean(target), 'FINDING_SCOPE');
    if (target) check(args.evidence.every(e => e.side === target.side), 'FINDING_SIDE');
    if (['ADD', 'TRIM'].includes(args.action)) {
      const mask = card.evidence.assets.find(a => a.assetId === args.maskAssetId && a.kind === 'MASK');
      check(mask && args.evidence.every(e => e.side === mask.side) && (!target || mask.sourceSha256 === target.sourceSha256), 'MASK_LINEAGE');
    } else check(args.maskAssetId === null, 'UNEXPECTED_MASK');
    check(['ADD', 'RETYPE'].includes(args.action) ? args.defectType !== null : args.defectType === null, 'DEFECT_TYPE_SEMANTICS');
  }
}
export function invokeMachine(store, capability, name, argumentJson, now) {
  // Count rejected/malformed/duplicate attempts too; an agent cannot evade the
  // call limit by repeatedly producing unparsable arguments.
  store.transaction(db => {
    const c = db.cards[capability?.cardId]; check(c, 'CAPABILITY_SCOPE');
    authorizedScope(c, capability, now);
    check(now < db.caps.deadlineMs && c.toolCalls < db.caps.maxToolCalls, 'TOOL_OR_DEADLINE_CAP');
    c.toolCalls += 1;
    event(c, 'TOOL_ATTEMPTED', `tool_${c.toolCalls}`, capability.subject, now, { name: typeof name === 'string' ? name : 'invalid' });
  });
  const tool = MACHINE_TOOLS.find(t => t.name === name);
  check(tool, 'TOOL_FORBIDDEN');
  const args = parseBounded(argumentJson, tool.parameters);
  return store.transaction(db => {
    const card = db.cards[args.cardId]; check(card, 'CARD_NOT_FOUND');
    authorized(card, capability, name, now);
    const key = `${card.runId}:${args.operationId}`;
    const inputHash = hash({ name, args });
    if (db.operations[key]) {
      check(db.operations[key].inputHash === inputHash, 'IDEMPOTENCY_CONFLICT');
      return db.operations[key].result;
    }
    checkBinding(card, args);
    check(now < db.caps.deadlineMs, 'TOOL_OR_DEADLINE_CAP');
    // This package intentionally has no implicit production/service fallback.
    let result;
    if (name === 'read_card_evidence') result = { status: 'READ_ONLY', evidence: card.evidence, revision: card.revision };
    else if (['propose_identity', 'propose_geometry', 'propose_finding_change'].includes(name)) {
      check(DRAFT_STATES.includes(card.state), 'DRAFT_LOCKED'); proposalSemantics(card, name, args);
      changeRevision(card);
      card.proposals.push({ proposalId: args.operationId, kind: name, origin: 'ASTRA_PROPOSAL', actorRef: capability.subject, basedOnRevision: args.expectedRevision, payload: args, payloadHash: hash(args) });
      saveRevision(card); event(card, 'PROPOSAL_APPENDED', args.operationId, capability.subject, now, args);
      result = { status: 'DRAFT_PROPOSAL', revision: card.revision, revisionHash: revisionHash(card), needsHumanReview: true };
    } else if (name === 'submit_for_human_review') {
      check(card.state === 'DRAFT_PACKAGE_READY' && card.package?.hash === args.packageHash, 'PACKAGE_NOT_READY');
      card.state = 'READY_FOR_HUMAN';
      event(card, 'REVIEW_SUBMITTED', args.operationId, capability.subject, now, { packageHash: args.packageHash });
      const outboxId = `review_${card.runId}_${card.revision}`;
      db.outbox[outboxId] = { outboxId, cardId: card.cardId, revision: card.revision, revisionHash: revisionHash(card), type: 'REVIEW_REQUESTED', status: 'PENDING', deliveries: 0 };
      result = { status: 'READY_FOR_HUMAN', revision: card.revision, outboxId };
    } else {
      proposalSemantics(card, name, args);
      // Explicit seam: callers cannot mistake a mock/no-adapter result for work.
      result = { status: 'ADAPTER_REQUIRED', tool: name, inputHash, revision: card.revision };
    }
    db.operations[key] = { inputHash, result };
    return result;
  });
}

// Read-only reconciliation for lost replies, including after local action caps
// or deadlines. It cannot create an operation, modify a revision, or bypass a
// fresh valid capability. The orchestrator uses this before retrying a command.
export function reconcileMachineOperation(store, capability, name, argumentJson, now) {
  const tool = MACHINE_TOOLS.find(t => t.name === name); check(tool, 'TOOL_FORBIDDEN');
  const args = parseBounded(argumentJson, tool.parameters);
  const card = store.read().cards[capability.cardId]; check(card, 'CARD_NOT_FOUND'); authorized(card, capability, name, now);
  check(args.cardId === card.cardId && args.runId === card.runId && args.evidenceHash === card.evidenceHash && args.runManifestHash === card.runManifestHash, 'SOURCE_SCOPE');
  const operation = store.read().operations[`${card.runId}:${args.operationId}`];
  check(operation && operation.inputHash === hash({ name, args }), 'IDEMPOTENCY_CONFLICT');
  return operation.result;
}

// A trusted crop adapter supplies exact bytes and source mapping. No image/URL
// acquisition occurs here. Receipt records delivery, not a model's mental state.
export function recordRegionDelivery(store, cardId, expectedRevision, sourceId, rect, sourceBytes, cropBytes, delivery, now) {
  return store.transaction(db => {
    const card = db.cards[cardId]; check(card && card.revision === expectedRevision, 'STALE_REVISION');
    const source = card.evidence.originals.find(a => a.assetId === sourceId);
    check(source && hashBytes(sourceBytes) === source.sha256, 'SOURCE_BYTES'); validRect(rect, source);
    check(delivery.runManifestHash === card.runManifestHash && delivery.requestId && delivery.responseId && delivery.status === 'COMPLETED', 'DELIVERY_RECEIPT');
    const transformHash = hash({ sourceId, sourceSha256: source.sha256, rect, mapping: 'SOURCE_PIXEL_RECT_NO_RESIZE_V1' });
    const assetId = `crop_${hash({ sourceId, rect, transformHash }).slice(7, 31)}`;
    const crop = { assetId, sha256: hashBytes(cropBytes), side: source.side, width: rect.width, height: rect.height, sourceAssetId: sourceId, sourceSha256: source.sha256, sourceRect: rect, kind: 'CROP', transformHash };
    const prior = card.crops.find(a => a.assetId === assetId);
    check(!prior || hash(prior) === hash(crop), 'CROP_CONFLICT');
    if (!prior) card.crops.push(crop);
    const receipt = { assetId, sourceId, rect, sourceSha256: source.sha256, revision: expectedRevision, requestId: delivery.requestId, responseId: delivery.responseId, runManifestHash: card.runManifestHash };
    if (!card.coverage.some(r => hash(r) === hash(receipt))) card.coverage.push(receipt);
    event(card, 'REGION_DELIVERED', assetId, 'evidence_adapter', now, receipt);
    return crop;
  });
}
export function coveredArea(rects) {
  const xs = [...new Set(rects.flatMap(r => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const spans = rects.filter(r => r.x < xs[i + 1] && r.x + r.width > xs[i]).map(r => [r.y, r.y + r.height]).sort((a, b) => a[0] - b[0]);
    let bottom = -1, total = 0;
    for (const [start, end] of spans) { total += Math.max(0, end - Math.max(start, bottom)); bottom = Math.max(bottom, end); }
    area += (xs[i + 1] - xs[i]) * total;
  }
  return area;
}
export function coverageSummary(card) {
  return card.evidence.originals.map(source => {
    const rects = card.coverage.filter(r => r.sourceId === source.assetId && r.revision === card.revision && r.runManifestHash === card.runManifestHash && r.sourceSha256 === source.sha256).map(r => r.rect);
    const area = coveredArea(rects);
    return { side: source.side, deliveredPixelFraction: area / (source.width * source.height), visualInspectionProven: false };
  });
}
export function recordDraftPackage(store, cardId, expectedRevision, receipt, now) {
  return store.transaction(db => {
    const c = db.cards[cardId]; check(c && c.revision === expectedRevision && DRAFT_STATES.includes(c.state), 'STALE_REVISION');
    check(receipt.mode === 'SYNTHETIC_ADAPTER' && receipt.revision === expectedRevision && receipt.evidenceHash === c.evidenceHash && receipt.runManifestHash === c.runManifestHash && receipt.proposalSetHash === hash(c.proposals), 'DRAFT_RECEIPT_BINDING');
    check(receipt.rulesHash === c.manifest.rulesHash && receipt.rendererHash === c.manifest.rendererHash && receipt.workerReleaseHash === c.manifest.workerReleaseHash, 'DRAFT_RUNTIME_BINDING');
    check(['identity', 'geometry', 'detection', 'grade', 'report', 'label'].every(k => /^sha256:[a-f0-9]{64}$/.test(receipt[k])), 'DRAFT_CHECKLIST');
    check(coverageSummary(c).every(s => s.deliveredPixelFraction === 1), 'COVERAGE_INCOMPLETE');
    check(receipt.coverageHash === hash(c.coverage.filter(r => r.revision === expectedRevision)), 'COVERAGE_BINDING');
    check(hash(receipt.rawFindingIds.slice().sort()) === hash(c.evidence.rawFindings.map(f => f.findingId).sort()), 'RAW_FINDING_OMISSION');
    c.receipts = structuredClone(receipt);
    c.revision += 1;
    c.package = { status: 'DRAFT_NO_CERTIFICATE', hash: hash(receipt), reportHash: receipt.report, labelHash: receipt.label };
    c.state = 'DRAFT_PACKAGE_READY';
    // Final package is a new material revision; receipts explicitly bind the
    // proposal revision actually inspected/rendered. History keeps both.
    saveRevision(c); event(c, 'STAGE_RECORDED', `package_${c.revision}`, 'deterministic_adapter', now, receipt);
    return c.package;
  });
}
function human(c, principal, capability, now) {
  try { validate(humanContextSchema, principal); } catch { check(false, 'TRAINED_HUMAN_REQUIRED'); }
  check(principal?.audience === 'atlas-staff' && principal.cardIds.includes(c.cardId) && principal.capabilities.includes(capability) && principal.trained === true && principal.authenticatedAtMs <= now && now - principal.authenticatedAtMs <= 300000 && principal.expiresAtMs > now, 'TRAINED_HUMAN_REQUIRED');
}
export function claimHumanReview(store, cardId, principal, now, durationMs = 60000) {
  return store.transaction(db => {
    const c = db.cards[cardId]; check(c, 'CARD_NOT_FOUND'); human(c, principal, 'review:certification', now);
    check(['READY_FOR_HUMAN', 'HUMAN_REVIEW'].includes(c.state), 'REVIEW_STATE');
    check(!c.assignment || c.assignment.expiresAtMs <= now, 'REVIEW_ALREADY_CLAIMED');
    check(Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= 300000, 'REVIEW_LEASE_BOUNDS');
    c.assignmentCounter += 1;
    c.assignment = { actorRef: principal.subject, fence: c.assignmentCounter, expiresAtMs: now + durationMs };
    c.state = 'HUMAN_REVIEW'; event(c, 'REVIEW_CLAIMED', `review_${c.assignmentCounter}`, principal.subject, now, c.assignment);
    return c.assignment;
  });
}
export function appendHumanOverride(store, cardId, principal, expectedRevision, assignmentFence, override, now) {
  return store.transaction(db => {
    const c = db.cards[cardId]; human(c, principal, 'review:certification', now);
    check(c.revision === expectedRevision && ['HUMAN_REVIEW', 'HUMAN_APPROVED'].includes(c.state), 'STALE_REVISION');
    check(c.assignment?.actorRef === principal.subject && c.assignment.fence === assignmentFence && c.assignment.expiresAtMs > now, 'REVIEW_LEASE');
    check(typeof override.reason === 'string' && override.reason.length > 0 && override.reason.length <= 500, 'OVERRIDE_REASON');
    changeRevision(c);
    c.humanOverrides.push({ actorRef: principal.subject, basedOnRevision: expectedRevision, payload: structuredClone(override), payloadHash: hash(override) });
    saveRevision(c); event(c, 'HUMAN_OVERRIDE_APPENDED', `override_${c.revision}`, principal.subject, now, override);
    return { revision: c.revision, revisionHash: revisionHash(c) };
  });
}
export function approveHumanRevision(store, cardId, principal, expectedRevision, expectedHash, assignmentFence, now) {
  return store.transaction(db => {
    const c = db.cards[cardId]; check(c, 'CARD_NOT_FOUND'); human(c, principal, 'review:certification', now); verifyAudit(c);
    check(c.state === 'HUMAN_REVIEW' && c.revision === expectedRevision && revisionHash(c) === expectedHash, 'APPROVAL_REVISION');
    check(c.assignment?.actorRef === principal.subject && c.assignment.fence === assignmentFence && c.assignment.expiresAtMs > now, 'REVIEW_LEASE');
    const approval = { schemaVersion: 'atlas-human-approval-v1', approvalId: `approval_${c.runId}_${c.revision}`, cardId, specimenId: c.specimenId, runId: c.runId, revision: c.revision, revisionHash: expectedHash, evidenceHash: c.evidenceHash, runManifestHash: c.runManifestHash, packageHash: c.package.hash, actorRef: principal.subject, assuranceRef: principal.assuranceRef, rosterHash: principal.rosterHash, assignmentFence, approvedAtMs: now, purpose: 'CERTIFICATION_REVIEW', approvedLessonIds: [] };
    validate(approvalSchema, approval);
    c.approval = { body: approval, hash: hash(approval) }; c.approvals.push(structuredClone(c.approval)); c.state = 'HUMAN_APPROVED';
    event(c, 'HUMAN_APPROVED', approval.approvalId, principal.subject, now, approval);
    // This records a review decision only. No issuance, public route or trusted
    // learning consumer exists in the offline package.
    return c.approval;
  });
}
export function approvalMatches(card, approval) {
  try {
    validate(approvalSchema, approval.body);
    return card.state === 'HUMAN_APPROVED' && card.approval?.hash === approval.hash && hash(card.approval) === hash(approval) && approval.body.purpose === 'CERTIFICATION_REVIEW' && approval.body.approvedLessonIds.length === 0 && approval.body.cardId === card.cardId && approval.body.specimenId === card.specimenId && approval.body.runId === card.runId && approval.hash === hash(approval.body) && approval.body.revisionHash === revisionHash(card) && approval.body.revision === card.revision && approval.body.evidenceHash === card.evidenceHash && approval.body.runManifestHash === card.runManifestHash && approval.body.packageHash === card.package?.hash;
  } catch { return false; }
}
export { event as appendAuditEvent, saveRevision, TOOL_NAMES };
