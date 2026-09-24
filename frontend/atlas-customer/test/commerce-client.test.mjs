import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../lib/client.mjs';

test('saved label JSON may exceed ordinary response cap, unrelated routes retain cap',async t=>{
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({labelBase64:'a'.repeat(700000)}),{headers:{'Content-Type':'application/json'}}));
    const path='/commerce/orders/11111111-1111-4111-8111-111111111111/labels/label-id';
    assert.equal((await request(path)).labelBase64.length,700000);
    await assert.rejects(()=>request('/submissions'),error=>error.code==='UNCONFIRMED_REPLY');
    await assert.rejects(()=>request(path,{body:{}}),error=>error.code==='UNCONFIRMED_REPLY');
});
test('label-specific response cap still rejects oversized replies',async t=>{
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({labelBase64:'a'.repeat(6*1024*1024)}),{headers:{'Content-Type':'application/json'}}));
    await assert.rejects(()=>request('/commerce/orders/11111111-1111-4111-8111-111111111111/labels/label-id'),error=>error.code==='UNCONFIRMED_REPLY');
});
test('only long private operations outlive the API deadline; auth and ordinary reads retain25 seconds', async t => {
    const timers = [], id = '11111111-1111-4111-8111-111111111111';
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.push(delay); return 1; });
    t.mock.method(globalThis, 'clearTimeout', () => {});
    t.mock.method(globalThis, 'fetch', async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    for (const path of [`/intake/drafts/${id}/cards/${id}/uploads/${id}/sign`, `/intake/drafts/${id}/cards/${id}/uploads/${id}/complete`, `/commerce/checkout?draftId=${id}`, '/commerce/quotes', '/commerce/payments', `/commerce/payments/${id}/reconcile`]) {
        await request(path); assert.equal(timers.at(-1), 115000, path);
    }
    for (const path of ['/session', '/auth/request', '/auth/verify', '/submissions', '/intake/drafts', `/commerce/orders/${id}`, `/commerce/orders/${id}/labels/label-id`, '/commerce/payments/invalid/reconcile']) {
        await request(path); assert.equal(timers.at(-1), 25000, path);
    }
});
test('a long payment timeout retains the exact caller request and never retries automatically', async t => {
    let abort, calls = 0, received;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.equal(delay, 115000); abort = callback; return 1; });
    t.mock.method(globalThis, 'clearTimeout', () => {});
    t.mock.method(globalThis, 'fetch', async (_url, options) => { calls++; received = JSON.parse(options.body); return new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('AbortError'))); abort(); }); });
    const body = { quoteId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222' };
    await assert.rejects(() => request('/commerce/payments', { body, csrf: 'fixture' }), error => error.code === 'UNCONFIRMED_REPLY');
    assert.equal(calls, 1); assert.deepEqual(received, body); assert.equal(body.requestId, '22222222-2222-4222-8222-222222222222');
});
