import test from 'node:test';
import assert from 'node:assert/strict';
import {PROOF_DECODER_PROTOCOL,proofDecoderLimits,proofDecoderLimitsHash,encodeProofDecoderFrame,createProofDecoderFrameReader} from '../src/proof-decoder-protocol.mjs';
const hello={schema:PROOF_DECODER_PROTOCOL,qualificationHash:'a'.repeat(64),epoch:'fixture_epoch',limitsHash:proofDecoderLimitsHash(proofDecoderLimits())};
function raw(text,type=1){const payload=Buffer.from(text),header=Buffer.alloc(8);header.writeUInt32BE(payload.length);header[4]=1;header[5]=type;return Buffer.concat([header,payload]);}
function reader(){const values=[];return{values,stream:createProofDecoderFrameReader({onFrame:(type,value)=>values.push([type,value])})};}

test('canonical frames parse across every header/payload byte boundary with bounded buffering',()=>{
  const data=Buffer.alloc(65536,7),input=Buffer.concat([encodeProofDecoderFrame('HELLO',hello),encodeProofDecoderFrame('DATA',data)]),f=reader();
  for(const byte of input){f.stream.feed(Buffer.from([byte]));assert.ok(f.stream.status().allocatedBytes<=65544);}f.stream.end();assert.deepEqual(f.values,[['HELLO',hello],['DATA',data]]);
});
test('metadata rejects unknown fields, duplicate and escaped duplicate keys, noncanonical JSON and excess nesting',()=>{
  const text=encodeProofDecoderFrame('HELLO',hello).subarray(8).toString('utf8'),alias='"ep'+'\\u006f'+'ch":"fixture_epoch",';
  const malformed=[text.slice(0,-1)+',"unexpected":true}',text.replace('{','{"epoch":"fixture_epoch",'),text.replace('{','{'+alias),text+' ',JSON.stringify({x:[[[[[0]]]]]}),'{"epoch":"\ufffd"}'];
  for(const value of malformed){const f=reader();assert.throws(()=>f.stream.feed(raw(value)),{code:'PROOF_DECODER_PROTOCOL'});}
  const invalid=raw('{}');invalid[8]=0xff;assert.throws(()=>reader().stream.feed(invalid),{code:'PROOF_DECODER_PROTOCOL'});
});
test('framing refuses oversized headers, versions, reserved bytes, response DATA, trailing bytes and truncated frames',()=>{
  const base=encodeProofDecoderFrame('HELLO',hello);
  for(const mutate of [b=>b.writeUInt32BE(4097),b=>b[4]=2,b=>b[6]=1,b=>b[5]=99]){const bytes=Buffer.from(base);mutate(bytes);assert.throws(()=>reader().stream.feed(bytes),{code:'PROOF_DECODER_PROTOCOL'});}
  const limited=createProofDecoderFrameReader({onFrame(){},allowedTypes:['HELLO'],maxFrames:1,maxTotalBytes:4096});assert.throws(()=>limited.feed(encodeProofDecoderFrame('DATA',Buffer.from('x'))),{code:'PROOF_DECODER_PROTOCOL'});
  for(const bytes of [base.subarray(0,4),base.subarray(0,-1),Buffer.concat([base,Buffer.from([0])])]){const f=reader();f.stream.feed(bytes);assert.throws(()=>f.stream.end(),{code:'PROOF_DECODER_PROTOCOL'});}
  const one=createProofDecoderFrameReader({onFrame(){},maxFrames:1});assert.throws(()=>one.feed(Buffer.concat([base,base])),{code:'PROOF_DECODER_PROTOCOL'});
});
test('limits require finite bounded integers and do not default explicit null',()=>{
  for(const input of [null,{timeoutMs:null},{maxConcurrent:0},{maxPixels:16000001},{maxObjectBytes:NaN},{unknown:1}])assert.throws(()=>proofDecoderLimits(input),{code:'PROOF_DECODER_PROTOCOL'});
  assert.equal(proofDecoderLimits({timeoutMs:undefined}).timeoutMs,15000);
});
