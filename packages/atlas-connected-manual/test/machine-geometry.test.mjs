import test from 'node:test';
import assert from 'node:assert/strict';
import { machineGeometryCandidate, machineGeometryReview, PRINTED_CANDIDATE_POLICY } from '../src/machine-geometry.mjs';

const quad = [{ x: .1, y: .08 }, { x: .9, y: .08 }, { x: .9, y: .92 }, { x: .1, y: .92 }];
function candidate() {
  return { mode: 'PRINTED_FRAME', outcome: 'ABSTAIN', authority: 'PROPOSER_ONLY', proposal: null,
    ambiguity: { ambiguous: true }, advisory: { code: 'AMBIGUOUS_PRINTED_FRAME' },
    diagnosticCandidate: { policy: PRINTED_CANDIDATE_POLICY, authority: 'PROPOSER_ONLY', reason: 'AMBIGUOUS_SUPPORTED_TRANSITIONS', quad },
    sideEvidence: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side,
      { medianContrastDeltaE: 20, supportFraction: .8, sampleCount: 200, candidateCount: 2 }])) };
}
test('supported ambiguous candidate is usable without rewriting native refusal or asserting human review', () => {
  const proposal = candidate(), before = structuredClone(proposal), result = machineGeometryCandidate(proposal);
  assert.deepEqual(result, { quad, ambiguous: true, provisional: true });
  assert.deepEqual(proposal, before);
});
for (const [name, change] of [
  ['missing candidate', p => { p.diagnosticCandidate = null; }],
  ['unversioned candidate', p => { delete p.diagnosticCandidate.policy; }],
  ['physical diagnostic', p => { p.mode = 'PHYSICAL_OUTER'; }],
  ['engine error', p => { p.advisory.code = 'COLOR_ENGINE_ERROR'; }],
  ['no printed frame', p => { p.outcome = 'NOT_APPLICABLE'; }],
  ['incomplete frame', p => { p.outcome = 'INSUFFICIENT_EVIDENCE'; }],
  ['untrusted authority', p => { p.authority = 'HUMAN'; }],
  ['weak contrast', p => { p.sideEvidence.left.medianContrastDeltaE = 11.99; }],
  ['weak support', p => { p.sideEvidence.left.supportFraction = .5499; }],
  ['unobserved edge', p => { p.sideEvidence.left.sampleCount = 0; }],
  ['missing edge candidate', p => { p.sideEvidence.left.candidateCount = 0; }],
  ['out-of-bounds quad', p => { p.diagnosticCandidate.quad = quad.map((v, i) => i ? v : { x: -0.01, y: .08 }); }],
  ['self-crossing quad', p => { p.diagnosticCandidate.quad = [quad[0], quad[2], quad[1], quad[3]]; }],
]) test(`${name} cannot become a machine border`, () => {
  const proposal = candidate(); change(proposal); assert.equal(machineGeometryCandidate(proposal), null);
});
test('complete accepted proposals keep exact pixels and ambiguity; invalid quads are never clamped', () => {
  const p = { outcome: 'ACCEPTED', proposal: quad, ambiguity: { ambiguous: true } };
  assert.deepEqual(machineGeometryCandidate(p), { quad, ambiguous: true, provisional: false });
  p.proposal = quad.map((v, i) => i ? v : { x: -0.01, y: .08 });
  assert.equal(machineGeometryCandidate(p), null);
});
test('final geometry review explicitly distinguishes unresolved from usable unconfirmed geometry', () => {
  const geometry = { sides: { FRONT: { physical: { quad }, prepared: {}, printed: { quad, proposal: { ambiguous: true } }, confirmation: null },
    BACK: { physical: { quad }, prepared: {}, printed: null, confirmation: null } } };
  const result = machineGeometryReview(geometry);
  assert.equal(result.requiresHumanConfirmation, true);
  assert.deepEqual(result.sides.FRONT, { machineUsable: true, ambiguous: true, confirmed: false, unresolved: [] });
  assert.deepEqual(result.sides.BACK, { machineUsable: true, ambiguous: false, confirmed: false, unresolved: ['PRINTED_GEOMETRY_UNRESOLVED'] });
});
