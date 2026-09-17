import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/contract.mjs';
import { createManualArtifactStore, createS3ManualArtifactTransport } from '../src/artifacts.mjs';

class PutObjectCommand { constructor(input) { this.input = input; } }
class GetObjectCommand { constructor(input) { this.input = input; } }
const checksum = bytes => Buffer.from(digest(bytes), 'hex').toString('base64');
const source = { cardId: randomUUID(), kind: 'STORAGE_TEST', sourceHash: digest('synthetic-source') };
function fixture() {
  const calls = [], records = new Map();
  const state = { omitChecksum: false, corruptPut: false, response: value => value };
  const client = { async send(command) {
    calls.push(command);
    const input = command.input;
    if (command instanceof PutObjectCommand) {
      assert.equal(input.IfNoneMatch, '*');
      assert.equal(input.ChecksumAlgorithm, 'SHA256');
      assert.equal(input.ChecksumSHA256, checksum(input.Body));
      if (records.has(input.Key)) throw Object.assign(new Error('collision'), { $metadata: { httpStatusCode: 412 } });
      const bytes = Buffer.from(input.Body);
      if (state.corruptPut) bytes[bytes.length - 2] ^= 1;
      records.set(input.Key, { bytes, metadata: input.Metadata });
      return { $metadata: { httpStatusCode: 200 } };
    }
    assert.equal(input.ChecksumMode, 'ENABLED');
    const value = records.get(input.Key);
    if (!value) throw new Error('missing');
    const body = Readable.from([value.bytes]); state.lastBody = body;
    return state.response({ ContentLength: value.bytes.length, ContentType: 'application/json', Metadata: value.metadata,
      Body: body, ...(state.omitChecksum ? {} : { ChecksumSHA256: checksum(value.bytes) }) });
  } };
  const transport = createS3ManualArtifactTransport({ client, bucket: 'synthetic-private', PutObjectCommand, GetObjectCommand });
  return { calls, records, state, transport, store: createManualArtifactStore({ transport }) };
}

test('artifact transport snapshots and checks bytes before SDK I/O, with explicit algorithm and conditional create', async () => {
  const { calls, transport } = fixture(), bytes = Buffer.from('{}');
  const args = { key: 'synthetic-key', bytes, sha256: digest(bytes), lineageSha256: digest('lineage') };
  const pending = transport.putIfAbsent(args); bytes.fill(0);
  await pending;
  assert.deepEqual(calls[0].input.Body, Buffer.from('{}'));
  assert.throws(() => transport.putIfAbsent(args), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert.equal(calls.length, 1);
});

test('artifact readback remains SHA-bound when provider silently accepts corrupted PUT or omits native checksum', async () => {
  const bad = fixture(); bad.state.omitChecksum = true; bad.state.corruptPut = true;
  await assert.rejects(bad.store.write({ value: 1 }, source), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  assert.equal(bad.records.size, 1); assert.equal(bad.calls.filter(call => call instanceof PutObjectCommand).length, 1);
  assert.equal(bad.state.lastBody.destroyed, true);
  const good = fixture(); good.state.omitChecksum = true;
  const ref = await good.store.write({ value: 1 }, source);
  assert.deepEqual(await good.store.read(ref, source), { value: 1 });
  assert.deepEqual(await good.store.write({ value: 1 }, source), ref);
  assert.equal(good.records.size, 1);
});

test('artifact transport refuses contradictory native checksums, truncated bodies and response transformations', async () => {
  const { store, state } = fixture(), ref = await store.write({ value: 1 }, source);
  for (const change of [
    value => ({ ...value, ChecksumSHA256: checksum('wrong') }),
    value => ({ ...value, DeleteMarker: true }),
    value => ({ ...value, ContentEncoding: '' }),
    value => ({ ...value, ContentRange: '' }),
    value => { value.Body.destroy(); state.lastBody = Readable.from([Buffer.from('{')]); return { ...value, Body: state.lastBody }; },
  ]) {
    state.response = change;
    await assert.rejects(store.read(ref, source), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
    assert.equal(state.lastBody.destroyed, true);
  }
});

test('invalid artifact read bounds fail before SDK work', async () => {
  const { calls, transport } = fixture();
  for (const maxBytes of [0, -1, 16 * 1024 * 1024 + 1, Infinity]) {
    await assert.rejects(transport.read({ key: 'synthetic-key', maxBytes }), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  }
  assert.equal(calls.length, 0);
});
