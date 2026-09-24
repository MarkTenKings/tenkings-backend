import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createPhotoStorage } from '@atlas/photo-storage';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const refusal = status => Object.assign(new Error('Synthetic S3 refusal'), { name: status === 404 ? 'NotFound' : 'PreconditionFailed', $metadata: { httpStatusCode: status } });

// Exact-byte SDK fixture. No network, bucket configuration or real credential.
export function memoryPhotoStorage() {
  const objects = new Map(), calls = []; let sequence = 0;
  const record = input => {
    const value = { bytes: Buffer.from(input.Body), ContentType: input.ContentType, Metadata: structuredClone(input.Metadata),
      VersionId: `fixture-${++sequence}`, ETag: `"fixture-${sequence}"` };
    objects.set(input.Key, [...(objects.get(input.Key) ?? []), value]); return value;
  };
  const client = { async send(command) {
    const { input } = command, name = command.constructor.name; calls.push({ name, input });
    if (name === 'PutObjectCommand') {
      assert.equal(input.IfNoneMatch, '*'); assert.equal(input.ContentLength, input.Body.length);
      assert.equal(input.ChecksumSHA256, Buffer.from(sha(input.Body), 'hex').toString('base64'));
      if (objects.has(input.Key)) throw refusal(412);
      const result = record(input); return { VersionId: result.VersionId };
    }
    const values = objects.get(input.Key) ?? [], value = input.VersionId ? values.find(item => item.VersionId === input.VersionId) : values.at(-1);
    if (!value) throw refusal(404);
    if (input.IfMatch && input.IfMatch !== value.ETag) throw refusal(412);
    const result = { ContentLength: value.bytes.length, ContentType: value.ContentType, Metadata: value.Metadata,
      VersionId: value.VersionId, ETag: value.ETag, ChecksumSHA256: Buffer.from(sha(value.bytes), 'hex').toString('base64') };
    if (name === 'GetObjectCommand') return { ...result, Body: Readable.from([value.bytes]) };
    assert.equal(name, 'HeadObjectCommand'); return result;
  } };
  const storage = createPhotoStorage({ client, bucket: 'synthetic-private', keyPrefix: 'intake',
    limits: { maxObjectBytes: 96 * 1024 * 1024, timeoutMs: 2000 },
    sign: async (_client, command) => { calls.push({ name: 'SignedPut', input: command.input }); return 'https://storage.invalid/synthetic-signed'; } });
  return { storage, objects, calls, record };
}
export function memoryJournal() {
  const entries = new Map();
  return { entries, get: async key => entries.get(key), put: async (key, value) => { entries.set(key, value); },
    remove: async key => { entries.delete(key); }, list: async () => [...entries].map(([id, value]) => ({ id, value })) };
}
