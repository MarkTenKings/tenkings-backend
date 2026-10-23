import test from 'node:test';
import assert from 'node:assert/strict';
import {openProofPublicationStore,openProofOriginalReader} from '../src/proof-publication-store.mjs';

test('both publisher entrypoints are inert by default and expose no caller authority adapter',()=>{
  for(const open of [openProofPublicationStore,openProofOriginalReader]){
    assert.equal(open(),null);
    assert.equal(open({enabled:false,descriptorPath:'/not-opened',encryptionKey:Buffer.alloc(32)}),null);
    for(const extra of ['authorize','assertQualified','storage','put','fault','publisherUid','qualified']){
      assert.throws(()=>open({enabled:false,[extra]:()=>true}));
    }
  }
});

test('closed options refuse accessors and inherited data without executing caller code',()=>{
  for(const open of [openProofPublicationStore,openProofOriginalReader]){
    let called=false;
    assert.throws(()=>open({get enabled(){called=true;return true;}}));assert.equal(called,false);
    assert.throws(()=>open({enabled:true,get descriptorPath(){called=true;return '/fake';}}));assert.equal(called,false);
    assert.throws(()=>open(Object.create({enabled:false})));
  }
});

test('enabled writer and reader cannot run on an unqualified platform or relative descriptor',()=>{
  for(const open of [openProofPublicationStore,openProofOriginalReader]){
    assert.throws(()=>open({enabled:true,descriptorPath:'relative.json',encryptionKey:Buffer.alloc(32)}),error=>
      ['PUBLICATION_PLATFORM_REFUSED','PUBLICATION_PATH_REFUSED'].includes(error.code));
  }
});
