import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionApprovedReader } from '../lib/server/collection-approved-reader.mjs';
import { createCollectionDisplayService } from '../lib/server/collection-display-service.mjs';
import { createCollectionDisplayFixture, deferred } from './collection-display-fixture.mjs';
import { approvedReportHandler } from '../../atlas-public/lib/server/approved-report-http.mjs';

const token = 'ar_' + 'a'.repeat(24);
const input = () => ({ token, version: 1, signal: new AbortController().signal, maxBytes: 4096 });
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
test('absent configuration does no I/O; admitted requests stay on fixed public URLs without customer credentials', async () => {
    let calls = 0; assert.equal(createCollectionApprovedReader({ request() { calls++; } }), null); assert.equal(calls, 0);
    const reader = createCollectionApprovedReader({ enabled: true, request(url, options) {
        calls++; assert.equal(url, `https://atlasgrading.com/api/reports/${token}?v=1`);
        assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
        assert.equal(options.referrerPolicy, 'no-referrer');
        assert.deepEqual(options.headers, { accept: 'application/json', 'accept-encoding': 'identity' });
        return json({ packet: {}, publicHash: 'a'.repeat(64) });
    } });
    assert.equal((await reader.readReport(input())).publicHash, 'a'.repeat(64)); assert.equal(calls, 1);
    for (const patch of [{ token: '../secret' }, { version: null }, { maxBytes: 9 * 1024 * 1024 }, { signal: null }, { cookie: 'private' }])
        await assert.rejects(reader.readReport({ ...input(), ...patch }));
    await assert.rejects(reader.readImage({ ...input(), side: 'BACK' })); assert.equal(calls, 1);
});
test('rejects error/redirect/type/cache/schema responses and byte overflow, including streamed decoded data', async () => {
    const valid = { packet: {}, publicHash: 'a'.repeat(64) };
    for (const response of [new Response('', { status: 404 }), new Response('', { status: 302 }), new Response(JSON.stringify(valid), { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } }),
        new Response(JSON.stringify(valid), { headers: { 'content-type': 'application/json', 'cache-control': 'public' } }), json({ ...valid, privateOwner: 'secret' }), json({ packet: {}, publicHash: 'wrong' }),
        new Response('invalid JSON', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })]) {
        await assert.rejects(createCollectionApprovedReader({ enabled: true, request: () => response }).readReport(input()));
    }
    let cancelled = false;
    const response = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1025)); }, cancel() { cancelled = true; } }),
        { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-encoding': 'gzip', 'content-length': '2' } });
    await assert.rejects(createCollectionApprovedReader({ enabled: true, request: () => response }).readReport({ ...input(), maxBytes: 1024 }));
    assert.equal(cancelled, true);
    const decoded = new Response(JSON.stringify(valid), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-encoding': 'gzip', 'content-length': '2' } });
    assert.deepEqual(await createCollectionApprovedReader({ enabled: true, request: () => decoded }).readReport(input()), valid);
});
test('abort refuses before I/O, interrupts held headers/body, and cancels a late response', async () => {
    const stopped = new AbortController(); stopped.abort(); let calls = 0;
    await assert.rejects(createCollectionApprovedReader({ enabled: true, request() { calls++; } }).readReport({ ...input(), signal: stopped.signal }));
    assert.equal(calls, 0);
    const entered = deferred(), release = deferred(), controller = new AbortController(); let cancelled = false;
    const reader = createCollectionApprovedReader({ enabled: true, request() { entered.resolve(); return release.promise; } });
    const pending = reader.readReport({ ...input(), signal: controller.signal }); await entered.promise; controller.abort(); await assert.rejects(pending);
    release.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await new Promise(r => setImmediate(r)); assert.equal(cancelled, true);
    const bodyEntered = deferred(), second = new AbortController(); cancelled = false;
    const response = new Response(new ReadableStream({ pull() { bodyEntered.resolve(); return new Promise(() => {}); }, cancel() { cancelled = true; } }),
        { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    const held = createCollectionApprovedReader({ enabled: true, request: () => response }).readReport({ ...input(), signal: second.signal });
    await bodyEntered.promise; second.abort(); await assert.rejects(held); assert.equal(cancelled, true);
});
test('actual display service joins exact public report handler and bounded image response; changed owner still prevents output', async () => {
    const f = await createCollectionDisplayFixture(), paths = [];
    const publicHandler = approvedReportHandler(() => ({ read: () => ({ packet: structuredClone(f.packet), publicHash: f.card.approvedCard.report.publicHash, privateOwner: 'must not escape' }) }));
    const reader = createCollectionApprovedReader({ enabled: true, async request(url, options) {
        const u = new URL(url); paths.push(u.pathname); assert.equal(options.credentials, 'omit');
        if (u.pathname.endsWith('/images/FRONT')) return new Response(f.bytes, { headers: { 'content-type': 'image/webp', 'cache-control': 'no-store' } });
        const res = { headers: {}, setHeader(k, v) { this.headers[k] = String(v); }, status(code) { this.code = code; return this; },
            end(bytes) { this.bytes = bytes; }, send(bytes) { this.bytes = bytes; } };
        await publicHandler({ method: 'GET', url: u.pathname + u.search, headers: {} }, res);
        return new Response(res.bytes, { status: res.code, headers: res.headers });
    } });
    const service = createCollectionDisplayService({ ownershipRead: f.ownershipRead, approvedReader: reader, mode: 'LOCAL_FIXTURE' });
    const display = await service.readDisplay(f.cookie, f.card.cardId);
    const expected = { ownershipRevision: display.binding.ownershipRevision, approvalActionId: display.binding.approvalActionId,
        version: display.binding.report.version, publicHash: display.binding.report.publicHash };
    assert.deepEqual((await service.readFront(f.cookie, f.card.cardId, expected)).bytes, f.bytes);
    assert(paths.some(path => path.endsWith('/images/FRONT')));
    f.ownerHook = () => { throw Object.assign(Error(), { status: 404 }); };
    const prior = paths.length; await assert.rejects(service.readDisplay(f.cookie, f.card.cardId)); assert.equal(paths.length, prior);
});
