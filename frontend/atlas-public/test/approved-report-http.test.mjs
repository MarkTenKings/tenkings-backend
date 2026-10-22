import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedReportHandler } from '../lib/server/approved-report-http.mjs';
import { PublicReportReader } from '../lib/server/reader.mjs';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture() {
    const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
    const manifest = JSON.parse(f.row.manifest);
    const packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
    let reads = 0;
    const reader = new PublicReportReader({ mode: 'LOCAL_FIXTURE' }, { async read() { reads++; return { packet, publicHash: f.row.public_hash }; } });
    const req = { method: 'GET', url: `/api/reports/${packet.publicToken}?v=1`, headers: { host: 'fixture.invalid' } };
    return { req, reader, packet, publicHash: f.row.public_hash, get reads() { return reads; } };
}
export async function invoke(handler, req) {
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }, status(code) { this.code = code; return this; },
        end(bytes) { this.bytes = bytes; return this; }, send(bytes) { this.bytes = bytes; return this; } };
    await handler(req, res); return res;
}
test('exact-version endpoint uses existing approved reader and emits only the public packet/hash', async () => {
    const f = await fixture(), handler = approvedReportHandler(() => f.reader);
    const result = await invoke(handler, f.req);
    assert.equal(result.code, 200); assert.equal(f.reads, 1);
    assert.deepEqual(JSON.parse(result.bytes), { packet: f.packet, publicHash: f.publicHash });
    assert.equal(result.headers['content-length'], String(result.bytes.length));
    assert.equal(result.headers['cache-control'], 'no-store, max-age=0');
    assert.match(result.headers['x-robots-tag'], /noindex/);
    const head = await invoke(handler, { ...f.req, method: 'HEAD' });
    assert.equal(head.code, 200); assert.equal(head.bytes, undefined); assert.equal(head.headers['content-length'], result.headers['content-length']);
});
test('rejects noncanonical selectors and mutations before resolving any reader', async () => {
    const f = await fixture(); let admits = 0;
    const handler = approvedReportHandler(() => { admits++; return f.reader; });
    for (const url of [f.req.url.replace('?v=1', ''), f.req.url + '&v=1', f.req.url + '&other=1', f.req.url.replace('v=1', 'v=01'),
        f.req.url.replace('v=1', 'v=2147483648'), f.req.url.replace('/reports/', '/reports/%2e/'), f.req.url + '#fragment']) {
        assert.equal((await invoke(handler, { ...f.req, url })).code, 404);
    }
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await invoke(handler, { ...f.req, method })).code, 405);
    for (const headers of [{ 'transfer-encoding': 'chunked' }, { 'content-length': '1' }])
        assert.equal((await invoke(handler, { ...f.req, headers })).code, 404);
    assert.equal(admits, 0);
});
test('missing publication, ingress failure and malformed/wrong-version packets never become successful JSON', async () => {
    const f = await fixture();
    assert.equal((await invoke(approvedReportHandler(() => ({ async read() { return null; } })), f.req)).code, 404);
    assert.equal((await invoke(approvedReportHandler(() => { throw Error('private detail'); }), f.req)).code, 503);
    for (const value of [{ packet: f.packet, publicHash: '0'.repeat(64) }, { packet: { ...f.packet, approvalVersion: 2 }, publicHash: f.publicHash },
        { packet: { ...f.packet, privateOwner: 'secret' }, publicHash: f.publicHash }]) {
        const res = await invoke(approvedReportHandler(() => ({ async read() { return value; } })), f.req);
        assert.equal(res.code, 503); assert.equal(res.bytes, undefined);
    }
});
test('held read cannot emit after request or admitted reader method changes', async () => {
    for (const change of [(req) => { req.headers.host = 'changed.invalid'; }, req => { req.url += '&other=1'; },
        req => { req.aborted = true; }, (_req, reader) => { reader.read = () => assert.fail('replacement used'); }]) {
        const f = await fixture(), entered = deferred(), release = deferred();
        const reader = { async read() { entered.resolve(); await release.promise; return { packet: f.packet, publicHash: f.publicHash }; } };
        const pending = invoke(approvedReportHandler(() => reader), f.req); await entered.promise;
        change(f.req, reader); release.resolve(); const res = await pending;
        assert.equal(res.code, 503); assert.equal(res.bytes, undefined);
    }
});
