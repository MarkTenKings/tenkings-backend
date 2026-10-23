import test from 'node:test';
import assert from 'node:assert/strict';
import { createProofImageValidator } from '../src/proof-image.mjs';
import { image,digest } from './proof-fixtures.mjs';
const plan=(bytes,declaredType='image/png')=>({byteCount:bytes.length,sha256:digest(bytes),declaredType});
function recalculateCrc(bytes,at){const length=bytes.readUInt32BE(at),end=at+12+length;let crc=0xffffffff;for(const byte of bytes.subarray(at+4,end-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}bytes.writeUInt32BE((crc^0xffffffff)>>>0,end-4);}

test('actual PNG and JPEG full raster decode preserves original digest and dimensions',async()=>{
  const validator=createProofImageValidator();for(const format of ['png','jpeg']){const bytes=await image(format),mime='image/'+format,value=await validator.validate({bytes,plan:plan(bytes,mime)});assert.equal(value.width,20);assert.equal(value.height,30);assert.equal(value.sha256,digest(bytes));assert.equal(value.contentType,mime);assert.equal(value.decoder,'sharp-0.33.5/libvips-8.15.3');}
});

test('valid PNG container with corrupt compressed pixels fails real decoder',async()=>{
  const bytes=Buffer.from(await image());let at=8;while(bytes.toString('ascii',at+4,at+8)!=='IDAT')at+=12+bytes.readUInt32BE(at);bytes.fill(0,at+8,at+8+bytes.readUInt32BE(at));recalculateCrc(bytes,at);
  await assert.rejects(createProofImageValidator().validate({bytes,plan:plan(bytes)}),{code:'PROOF_IMAGE_INVALID'});
});

test('truncation, appended data, unsupported content and pixel budget are refused',async()=>{
  const validator=createProofImageValidator(),png=await image(),jpeg=await image('jpeg');
  for(const [bytes,mime] of [[png.subarray(0,-4),'image/png'],[jpeg.subarray(0,-2),'image/jpeg'],[Buffer.concat([jpeg,Buffer.from('private')]),'image/jpeg'],[Buffer.from('<svg onload="alert(1)"/>'),'image/png']])await assert.rejects(validator.validate({bytes,plan:plan(bytes,mime)}),{code:'PROOF_IMAGE_INVALID'});
  await assert.rejects(createProofImageValidator({maxPixels:200}).validate({bytes:png,plan:plan(png)}));
});

test('worker deadline kills decode and capacity does not remain occupied',async()=>{
  const validator=createProofImageValidator({timeoutMs:1,maxConcurrent:1}),bytes=await image();await assert.rejects(validator.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_TIMEOUT'});await assert.rejects(validator.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_TIMEOUT'});
});


test('owned validator close kills active work, joins child cleanup and refuses new input',async()=>{
  const validator=createProofImageValidator(),bytes=await image(),pending=validator.validate({bytes,plan:plan(bytes)}),rejected=assert.rejects(pending,{code:'PROOF_VALIDATOR_CLOSED'});
  await validator.close();await rejected;await assert.rejects(validator.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_CLOSED'});await validator.close();
});
