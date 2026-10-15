import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInspectionAccess, parseReportImageAccess, INSPECTION_STORAGE_ORIGIN } from '../src/inspection-access.mjs';
import { signManualPublicRequest, verifyManualPublicRequest, MANUAL_PUBLIC_ORIGIN } from '../src/manual-public.mjs';
const hash = 'a'.repeat(64), publicHash = 'b'.repeat(64);
const access = () => ({ version: 'atlas-approved-image-access-v1', publicToken: 'ar_' + 'A'.repeat(24),
  approvalVersion: 1, publicHash, side: 'FRONT', image: { url: `${INSPECTION_STORAGE_ORIGIN}/approved?grant=fixture`,
    sha256: hash, byteCount: 6000000, mime: 'image/webp', width: 1350, height: 1858,
    preview: { url: `${INSPECTION_STORAGE_ORIGIN}/preview?grant=fixture`, sha256: 'c'.repeat(64), byteCount: 40000,
      mime: 'image/jpeg', width: 558, height: 768, sourceSha256: hash, policyVersion: 'atlas-inspection-preview-v1' } } });
test('approved access binds full and preview bytes to exact report version, side and canonical hash', () => {
  const value = access();
  assert.deepEqual(parseInspectionAccess(value, { publicHash, sha256: hash, side: 'FRONT' }), value);
  for (const expected of [{ publicHash: hash }, { side: 'BACK' }, { sha256: publicHash }, { byteCount: 1 }])
    assert.throws(() => parseInspectionAccess(value, expected));
});
test('grants reject external destinations, wrong preview binding and unsafe dimensions; old images need no preview', () => {
  for (const mutate of [v => { v.image.url = 'https://attacker.invalid/image'; },
    v => { v.image.preview.sourceSha256 = publicHash; }, v => { v.image.preview.width = 768; },
    v => { v.image.preview.byteCount = 2000000; }, v => { v.image.width = 3024; },
    v => { v.image.url = `${INSPECTION_STORAGE_ORIGIN}/image#fragment`; }]) {
    const v = access(); mutate(v); assert.throws(() => parseInspectionAccess(v));
  }
  const old = access(); delete old.image.preview; assert.deepEqual(parseInspectionAccess(old), old);
});
test('new access request is signed and versioned without accepting arbitrary object selectors', () => {
  const config = { manualKey: Buffer.alloc(32, 7), manualOrigin: MANUAL_PUBLIC_ORIGIN,
    deploymentId: 'fixture.vercel.app', releaseSha: 'a'.repeat(40), configHash: hash };
  const request = { kind: 'IMAGE_ACCESS', token: access().publicToken, version: 1, side: 'FRONT', findingId: null };
  const signed = signManualPublicRequest(config, request);
  assert.deepEqual(verifyManualPublicRequest({ key: config.manualKey }, signed.body, signed.signature).request, request);
  for (const change of [{ version: null }, { side: null }, { url: 'https://other.invalid' }, { findingId: 'other' }])
    assert.throws(() => signManualPublicRequest(config, { ...request, ...change }));
});


test('Photoroom direct access allows bounded full resolution with exact approval and output bindings', () => {
  const value={...access(),version:'atlas-approved-report-image-access-v1',execution:'PHOTOROOM_PLUS_API',
    image:{url:`${INSPECTION_STORAGE_ORIGIN}/cutout?grant=fixture`,sha256:hash,byteCount:25*1024*1024,mime:'image/png',width:3024,height:4032}};
  assert.deepEqual(parseReportImageAccess(value,{publicToken:value.publicToken,approvalVersion:1,publicHash,side:'FRONT',sha256:hash,byteCount:value.image.byteCount,width:3024,height:4032}),value);
  for(const expected of [{publicToken:'ar_'+'B'.repeat(24)},{approvalVersion:2},{publicHash:hash},{side:'BACK'},{sha256:publicHash},{byteCount:1},{width:4032},{height:3024}])
    assert.throws(()=>parseReportImageAccess(value,expected));
  for(const mutate of [v=>{v.execution='OPENAI_IMAGES_API';},v=>{v.image.width=5001;},v=>{v.image.byteCount=101*1024*1024+1;},
    v=>{v.image.mime='image/webp';},v=>{v.image.url='https://attacker.invalid/photo';},v=>{v.image.url+= '#fragment';}]){
    const changed=structuredClone(value);mutate(changed);assert.throws(()=>parseReportImageAccess(changed));
  }
  assert.throws(()=>parseInspectionAccess(value));
});
