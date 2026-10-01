import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityHandler } from '../lib/server/capacity-http.mjs';
import { unconfiguredCapacity } from '../../../packages/atlas-commerce/src/capacity.mjs';

function response() {
    return { headers:{}, statusCode:null, body:null, setHeader(k,v){this.headers[k]=v;}, status(v){this.statusCode=v;return this;},
        json(v){this.body=v;return this;},end(){return this;} };
}
test('public capacity is a read-only aggregate with no invented quotas', async () => {
    let reads=0;
    const handler=capacityHandler(()=>({async weeklyCapacity(){reads++;return unconfiguredCapacity(new Date('2026-10-01T10:00:00Z'));}}));
    const res=response(); await handler({method:'GET',query:{}},res);
    assert.equal(res.statusCode,200); assert.equal(res.body.pools[0].quotaCards,null);
    assert.equal(res.headers['Cache-Control'],'no-store, max-age=0');
    const head=response();await handler({method:'HEAD',query:{}},head);
    assert.equal(head.statusCode,200);assert.equal(head.body,null);
    const bad=response();await handler({method:'POST',query:{}},bad);
    assert.equal(bad.statusCode,405);assert.equal(reads,2);
    const forged=response();await handler({method:'GET',query:{quotaCards:'999'}},forged);
    assert.equal(forged.statusCode,400);assert.equal(reads,2);
});
test('failed/schema-disabled capacity read is unavailable and exposes no stale guessed counts', async () => {
    const handler=capacityHandler(()=>({async weeklyCapacity(){throw new Error('private details');}}));
    const res=response();await handler({method:'GET',query:{}},res);
    assert.equal(res.statusCode,503);assert.deepEqual(res.body,{error:'WEEKLY_CAPACITY_UNAVAILABLE'});
});
