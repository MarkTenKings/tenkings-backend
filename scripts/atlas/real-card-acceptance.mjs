#!/usr/bin/env node
// Offline evidence reader only. No client, credential, network, SQL, browser,
// provider, approval or device capability is present in this executable.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest } from '../../packages/atlas-manual-service/src/contract.mjs';
import { descriptorSha256 } from '../../packages/atlas-photo-core/src/index.mjs';
import { approvedPublicationSource } from '../../packages/atlas-connected-manual/src/publication-repository.mjs';
import { validateManualFinishingPlan } from '../../packages/atlas-finishing/src/manual.mjs';

const VERSION = 'atlas-real-card-evidence-v1', SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SIDES = ['FRONT', 'BACK'], RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'];
// These already-retained September 22 regression originals are never new specimens.
export const HISTORICAL_ORIGINALS = Object.freeze([
  '0a74fece6fd500ffd1cadf4ef043a3f8894204fb6854acd1303018a2c9282113',
  '38574a3d835ef17eb4d5160e76bbc3acfbcac9890e9a8f937c0044a7d07bbb7e',
  'f8c13dc84b745ec12e52cdc8b0e1b25894ce38caf5d4d2f2991632dbe2450f27',
  'f10c63eb077019f6155e2fd34960a46318fa67672a5b2393a9d011a74c66ab48',
]);
function check(ok, code = 'EVIDENCE_BINDING_MISMATCH') { if (!ok) throw new Error(code); }
function time(value) { check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value)), 'EVIDENCE_TIME_INVALID'); return Date.parse(value); }
function stored(row, name, hashName = `${name}_hash`) { check(typeof row[name] === 'string' && digest(row[name]) === row[hashName]); return JSON.parse(row[name]); }
function exact(a, b) { return canonical(a, { maxBytes: 4194304 }) === canonical(b, { maxBytes: 4194304 }); }
function boundedArray(value, max) { check(Array.isArray(value) && value.length <= max, 'EVIDENCE_ARRAY_INVALID'); return value; }

// Files stay where the operator retained them. Neither their contents nor paths
// are copied into the summary. Relative paths must remain below the chosen root.
export async function evidenceReader(root) {
  const base = await realpath(root), receipts = [], cache = new Map(); let total = 0;
  return { receipts, async read(ref, binary = false) {
    check(ref && typeof ref.path === 'string' && !isAbsolute(ref.path) && !ref.path.includes('\0')
      && SHA.test(ref.sha256) && Number.isSafeInteger(ref.byteCount) && ref.byteCount > 0, 'EVIDENCE_REFERENCE_INVALID');
    const file = resolve(base, ref.path), rel = relative(base, file);
    check(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel), 'EVIDENCE_PATH_INVALID');
    const key = `${rel}:${ref.sha256}:${ref.byteCount}:${binary}`;
    if (cache.has(key)) return cache.get(key);
    check(ref.byteCount <= (binary ? 100 * 1024 * 1024 : 16 * 1024 * 1024)
      && receipts.length < 1200 && total + ref.byteCount <= 2 * 1024 ** 3, 'EVIDENCE_LIMIT');
    let current = base;
    for (const part of rel.split(sep)) { current = resolve(current, part); check(!(await lstat(current)).isSymbolicLink(), 'EVIDENCE_SYMLINK_REFUSED'); }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat(); check(before.isFile() && before.size === ref.byteCount, 'EVIDENCE_SIZE_MISMATCH');
      const hash = createHash('sha256'); let bytes = 0, data;
      if (binary) {
        for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; check(bytes <= ref.byteCount, 'EVIDENCE_SIZE_MISMATCH'); hash.update(chunk); }
      } else { data = await handle.readFile(); bytes = data.length; hash.update(data); }
      const after = await handle.stat();
      check(bytes === ref.byteCount && hash.digest('hex') === ref.sha256 && before.size === after.size
        && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'EVIDENCE_HASH_MISMATCH');
      total += bytes; receipts.push({ sha256: ref.sha256, byteCount: bytes, interpretation: binary ? 'ORIGINAL_BYTES' : 'JSON' });
      const value = binary ? { sha256: ref.sha256, byteCount: bytes } : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
      cache.set(key, value); return value;
    } finally { await handle.close(); }
  } };
}

export async function collectAcceptance(manifest, reader) {
  check(manifest?.version === VERSION && ['REAL_CARD', 'FIXTURE'].includes(manifest.scope)
    && /^[A-Za-z0-9_-]{1,80}$/.test(manifest.cohortId) && [1, 10, 50].includes(manifest.target), 'ACCEPTANCE_MANIFEST_INVALID');
  const start = time(manifest.startedAt), end = time(manifest.observedThrough);
  check(end >= start, 'EVIDENCE_TIME_INVALID'); boundedArray(manifest.cards, manifest.target);
  const seenCards = new Set(), seenSpecimens = new Set(), seenOriginals = new Set(HISTORICAL_ORIGINALS);
  for (const sha of boundedArray(manifest.priorOriginalSha256 ?? [], 10000)) { check(SHA.test(sha)); seenOriginals.add(sha); }
  const issues = [], cards = [];
  async function stage(name, ref, action, target = issues) {
    if (!ref) { target.push({ stage: name, status: 'NOT_RUN' }); return null; }
    try { const value = await reader.read(ref); const result = await action(value); target.push({ stage: name, status: 'MATCHED', evidenceHash: ref.sha256 }); return result ?? value; }
    catch (error) { target.push({ stage: name, status: error.message.startsWith('DEPENDENCY_') ? 'BLOCKED' : 'FAIL',
      code: /^[A-Z_]{1,80}$/.test(error.message) ? error.message : 'EVIDENCE_INVALID' }); return null; }
  }
  const release = await stage('release', manifest.release, async value => {
    check(value.version === 'atlas-acceptance-release-v1' && value.scope === manifest.scope
      && /^[a-f0-9]{40}$/.test(value.sourceCommit) && /^sha256:[a-f0-9]{64}$/.test(value.nativeImageDigest)
      && ['staffDeploymentId','publicDeploymentId'].every(key => /^[A-Za-z0-9_-]{1,150}$/.test(value[key]))
      && value.batchEnabled === true && value.qualificationStatus === 'PASS' && time(value.observedAt) <= start);
    check(boundedArray(value.migrations, 100).length > 0 && value.migrations.every(item => /^[0-9][A-Za-z0-9_]{1,100}$/.test(item.name) && SHA.test(item.sha256)));
    check(boundedArray(value.receipts, 30).length >= 1, 'RELEASE_RECEIPTS_REQUIRED');
    for (const ref of value.receipts) await reader.read(ref);
  });
  const checkpoint = manifest.target === 1 ? null : await stage('previousCheckpoint', manifest.previousCheckpoint, async value => {
    const previous = await reader.read(value.summary), decision = value.decision, priorTarget = manifest.target === 10 ? 1 : 10;
    check(previous.version === 'atlas-real-card-evidence-summary-v1' && previous.scope === manifest.scope
      && previous.cohortId === manifest.cohortId && previous.target === priorTarget && previous.softwareEvidenceMatched === true
      && previous.realCardAcceptance === 'NOT_DETERMINED_BY_COLLECTOR' && previous.cards.length === priorTarget);
    check(decision.kind === 'HUMAN_CHECKPOINT_DECISION' && decision.scope === manifest.scope && UUID.test(decision.observerId)
      && decision.previousSummarySha256 === value.summary.sha256 && decision.fromTarget === priorTarget && decision.toTarget === manifest.target
      && decision.acceptPreviousCheckpoint === true && time(decision.observedAt) >= time(previous.observedThrough) && time(decision.observedAt) <= end);
    check(boundedArray(decision.receipts, 10).length > 0, 'HUMAN_ATTESTATION_RECEIPT_REQUIRED');
    for (const ref of decision.receipts) await reader.read(ref);
    for (const old of previous.cards) check(manifest.cards.some(card => card.cardId === old.cardId && card.specimenId === old.specimenId), 'PREVIOUS_SPECIMEN_MISSING');
    return { previous, decision };
  });
  for (const item of manifest.cards) {
    check(UUID.test(item.cardId) && /^[A-Za-z0-9_-]{1,80}$/.test(item.specimenId)
      && !seenCards.has(item.cardId) && !seenSpecimens.has(item.specimenId), 'DUPLICATE_OR_INVALID_SPECIMEN');
    seenCards.add(item.cardId); seenSpecimens.add(item.specimenId);
    const output = { specimenId: item.specimenId, cardId: item.cardId, checks: [], timings: {}, observations: [] }; cards.push(output);
    const step = (name, ref, action) => stage(name, ref, action, output.checks);
    const capture = await step('freshCaptureAttestation', item.capture, async value => {
      check(value.version === 'atlas-acceptance-capture-v1' && value.scope === manifest.scope
        && value.cardId === item.cardId && value.specimenId === item.specimenId && UUID.test(value.observerId)
        && value.freshNativeOriginals === true && value.samePhysicalPair === true && value.distinctPhysicalSpecimen === true);
      check(time(value.observedAt) >= start && time(value.observedAt) <= end);
      for (const side of SIDES) check(time(value.capturedAt[side]) >= start && time(value.capturedAt[side]) <= time(value.observedAt));
      if (manifest.target > 1) {
        check(checkpoint, 'DEPENDENCY_PREVIOUS_CHECKPOINT');
        if (!checkpoint.previous.cards.some(card => card.cardId === item.cardId))
          check(time(value.observedAt) >= time(checkpoint.decision.observedAt), 'CARD_PRECEDES_SCALE_DECISION');
      }
      check(boundedArray(value.receipts, 10).length > 0, 'HUMAN_ATTESTATION_RECEIPT_REQUIRED');
      for (const ref of value.receipts) await reader.read(ref);
    });
    const intake = await step('originalsAndIntake', item.intake, async value => {
      check(capture, 'DEPENDENCY_CAPTURE_ATTESTATION'); const card = value.card;
      check(card?.cardId === item.cardId && card.ready === true && time(card.createdAt) >= start && time(card.createdAt) <= end);
      for (const side of SIDES) {
        const upload = card.sides[side].upload, ref = item.originals?.[side];
        const bytes = await reader.read(ref, true), photo = await reader.read(value.photos?.[side]), original = photo.original.content;
        check(!seenOriginals.has(bytes.sha256), 'REUSED_OR_HISTORICAL_ORIGINAL'); seenOriginals.add(bytes.sha256);
        check(upload.side === side && upload.version === card.sides[side].version && upload.plan.uploadId === upload.uploadId
          && upload.plan.binding.cardId === item.cardId && upload.plan.binding.side === side && upload.plan.binding.pairId === card.pairId
          && upload.plan.expected.sha256 === bytes.sha256 && upload.plan.expected.byteCount === bytes.byteCount
          && upload.verification.sha256 === bytes.sha256 && upload.verification.byteCount === bytes.byteCount
          && original.sha256 === bytes.sha256 && original.byteCount === bytes.byteCount
          && capture.originalSha256[side] === bytes.sha256);
        check(upload.source.ref.sha256 === value.photos[side].sha256 && upload.source.ref.cardId === item.cardId
          && upload.source.ref.kind === 'PHOTO_SOURCE' && upload.source.photoSourceHash === descriptorSha256({ plan: upload.plan, verification: upload.verification }));
        check(exact(photo.decodedFrame.raster.dimensions, photo.workingFrame.raster.dimensions));
      }
      check(card.sourceHash === descriptorSha256({ cardId: card.cardId, pairId: card.pairId, front: card.sides.FRONT.upload, back: card.sides.BACK.upload }));
      output.sourceHash = card.sourceHash; output.originalSha256 = { ...capture.originalSha256 };
      const prior = checkpoint?.previous.cards.find(card => card.cardId === item.cardId);
      if (prior) check(prior.sourceHash === card.sourceHash && exact(prior.originalSha256, capture.originalSha256), 'PREVIOUS_SPECIMEN_CHANGED');
      else if (checkpoint) check(time(card.createdAt) >= time(checkpoint.decision.observedAt), 'CARD_PRECEDES_SCALE_DECISION');
      return card;
    });
    const job = await step('batchJob', item.job, async row => {
      check(release && intake, 'DEPENDENCY_RELEASE_AND_INTAKE');
      check(row.card_id === item.cardId && row.source_hash === intake.sourceHash && SHA.test(row.key) && UUID.test(row.analysis_action_id));
      stored(row, 'input'); const evidence = JSON.parse(row.evidence);
      check(['REVIEW','APPROVED'].includes(row.state) && row.stage === 'REPORT' && evidence.authority === 'MACHINE_PROPOSAL');
      check(time(row.created_at) >= time(intake.createdAt) && time(row.updated_at) <= end && time(row.updated_at) >= time(row.created_at));
      output.timings.batchObservedElapsedMs = time(row.updated_at) - time(row.created_at);
      return { ...row, evidence };
    });
    const provider = await step('providerEvidence', item.provider, async value => {
      check(job, 'DEPENDENCY_BATCH_JOB'); const run = value.run, binding = stored(run, 'binding'), evidence = stored(run, 'request_evidence', 'evidence_hash');
      check(run.card_id === item.cardId && run.action_id === job.analysis_action_id && binding.sourceHash === intake.sourceHash
        && evidence.model === 'gpt-6-astra' && evidence.reasoningEffort === 'xhigh' && run.state === 'DISPATCHED');
      const received = boundedArray(value.receipts, 20).filter(row => row.kind === 'RESPONSE' && JSON.parse(row.evidence).state === 'READY');
      check(received.length === 1, 'READY_PROVIDER_RECEIPT_REQUIRED'); const row = received[0], receipt = JSON.parse(row.evidence);
      check(row.analysis_id === run.id && row.request_hash === run.request_hash && SHA.test(receipt.responseHash));
      const request = await reader.read(value.request), responseArtifact = await reader.read(value.response), result = await reader.read(value.result);
      check(value.response.sha256 === receipt.responseRef.sha256 && value.result.sha256 === receipt.resultRef.sha256
        && responseArtifact.analysisId === run.id && responseArtifact.requestHash === run.request_hash);
      const responseBytes = Buffer.from(responseArtifact.base64, 'base64'), response = JSON.parse(responseBytes.toString('utf8'));
      check(responseBytes.toString('base64') === responseArtifact.base64 && digest(responseBytes) === receipt.responseHash
        && responseArtifact.sha256 === receipt.responseHash && value.request.sha256 === run.request_hash
        && request.model === evidence.model && request.reasoning?.effort === evidence.reasoningEffort && response.id === receipt.responseId);
      check(time(run.created_at) >= time(job.created_at) && time(run.dispatched_at) >= time(run.created_at)
        && time(row.recorded_at) >= time(run.dispatched_at) && time(row.recorded_at) <= end);
      output.timings.providerDispatchToReceiptMs = time(row.recorded_at) - time(run.dispatched_at);
      output.provider = { analysisId: run.id, requestHash: run.request_hash, responseHash: receipt.responseHash,
        usage: receipt.usage == null ? null : Object.fromEntries(['input_tokens','output_tokens','total_tokens','cached_input_tokens','reasoning_output_tokens']
          .filter(key => Number.isSafeInteger(receipt.usage?.[key]) && receipt.usage[key] >= 0).map(key => [key,receipt.usage[key]])),
        billingVerified: false };
      return { run, binding, receipt, result };
    });
    const machine = await step('machineProposal', item.machineReport, async report => {
      check(provider, 'DEPENDENCY_PROVIDER_EVIDENCE');
      check(report.version === 'atlas-machine-provisional-report-v1' && report.authority === 'MACHINE_PROPOSAL' && report.certification === null
        && report.cardId === item.cardId && report.sourceHash === intake.sourceHash && report.analysisId === provider.run.id
        && digest(JSON.stringify(report)) === job.evidence.reportHash && report.manualRevision === job.evidence.manualRevision
        && report.manualContentHash === job.evidence.manualContentHash);
      check(report.analysisResultHash === digest(canonical(provider.result.proposals.map(proposal => ({ ...proposal, reviewStatus: 'UNREVIEWED' })))));
      for (const side of SIDES) check(report.geometry[side].frame.originalSha256 === capture.originalSha256[side]);
      output.machineFindingCount = boundedArray(report.findings, 256).length;
    });
    const human = await step('humanApproval', item.human, async value => {
      check(machine, 'DEPENDENCY_MACHINE_PROPOSAL'); const row = value.approval, action = value.action;
      check(row.card_id === item.cardId && action.card_id === item.cardId && row.action_id === action.action_id && row.actor_id === action.actor_id);
      const request = stored(action, 'request'), result = JSON.parse(action.result), { draft, approval } = approvedPublicationSource({ ...row, result: action.result });
      check(request.actionId === row.action_id && request.action.type === 'APPROVE_REPORT' && request.action.reviewed === true
        && request.action.reportHash === row.report_hash && request.expectedRevision === row.source_revision
        && draft.source.sourceHash === intake.sourceHash && result.receipt.actorId === row.actor_id);
      const finalReport = await reader.read(value.finalReport);
      check(approval.version === 'atlas-manual-report-snapshot-v2' && finalReport.version === 'atlas-manual-draft-report-v2'
        && value.finalReport.sha256 === approval.report.ref.sha256 && digest(JSON.stringify(finalReport)) === approval.report.sourceHash
        && finalReport.inspection.method === 'HUMAN' && SIDES.every(side => finalReport.inspection[side.toLowerCase()].inspected === true));
      check(['identity','grade','finalGrade','finalGradePolicy','ruleVersion'].every(key => exact(approval[key], finalReport[key])));
      check(value.decision.version === 'atlas-acceptance-human-decision-v1' && value.decision.scope === manifest.scope
        && value.decision.actorId === row.actor_id && value.decision.cardId === item.cardId
        && value.decision.reportHash === row.report_hash && value.decision.approvalActionId === row.action_id
        && value.decision.physicalCardInspected === true && value.decision.bothEvidenceSidesInspected === true);
      check(boundedArray(value.decision.receipts, 10).length > 0, 'HUMAN_ATTESTATION_RECEIPT_REQUIRED');
      for (const ref of value.decision.receipts) await reader.read(ref);
      check(time(row.approved_at) >= time(value.decision.reviewStartedAt) && time(row.approved_at) <= time(value.decision.observedAt)
        && time(value.decision.reviewStartedAt) >= start && time(value.decision.observedAt) <= end);
      output.timings.humanReviewWallMs = time(row.approved_at) - time(value.decision.reviewStartedAt);
      output.approval = { actionId: row.action_id, reportHash: row.report_hash, sourceHash: row.source_hash };
      return row;
    });
    const publication = await step('publicVersion', item.publication, async value => {
      check(human, 'DEPENDENCY_HUMAN_APPROVAL'); const row = value.publication, packet = value.publicResponse?.packet;
      check(row.card_id === item.cardId && row.action_id === human.action_id && row.state === 'PUBLISHED'
        && row.mode === (manifest.scope === 'REAL_CARD' ? 'PRODUCTION' : 'LOCAL_FIXTURE'));
      const saved = stored(row, 'manifest');
      check(packet?.version === 'atlas-public-manual-report-v2' && saved.publicHash === row.public_hash && saved.packet.sourceHash === row.public_hash && saved.packet.ref.sha256 === row.public_hash
        && value.publicResponse.publicHash === row.public_hash && digest(JSON.stringify(packet)) === row.public_hash
        && packet.approvalVersion === row.version && packet.reportHash === human.report_hash && packet.mode === row.mode
        && packet.approvedAt === new Date(human.approved_at).toISOString());
      const approval = JSON.parse(human.report);
      check(['identity','grade','finalGrade','finalGradePolicy','ruleVersion'].every(key => exact(approval[key], packet.report[key])));
      const url = `https://atlasgrading.com/reports/${packet.publicToken}?v=${row.version}`;
      check(/^ar_[A-Za-z0-9_-]{24}$/.test(packet.publicToken) && value.requestedUrl === url && value.httpStatus === 200);
      check(time(row.published_at) >= time(human.approved_at) && time(value.fetchedAt) >= time(row.published_at) && time(value.fetchedAt) <= end);
      output.publication = { version: row.version, publicHash: row.public_hash };
      return { row, packet, url };
    });
    const plan = await step('finishingPlan', item.finishing?.plan, async value => {
      check(publication, 'DEPENDENCY_PUBLICATION'); validateManualFinishingPlan(value);
      check(value.binding.cardId === item.cardId && value.binding.approvalActionId === human.action_id
        && value.binding.publicHash === publication.row.public_hash && value.binding.reportHash === human.report_hash
        && value.binding.sourceHash === human.source_hash && value.binding.sourceRevision === human.source_revision
        && value.binding.approvalVersion === publication.row.version && value.label.url === publication.url);
    });
    for (const kind of ['PRINT','NFC','ASSEMBLY','WELDING']) await step(kind.toLowerCase(), item.finishing?.[kind.toLowerCase()], async value => {
      check(plan, 'DEPENDENCY_FINISHING_PLAN');
      check(value.version === 'atlas-acceptance-finishing-observation-v1' && value.scope === manifest.scope && value.kind === kind
        && value.cardId === item.cardId && value.approvalActionId === human.action_id && value.publicHash === publication.row.public_hash
        && value.planHash === plan.planHash && UUID.test(value.observerId) && RESULTS.includes(value.status));
      check(time(value.observedAt) >= time(human.approved_at) && time(value.observedAt) <= end);
      if (value.status === 'PASS') {
        check(value.physicalObservation === true && boundedArray(value.receipts, 20).length > 0, 'PHYSICAL_RECEIPTS_REQUIRED');
        for (const ref of value.receipts) await reader.read(ref);
      }
      output.observations.push({ kind, status: value.status, attestationOnly: true });
    });
    await step('firstObservations', item.observations, async value => {
      check(value.version === 'atlas-acceptance-observations-v1' && value.cardId === item.cardId && value.scope === manifest.scope);
      for (const observation of boundedArray(value.entries, 100)) {
        check(RESULTS.includes(observation.status) && /^[A-Za-z0-9_-]{1,80}$/.test(observation.check)
          && UUID.test(observation.observerId) && time(observation.observedAt) >= start && time(observation.observedAt) <= end);
        check(typeof observation.note === 'string' && observation.note.trim().length > 0 && observation.note.length <= 4000);
        output.observations.push({ check: observation.check, status: observation.status, observedAt: observation.observedAt });
      }
    });
  }
  const softwareStages = ['freshCaptureAttestation','originalsAndIntake','batchJob','providerEvidence','machineProposal','humanApproval','publicVersion'];
  const softwareEvidenceMatched = manifest.cards.length === manifest.target && Boolean(release) && (manifest.target === 1 || Boolean(checkpoint))
    && cards.every(card => softwareStages.every(name => card.checks.some(check => check.stage === name && check.status === 'MATCHED')));
  return { version: 'atlas-real-card-evidence-summary-v1', scope: manifest.scope, cohortId: manifest.cohortId,
    target: manifest.target, recordedCards: cards.length, startedAt: manifest.startedAt, observedThrough: manifest.observedThrough,
    release: release ? { sourceCommit: release.sourceCommit, nativeImageDigest: release.nativeImageDigest,
      staffDeploymentId: release.staffDeploymentId, publicDeploymentId: release.publicDeploymentId } : null,
    checks: issues, cards, softwareEvidenceMatched, realCardAcceptance: 'NOT_DETERMINED_BY_COLLECTOR',
    scaleDecision: 'REQUIRES_PRIOR_CHECKPOINT_AND_EXPLICIT_HUMAN_DECISION',
    limitations: ['Local file integrity and cross-binding checks only; source authenticity and completeness require independent custody review.',
      'Human/physical statements are retained attestations, not observations made by this program.',
      'Elapsed intervals include waits; no active-work, throughput, billing, accuracy or learning-improvement claim is inferred.',
      'Historical failures remain in observations; matching later evidence does not erase them.'],
    artifacts: reader.receipts };
}

export function template() { return { version: VERSION, scope: 'REAL_CARD', cohortId: 'SET_BY_LEAD', target: 1,
  startedAt: null, observedThrough: null, release: null, priorOriginalSha256: [], cards: [] }; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--template') console.log(JSON.stringify(template(), null, 2));
    else {
      check(process.argv.length === 5 && process.argv[2] === '--check', 'USAGE_CHECK_MANIFEST_EVIDENCE_ROOT');
      const handle = await open(resolve(process.argv[3]), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try { check((await handle.stat()).size <= 1024 * 1024, 'MANIFEST_TOO_LARGE'); bytes = await handle.readFile(); } finally { await handle.close(); }
      const summary = await collectAcceptance(JSON.parse(bytes.toString('utf8')), await evidenceReader(process.argv[4]));
      console.log(JSON.stringify({ ...summary, manifestSha256: digest(bytes) }, null, 2));
      if (summary.checks.some(x => x.status === 'FAIL') || summary.cards.some(card => card.checks.some(x => x.status === 'FAIL'))) process.exitCode = 2;
      else if (!summary.softwareEvidenceMatched) process.exitCode = 3;
    }
  } catch (error) { console.error(JSON.stringify({ error: /^[A-Z_]{1,80}$/.test(error.message) ? error.message : 'ACCEPTANCE_EVIDENCE_INVALID' })); process.exitCode = 1; }
}
