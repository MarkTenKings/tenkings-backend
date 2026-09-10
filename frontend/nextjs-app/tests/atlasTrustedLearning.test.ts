import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextApiRequest, NextApiResponse } from 'next';
import { makeTrustedLearningConfig } from '@atlas/service-bridge/trusted-learning';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { atlasTrustedLearningConfig, atlasTrustedLearningBinding, atlasTrustedLearningSourceProjection,
    atlasTrustedLearningFingerprintVersion, createAtlasTrustedLearningPorts, createAtlasTrustedLearning } from '../lib/server/atlasTrustedLearning';
import { createAtlasTrustedLearningHandler } from '../lib/server/atlasTrustedLearningHttp';
import { harvestSpeedsterLearningCandidatesV2 } from '../lib/ai-grader-v2/learning-harvest-v2';
import { SPEEDSTER_INSPECTION_DETECTOR_VERSION } from '../lib/ai-grader-v2/learning-articuno-dry-run-v2';
import { SPEEDSTER_LEARNING_FINGERPRINT_VERSION } from '../lib/ai-grader-v2/learning-v2';
import { atlasSpeedsterSourceEvidence, assertAtlasSpeedsterSourceAdmission } from '../lib/server/atlasGradingBridge';
const phone='1'.repeat(64),key=Buffer.alloc(32,13);
const settings=Object.freeze({...makeTrustedLearningConfig({mode:'PRODUCTION',origin:'https://learning.example.test',deploymentId:'dpl_private_fixture',
    releaseSha:'a'.repeat(40),key,gradingPolicyHash:'2'.repeat(64),phoneAllowlistHash:digest(canonical([phone])),otherKeyHashes:[]}),allowedPhoneHashes:Object.freeze([phone])});
const environment={NODE_ENV:'production',VERCEL_ENV:'production',VERCEL_URL:'private-fixture.vercel.app',VERCEL_DEPLOYMENT_ID:'dpl_private_fixture',
    VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),ATLAS_TRUSTED_LEARNING_ENABLED:'true',ATLAS_TRUSTED_LEARNING_ORIGIN:settings.origin,
    ATLAS_TRUSTED_LEARNING_KEY:key.toString('base64'),ATLAS_TRUSTED_LEARNING_ALLOWED_PHONE_HASHES_JSON:JSON.stringify([phone])};
const frame={width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}};
const compatible=()=>({capture:{front:{inspectionStorageKey:'private/source/front',inspectionFrame:structuredClone(frame)},
    back:{inspectionStorageKey:'private/source/back',inspectionFrame:structuredClone(frame)}},gradeReport:{detectorVersion:SPEEDSTER_INSPECTION_DETECTOR_VERSION}});
function request(patch:Record<string,unknown>={},chunks:Buffer[]=[Buffer.from('{"canonical":"body"}')]){
    return{method:'POST',url:'/api/internal/atlas/trusted-learning/candidates',headers:{host:'learning.example.test','x-forwarded-proto':'https',
        'content-type':'application/json','x-atlas-learning-signature':'a'.repeat(64)},async *[Symbol.asyncIterator](){for(const chunk of chunks)yield chunk;},...patch}as unknown as NextApiRequest;
}
function response(){const state={status:0,body:undefined as unknown,headers:{}as Record<string,string>};
    const res={setHeader(k:string,v:string){state.headers[k]=v;return this;},status(s:number){state.status=s;return this;},
        json(body:unknown){state.body=body;return this;},send(body:unknown){state.body=body;return this;}}as unknown as NextApiResponse;return{state,res};}

test('private learning is disabled by default and caller pins cannot substitute actual deployment or compiled preparation policy',()=>{
    assert.throws(()=>atlasTrustedLearningConfig({}),/LEARNING_NOT_ENABLED/);
    for(const patch of [{ATLAS_TRUSTED_LEARNING_ENABLED:'false'},{NODE_ENV:'test'},{VERCEL_ENV:'preview'},{VERCEL_URL:'evil.example'},
        {VERCEL_DEPLOYMENT_ID:''},{VERCEL_DEPLOYMENT_ID:'has spaces'},{VERCEL_GIT_COMMIT_SHA:'0'.repeat(40)},{ATLAS_LOCAL_SYNTHETIC:'false'}])
        assert.throws(()=>atlasTrustedLearningConfig({...environment,...patch}),/LEARNING_NOT_ENABLED/);
    assert.throws(()=>atlasTrustedLearningConfig({...environment,VERCEL_DEPLOYMENT_ID:undefined,ATLAS_TRUSTED_LEARNING_DEPLOYMENT_ID:'dpl_caller_supplied'}),/LEARNING_NOT_ENABLED/);
    // No environment value supplies the missing owner-reviewed compiled release.
    assert.throws(()=>atlasTrustedLearningConfig({...environment,ATLAS_TRUSTED_LEARNING_GRADING_POLICY_HASH:'3'.repeat(64),
        ATLAS_TRUSTED_LEARNING_RELEASE_SHA:'b'.repeat(40)}),/compatible release/);
});
test('private learning roster and key are exact and independent of every existing HMAC purpose',()=>{
    for(const list of ['[]','{}','["bad"]',JSON.stringify([phone,phone]),'['+' '.repeat(8192)+']'])
        assert.throws(()=>atlasTrustedLearningConfig({...environment,ATLAS_TRUSTED_LEARNING_ALLOWED_PHONE_HASHES_JSON:list}),/LEARNING_ROSTER_INVALID/);
    for(const name of ['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_OPERATOR_EVIDENCE_KEY','ATLAS_PUBLIC_MEDIA_KEY',
        'ATLAS_MACHINE_ADMISSION_KEY','ATLAS_MACHINE_EXECUTION_KEY'])
        assert.throws(()=>atlasTrustedLearningConfig({...environment,[name]:key.toString('base64')}),/LEARNING_CONFIGURATION_INVALID/);
    assert.throws(()=>createAtlasTrustedLearning({}as never,{...settings,allowedPhoneHashes:['3'.repeat(64)]}),/LEARNING_ROSTER_INVALID/);
});
test('safe private binding is immutable and excludes key and phone roster',()=>{
    const binding=atlasTrustedLearningBinding(settings);assert(Object.isFrozen(binding));assert.equal(binding.deploymentId,'dpl_private_fixture');
    assert.equal(binding.configHash,settings.configHash);assert.equal(Object.hasOwn(binding,'key'),false);assert.equal(Object.hasOwn(binding,'allowedPhoneHashes'),false);
    assert.throws(()=>atlasTrustedLearningBinding({...settings,releaseSha:'b'.repeat(40)}),/LEARNING_CONFIGURATION_INVALID/);
});
test('source port parameterizes exact original owner/session, retains FOR SHARE and projects only original grading source fields',async()=>{
    const ports=createAtlasTrustedLearningPorts(settings),source={id:'existing-source',createdByUserId:'existing-owner',workflowState:'CAPTURED',cardProfile:'SPORTS',
        identity:{playerName:'Stored name'},capture:{},reviewedDefects:[],gradeReport:{},updatedAt:new Date(),privateCredential:'never projected'};
    let count=0;const tx={$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{count++;const sql=strings.join('?');
        assert.match(sql,/FROM public\."AiGraderV2Session" WHERE id=\? AND "createdByUserId"=\? FOR SHARE/);assert.equal(sql.includes('SELECT *'),false);
        assert.deepEqual(values,['existing-source','existing-owner']);return[source];}};
    const row=await ports.loadSource(tx as never,{sourceType:'SPEEDSTER',sourceId:'existing-source',sourceOwnerId:'existing-owner'});
    assert.equal(row.id,source.id);assert.equal(count,1);
    assert.deepEqual(atlasTrustedLearningSourceProjection(row),{cardProfile:'SPORTS',identity:source.identity,capture:{},reviewedDefects:[],gradeReport:{},
        mapRevisionId:null,mapFilterPolicyVersion:null,mapRegistration:null});
    await assert.rejects(()=>ports.loadSource(tx as never,{sourceType:'LOCAL_FIXTURE',sourceId:'existing-source',sourceOwnerId:'existing-owner'}),/LEARNING_SOURCE_INVALID/);
    for(const change of [{createdByUserId:'another-owner'},{id:'another-source'},{workflowState:'COMPLETED'},{cardProfile:'OTHER'}])
        await assert.rejects(()=>ports.loadSource({$queryRaw:async()=>[{...source,...change}]}as never,{sourceType:'SPEEDSTER',sourceId:'existing-source',sourceOwnerId:'existing-owner'}),/LEARNING_SOURCE_NOT_CAPTURED/);
    assert.equal(ports.sourceEvidence,atlasSpeedsterSourceEvidence);assert.equal(ports.assertSourceAdmission,assertAtlasSpeedsterSourceAdmission);
    assert.equal(ports.isStaffPhoneAllowed(phone),true);assert.equal(ports.isStaffPhoneAllowed('f'.repeat(64)),false);
});
test('original fingerprint compatibility is required and original candidate generator preserves paired lesson and raw evidence',()=>{
    const ports=createAtlasTrustedLearningPorts(settings),snapshot=compatible();assert.equal(ports.generateCandidates,harvestSpeedsterLearningCandidatesV2);
    assert.equal(atlasTrustedLearningFingerprintVersion(snapshot),SPEEDSTER_LEARNING_FINGERPRINT_VERSION);
    for(const change of [(s:ReturnType<typeof compatible>)=>{s.gradeReport.detectorVersion='old-detector';},
        (s:ReturnType<typeof compatible>)=>{s.capture.back.inspectionFrame.cardBounds.x=41;},
        (s:ReturnType<typeof compatible>)=>{s.capture.front.inspectionStorageKey='';}]){const s=compatible();change(s);assert.throws(()=>ports.fingerprintVersion(s),/LEARNING_FINGERPRINT_INCOMPATIBLE/);}
    const findings=[{id:'retained-finding',origin:'DETECTOR',defectType:'FRAYING',detectedDefectType:'VISIBLE_WHITENING',reviewResult:'TYPE_CORRECTED',
        sourceViewId:'FRONT:ORIGINAL',featureFingerprint:Array.from({length:32},(_,n)=>n===0?2:0),rawMask:{sha256:'f'.repeat(64),runs:[0,3,4]}}],before=canonical(findings);
    const result=ports.generateCandidates({fingerprintVersion:ports.fingerprintVersion(snapshot),reviewedDefects:findings});
    assert.deepEqual(result.lessons.map(l=>l.polarity),['NEGATIVE','POSITIVE']);assert.equal(canonical(findings),before);
    assert.deepEqual(Object.keys(result),['lessons','diagnostics']);assert.equal(Object.hasOwn(ports,'perform'),false);assert.equal(Object.hasOwn(ports,'writeBank'),false);
});
test('private HTTP preserves exact bounded canonical request and safe canonical response',async()=>{
    let calls=0;const handler=createAtlasTrustedLearningHandler({settings:()=>settings,async receive(s,body,signature){calls++;
        assert.equal(s,settings);assert.equal(body,'{"canonical":"body"}');assert.equal(signature,'a'.repeat(64));return{receiptId:'safe',bundleHash:'b'.repeat(64),candidates:[],expiresAt:'fixture'};}});
    const r=response();await handler(request(),r.res);assert.equal(calls,1);assert.equal(r.state.status,200);
    assert.equal(r.state.headers['Cache-Control'],'private, no-store');assert.equal(r.state.headers['X-Content-Type-Options'],'nosniff');
    assert.equal(r.state.body,canonical({receiptId:'safe',bundleHash:'b'.repeat(64),candidates:[],expiresAt:'fixture'}));
});
test('wrong host path method HTTPS or browser authority is denied before the candidate service',async()=>{
    const base=request();for(const patch of [{method:'GET'},{url:'/api/internal/atlas/trusted-learning/candidates?source=other'},{aborted:true},
        ...[{host:'other.example'},{'x-forwarded-host':'other.example'},{'x-forwarded-proto':'http'},{'x-forwarded-proto':['https']},
            {cookie:'legacy-admin=present'},{authorization:'Bearer admin'},{'content-type':'text/plain'},{'content-length':'8193'},{'content-length':'bad'},
            {'x-atlas-learning-signature':['a'.repeat(64)]},{'x-atlas-learning-signature':undefined,'x-atlas-intake-signature':'a'.repeat(64)}]
            .map(headers=>({headers:{...base.headers,...headers}}))]){
        let calls=0;const handler=createAtlasTrustedLearningHandler({settings:()=>settings,async receive(){calls++;return{};}}),r=response();
        await handler(request(patch),r.res);assert.equal(calls,0);assert.equal(r.state.status,503);assert.deepEqual(r.state.body,{error:'ATLAS_TRUSTED_LEARNING_UNAVAILABLE'});
    }
});
test('HTTP rejects stream overflow invalid UTF8 noncanonical JSON and hides configuration/source failures',async()=>{
    let calls=0;const handler=createAtlasTrustedLearningHandler({settings:()=>settings,async receive(){calls++;throw Error('source-owner/key detail');}});
    for(const chunks of [[Buffer.alloc(4000),Buffer.alloc(4193)],[Buffer.from([255])],[Buffer.from('{"z":1, "a":2}')],
        [Buffer.from('{"x":1,"x":2}')],[Buffer.from('{bad')]]){const r=response();await handler(request({},chunks),r.res);assert.equal(calls,0);assert.equal(r.state.status,503);}
    const mismatch=response();await handler(request({headers:{...request().headers,'content-length':'1'}}),mismatch.res);assert.equal(calls,0);
    const failed=response();await handler(request(),failed.res);assert.equal(calls,1);assert.deepEqual(failed.state.body,{error:'ATLAS_TRUSTED_LEARNING_UNAVAILABLE'});
    const denied=response();await createAtlasTrustedLearningHandler({settings(){throw Error('private configuration');},async receive(){throw Error('unreachable');}})(request(),denied.res);
    assert.deepEqual(denied.state.body,{error:'ATLAS_TRUSTED_LEARNING_UNAVAILABLE'});
});
