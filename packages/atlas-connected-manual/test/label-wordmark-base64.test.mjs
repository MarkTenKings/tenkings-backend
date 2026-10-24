import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLabelWordmarkBase64 } from '../src/label-wordmark-image.mjs';
import { LABEL_WORDMARK_LIMITS } from '../src/label-wordmark-contract.mjs';

test('large image envelopes decode without recursive-regexp stack growth and stay canonical', () => {
  // This decoder checks the transport envelope; PNG decoding follows separately.
  const bytes = Buffer.alloc(LABEL_WORDMARK_LIMITS.imageBytes, 181);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const encoded = bytes.toString('base64');
  assert.deepEqual(decodeLabelWordmarkBase64(encoded), bytes);
  for (const invalid of [encoded + 'AAAA', encoded.slice(0,-4) + 'A===', encoded.slice(0,-4) + '=AAA', encoded + '\n'])
    assert.throws(() => decodeLabelWordmarkBase64(invalid), /LABEL_WORDMARK_IMAGE_INVALID/);
});
