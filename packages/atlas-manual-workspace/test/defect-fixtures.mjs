import { readFileSync } from 'node:fs';
import { createDefectWorkspace, adoptDefectProposals, defectBase, beginDefectEdit } from '../src/defect-actions.mjs';
import { createEmptySpeedsterTrace } from '@atlas/grading-core/trace-editor';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';

// Generated once by checked measure_manual_side on synthetic canonical masks
// with a hole and a disconnected component. No card/detector claim is made.
export const measurements = JSON.parse(readFileSync(new URL('./fixtures/defect-measurements.json', import.meta.url)));
export const clone = value => structuredClone(value);
export function workspace(proposals = true) {
  let state = createDefectWorkspace({ cardId: 'synthetic-card', profile: 'SPORTS', sides: Object.fromEntries(['FRONT', 'BACK'].map((side, index) => [side, {
    frame: { imageVersion: 1, preparationVersion: 1, frameId: `prepared-${side}`,
      originalSha256: String(index + 1).repeat(64), inspectionImageSha256: String(index + 3).repeat(64), rectifiedImageSha256: String(index + 5).repeat(64) },
    cornerShape: 'SQUARE',
  }])) });
  if (proposals) for (const side of ['FRONT', 'BACK']) state = adoptDefectProposals(state, {
    side, base: defectBase(state, side), findings: [clone(measurements[side])],
    source: { method: 'DETECTOR', version: 'synthetic-fixture-only', id: `fixture-${side}` },
  }).state;
  return state;
}
export function traceAction(side = 'FRONT', findingId = null, rect = [600, 600, 20, 20], id = `${side}:human-trace`) {
  const pixels = createEmptySpeedsterTrace(), [x, y, width, height] = rect;
  for (let row = y; row < y + height; row++) pixels.fill(1, row * 1270 + x, row * 1270 + x + width);
  const finalTrace = encodeSpeedsterTraceRleV1(pixels);
  return { type: 'TRACE_SAVE', side, findingId, trace: {
    ...(findingId === null ? { id, defectType: 'VISIBLE_WHITENING', sourceViewId: `${side}:inspection` } : {}),
    traceWire: encodeSpeedsterTraceBitmapWireV1(pixels, finalTrace.sha256), traceProvenance: {
      version: 'speedster-trace-provenance-v1', sourceViewId: `${side}:inspection`,
      cropTransform: { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1269, height: 1777 } },
      highlighterStrokes: [], finalTraceSha256: finalTrace.sha256,
    },
  } };
}
export function edit(state, action, side = 'FRONT') {
  return beginDefectEdit(state, { side, base: defectBase(state, side), actor: 'HUMAN', action }).state;
}
// Stub used only for state/provenance unit tests; runtime tests always call CPU.
export async function unchangedMeasurement(input) { return { defects: clone(input.findings), receipt: { test: 'state-only-stub' } }; }
