import test from 'node:test';
import assert from 'node:assert/strict';
import {createSectionSession,sectionFindingDetail,sideGeometry,fingerprintArea} from './continuation-state.mjs';

const manifest=(key,id)=>({report:{bindingKey:key},findings:id?[{id}]:[]});
const session=(section,load,options={})=>createSectionSession({section,load,fetchAsset:async asset=>asset,createURL:asset=>'blob:'+asset.contentKey,revokeURL:()=>{},...options});

test('chapter reports stay separate and finding actions retain their exact report',async()=>{
  const load=async key=>manifest('approved:'+key,key+'-finding');
  const report=session('report',load),connected=session('connected',load);
  const [r,c]=await Promise.all([report.load(),connected.load()]);
  assert.equal(sectionFindingDetail('connected',c,'connected-finding').reportKey,'approved:connected');
  assert.equal(sectionFindingDetail('report',r,'report-finding').manifest,r);
  assert.throws(()=>sectionFindingDetail('connected',c,'report-finding'),/does not belong/);
  assert.throws(()=>sectionFindingDetail('report',manifest('empty'),'invented'),/does not belong/);
  report.dispose();connected.dispose();
});

test('failed metadata read can retry while concurrent successful reads share one request',async()=>{
  let calls=0;
  const s=session('fingerprint',async()=>{calls++;if(calls===1)throw new Error('temporary');return manifest('ready');});
  await assert.rejects(s.load(),/temporary/);
  const [a,b]=await Promise.all([s.load(),s.load()]);assert.equal(a,b);assert.equal(calls,2);
  assert.equal(await s.load(),a);assert.equal(calls,2);s.dispose();
});

test('changing sides cancels stale reads without cancelling the current side',async()=>{
  const s=session('report',async()=>manifest('report'));
  const old=s.request('side'),focus=s.request('focus'),current=s.request('side');
  assert.equal(old.signal.aborted,true);assert.equal(old.current(),false);
  assert.equal(current.current(),true);assert.equal(focus.current(),true);
  await assert.rejects(s.asset({contentKey:'old'},old),{name:'AbortError'});
  s.dispose();assert.equal(current.signal.aborted,true);assert.equal(focus.signal.aborted,true);
});

test('a read completing after cancellation cannot create a stale image URL',async()=>{
  let release,created=0;
  const s=session('connected',async()=>manifest('connected'),{fetchAsset:()=>new Promise(resolve=>{release=resolve;}),createURL:()=>{created++;return 'blob:late';}});
  const old=s.request('side'),pending=s.asset({contentKey:'old'},old);
  s.request('side');release({});await assert.rejects(pending,{name:'AbortError'});assert.equal(created,0);s.dispose();
});

test('derived front/back images use distinct evidence keys and URLs are released once',async()=>{
  const revoked=[];let reads=0;
  const s=session('fingerprint',async()=>manifest('fingerprint'),{fetchAsset:async asset=>{reads++;return asset;},revokeURL:url=>revoked.push(url)});
  assert.equal(await s.asset({contentKey:'hash:FRONT:FINGERPRINT'}),'blob:hash:FRONT:FINGERPRINT');
  assert.equal(await s.asset({contentKey:'hash:BACK:FINGERPRINT'}),'blob:hash:BACK:FINGERPRINT');
  assert.equal(await s.asset({contentKey:'hash:FRONT:FINGERPRINT'}),'blob:hash:FRONT:FINGERPRINT');
  assert.equal(reads,2);s.dispose();s.dispose();assert.equal(revoked.length,2);
  await assert.rejects(s.load(),{name:'AbortError'});
});

test('missing optional geometry or dimensions are not replaced with invented measurements',()=>{
  const quad=[[0,0],[10,0],[10,20],[0,20]];
  assert.equal(sideGeometry({geometry:{physicalQuadSource:quad}}),null);
  assert.deepEqual(sideGeometry({geometry:{physicalQuadSource:quad,printedQuadSource:quad}}),{physical:quad,printed:quad});
  assert.equal(fingerprintArea({card:{widthMm:null,heightMm:null}},{}),null);
  const card={widthMm:63.5,heightMm:88.9,canonicalWidth:1270,canonicalHeight:1778};
  assert.equal(fingerprintArea({card},{fingerprint:{occupiedPixels:0}}),0);
  assert.equal(fingerprintArea({card},{fingerprint:{occupiedPixels:400}}),1);
});
