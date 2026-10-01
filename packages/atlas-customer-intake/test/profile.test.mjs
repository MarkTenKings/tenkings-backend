import test from 'node:test';
import assert from 'node:assert/strict';
import {contactProfileInput,shopProfile} from '../src/profile.mjs';

test('shop contact requires name, accepts omitted or empty email, and normalizes a supplied email address',()=>{
 assert.deepEqual(contactProfileInput({name:' Alex Collector '}),{name:'Alex Collector'});
 assert.deepEqual(contactProfileInput({name:'Alex',email:' '}),{name:'Alex',email:''});
 assert.deepEqual(contactProfileInput({name:'Alex',email:' alex@example.test '}),{name:'Alex',email:'alex@example.test'});
});
test('profile input cannot replace verified phone or introduce caller identity',()=>{
 for(const input of [null,[],{}, {name:''},{name:'  '},{name:'Alex',email:null},{name:'Alex',email:'not-email'},
  {name:'Alex\nCollector'},{name:'x'.repeat(121)},{name:'Alex',phone:'+12025550141'},{name:'Alex',accountId:'other'},
  {name:'Alex',address1:'Invented street'}])assert.throws(()=>contactProfileInput(input),{code:'CONTACT_DETAILS_REQUIRED'});
});
test('new shop snapshot explicitly strips saved return address while preserving only contact',()=>{
 assert.deepEqual(shopProfile({name:'Alex',email:'',address1:'Saved mail street',country:'US',phone:'forged'}),{name:'Alex',email:''});
 assert.deepEqual(shopProfile({name:'Alex'}),{name:'Alex',email:''});
});
