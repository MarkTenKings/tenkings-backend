import { deflateSync } from 'node:zlib';
import { hash, hashBytes, immutable } from '../src/strict.mjs';
import { TOOLS_HASH, TOOL_NAMES } from '../src/contracts.mjs';
import { initialStore } from '../src/store.mjs';
import { createCard, recordRegionDelivery, recordDraftPackage } from '../src/workflow.mjs';
import { compiledInstructions } from '../src/responses.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function syntheticPng(width, height, value) {
  const chunk = (kind, bytes) => { const type = Buffer.from(kind); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes]))); return Buffer.concat([length, type, bytes, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8;
  const pixels = Buffer.alloc((width + 1) * height, value); for (let row = 0; row < height; row++) pixels[row * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export const fixturePrompt = 'Offline contract fixture. Report uncertainty; only prepare a review draft.';
export const fixtureBytes = { FRONT: syntheticPng(8, 10, 200), BACK: syntheticPng(8, 10, 50) };
export function fixture(suffix = 'a') {
  const originals = ['FRONT', 'BACK'].map(side => ({ assetId: `${side.toLowerCase()}_${suffix}`, sha256: hashBytes(fixtureBytes[side]), side, width: 8, height: 10, sourceAssetId: `${side.toLowerCase()}_${suffix}`, sourceSha256: hashBytes(fixtureBytes[side]), kind: 'ORIGINAL', sourceRect: null, transformHash: hash({ type: 'IDENTITY' }) }));
  const evidence = { schemaVersion: 'atlas-evidence-v1', specimenId: `specimen_${suffix}`, cardId: `card_${suffix}`, originals, assets: [], rawFindings: [{ findingId: 'raw_visible', side: 'FRONT', sourceSha256: originals[0].sha256, maskHash: hash('mask_1'), disposition: 'DETECTED', reasonCodes: [] }, { findingId: 'raw_suppressed', side: 'BACK', sourceSha256: originals[1].sha256, maskHash: hash('mask_2'), disposition: 'SUPPRESSED', reasonCodes: ['MAP_ZONE'] }] };
  const manifest = { schemaVersion: 'atlas-run-manifest-v1', mode: 'OFFLINE_REFERENCE', batchId: 'batch_synthetic', runId: `run_${suffix}`, evidenceHash: hash(evidence), model: 'gpt-6-astra', effort: 'medium', expectedReturnedModel: 'gpt-6-astra', promptHash: hash(compiledInstructions(fixturePrompt)), toolsHash: TOOLS_HASH, ...Object.fromEntries(['rulesHash', 'mapRevisionHash', 'memorySnapshotHash', 'workerReleaseHash', 'checkpointHash', 'gpuPolicyHash', 'determinismPolicyHash', 'pricingPolicyHash', 'capturePolicyHash', 'rendererHash'].map(k => [k, hash(`synthetic_${k}`)])) };
  return { evidence, manifest };
}
export const caps = { batchMicroUsd: 10000, cardMicroUsd: 5000, maxAttempts: 3, maxProviderAttempts: 12, maxToolCalls: 60, maxStageDurationMs: 300000, maxCardDurationMs: 900000, deadlineMs: 1000000 };
export class MemoryStore {
  constructor(initial = initialStore('batch_synthetic', caps)) { this.data = structuredClone(initial); }
  read() { return immutable(structuredClone(this.data)); }
  transaction(fn, failpoint) { const copy = structuredClone(this.data); const result = fn(copy); copy.version++; if (failpoint === 'BEFORE_RENAME') throw new Error('SIMULATED_CRASH_BEFORE_COMMIT'); this.data = copy; if (failpoint === 'AFTER_RENAME') throw new Error('SIMULATED_CRASH_AFTER_COMMIT'); return immutable(structuredClone(result ?? null)); }
}
export function setup(store = new MemoryStore(), suffix = 'a') {
  const { evidence, manifest } = fixture(suffix); createCard(store, evidence, manifest, 1);
  return { store, evidence, manifest, cardId: evidence.cardId, get card() { return store.read().cards[evidence.cardId]; } };
}
export const capability = card => ({ audience: 'atlas-machine', subject: 'synthetic_machine', cardId: card.cardId, specimenId: card.specimenId, runId: card.runId, evidenceHash: card.evidenceHash, runManifestHash: card.runManifestHash, tools: [...TOOL_NAMES], notBeforeMs: 0, expiresAtMs: 900000 });
export const principal = card => ({ audience: 'atlas-staff', subject: 'synthetic_human', cardIds: [card.cardId], capabilities: ['review:certification'], trained: true, authenticatedAtMs: 0, expiresAtMs: 900000, assuranceRef: 'synthetic_assurance', rosterHash: hash('synthetic_roster') });
export const binding = (card, operationId = 'operation_a') => ({ operationId, cardId: card.cardId, runId: card.runId, expectedRevision: card.revision, evidenceHash: card.evidenceHash, runManifestHash: card.runManifestHash });
export const citation = (card, side = 'FRONT') => { const a = card.evidence.originals.find(a => a.side === side); return { assetId: a.assetId, sha256: a.sha256, side }; };
export function deliverAll(f) {
  for (const a of f.card.evidence.originals) recordRegionDelivery(f.store, f.cardId, f.card.revision, a.assetId, { x: 0, y: 0, width: 8, height: 10 }, fixtureBytes[a.side], fixtureBytes[a.side], { runManifestHash: f.card.runManifestHash, requestId: `req_${a.side}`, responseId: `resp_${a.side}`, status: 'COMPLETED' }, 2);
}
export function draftReceipt(card) {
  return { mode: 'SYNTHETIC_ADAPTER', revision: card.revision, evidenceHash: card.evidenceHash, runManifestHash: card.runManifestHash, proposalSetHash: hash(card.proposals), coverageHash: hash(card.coverage.filter(r => r.revision === card.revision)), rulesHash: card.manifest.rulesHash, rendererHash: card.manifest.rendererHash, workerReleaseHash: card.manifest.workerReleaseHash, rawFindingIds: card.evidence.rawFindings.map(f => f.findingId), ...Object.fromEntries(['identity', 'geometry', 'detection', 'grade', 'report', 'label'].map(k => [k, hash(`synthetic_${k}`)])) };
}
export function prepareDraft(f) { deliverAll(f); return recordDraftPackage(f.store, f.cardId, f.card.revision, draftReceipt(f.card), 3); }
