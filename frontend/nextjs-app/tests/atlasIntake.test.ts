import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextApiRequest, NextApiResponse } from 'next';
import { atlasIntakeConfig, atlasIntakeSourceTitle, createAtlasIntake } from '../lib/server/atlasIntake';
import { createAtlasIntakeHandler } from '../pages/api/internal/atlas/intake';
import { makeIntakeConfig } from '@atlas/service-bridge/intake';
import { canonical, digest } from '@atlas/service-bridge/protocol';
const phone = '1'.repeat(64);
const config = { ...makeIntakeConfig({ mode:'PRODUCTION',origin:'https://intake.example.test',deploymentId:'private-release.vercel.app',
    releaseSha:'a'.repeat(40),key:Buffer.alloc(32,7),otherKeyHashes:[],gradingPolicyHash:'2'.repeat(64),
    phoneAllowlistHash:digest(canonical([phone])) }), allowedPhoneHashes:Object.freeze([phone]) };
function req(patch: Record<string,unknown> = {}, chunks: Buffer[] = [Buffer.from('{"canonical":"body"}')]) {
    return { method:'POST',url:'/api/internal/atlas/intake',headers:{host:'intake.example.test','x-forwarded-proto':'https',
        'content-type':'application/json','x-atlas-intake-signature':'a'.repeat(64)},
        async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; }, ...patch } as unknown as NextApiRequest;
}
function res() {
    const state = { status:0,body:undefined as unknown,headers:{} as Record<string,string> };
    const response = { setHeader(key:string,value:string) { state.headers[key]=value;return this; },
        status(status:number){state.status=status;return this;},json(body:unknown){state.body=body;return this;} } as unknown as NextApiResponse;
    return {state,response};
}
test('private intake forwards only bounded exact raw body and own signature', async()=>{
    let calls=0;
    const handler=createAtlasIntakeHandler({settings:()=>config,async receive(settings,body,signature){calls++;
        assert.equal(settings,config);assert.equal(body,'{"canonical":"body"}');assert.equal(signature,'a'.repeat(64));return {receiptId:'safe'};}});
    const r=res();await handler(req(),r.response);assert.equal(calls,1);assert.equal(r.state.status,200);
    assert.equal(r.state.headers['Cache-Control'],'private, no-store');assert.equal(r.state.headers['X-Content-Type-Options'],'nosniff');
});
test('wrong host/path/method, insecure forwarding, cookies, legacy auth and header arrays never reach service',async()=>{
    for (const patch of [{method:'GET'},{url:'/api/internal/atlas/intake?source=other'},
        ...[{host:'evil.test'},{'x-forwarded-host':'evil.test'},{'x-forwarded-proto':'http'},
            {cookie:'legacy=admin'},{authorization:'Bearer legacy'},{'x-atlas-intake-signature':['a'.repeat(64)]},
            {'content-type':'text/plain'},{'content-length':'8193'},{'content-length':'nope'}].map(headers=>({headers:{...req().headers,...headers}}))]) {
        let calls=0;const handler=createAtlasIntakeHandler({settings:()=>config,async receive(){calls++;return {};}});
        const r=res();await handler(req(patch),r.response);assert.equal(calls,0);assert.equal(r.state.status,503);
        assert.deepEqual(r.state.body,{error:'ATLAS_INTAKE_UNAVAILABLE'});
    }
});
test('streaming overflow and service details are rejected without disclosure',async()=>{
    let calls=0;const handler=createAtlasIntakeHandler({settings:()=>config,async receive(){calls++;throw new Error('private-key-secret');}});
    const oversized=res();await handler(req({},[Buffer.alloc(4000),Buffer.alloc(4193)]),oversized.response);assert.equal(calls,0);
    const malformed=res();await handler(req({},[Buffer.from([255])]),malformed.response);assert.equal(calls,0);
    const mismatch=res();await handler(req({headers:{...req().headers,'content-length':'1'}}),mismatch.response);assert.equal(calls,0);
    const failed=res();await handler(req(),failed.response);assert.equal(calls,1);assert.equal(failed.state.status,503);
    assert.deepEqual(failed.state.body,{error:'ATLAS_INTAKE_UNAVAILABLE'});
});
test('production gate and roster deny invalid env before preparing intake',()=>{
    const env={NODE_ENV:'production',VERCEL_ENV:'production',VERCEL_URL:'private-release.vercel.app',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),
        ATLAS_INTAKE_ENABLED:'true',ATLAS_INTAKE_ORIGIN:config.origin,ATLAS_INTAKE_KEY:Buffer.alloc(32,7).toString('base64'),
        ATLAS_INTAKE_ALLOWED_PHONE_HASHES_JSON:JSON.stringify([phone])};
    for (const patch of [{ATLAS_INTAKE_ENABLED:'false'},{VERCEL_ENV:'preview'},{VERCEL_URL:'bad.invalid'},
        {VERCEL_GIT_COMMIT_SHA:'tag'},{ATLAS_LOCAL_FIXTURE:'true'}]) assert.throws(()=>atlasIntakeConfig({...env,...patch}),/INTAKE_NOT_ENABLED/);
    for (const value of ['[]','{}','["bad"]',JSON.stringify([phone,phone]),'['+' '.repeat(8192)+']'])
        assert.throws(()=>atlasIntakeConfig({...env,ATLAS_INTAKE_ALLOWED_PHONE_HASHES_JSON:value}),/INTAKE_ROSTER_INVALID/);
    // Current source preparation authority is intentionally unapproved. No env
    // setting can turn that missing compiled release into intake permission.
    assert.throws(()=>atlasIntakeConfig(env),/compatible release/);
});
test('server title uses canonical stored sports or pokemon identity fields only',()=>{
    const base={id:'source',createdByUserId:'owner',workflowState:'CAPTURED',capture:{},reviewedDefects:[],gradeReport:null,updatedAt:new Date()};
    const sports=atlasIntakeSourceTitle({...base,cardProfile:'SPORTS',identity:{playerName:' Ada\n Player ',year:'2026',manufacturer:'Maker',productSet:'Set',cardNumber:'12'}});
    assert.deepEqual(sports,{title:'Ada Player',subtitle:'2026 · Maker · Set · #12'});
    const pokemon=atlasIntakeSourceTitle({...base,cardProfile:'POKEMON',identity:{cardName:'Card',year:'2026',productSet:'Set'}});
    assert.deepEqual(pokemon,{title:'Card',subtitle:'2026 · Pokémon · Set'});
    assert.throws(()=>atlasIntakeSourceTitle({...base,cardProfile:'OTHER',identity:{}}),/IDENTITY_INVALID/);
});
test('private adapter rejects an altered roster before touching any client',()=>{
    assert.throws(()=>createAtlasIntake({} as never,{...config,allowedPhoneHashes:Object.freeze(['3'.repeat(64)])}),/INTAKE_ROSTER_INVALID/);
});
