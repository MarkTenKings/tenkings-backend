import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalJSON} from '../src/contract.mjs';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {PROOF_DECODER_VERSION} from '../src/proof-decoder-protocol.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';
import {TARGET_BROKER_SCHEMA,TARGET_BROKER_SOCKET,encodeTargetBrokerFrame,createTargetBrokerFrameReader,createTargetBrokerInputCollector,brokerNanoseconds} from '../src/proof-decoder-target-broker-protocol.mjs';
import {startProofDecoderTargetBroker,createProofDecoderTargetBrokerClient} from '../src/proof-decoder-target-broker.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const requestId=randomUUID(),nonce='a'.repeat(64),bindingHash='b'.repeat(64);
const source=Buffer.alloc(65539,0x37),originalPlan={byteCount:source.length,sha256:sha(source),declaredType:'image/png'};
const hello={schema:TARGET_BROKER_SCHEMA,bootId:'11111111-1111-4111-8111-111111111111',epoch:'UNQUALIFIED_TEST',bindingHash,profileHash:'c'.repeat(64),limitsHash:'d'.repeat(64),nonce,nowNs:'123'};
function reader(types=['HELLO','START','ACCEPT','DATA','INPUT_END','CANCEL','TERMINAL'],bounds={}){const frames=[];return {frames,stream:createTargetBrokerFrameReader({onFrame:(type,value)=>frames.push({type,value}),allowedTypes:types,maxFrames:166,maxTotalBytes:10485760+16384,...bounds})};}
function raw(text,type=1){const body=Buffer.from(text),header=Buffer.alloc(8);header.writeUInt32BE(body.length);header[4]=2;header[5]=type;return Buffer.concat([header,body]);}
const terminal=()=>({schema:TARGET_BROKER_SCHEMA,classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false,requestId,nonce,bindingHash,jobId:randomUUID(),outcome:'SUCCESS',reportedCleanup:'OBSERVED',validation:{schema:'atlas-marketplace-proof-image-v1',decoder:PROOF_DECODER_VERSION,contentType:'image/png',byteCount:source.length,sha256:sha(source),width:2,height:3}});

test('v2 frame parsing handles every byte boundary and retains at most one bounded frame',()=>{
  const bytes=Buffer.concat([encodeTargetBrokerFrame('HELLO',hello),encodeTargetBrokerFrame('DATA',source.subarray(0,65536))]),f=reader();
  for(let i=0;i<bytes.length;i++){f.stream.feed(bytes.subarray(i,i+1));assert.ok(f.stream.status().allocatedBytes<=65544);}
  f.stream.end();assert.deepEqual(f.frames,[{type:'HELLO',value:hello},{type:'DATA',value:source.subarray(0,65536)}]);
});
test('canonical metadata rejects duplicate aliases, malformed UTF-8, unknown fields and forbidden authority fields',()=>{
  const text=canonicalJSON(hello),alias='"ep'+'\\u006f'+'ch":"UNQUALIFIED_TEST",';
  for(const bad of [text+' ',text.replace('{','{"epoch":"UNQUALIFIED_TEST",'),text.replace('{','{'+alias),text.replace('{','{"qualificationHash":"'+'f'.repeat(64)+'",'),'{"x":[[[[[[[[[[[[[0]]]]]]]]]]]]]}'])assert.throws(()=>reader().stream.feed(raw(bad)));
  const malformed=raw(text);malformed[9]=0xff;assert.throws(()=>reader().stream.feed(malformed));
  const promoted=terminal();promoted.executionAllowed=true;assert.throws(()=>encodeTargetBrokerFrame('TERMINAL',promoted));
  promoted.executionAllowed=false;promoted.freshPublicationAllowed=true;assert.throws(()=>encodeTargetBrokerFrame('TERMINAL',promoted));
});
test('v1, reserved bytes, unknown kinds, oversized headers and excess frame/byte budgets refuse',()=>{
  const base=encodeTargetBrokerFrame('HELLO',hello);
  for(const mutate of [b=>b[4]=1,b=>b[5]=99,b=>b[6]=1,b=>b.writeUInt32BE(2049)]){const frame=Buffer.from(base);mutate(frame);assert.throws(()=>reader().stream.feed(frame));}
  assert.throws(()=>reader(['HELLO']).stream.feed(encodeTargetBrokerFrame('DATA',Buffer.from('x'))));
  assert.throws(()=>reader(['HELLO'],{maxFrames:1}).stream.feed(Buffer.concat([base,base])));
  assert.throws(()=>reader(['HELLO'],{maxTotalBytes:8}).stream.feed(base));
});
test('EOF requires the complete final frame; closed/failed readers cannot be reused',()=>{
  const base=encodeTargetBrokerFrame('HELLO',hello);
  for(const partial of [base.subarray(0,1),base.subarray(0,7),base.subarray(0,-1),Buffer.concat([base,Buffer.from([0])])]){const f=reader();f.stream.feed(partial);assert.throws(()=>f.stream.end());assert.equal(f.stream.status().failed,true);assert.equal(f.stream.status().allocatedBytes,8);assert.throws(()=>f.stream.feed(base));f.stream.close();}
  const f=reader(['HELLO']);assert.throws(()=>f.stream.feed(encodeTargetBrokerFrame('DATA',Buffer.from('x'))));assert.equal(f.stream.status().allocatedBytes,8);assert.throws(()=>f.stream.feed(base));
});
test('original collection snapshots the plan and requires exact count/hash/chunk sizes before completion',()=>{
  const input={...originalPlan},collector=createTargetBrokerInputCollector(input);input.sha256='f'.repeat(64);
  collector.feed(source.subarray(0,65536));collector.feed(source.subarray(65536));const bytes=collector.end();assert.deepEqual(bytes,source);
  assert.throws(()=>collector.feed(Buffer.from('x')));assert.equal(bytes.every(byte=>byte===0),true);
  const incomplete=createTargetBrokerInputCollector(originalPlan);incomplete.feed(source.subarray(0,65536));assert.throws(()=>incomplete.end());assert.equal(incomplete.status().closed,true);
  const short=createTargetBrokerInputCollector(originalPlan);assert.throws(()=>short.feed(source.subarray(0,1)));assert.equal(short.status().closed,true);
  const wrong=createTargetBrokerInputCollector({...originalPlan,sha256:'0'.repeat(64)});wrong.feed(source.subarray(0,65536));wrong.feed(source.subarray(65536));assert.throws(()=>wrong.end());
});
test('INPUT_END/cancel carry exact request and nonce; terminal keeps retained DTO and unqualified markers',()=>{
  for(const type of ['INPUT_END','CANCEL']){const f=reader([type]);f.stream.feed(encodeTargetBrokerFrame(type,{requestId,nonce}));f.stream.end();assert.deepEqual(f.frames[0].value,{requestId,nonce});assert.throws(()=>encodeTargetBrokerFrame(type,{requestId,nonce,accepted:true}));}
  const report=terminal(),f=reader(['TERMINAL']);f.stream.feed(encodeTargetBrokerFrame('TERMINAL',report));f.stream.end();assert.deepEqual(f.frames[0].value,report);
  assert.throws(()=>encodeTargetBrokerFrame('TERMINAL',{...report,outcome:'QUARANTINED',reportedCleanup:'OBSERVED',validation:null}));
  assert.throws(()=>encodeTargetBrokerFrame('TERMINAL',{...report,outcome:'INVALID_IMAGE'}));
});
test('BOOTTIME grammar is exact unsigned decimal with no floating-point or uint64 overflow',()=>{
  for(const value of ['01','-1','1.5','1e2','18446744073709551616',1,null])assert.throws(()=>brokerNanoseconds(value));
  assert.equal(brokerNanoseconds('18446744073709551615'),18446744073709551615n);
});
test('broker/client default off and closed options refuse getters without endpoint or runtime effects',async()=>{
  assert.equal(await startProofDecoderTargetBroker(),null);assert.equal(createProofDecoderTargetBrokerClient(),null);
  for(const factory of [startProofDecoderTargetBroker,createProofDecoderTargetBrokerClient]){
    let called=false;await assert.rejects(async()=>factory({get enabled(){called=true;return true;}}));assert.equal(called,false);
    await assert.rejects(async()=>factory({enabled:false,execute:()=>true}));
  }
});
test('target-only listener/client reject shaped observers/controllers and nonfixed profiles before effects',async()=>{
  const profile=syntheticDecoderProfile();profile.limits.maxConcurrent=1;profile.ipc.socketPath=TARGET_BROKER_SOCKET;profile.ipc.supervisorUid=0;profile.ipc.supervisorGid=0;
  const plan=createProofDecoderLaunchPlan({enabled:true,profile});
  await assert.rejects(startProofDecoderTargetBroker({enabled:true,plan,parentController:{status:()=>({healthy:true})},observer:{}}),{code:'DECODER_KERNEL_PARENT_REQUIRED'});
  assert.throws(()=>createProofDecoderTargetBrokerClient({enabled:true,plan,observer:{boottimeNanoseconds:()=>1n}}),{code:'DECODER_LINUX_OBSERVER_REQUIRED'});
  const nonfixed=createProofDecoderLaunchPlan({enabled:true,profile:{...profile,ipc:{...profile.ipc,socketPath:'/run/atlas-r2-decoder/other.sock'}}});
  assert.throws(()=>createProofDecoderTargetBrokerClient({enabled:true,plan:nonfixed,observer:{}}),{code:'DECODER_BROKER_CONFIGURATION'});
});
