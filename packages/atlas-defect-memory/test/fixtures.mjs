import { randomUUID } from 'node:crypto';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { defectBase, markDefectSideInspected, confirmDefectFindings } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { canonical, digest } from '../src/contract.mjs';

export const identity = { playerName: 'Owned synthetic fixture', year: '2026', manufacturer: 'Example', productSet: 'Synthetic Set', parallel: null, insert: null, cardNumber: '1' };
export function fixtures({ empty = false, cardId = randomUUID(), originalHashes = ['1'.repeat(64), '2'.repeat(64)] } = {}) {
  let state = structuredClone(workspace(!empty)); state.cardId = cardId;
  for (const [i, side] of ['FRONT', 'BACK'].entries()) state.sides[side].frame.originalSha256 = originalHashes[i];
  const geometry = { cardId, profile: 'SPORTS', sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { image: { originalSha256: state.sides[side].frame.originalSha256 } }])) };
  const finish = value => {
    for (const side of ['FRONT', 'BACK']) value = markDefectSideInspected(value, { side, base: defectBase(value, side), actor: 'HUMAN', inspected: true }).state;
    const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, defectBase(value, side)]));
    return { base, defects: confirmDefectFindings(value, { base, actor: 'HUMAN', reviewed: true }).state };
  };
  const completed = finish(state), objects = new Map();
  const artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent({ key, bytes, lineageSha256, contentType }) { if (!objects.has(key)) objects.set(key, { bytes, lineageSha256, contentType }); },
    async read({ key }) { return objects.get(key); },
  } });
  const createExemplar = async ({ card, trace, cropTransform }) => {
    // Descriptor/lineage fixture only; production host separately qualifies
    // actual PNG decoding/cropping. No real card or optical claim.
    const bytes = Buffer.from(`fixture-png:${card.cardId}:${JSON.stringify(cropTransform)}`);
    const cropValue = { pngBase64: bytes.toString('base64') }, cropHash = digest(JSON.stringify(cropValue)), traceHash = digest(JSON.stringify(trace));
    return { crop: { ref: await artifacts.write(cropValue, { cardId, kind: 'REVIEWED_CROP', sourceHash: cropHash }),
      sourceHash: cropHash, width: cropTransform.width, height: cropTransform.height, mime: 'image/png', sha256: digest(bytes) },
    trace: { ref: await artifacts.write(trace, { cardId, kind: 'REVIEWED_TRACE', sourceHash: traceHash }), sourceHash: traceHash, sha256: trace.sha256 }, cropTransform };
  };
  const draft = { version: 'atlas-manual-workflow-v2', source: { sourceHash: digest(`source:${cardId}`) },
    identity, geometry: { sourceHash: digest(`geometry:${cardId}`) }, defects: { sourceHash: digest(JSON.stringify(completed.defects)) } };
  const confirmation = { actionId: randomUUID(), actorId: randomUUID(), requestHash: digest('request'),
    card: { cardId, revision: 2, contentHash: digest(canonical(draft)), draft } };
  return { ...completed, cardId, draft, state, geometry, finish, artifacts, objects, confirmation, createExemplar,
    hydrate: async () => ({ geometry, defects: completed.defects, identity }) };
}
