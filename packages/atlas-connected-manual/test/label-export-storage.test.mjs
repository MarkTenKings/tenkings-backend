import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { digest } from '@atlas/manual-service/contract';
import { createLabelExportStorage } from '../src/label-export-storage.mjs';

function fixture({ lostReply = false, corrupt = false, hanging = false, versioned = true, timeoutMs = 60000 } = {}) {
  const objects = new Map(), calls = []; let signed, destroyed = false;
  const client = { async send(command) {
    const name = command.constructor.name, input = command.input; calls.push({ name, input });
    if (name === 'PutObjectCommand') {
      assert.equal(input.IfNoneMatch, '*'); assert.equal(input.ContentType, 'image/png');
      if (objects.has(input.Key)) throw { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } };
      objects.set(input.Key, { bytes: Buffer.from(input.Body), metadata: input.Metadata });
      if (lostReply) throw new Error('fixture lost reply'); return versioned ? { VersionId: 'v1' } : {};
    }
    const found = objects.get(input.Key); if (!found) throw { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } };
    return { ContentLength: found.bytes.length, ContentType: 'image/png', Metadata: found.metadata, ETag: 'fixture-etag', ...(versioned ? { VersionId: 'v1' } : {}),
      ...(name === 'GetObjectCommand' ? { Body: hanging ? { [Symbol.asyncIterator]() { return this; }, next() { return new Promise(() => {}); }, destroy() { destroyed = true; } } : Readable.from([corrupt ? Buffer.alloc(found.bytes.length) : found.bytes]) } : {}) };
  } };
  const store = createLabelExportStorage({ client, bucket: 'atlas-fixture', keyPrefix: 'atlas/label-exports', timeoutMs, sign: async (_client, command, options) => {
    signed = { command, options }; return 'https://objects.example.invalid/immutable?signature=fixture';
  } });
  const bytes = Buffer.alloc(40); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.writeUInt32BE(6458,16); bytes.writeUInt32BE(1898,20);
  const binding = { exportId: randomUUID(), manifestHash: digest('manifest'), kind: 'SINGLE' };
  return { store, client, binding, bytes, calls, objects, get destroyed() { return destroyed; }, get signed() { return signed; } };
}

test('conditional binary write, whole-byte readback, one immutable key and short signed GET', async () => {
  const f = fixture(), sha256 = digest(f.bytes);
  const saved = await f.store.write(f.binding, f.bytes, { sha256 });
  assert.deepEqual(await f.store.write(f.binding, f.bytes, { sha256 }), saved);
  assert.equal(f.calls.filter(c => c.name === 'PutObjectCommand').length,1);
  const download = await f.store.download(f.binding, saved); assert.match(download.url,/^https:/);
  assert.equal(f.signed.options.expiresIn,60); assert.equal(f.signed.command.input.VersionId,'v1');
  assert.match(f.signed.command.input.ResponseContentDisposition,/attachment/);
  assert.equal(JSON.stringify(saved).includes('signature'),false);
});
test('lost PUT response reconciles saved body instead of a new key or write', async () => {
  const f = fixture({ lostReply:true }); const saved = await f.store.write(f.binding, f.bytes, { sha256:digest(f.bytes) });
  assert.equal(saved.byteCount,f.bytes.length); assert.equal(f.objects.size,1); assert.equal(f.calls.filter(c => c.name === 'PutObjectCommand').length,1);
});
test('wrong bytes, dimensions, object scope, metadata and changed readback are refused', async () => {
  const f = fixture(); await assert.rejects(f.store.write(f.binding,f.bytes,{sha256:digest('other')}),{code:'LABEL_PNG_INVALID'});
  const wide = Buffer.from(f.bytes); wide.writeUInt32BE(13000,16);
  await assert.rejects(f.store.write(f.binding,wide,{sha256:digest(wide)}),{code:'LABEL_PNG_INVALID'});
  const saved = await f.store.write(f.binding,f.bytes,{sha256:digest(f.bytes)});
  await assert.rejects(f.store.download({...f.binding,exportId:randomUUID()},saved),{code:'LABEL_STORAGE_SCOPE_INVALID'});
  f.objects.get(saved.object.key).metadata = {};
  await assert.rejects(f.store.download(f.binding,saved),{code:'LABEL_STORAGE_CONFLICT'});
  const bad = fixture({corrupt:true}); await assert.rejects(bad.store.write(bad.binding,bad.bytes,{sha256:digest(bad.bytes)}),{code:'LABEL_STORAGE_CONFLICT'});
});

test('noncooperative body is timed out and destroyed without pinning the worker', async () => {
  const f = fixture({ hanging:true, timeoutMs:25 }); const keepAlive = setTimeout(() => {},1000);
  try { await assert.rejects(f.store.write(f.binding,f.bytes,{sha256:digest(f.bytes)}),{name:'TimeoutError'}); assert.equal(f.destroyed,true); }
  finally { clearTimeout(keepAlive); }
});
test('actual SDK unversioned URL needs only the browser host header', async () => {
  const f = fixture({versioned:false}); const saved = await f.store.write(f.binding,f.bytes,{sha256:digest(f.bytes)});
  const client = new S3Client({region:'us-east-1',endpoint:'https://objects.example.invalid',forcePathStyle:true,credentials:{accessKeyId:'FIXTURE',secretAccessKey:'fixture-only'}});
  client.send = f.client.send;
  const store = createLabelExportStorage({client,bucket:'atlas-fixture',keyPrefix:'atlas/label-exports'});
  const result = await store.download(f.binding,saved), url=new URL(result.url);
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'),'host');assert.equal(url.searchParams.get('X-Amz-Expires'),'60');
  assert(!url.searchParams.has('versionId')); client.destroy();
});
