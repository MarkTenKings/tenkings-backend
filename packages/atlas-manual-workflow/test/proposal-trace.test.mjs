import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { measurableProposalEdit, proposalEdit } from '../src/proposal-review.mjs';
import { checkedSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
const fixtures = JSON.parse(readFileSync(new URL('../../atlas-grading-core/test/fixtures/trace-bitmap-frozen.json', import.meta.url)));

test('machine edit uses the same independently frozen trace and provenance as the existing proposal tool', () => {
  for (const f of fixtures.cases) {
    const before = structuredClone(f.proposal), edit = measurableProposalEdit(f.proposal, f.proposal.side, f.cornerShape);
    assert.deepEqual(f.proposal, before);
    if (!f.expected.pixelCount) {
      assert.equal(edit, null);
      assert.throws(() => proposalEdit(f.proposal, f.proposal.side, f.cornerShape), /must be non-empty/);
      continue;
    }
    assert.deepEqual(edit, proposalEdit(f.proposal, f.proposal.side, f.cornerShape));
    assert.equal(edit.traceWire.rleSha256, f.expected.rleSha256);
    assert.equal(edit.traceProvenance.finalTraceSha256, f.expected.rleSha256);
    assert.equal(edit.traceProvenance.sourceViewId, f.proposal.side + ':inspection');
    assert.equal(createHash('sha256').update(checkedSpeedsterTraceBitmapWireV1(edit.traceWire).pixels).digest('hex'), f.expected.pixelSha256);
  }
});
