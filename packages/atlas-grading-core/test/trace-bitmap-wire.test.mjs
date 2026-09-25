import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkedSpeedsterTraceBitmapWireV1, decodeSpeedsterTraceBitmapWireV1,
  encodeSpeedsterTraceBitmapWireV1, parseSpeedsterTraceBitmapWireV1 } from '../dist/trace-bitmap-wire.js';
import { encodeSpeedsterTraceRleV1 } from '../dist/trace-codec.js';
import { rasterizeSpeedsterCanonicalContour, clipSpeedsterTraceToEditorBounds } from '../dist/trace-editor.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/trace-bitmap-frozen.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const crop = { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1269, height: 1777 } };
const bitmap = f => clipSpeedsterTraceToEditorBounds(rasterizeSpeedsterCanonicalContour(f.proposal.canonicalContour), crop, f.cornerShape);
const wireFor = pixels => encodeSpeedsterTraceBitmapWireV1(pixels, encodeSpeedsterTraceRleV1(pixels).sha256);

test('checked decoding preserves independently frozen pixels, packed bytes, runs and hashes for six shapes', () => {
  assert.equal(fixtures.cases.length, 7);
  let measurable = 0;
  for (const f of fixtures.cases) {
    const pixels = bitmap(f);
    assert.equal(hash(pixels), f.expected.pixelSha256);
    assert.equal(pixels.reduce((sum, pixel) => sum + pixel, 0), f.expected.pixelCount);
    if (!f.expected.pixelCount) { assert.equal(f.expected.rleSha256, null); continue; }
    measurable++;
    const wire = wireFor(pixels), checked = checkedSpeedsterTraceBitmapWireV1(wire);
    assert.strictEqual(checked.wire, wire);
    assert.strictEqual(parseSpeedsterTraceBitmapWireV1(wire), wire);
    assert.equal(hash(Buffer.from(wire.dataBase64, 'base64')), f.expected.packedSha256);
    assert.equal(hash(checked.pixels), f.expected.pixelSha256);
    assert.equal(hash(decodeSpeedsterTraceBitmapWireV1(wire)), f.expected.pixelSha256);
    assert.equal(checked.rle.sha256, f.expected.rleSha256);
    assert.deepEqual(checked.rle.runs, f.expected.runs);
  }
  assert.equal(measurable, 6);
});

test('all decoder entry points preserve malformed metadata, alphabet, padding, hash and empty-mask rejection', () => {
  const wire = wireFor(bitmap(fixtures.cases[0]));
  const objectError = 'Speedster trace bitmap wire must be an object.';
  const fieldsError = 'Speedster trace bitmap wire must contain exactly the frozen fields.';
  const metadataError = 'Speedster trace bitmap metadata does not match TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1.';
  const alphabetError = 'Speedster trace bitmap dataBase64 must have the exact canonical length and alphabet.';
  const cases = [[null, objectError], [[], objectError], [{ ...wire, extra: true }, fieldsError]];
  for (const key of Object.keys(wire)) { const missing = { ...wire }; delete missing[key]; cases.push([missing, fieldsError]); }
  for (const [key, value] of [['format', 'wrong'], ['width', 1269], ['height', 1777], ['origin', 'BOTTOM_LEFT'],
    ['order', 'COLUMN'], ['bitOrder', 'LSB_FIRST'], ['byteLength', 1]]) cases.push([{ ...wire, [key]: value }, metadataError]);
  for (const dataBase64 of [null, '', '!' + wire.dataBase64.slice(1), '=' + wire.dataBase64.slice(1), ' ' + wire.dataBase64.slice(1)]) {
    cases.push([{ ...wire, dataBase64 }, alphabetError]);
  }
  cases.push([{ ...wire, rleSha256: 'A'.repeat(64) }, 'Speedster trace bitmap RLE SHA-256 is malformed.']);
  cases.push([{ ...wire, rleSha256: '0'.repeat(64) }, 'Speedster trace bitmap RLE SHA-256 does not match the decoded pixels.']);
  const padding = Buffer.from(wire.dataBase64, 'base64'); padding[padding.length - 1] |= 1;
  cases.push([{ ...wire, dataBase64: padding.toString('base64') }, 'Speedster trace bitmap final-byte padding bits must be zero.']);
  const changed = Buffer.from(wire.dataBase64, 'base64'); changed[100] ^= 128;
  cases.push([{ ...wire, dataBase64: changed.toString('base64') }, 'Speedster trace bitmap RLE SHA-256 does not match the decoded pixels.']);
  const emptyPreimage = 'TK_SPEEDSTER_TRACE_RLE_V1\n1270\n1778\nTOP_LEFT\nROW_MAJOR_Y_X\n0\n2258060\n';
  cases.push([{ ...wire, dataBase64: Buffer.alloc(282258).toString('base64'), rleSha256: hash(emptyPreimage) }, 'A saved Speedster trace must be non-empty.']);
  assert.equal(cases.length, 29);
  for (const decode of [checkedSpeedsterTraceBitmapWireV1, decodeSpeedsterTraceBitmapWireV1, parseSpeedsterTraceBitmapWireV1]) {
    for (const [value, message] of cases) assert.throws(() => decode(value), { name: 'Error', message });
  }
});

test('mutable wires and returned buffers never gain cached validation authority', () => {
  const pixels = bitmap(fixtures.cases[0]), wire = wireFor(pixels);
  const first = checkedSpeedsterTraceBitmapWireV1(wire);
  first.pixels.fill(0); first.rle.runs[0] = 0;
  assert.equal(hash(checkedSpeedsterTraceBitmapWireV1(wire).pixels), hash(pixels));
  const changed = pixels.slice(); changed[12345] ^= 1;
  Object.assign(wire, wireFor(changed));
  assert.equal(hash(checkedSpeedsterTraceBitmapWireV1(wire).pixels), hash(changed));
  assert.notEqual(hash(changed), hash(pixels));
  wire.rleSha256 = '0'.repeat(64);
  assert.throws(() => checkedSpeedsterTraceBitmapWireV1(wire), /does not match the decoded pixels/);
});
