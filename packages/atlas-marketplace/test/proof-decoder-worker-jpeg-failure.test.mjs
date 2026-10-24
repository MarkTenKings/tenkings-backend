import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProofDecoderWorkerFailure as classify} from '../src/proof-decoder-worker.mjs';

const observed='VipsJpeg: Corrupt JPEG data: premature end of data segment';

test('exact observed libvips JPEG entropy failure is an invalid image',()=>{
  assert.equal(classify(new Error(observed)),'INVALID_IMAGE');
  assert.equal(classify({message:observed}),'INVALID_IMAGE');
});

test('near-miss JPEG messages retain decoder failure',()=>{
  for(const message of [observed+'\n',observed+'\r\n',observed+' ', ' '+observed,
    observed+'.',observed+'\0',observed.toLowerCase(),observed.slice(0,-1),
    'VipsJpeg: Corrupt JPEG data: premature end of data',
    'VipsJpeg: Corrupt JPEG data: bad Huffman code',
    'Input buffer has corrupt header: '+observed,
    observed+': unexpected native error',observed+'\nout of memory']){
    assert.equal(classify({message}),'DECODER_FAILURE',JSON.stringify(message));
  }
});

test('coded or unavailable native failures cannot use the JPEG message rule',()=>{
  for(const code of ['ENOMEM','ERR_MODULE_NOT_FOUND','PROOF_DECODER_VERSION_UNAVAILABLE',
    'PROOF_DECODE_INVALID','ETIMEDOUT','UNKNOWN',null,0,'']){
    assert.equal(classify({code,message:observed}),'DECODER_FAILURE',String(code));
  }
  for(const error of [undefined,null,{},new Error(),{message:null},{message:42},
    {message:{toString(){throw new Error('must not coerce');}}}]){
    assert.equal(classify(error),'DECODER_FAILURE');
  }
});
