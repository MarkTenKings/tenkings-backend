import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical,digest } from '@atlas/service-bridge/protocol';
import { makeIdentityCorrectionConfig,ScopedIdentityCorrection,signIdentityCorrectionRequest,verifyIdentityCorrectionRequest,
    identityCorrectionClient,IDENTITY_CORRECTION_PATH } from '@atlas/service-bridge/identity-correction';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { canonicalizeSpeedsterSessionIdentity } from '../lib/ai-grader-v2/identity';
import { fixtureAnalysis } from '../../atlas-app/lib/server/access/fixture-analysis.mjs';
import { classifyAtlasIdentityCorrection } from '../lib/server/atlasIdentityCorrection';
import { atlasIdentityCorrectionConfig,atlasIdentityCorrectionBinding,createAtlasIdentityCorrectionPorts,assertAtlasIdentityCorrectionMap } from '../lib/server/atlasIdentityCorrectionBridge';
import { speedsterCardTypeMapKey,SPEEDSTER_MAP_FILTER_POLICY_VERSION,SPEEDSTER_MAP_SCHEMA_VERSION } from '../lib/ai-grader-v2/card-type-map-contracts';
import { speedsterIdentityMapRegistration,parseSpeedsterMapSourceSession,speedsterPhysicalQuadHash } from '../lib/server/speedsterCardTypeMaps';
import { createAtlasIdentityCorrectionHandler } from '../lib/server/atlasIdentityCorrectionHttp';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const phone='1'.repeat(64),key=Buffer.alloc(32,19),policy='a'.repeat(64);
const config=makeIdentityCorrectionConfig({mode:'LOCAL_FIXTURE',origin:'https://identity.example.test',deploymentId:'private-fixture',releaseSha:'0'.repeat(40),key,
    gradingPolicyHash:policy,phoneAllowlistHash:digest(canonical([phone])),otherKeyHashes:[]});
const sourceProjection=(s:any)=>({cardProfile:s.cardProfile,identity:s.identity,capture:s.capture,reviewedDefects:s.reviewedDefects,gradeReport:s.gradeReport,
    mapRevisionId:s.mapRevisionId??null,mapFilterPolicyVersion:s.mapFilterPolicyVersion??null,mapRegistration:s.mapRegistration??null});
const evidence=(s:any,revision:string)=>({version:'atlas-speedster-evidence-v1',sourceId:s.id,sourceOwnerId:s.createdByUserId,sourceRevision:revision,
    captureHash:digest(canonical(s.capture)),identityHash:digest(canonical({cardProfile:s.cardProfile,identity:s.identity})),mapRevisionId:s.mapRevisionId??null,
    mapFilterPolicyVersion:s.mapFilterPolicyVersion??null,mapRegistrationHash:digest(canonical(s.mapRegistration??null)),
    sides:{FRONT:{sha256:'1'.repeat(64)},BACK:{sha256:'2'.repeat(64)}},originals:{FRONT:{sha256:'3'.repeat(64)},BACK:{sha256:'4'.repeat(64)}}});
function fixture(){
    const now=new Date(),captureRevision=new Date(+now-120_000).toISOString();
    const raw=JSON.parse(fixtureAnalysis({title:'Fixture Player',set:'Synthetic Set'},'f'.repeat(64),{traces:true}).sourceCanonical);
    raw.identity=canonicalizeSpeedsterSessionIdentity('SPORTS',raw.identity);
    Object.assign(raw,{id:'known-source',createdByUserId:'known-owner',workflowState:'CAPTURED',updatedAt:new Date(+now-60_000),mapRegistration:null,mapFilterPolicyVersion:null,mapRevisionId:null});
    raw.reviewedDefects[0].privateFingerprint=[1,0.10000000000000002,-0.3];
    const sourceCanonical=canonical(sourceProjection(raw)),evidenceCanonical=canonical(evidence(raw,captureRevision)),evidenceHash=digest(evidenceCanonical),
        reportCanonical=canonical(previewAtlasReport(JSON.parse(sourceCanonical))),sourceHash=digest(sourceCanonical);
    const draft={revision:3,evidenceRevision:1,evidenceHash,observations:'Retain human notes.',reviewedSides:['FRONT','BACK'],identityReviewed:true,
        disposition:'READY',savedAt:new Date(+now-50_000).toISOString(),savedBy:'Earlier Human'};
    const admissionCanonical=canonical({purpose:'atlas-analysis-admission-v1',mode:'LOCAL_FIXTURE',policyHash:policy,sourceHash,evidenceHash,
        detectionPair:{mode:'LOCAL_FIXTURE',rawCheckpoint:{sourceRevision:'historical-never-relabelled',sha256:'b'.repeat(64)}}});
    const state:any={raw,now,control:{id:'active',enabled:true,mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'staff-fixture',releaseSha:'0'.repeat(40),
        configHash:'c'.repeat(64),gradingPolicyHash:policy,revision:1},correction:{...config,id:'active',enabled:true,revision:2},
        identity:{id:id(1),name:'Human Reviewer',phoneHash:phone,role:'REVIEWER',revokedAt:null,accessVersion:1,certificationUntil:new Date(0),trustedLearningUntil:new Date(0)},
        session:{tokenHash:'d'.repeat(64),identityId:id(1),browserHash:'e'.repeat(64),accessVersion:1,controlRevision:1,createdAt:new Date(+now-30_000),expiresAt:new Date(+now+600_000),revokedAt:null},
        browser:{tokenHash:'e'.repeat(64),controlRevision:1,createdAt:new Date(+now-60_000),expiresAt:new Date(+now+600_000)},
        assignment:{specimenId:id(2),identityId:id(1),canReview:true,fence:1,revokedAt:null,expiresAt:new Date(+now+600_000)},
        card:{id:id(2),sourceType:'LOCAL_FIXTURE',sourceId:raw.id,sourceOwnerId:raw.createdByUserId,title:'Fixture Player',subtitle:'Synthetic Set',analysisRevision:2,draftRevision:3,
            evidenceRevision:1,evidenceCanonical,evidenceHash},
        analyses:[{specimenId:id(2),revision:2,evidenceHash,sourceCanonical,sourceHash,reportCanonical,reportHash:digest(reportCanonical),admissionCanonical,
            admissionHash:digest(admissionCanonical),sourceRevision:raw.updatedAt.toISOString(),mode:'LOCAL_FIXTURE'}],
        reviews:[{specimenId:id(2),revision:3,evidenceRevision:1,evidenceHash,analysisRevision:2,canonical:canonical(draft),contentHash:digest(canonical(draft))}],
        publication:{specimenId:id(2),currentApprovalId:id(8)},receipts:[],audits:[],pending:false};
    const counters={preflight:0,source:0,cas:0,authority:0},order:string[]=[];
    let preflightHook=async()=>{},endHook=()=>{},failAudit=false;
    function insert(sql:string,values:any[]){
        const match=sql.match(/INSERT INTO atlas_staff\."(\w+)"\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*)\)/)!;
        const columns=match[2].split(',').map(v=>v.trim().replaceAll('"',''));let index=0;
        // All INSERT values are bound except the fixed audit event.
        const record=Object.fromEntries(columns.map(column=>[column,column==='event'?'IDENTITY_CORRECTED':values[index++]]));
        const key=({StaffIdentityCorrection:'receipts',StaffAnalysisRevision:'analyses',StaffReviewRevision:'reviews',StaffAudit:'audits'}as any)[match[1]];
        assert(key,sql);state[key].push(record);order.push(match[1]);
    }
    const tx:any={async $queryRaw(strings:TemplateStringsArray,...values:any[]){const sql=strings.join('?');
        if(sql.includes('clock_timestamp() AS now'))return[{now:new Date(state.now)}];
        if(sql.includes(' AS pending')){assert.match(sql,/"StaffGradingExecution"/);assert.match(sql,/"StaffOperatorAttempt"/);assert.match(sql,/"StaffNfcJob"/);return[{pending:state.pending}];}
        if(sql.includes('"StaffIdentityCorrection"'))return state.receipts.filter((r:any)=>r.actorId===values[0]&&r.operationId===values[1]);
        for(const [table,name]of Object.entries({StaffControl:'control',StaffIdentityCorrectionControl:'correction',StaffIdentity:'identity',StaffSession:'session',StaffBrowser:'browser',StaffAssignment:'assignment',StaffSpecimen:'card',StaffPublicReport:'publication'}))
            if(sql.includes(`"${table}"`))return state[name]?[state[name]]:[];
        if(sql.includes('"StaffAnalysisRevision"'))return state.analyses.filter((r:any)=>r.revision===values[1]);
        if(sql.includes('"StaffReviewRevision"'))return state.reviews.filter((r:any)=>r.revision===values[1]);
        throw Error(sql);
    },async $executeRaw(strings:TemplateStringsArray,...values:any[]){const sql=strings.join('?');
        if(sql.startsWith('SELECT pg_advisory')){order.push('gate');return 1;}
        if(sql==='SET CONSTRAINTS ALL IMMEDIATE'){order.push('constraints');return 1;}
        if(sql.startsWith('INSERT')){if(sql.includes('"StaffAudit"')&&failAudit)throw Error('audit blocked');insert(sql,values);return 1;}
        if(sql.startsWith('UPDATE atlas_staff."StaffSpecimen"')){const [analysisRevision,draftRevision,evidenceRevision,evidenceCanonical,evidenceHash,title,subtitle]=values;
            Object.assign(state.card,{analysisRevision,draftRevision,evidenceRevision,evidenceCanonical,evidenceHash,title,subtitle});order.push('heads');endHook();return 1;}
        throw Error(sql);
    }};
    const client:any={async $transaction(work:any){const snapshot=structuredClone(state);try{return await work(tx);}catch(error){
        for(const key of Object.keys(state))delete state[key];Object.assign(state,snapshot);throw error;}}};
    const ports:any={loadRawSource:async()=>{counters.source++;return structuredClone(state.raw);},
        classify:(source:any,expected:any,next:any)=>classifyAtlasIdentityCorrection({source,expected,next},{reportSource:sourceProjection,sourceEvidence:evidence,previewReport:previewAtlasReport,
            sourceAdmission:()=>({gradingPolicyHash:policy,preparationRelease:{mode:'LOCAL_FIXTURE'},frontAuthorityHash:'a'.repeat(64),backAuthorityHash:'b'.repeat(64)})}),
        preflight:async()=>{counters.preflight++;await preflightHook();return{};},assertCurrentAuthority:async()=>{counters.authority++;},
        projectNext:(raw:any,identity:any,updatedAt:Date)=>({...structuredClone(raw),identity,updatedAt}),reportSource:sourceProjection,sourceEvidence:evidence,previewReport:previewAtlasReport,
        safeTitle:(s:any)=>({title:s.identity.playerName,subtitle:'Synthetic Set'}),compareAndSwap:async(_tx:any,_old:any,next:any)=>{counters.cas++;order.push('source-CAS');state.raw=structuredClone(next);return structuredClone(state.raw);},
        isStaffPhoneAllowed:(hash:string)=>hash===phone};
    const scope:any={actorId:id(1),sessionHash:state.session.tokenHash,browserHash:state.browser.tokenHash,accessVersion:1,controlRevision:1,staffOrigin:state.control.origin,
        deploymentId:state.control.deploymentId,releaseSha:state.control.releaseSha,staffConfigHash:state.control.configHash,specimenId:id(2),assignmentFence:1};
    const request:any={operationId:id(3),expectedAnalysisRevision:2,expectedReviewRevision:3,expectedEvidenceRevision:1,analysisHash:sourceHash,
        reviewHash:state.reviews[0].contentHash,evidenceHash,sourceRevision:raw.updatedAt.toISOString(),next:{cardProfile:'SPORTS',identity:{...raw.identity,playerName:'FIXTURE PLAYER'}},reason:'Correct display capitalization.'};
    const service=new ScopedIdentityCorrection({client,config,ports});
    return{state,ports,client,service,scope,request,counters,order,setPreflight:(fn:any)=>{preflightHook=fn;},setEnd:(fn:any)=>{endHook=fn;},failAudit:()=>{failAudit=true;},
        call:async(r=request,s=scope)=>{const signed=signIdentityCorrectionRequest(config,s,r,+state.now);return service.receive(signed.body,signed.signature);}};
}

test('identity transaction uses original classifier/math and atomically preserves raw state, detection lineage, approvals and notes',async()=>{
    const f=fixture(),before=structuredClone(f.state),result=await f.call();assert.equal(result.status,'CORRECTED');assert.equal(f.counters.preflight,1);
    assert.equal(f.state.raw.identity.playerName,'FIXTURE PLAYER');
    assert.deepEqual({...f.state.raw,identity:before.raw.identity,updatedAt:before.raw.updatedAt},before.raw);
    assert.deepEqual(f.state.publication,before.publication);assert.deepEqual(f.state.analyses[0],before.analyses[0]);assert.deepEqual(f.state.reviews[0],before.reviews[0]);
    const receipt=f.state.receipts[0],analysis=f.state.analyses[1],review=JSON.parse(f.state.reviews[1].canonical),admission=JSON.parse(analysis.admissionCanonical);
    assert.equal(analysis.identityCorrectionId,receipt.id);assert.equal(Object.hasOwn(analysis,'operationId'),false);assert.equal(admission.provenance,'IDENTITY_CORRECTION');
    assert.deepEqual(admission.detectionPair,JSON.parse(before.analyses[0].admissionCanonical).detectionPair);
    assert.equal(admission.previousAdmissionHash,before.analyses[0].admissionHash);assert.equal(Object.hasOwn(admission,'operationId'),false);
    assert.equal(review.observations,'Retain human notes.');assert.deepEqual(review.reviewedSides,[]);assert.equal(review.identityReviewed,false);assert.equal(review.disposition,'IN_REVIEW');
    assert.equal(receipt.priorApprovalId,before.publication.currentApprovalId);assert.equal(f.state.audits.length,1);
    assert(f.order.indexOf('StaffIdentityCorrection')<f.order.indexOf('source-CAS'));
    assert.deepEqual(f.order.filter(v=>!['gate','constraints'].includes(v)),['StaffIdentityCorrection','source-CAS','StaffAnalysisRevision','StaffReviewRevision','heads','StaffAudit']);
    assert.equal(f.state.identity.certificationUntil.getTime(),0);assert.equal(f.state.identity.trustedLearningUntil.getTime(),0);
});
test('no change and incompatible map-key corrections return safe projections without preflight or writes',async()=>{
    for(const playerName of ['Fixture Player','Other Player']){const f=fixture();f.request.next.identity.playerName=playerName;
        const response=await f.call();assert.equal(response.status,playerName==='Fixture Player'?'NO_CHANGE':'REPROCESS_REQUIRED');
        assert.equal(f.counters.preflight,0);assert.equal(f.counters.cas,0);assert.equal(f.state.receipts.length,0);assert.equal(Object.hasOwn(response,'proofCanonical'),false);}
});
test('lost reply recovers same operation before stale-head/source/private work; altered input conflicts',async()=>{
    const f=fixture(),first=await f.call(),counts={...f.counters};
    f.ports.preflight=async()=>{throw Error('private source unavailable');};f.ports.loadRawSource=async()=>{throw Error('source should not be read');};
    assert.deepEqual(await f.call(),first);assert.deepEqual(f.counters,counts);
    await assert.rejects(()=>f.call({...f.request,reason:'Changed replay request'}),/IDENTITY_REQUEST_CONFLICT/);
    f.state.session.createdAt=new Date(+f.state.now-1000);assert.deepEqual(await f.call(),first);
});
test('reviewer/session/browser/assignment/control denials occur before external work without certification gating',async()=>{
    for(const mutate of [(s:any)=>{s.identity.role='OBSERVER';},(s:any)=>{s.identity.revokedAt=s.now;},(s:any)=>{s.session.createdAt=new Date(+s.now-300001);},
        (s:any)=>{s.session.browserHash='f'.repeat(64);},(s:any)=>{s.browser.expiresAt=s.now;},(s:any)=>{s.assignment.canReview=false;},
        (s:any)=>{s.assignment.fence++;},(s:any)=>{s.correction.enabled=false;},(s:any)=>{s.correction.configHash='f'.repeat(64);}]){
        const f=fixture();mutate(f.state);await assert.rejects(()=>f.call());assert.equal(f.counters.preflight,0);assert.equal(f.counters.cas,0);}
});
test('revocation, source drift, or current map authority changes during preflight cannot publish a correction',async()=>{
    for(const kind of ['revoke','source','map']){const f=fixture();f.setPreflight(async()=>{
        if(kind==='revoke')f.state.assignment.revokedAt=f.state.now;
        if(kind==='source')f.state.raw.updatedAt=new Date(+f.state.raw.updatedAt+1);
        if(kind==='map')f.ports.assertCurrentAuthority=async()=>{throw Error('map changed');};
    });await assert.rejects(()=>f.call());assert.equal(f.state.receipts.length,0);assert.equal(f.counters.cas,0);assert.equal(f.state.card.analysisRevision,2);}
});
test('audit failure and end-of-transaction freshness denial roll back original source plus all new staff records',async()=>{
    for(const kind of ['audit','clock']){const f=fixture(),before=structuredClone(f.state);if(kind==='audit')f.failAudit();
        else f.setEnd(()=>{f.state.now=new Date(+f.state.now+301_000);});
        await assert.rejects(()=>f.call());assert.deepEqual(f.state.raw,before.raw);assert.deepEqual(f.state.card,before.card);
        assert.equal(f.state.receipts.length,0);assert.equal(f.state.analyses.length,1);assert.equal(f.state.reviews.length,1);assert.equal(f.state.audits.length,0);}
});
test('unresolved grading/operator/proposal/NFC work blocks preflight and preserves reservations',async()=>{
    const f=fixture();f.state.pending=true;await assert.rejects(()=>f.call(),/IDENTITY_WORK_UNRESOLVED/);assert.equal(f.counters.preflight,0);assert.equal(f.state.pending,true);
});
test('signed identity request has its own bounded purpose, exact config, freshness and body',()=>{
    const f=fixture(),now=Date.now(),signed=signIdentityCorrectionRequest(config,f.scope,f.request,now,id(6));
    assert.deepEqual(verifyIdentityCorrectionRequest(config,signed.body,signed.signature,now).request,f.request);
    assert.throws(()=>verifyIdentityCorrectionRequest(config,signed.body,signed.signature,now+30_000),/EXPIRED/);
    assert.throws(()=>verifyIdentityCorrectionRequest({...config,key:Buffer.alloc(32,20)},signed.body,signed.signature,now),/AUTHENTICATION/);
    assert.throws(()=>verifyIdentityCorrectionRequest({...config,configHash:'f'.repeat(64)},signed.body,signed.signature,now),/EXPIRED/);
    assert.throws(()=>signIdentityCorrectionRequest(config,f.scope,{...f.request,url:'https://attacker'}as never));
    assert.throws(()=>makeIdentityCorrectionConfig({...config,otherKeyHashes:[config.clientKeyHash]}),/CONFIGURATION/);
});
test('identity transport remains bounded for an uncooperative fetch or response body',async()=>{
    const f=fixture();let deadline:()=>void=()=>{};const timers:any={setTimeout(fn:()=>void){deadline=fn;return 1;},clearTimeout(){}};
    const pending=identityCorrectionClient(config,async()=>new Promise(()=>{}),{timers}).call(f.scope,f.request);deadline();await assert.rejects(()=>pending,/OUTCOME_UNCONFIRMED/);
    let cancelled=0;const fetcher:any=async()=>({status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel(){cancelled++;},releaseLock(){}})}});
    const body=identityCorrectionClient(config,fetcher,{timers}).call(f.scope,f.request);await Promise.resolve();deadline();await assert.rejects(()=>body,/OUTCOME_UNCONFIRMED/);assert.equal(cancelled,1);
});

test('private production configuration is disabled and bound to actual deployment/release, independent key and roster',()=>{
    assert.throws(()=>atlasIdentityCorrectionConfig({}),/NOT_ENABLED/);
    const env={NODE_ENV:'production',VERCEL_ENV:'production',VERCEL_URL:'private-fixture.vercel.app',VERCEL_DEPLOYMENT_ID:'dpl_private',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),
        ATLAS_IDENTITY_CORRECTION_ENABLED:'true',ATLAS_IDENTITY_CORRECTION_ORIGIN:config.origin,ATLAS_IDENTITY_CORRECTION_KEY:key.toString('base64'),
        ATLAS_IDENTITY_CORRECTION_ALLOWED_PHONE_HASHES_JSON:JSON.stringify([phone])};
    assert.throws(()=>atlasIdentityCorrectionConfig({...env,VERCEL_DEPLOYMENT_ID:undefined,ATLAS_IDENTITY_CORRECTION_DEPLOYMENT_ID:'caller'}),/NOT_ENABLED/);
    for(const name of ['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_TRUSTED_LEARNING_KEY','ATLAS_OPERATOR_EVIDENCE_KEY','ATLAS_PUBLIC_MEDIA_KEY','ATLAS_MACHINE_ADMISSION_KEY','ATLAS_MACHINE_EXECUTION_KEY'])
        assert.throws(()=>atlasIdentityCorrectionConfig({...env,[name]:key.toString('base64')}),/CONFIGURATION_INVALID/);
    assert.throws(()=>atlasIdentityCorrectionConfig(env),/compatible release/);
    const settings={...makeIdentityCorrectionConfig({...config,mode:'PRODUCTION',releaseSha:'a'.repeat(40),otherKeyHashes:[]}),allowedPhoneHashes:[phone]};
    assert(Object.isFrozen(atlasIdentityCorrectionBinding(settings)));assert.equal(Object.hasOwn(atlasIdentityCorrectionBinding(settings),'key'),false);
    assert.throws(()=>createAtlasIdentityCorrectionPorts({}as never,{...settings,allowedPhoneHashes:[]}),/ROSTER_INVALID/);
});
test('private source port selects exact owner+source FOR UPDATE and source CAS touches only identity+timestamp',async()=>{
    const settings={...makeIdentityCorrectionConfig({...config,mode:'PRODUCTION',releaseSha:'a'.repeat(40),otherKeyHashes:[]}),allowedPhoneHashes:[phone]},
        ports=createAtlasIdentityCorrectionPorts({}as never,settings),f=fixture();
    const tx:any={$queryRaw:async(strings:TemplateStringsArray,...values:any[])=>{const sql=strings.join('?');
        if(sql.startsWith('SELECT')){assert.match(sql,/WHERE id=\? AND "createdByUserId"=\? FOR UPDATE/);assert.deepEqual(values,['known-source','known-owner']);return[f.state.raw];}
        assert.match(sql,/SET identity=\?::jsonb,\s*"updatedAt"=\(\?::timestamptz AT TIME ZONE 'UTC'\)/);
        assert.equal(sql.slice(0,sql.indexOf('WHERE')).includes('capture='),false);assert.match(sql,/"workflowState"='CAPTURED'/);return[f.state.raw];}};
    await ports.loadRawSource(tx,{sourceType:'SPEEDSTER',sourceId:'known-source',sourceOwnerId:'known-owner'});
    await ports.compareAndSwap(tx,f.state.raw,{...f.state.raw,identity:f.request.next.identity,updatedAt:f.state.now});
    await assert.rejects(()=>ports.loadRawSource(tx,{sourceType:'LOCAL_FIXTURE',sourceId:'known-source',sourceOwnerId:'known-owner'}),/SOURCE_CHANGED/);
    await assert.rejects(()=>ports.assertCurrentAuthority(tx,f.state.raw,{}),/PREFLIGHT_CHANGED/);
});
test('private HTTP strictly bounds canonical body and refuses browser credentials, wrong host and non-HTTPS',async()=>{
    const base={method:'POST',url:IDENTITY_CORRECTION_PATH,headers:{host:'identity.example.test','x-forwarded-proto':'https','content-type':'application/json','x-atlas-identity-signature':'a'.repeat(64)}};
    const req=(patch:any={},bytes=Buffer.from('{"input":"safe"}'))=>({...base,...patch,async *[Symbol.asyncIterator](){yield bytes;}}as any);
    const response=()=>{const out:any={statusCode:0,body:null};return{out,res:{setHeader(){},status(n:number){out.statusCode=n;return this;},json(v:any){out.body=v;return this;},send(v:any){out.body=v;return this;}}as any};};
    let calls=0;const handler=createAtlasIdentityCorrectionHandler({settings:()=>config,receive:async()=>{calls++;return{status:'NO_CHANGE',reasons:[],changedFields:[],identity:{playerName:'safe'}};}});
    const ok=response();await handler(req(),ok.res);assert.equal(ok.out.statusCode,200);assert.equal(calls,1);
    for(const patch of [{method:'GET'},{url:IDENTITY_CORRECTION_PATH+'?x=1'},...([{cookie:'legacy-admin=x'},{authorization:'Bearer x'},{host:'wrong.test'},{'x-forwarded-proto':'http'}]
        .map(headers=>({headers:{...base.headers,...headers}})))]){const r=response();await handler(req(patch),r.res);assert.equal(r.out.statusCode,503);}
    for(const bytes of [Buffer.alloc(8193),Buffer.from([255]),Buffer.from('{"z":1, "a":2}')]){const r=response();await handler(req({},bytes),r.res);assert.equal(r.out.statusCode,503);}
    assert.equal(calls,1);
});
test('persisted map validator reuses original registration/geometry authority with exact pinned and current map, never a submission receipt',async()=>{
    const f=fixture(),source:any={...f.state.raw,id:'synthetic-map-source',createdByUserId:'synthetic-owner'};
    const quad=[{x:0.1,y:0.1},{x:0.9,y:0.1},{x:0.9,y:0.9},{x:0.1,y:0.9}],hash='a'.repeat(64);
    const side=(name:string)=>({originalStorageKey:`ai-grader-v2/synthetic-owner/synthetic-map-source/original/${name}.jpg`,
        rectifiedStorageKey:`ai-grader-v2/synthetic-owner/synthetic-map-source/prepared/${name}/rectified.webp`,
        inspectionStorageKey:`ai-grader-v2/synthetic-owner/synthetic-map-source/prepared/${name}/inspection.webp`,sourceCorners:quad,centeringQuad:quad,
        centeringBorders:{leftMm:6,rightMm:6,topMm:8,bottomMm:8},inspectionFrame:{width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},
        transform:[1,0,0,0,1,0,0,0,1],viewStorageKeys:Object.fromEntries(['NORMALIZED','MICRO_DEFECT','DIRECTIONAL'].map(view=>[view,
            `ai-grader-v2/synthetic-owner/synthetic-map-source/prepared/${name}/${view.toLowerCase()}.webp`]))});
    source.capture={cornerShape:'ROUNDED_3_18_MM',front:side('front'),back:side('back')};
    const parsed=parseSpeedsterMapSourceSession(source),mapSide=(side:'FRONT'|'BACK')=>({side,referenceInspection:{storageKey:`synthetic/${side}/reference`,sha256:hash},
        sourcePhysicalQuadSha256:speedsterPhysicalQuadHash(quad),designBoundary:{kind:'FULL_BLEED'},
        anchors:quad.map((point,index)=>({id:`${side}-${index}`,label:`Anchor ${index}`,point,referencePatch:{storageKey:`synthetic/${side}/reference`,sha256:hash}})),
        zones:[{id:`${side}-zone`,label:'Synthetic printed text',semanticType:'PRINT_TEXT',polygon:quad}]});
    const frontMap=mapSide('FRONT'),backMap=mapSide('BACK'),revision:any={mapId:'synthetic-map',revisionId:'synthetic-map-revision',version:1,
        matchKey:speedsterCardTypeMapKey('SPORTS',source.identity),filterPolicyVersion:SPEEDSTER_MAP_FILTER_POLICY_VERSION,mapSchemaVersion:SPEEDSTER_MAP_SCHEMA_VERSION,frontMap,backMap};
    // Original builder here supplies fictional fixture geometry only; the runtime
    // adapter never creates or signs a registration during correction.
    source.mapRegistration={front:speedsterIdentityMapRegistration(frontMap as never,parsed.front,revision.revisionId),
        back:speedsterIdentityMapRegistration(backMap as never,parsed.back,revision.revisionId)};
    source.mapRevisionId=revision.revisionId;source.mapFilterPolicyVersion=revision.filterPolicyVersion;
    const applied:any={revision,appliedScope:'EXACT'};let calls=0;const hashEvidence=async()=>{calls++;return hash;},noLesson=async()=>null;
    await assertAtlasIdentityCorrectionMap(source,applied,hashEvidence,noLesson);assert(calls>=4);
    assert.equal(Object.hasOwn(source.mapRegistration.front,'serverReceipt'),false);
    for(const mutate of [(s:any)=>{s.mapRevisionId='other';},(s:any)=>{s.mapFilterPolicyVersion='other';},
        (s:any)=>{s.mapRegistration.front.currentPhysicalQuadSha256='f'.repeat(64);},(s:any)=>{s.mapRegistration.front.homography[0]=0;}]){
        const changed=structuredClone(source);mutate(changed);await assert.rejects(()=>assertAtlasIdentityCorrectionMap(changed,applied,hashEvidence,noLesson));}
    await assert.rejects(()=>assertAtlasIdentityCorrectionMap(source,applied,async()=> 'f'.repeat(64),noLesson));
    const noMap={...source,mapRevisionId:null,mapFilterPolicyVersion:null,mapRegistration:null};
    await assertAtlasIdentityCorrectionMap(noMap,null,hashEvidence,noLesson);
    await assert.rejects(()=>assertAtlasIdentityCorrectionMap(noMap,applied,hashEvidence,noLesson),/MAP_REPROCESS_REQUIRED/);
});
test('private HTTP deadline bounds a stalled body and prevents late body completion from dispatching correction',async()=>{
    let deadline=()=>{},resolveRead:(value:any)=>void=()=>{},destroyed=0,returned=0,calls=0,writes=0;
    const timers:any={setTimeout(fn:()=>void,ms:number){assert.equal(ms,25_000);deadline=fn;return 1;},clearTimeout(){}};
    const req:any={method:'POST',url:IDENTITY_CORRECTION_PATH,headers:{host:'identity.example.test','x-forwarded-proto':'https',
        'content-type':'application/json','x-atlas-identity-signature':'a'.repeat(64)},destroy(){destroyed++;},[Symbol.asyncIterator](){return{
            next:()=>new Promise(resolve=>{resolveRead=resolve;}),return(){returned++;return new Promise(()=>{});}};}};
    const statuses:number[]=[],res:any={setHeader(){},status(n:number){statuses.push(n);return this;},json(){writes++;},send(){writes++;}};
    const handler=createAtlasIdentityCorrectionHandler({settings:()=>config,receive:async()=>{calls++;return{};}},{timers});
    const pending=handler(req,res);deadline();await pending;assert.deepEqual(statuses,[503]);assert.equal(writes,1);assert(destroyed>=1);assert(returned>=1);
    resolveRead({done:true});await Promise.resolve();await Promise.resolve();assert.equal(calls,0);assert.equal(writes,1);
});
test('private HTTP deadline aborts receive signal and a late committed receipt cannot write another response',async()=>{
    let deadline=()=>{},finish:(value:any)=>void=()=>{},signal:AbortSignal|undefined,writes=0;
    const timers:any={setTimeout(fn:()=>void){deadline=fn;return 1;},clearTimeout(){}};
    const req:any={method:'POST',url:IDENTITY_CORRECTION_PATH,headers:{host:'identity.example.test','x-forwarded-proto':'https',
        'content-type':'application/json','x-atlas-identity-signature':'a'.repeat(64)},async *[Symbol.asyncIterator](){yield Buffer.from('{"input":"safe"}');}};
    const statuses:number[]=[],res:any={setHeader(){},status(n:number){statuses.push(n);return this;},json(){writes++;},send(){writes++;}};
    const handler=createAtlasIdentityCorrectionHandler({settings:()=>config,receive:async(_s,_body,_sig,s)=>{signal=s;return new Promise(resolve=>{finish=resolve;});}},{timers});
    const pending=handler(req,res);for(let n=0;n<10&&!signal;n++)await Promise.resolve();assert(signal);
    deadline();await pending;assert.equal(signal.aborted,true);assert.deepEqual(statuses,[503]);assert.equal(writes,1);
    finish({status:'CORRECTED',receiptId:id(9)});for(let n=0;n<5;n++)await Promise.resolve();assert.equal(writes,1);assert.deepEqual(statuses,[503]);
});
