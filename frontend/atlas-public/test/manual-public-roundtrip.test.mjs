import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyManualPublicRoundtrip } from '../scripts/manual-public-fixture.mjs';
test('current publication crosses the real signed HTTP bridge into the public reader and approved renderer', async () => {
    const result = await qualifyManualPublicRoundtrip();
    assert.equal(result.ok, true);
    assert.ok(result.requests > 0); assert.ok(result.publicationReads > result.requests);
});
