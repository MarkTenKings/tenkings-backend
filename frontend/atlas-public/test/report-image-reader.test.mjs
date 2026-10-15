import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicReportReader } from '../lib/server/reader.mjs';
import { digest } from '../lib/server/policy.mjs';
import { reportImageURL } from '@atlas/report-view/report-images-contract';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';

async function fixture({photoroom=false}={}) {
  const f = await publicationFixture();
  await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest);
  const packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const bytes = Buffer.from('synthetic presentation bytes; reader tests integrity, provider validates PNG');
  const binding = { publicToken: packet.publicToken, approvalVersion: 1, publicHash: f.row.public_hash };
  const image = { ...binding, side: 'FRONT', sourceSha256: packet.images.FRONT.sha256,
    sha256: digest(bytes), byteCount: bytes.length, width: 1024, height: 1536, contentType: 'image/png',
    transparent: true, presentationOnly: true, preservesOriginalRGB: false, alignment: 'approximate-frame-fit',
    promptVersion: 'test-background-v1', model: 'test-model', execution: 'OPENAI_IMAGES_API' };
  if(photoroom){delete image.promptVersion;delete image.model;Object.assign(image,{execution:'PHOTOROOM_PLUS_API',recipeVersion:'atlas-photoroom-plus-hd-v1',
    preservesOriginalRGB:false,preservesOpaqueRGB:true,foregroundRGBValidation:'bounded-edge-rgb-v1',alignment:'original-frame',width:3024,height:4032,byteCount:25*1024*1024});}
  image.url = reportImageURL(image);
  const state = { envelope: { version: 'atlas-report-images-v1', ...binding, images: { FRONT: image } },
    bytes, retired: false, calls: [], grant:{version:'atlas-approved-report-image-access-v1',execution:'PHOTOROOM_PLUS_API',...binding,side:'FRONT',
      image:{url:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com/cutout?signature=fixture',sha256:image.sha256,
        byteCount:image.byteCount,mime:'image/png',width:image.width,height:image.height}} };
  const manual = { async read(request) {
    state.calls.push(request);
    if (state.retired) return null;
    if (request.kind === 'REPORT_IMAGE') return state.bytes;
    if (request.kind === 'REPORT_IMAGE_ACCESS') return state.grant;
    return { packet, publicHash: binding.publicHash, reportImages: state.envelope };
  } };
  return { state, packet, image, manual, reader: new PublicReportReader({ mode: 'LOCAL_FIXTURE' }, manual),
    selector: { token: binding.publicToken, version: 1, side: 'FRONT', outputSha256: image.sha256 } };
}

test('optional presentation binds to approved source and leaves immutable report unchanged', async () => {
  const f = await fixture(), before = JSON.stringify(f.packet);
  const report = await f.reader.read(f.selector);
  assert.equal(JSON.stringify(report.packet), before);
  assert.equal(report.reportImages.images.FRONT.sourceSha256, f.packet.images.FRONT.sha256);
  assert.deepEqual(await f.reader.reportImage(f.selector), { bytes: f.state.bytes, contentType: 'image/png' });
  const request = f.state.calls.find(call => call.kind === 'REPORT_IMAGE');
  assert.deepEqual(request, { kind: 'REPORT_IMAGE', ...f.selector, findingId: null });
});

test('wrong-source or wrong-report presentation falls back without suppressing approved report', async () => {
  for (const change of [image => { image.sourceSha256 = 'f'.repeat(64); }, image => { image.publicHash = 'f'.repeat(64); },
    image => { image.side = 'BACK'; }, image => { image.url = 'https://untrusted.invalid/photo.png'; }]) {
    const f = await fixture(); change(f.state.envelope.images.FRONT);
    const report = await f.reader.read(f.selector);
    assert.ok(report.packet); assert.equal(report.reportImages, undefined);
    assert.equal(await f.reader.reportImage(f.selector), null);
    assert.equal(f.state.calls.some(call => call.kind === 'REPORT_IMAGE'), false);
  }
});

test('derivative bytes must match digest and length and requested output', async () => {
  const f = await fixture();
  assert.equal(await f.reader.reportImage({ ...f.selector, outputSha256: 'a'.repeat(64) }), null);
  assert.equal(await f.reader.reportImage({ ...f.selector, side: 'BACK' }), null);
  f.state.bytes = Buffer.alloc(f.state.bytes.length, 65);
  await assert.rejects(f.reader.reportImage(f.selector), /PUBLIC_REPORTS_UNAVAILABLE/);
});

test('retirement during image fetch and version replacement prevent stale bytes escaping', async () => {
  for (const afterRead of [state => { state.retired = true; }, state => { state.envelope = null; }]) {
    const f = await fixture(), read = f.manual.read;
    f.manual.read = async request => { const result = await read(request); if (request.kind === 'REPORT_IMAGE') afterRead(f.state); return result; };
    assert.equal(await f.reader.reportImage(f.selector), null);
  }
});

test('full-resolution Photoroom images return an exact signed grant without using the bounded PNG proxy',async()=>{
 const f=await fixture({photoroom:true});
 assert.deepEqual(await f.reader.reportImage(f.selector),{access:f.state.grant});
 assert.equal(f.state.calls.some(call=>call.kind==='REPORT_IMAGE'),false);
 assert.deepEqual(f.state.calls.find(call=>call.kind==='REPORT_IMAGE_ACCESS'),{kind:'REPORT_IMAGE_ACCESS',...f.selector,findingId:null});
 for(const mutate of [v=>{v.publicHash='d'.repeat(64);},v=>{v.side='BACK';},v=>{v.approvalVersion=2;},v=>{v.image.sha256='d'.repeat(64);},
  v=>{v.image.byteCount--;},v=>{v.image.width--;},v=>{v.image.url='https://other.invalid/cutout';}]){
  const g=await fixture({photoroom:true});mutate(g.state.grant);await assert.rejects(g.reader.reportImage(g.selector));
 }
});

test('retirement or output replacement during Photoroom grant creation cannot return stale access',async()=>{
 for(const changed of [state=>{state.retired=true;},state=>{state.envelope.images.FRONT.sha256='d'.repeat(64);},state=>{state.envelope=null;}]){
  const f=await fixture({photoroom:true}),read=f.manual.read;
  f.manual.read=async request=>{const result=await read(request);if(request.kind==='REPORT_IMAGE_ACCESS')changed(f.state);return result;};
  assert.equal(await f.reader.reportImage(f.selector),null);
 }
});
