import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSearchMessage } from '../src/sold-reference-ui.mjs';

test('photo-review stage distinguishes saved listings from the provider search without fabricated progress', () => {
  assert.match(marketSearchMessage({ state: 'SEARCHING' }), /^Searching sold listings/);
  const message = marketSearchMessage({ state: 'SEARCHING', stage: 'READING_PHOTOS', progress: { returned: 240 } });
  assert.match(message, /^240 sold listings saved · Astra is reviewing photos/);
  assert.doesNotMatch(message, /Searching sold|photos checked|awaiting review|failed|unconfirmed/);
  assert.match(marketSearchMessage({ state: 'SEARCHING', stage: 'READING_PHOTOS' }), /^Sold listings saved · Astra is reviewing photos/);
});

test('only actual nonnegative counters describe photo progress and missing counters remain unknown', () => {
  const message = marketSearchMessage({ state: 'SEARCHING', stage: 'READING_PHOTOS',
    progress: { returned: 10, completed: 4, pending: 3, failed: 1, unknown: 1, unavailable: 1 } });
  assert.match(message, /4 photos checked · 3 awaiting review · 1 photo review failed · 1 review outcome unconfirmed · 1 without a photo/);
  const missing = marketSearchMessage({ state: 'SEARCHING', stage: 'READING_PHOTOS',
    progress: { returned: -1, completed: null, pending: '12', failed: -2, unknown: NaN, unavailable: Infinity } });
  assert.equal(missing, 'Sold listings saved · Astra is reviewing photos. Results update automatically.');
  assert.match(marketSearchMessage({ state: 'SEARCHING', stage: 'READING_PHOTOS', progress: { returned: 1, completed: 0, pending: 1 } }),
    /1 sold listing saved · Astra is reviewing photos · 0 photos checked · 1 awaiting review/);
});

test('queued retained work and terminal failures do not imply that photo reading is active', () => {
  const queued = marketSearchMessage({ state: 'QUEUED', stage: 'READING_PHOTOS', progress: { returned: 12 } });
  assert.match(queued, /12 sold listings saved · Astra photo review queued/); assert.doesNotMatch(queued, /is reviewing/);
  const failed = marketSearchMessage({ state: 'FAILED', stage: 'READING_PHOTOS', reason: 'MARKET_LABEL_RESPONSE_INVALID', progress: { returned: 12 } });
  assert.match(failed, /label-reading response could not be used/); assert.doesNotMatch(failed, /is reviewing|queued/);
  assert.equal(marketSearchMessage({ state: 'READY', stage: 'READING_PHOTOS', progress: { returned: 12 } }), '');
});
