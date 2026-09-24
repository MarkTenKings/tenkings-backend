import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest, inputCommand } from '../src/contract.mjs';
import { createManualArtifactStore, createS3ManualArtifactTransport } from '../src/artifacts.mjs';
import { createManualHandler } from '../src/http.mjs';
import { createManualService } from '../src/service.mjs';
import { createFileArtifactTransport } from '../scripts/file-artifacts.mjs';

const source = () => ({ cardId: randomUUID(), kind: 'DEFECTS', sourceHash: digest('source') });
function storage() {
  const records = new Map(); let failAfterPut = false;
  const transport = {
    async putIfAbsent({ key, bytes, lineageSha256, contentType }) {
      if (records.has(key)) throw new Error('exists');
      records.set(key, { bytes: Buffer.from(bytes), lineageSha256, contentType });
      if (failAfterPut) throw new Error('lost reply');
    },
    async read({ key }) { if (!records.has(key)) throw new Error('not found'); return records.get(key); },
  };
  return { transport, records, loseReply: () => { failAfterPut = true; } };
}
test('public actions reject forged authority, binaries and oversized metadata', () => {
  const input = { actionId: randomUUID(), expectedRevision: 1, action: { type: 'EDIT', actor: 'HUMAN' } };
  assert.throws(() => inputCommand(input), { code: 'MANUAL_CLIENT_AUTHORITY_FORBIDDEN' });
  assert.throws(() => inputCommand({ ...input, action: { type: 'EDIT', nested: { principal: {} } } }), { code: 'MANUAL_CLIENT_AUTHORITY_FORBIDDEN' });
  assert.throws(() => canonical({ traceWire: 'raw' }), { code: 'MANUAL_OBJECT_REFERENCE_REQUIRED' });
  assert.throws(() => canonical({ value: 'a'.repeat(8193) }), { code: 'MANUAL_OBJECT_REFERENCE_REQUIRED' });
  assert.throws(() => canonical({ value: Number.NaN }), { code: 'MANUAL_REQUEST_INVALID' });
});
test('artifact put lost reply and repeated write reconcile the identical immutable reference', async () => {
  const backend = storage(), artifacts = createManualArtifactStore({ transport: backend.transport }), bound = source();
  backend.loseReply();
  const content = { traceWire: { bitmapBase64: 'a'.repeat(376344) }, findingRevision: 7 };
  const first = await artifacts.write(content, bound), again = await artifacts.write(content, bound);
  assert.deepEqual(first, again); assert.equal(backend.records.size, 1);
  assert.deepEqual(await artifacts.read(first, bound), content);
});
test('artifact content, card, lineage and private metadata are checked on every hydration', async () => {
  const backend = storage(), artifacts = createManualArtifactStore({ transport: backend.transport }), bound = source();
  const ref = await artifacts.write({ findings: [1] }, bound);
  await assert.rejects(artifacts.read(ref, { ...bound, cardId: randomUUID() }), { code: 'MANUAL_ARTIFACT_LINEAGE_CONFLICT' });
  await assert.rejects(artifacts.read(ref, { ...bound, sourceHash: digest('changed') }), { code: 'MANUAL_ARTIFACT_LINEAGE_CONFLICT' });
  const saved = backend.records.get(ref.key); saved.bytes[1] ^= 1;
  await assert.rejects(artifacts.read(ref, bound), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
});
test('artifact write captures source and bytes before the first transport await', async () => {
  const backend = storage(), bound = source(), original = structuredClone(bound), content = { findingRevision: 1 };
  const ordinary = backend.transport.putIfAbsent;
  backend.transport.putIfAbsent = async args => { bound.sourceHash = digest('mutated'); content.findingRevision = 99; return ordinary(args); };
  const artifacts = createManualArtifactStore({ transport: backend.transport }), ref = await artifacts.write(content, bound);
  assert.deepEqual(await artifacts.read(ref, original), { findingRevision: 1 });
  await assert.rejects(artifacts.write({ bad: NaN }, original), { code: 'MANUAL_ARTIFACT_INVALID' });
  await assert.rejects(artifacts.write({ bad: undefined }, original), { code: 'MANUAL_ARTIFACT_INVALID' });
});
test('file artifact storage survives a new adapter and publishes one complete immutable value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-manual-artifact-test-'));
  try {
    const a = createManualArtifactStore({ transport: await createFileArtifactTransport(directory) }), bound = source();
    const content = { bitmap: '0'.repeat(376344) };
    const [first, second] = await Promise.all([a.write(content, bound), a.write(content, bound)]);
    assert.deepEqual(first, second);
    const b = createManualArtifactStore({ transport: await createFileArtifactTransport(directory) });
    assert.deepEqual(await b.read(first, bound), content);
  } finally { await rm(directory, { recursive: true }); }
});
test('S3 transport requires conditional create and rejects ranged/encoded/oversized streams', async () => {
  class Command { constructor(input) { this.input = input; } }
  const requests = []; let result;
  const transport = createS3ManualArtifactTransport({ bucket: 'private-fixture', PutObjectCommand: Command, GetObjectCommand: Command,
    client: { async send(command) { requests.push(command.input); return result; } } });
  await transport.putIfAbsent({ key: 'safe', bytes: Buffer.from('ok'), sha256: digest('ok'), lineageSha256: digest('lineage') });
  assert.equal(requests[0].IfNoneMatch, '*'); assert.equal(requests[0].ChecksumSHA256, Buffer.from(digest('ok'), 'hex').toString('base64'));
  let closed = false;
  const body = { async *[Symbol.asyncIterator]() { yield Buffer.from('toolong'); }, destroy() { closed = true; } };
  result = { ContentLength: 2, ContentType: 'application/json', Body: body };
  await assert.rejects(transport.read({ key: 'safe', maxBytes: 2 }), { code: 'MANUAL_ARTIFACT_UNVERIFIED' }); assert.equal(closed, true);
  result = { ...result, ContentRange: 'bytes 0-1/100' };
  await assert.rejects(transport.read({ key: 'safe', maxBytes: 2 }), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
});
test('HTTP mutations require exact origin, JSON, CSRF and ordinary authenticated principal', async () => {
  const cardId = randomUUID(), origin = 'http://127.0.0.1:4318', principal = Object.freeze({}); let calls = 0;
  const handler = createManualHandler({ origin, assertRequest: req => assert.equal(req.headers.host, '127.0.0.1:4318'),
    boundary: { async authenticate(cookie, csrf) { assert.equal(cookie, 'session'); assert.equal(csrf, 'csrf'); return principal; } },
    service: { async execute(staff) { assert.equal(staff, principal); calls++; return { saved: true }; } } });
  const request = { url: `/api/staff/manual/cards/${cardId}/actions`, method: 'POST',
    headers: { host: '127.0.0.1:4318', origin, 'content-type': 'application/json', 'x-atlas-csrf': 'csrf', cookie: 'session' },
    body: { actionId: randomUUID(), expectedRevision: 1, action: { type: 'SAVE' } } };
  const send = async req => { const response = { setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } }; await handler(req, response); return response; };
  assert.equal((await send({ ...request, headers: { ...request.headers, origin: 'https://attacker.invalid' } })).statusCode, 403);
  assert.equal((await send({ ...request, headers: { ...request.headers, 'x-atlas-csrf': '' } })).statusCode, 403);
  assert.equal((await send({ ...request, body: { ...request.body, actorId: randomUUID() } })).statusCode, 400);
  assert.equal(calls, 0); assert.equal((await send(request)).statusCode, 200); assert.equal(calls, 1);
});
test('report approval uses the exact server preview and does not invoke ordinary reducer', async () => {
  const card = { revision: 4, contentHash: digest('draft'), draft: { refs: 'unchanged' } }, principal = { canCertify: true };
  let reduced = false, committed;
  const report = { version: 1, grade: 8.5 };
  const repository = { async findAction() { return null; }, async load() { return { card, principal }; },
    async commit(_staff, input) { committed = input; return input; } };
  const service = createManualService({ repository, reduce() { reduced = true; }, buildReport: async () => report });
  const input = { actionId: randomUUID(), expectedRevision: 4, action: { type: 'APPROVE_REPORT', reviewed: true, reportHash: digest(canonical(report)) } };
  await service.execute({}, randomUUID(), input); assert.equal(reduced, false); assert.deepEqual(committed.approval, report);
  await assert.rejects(service.execute({}, randomUUID(), { ...input, action: { ...input.action, reportHash: digest('stale') } }), { code: 'MANUAL_REPORT_STALE' });
});
test('report preview exposes certification availability without changing report bytes or granting approval', async () => {
  const card = { revision: 4, contentHash: digest('draft'), draft: { refs: 'unchanged' } }, principal = { canCertify: true };
  const report = { version: 1, grade: 8.5 }; let commits = 0;
  const service = createManualService({ repository: {
    async load() { return { card, principal }; }, async findAction() { return null; }, async commit() { commits++; },
  }, reduce() { throw Error('Preview must not reduce'); }, buildReport: async () => report });
  const approved = await service.previewReport({}, randomUUID());
  assert.equal(approved.canCertify, true);
  for (const value of [false, undefined]) {
    principal.canCertify = value;
    const preview = await service.previewReport({}, randomUUID());
    assert.equal(preview.canCertify, false);
    assert.equal(preview.reportHash, approved.reportHash);
    assert.deepEqual(preview.report, approved.report);
    await assert.rejects(service.execute({}, randomUUID(), { actionId: randomUUID(), expectedRevision: 4,
      action: { type: 'APPROVE_REPORT', reviewed: true, reportHash: preview.reportHash } }), { code: 'MANUAL_CERTIFICATION_REQUIRED' });
  }
  assert.equal(commits, 0);
});
