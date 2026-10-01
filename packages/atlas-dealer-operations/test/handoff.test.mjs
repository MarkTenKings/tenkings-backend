import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import QRCode from 'qrcode';
import {handoffToken,readHandoffToken,handoffConfirmation} from '../src/handoff.mjs';
import {handoffQr} from '../src/handoff-qr.mjs';
import {DealerOperations} from '../src/service.mjs';
const key=Buffer.alloc(32,7),id=randomUUID(),ids=[randomUUID(),randomUUID()],session=Buffer.alloc(32,1).toString('base64url'),browserHash='b'.repeat(64);
test('handoff is an exact signed reference, cannot be forged or used under another signing key',()=>{
 const token=handoffToken(key,id);assert.equal(readHandoffToken(key,token),id);
 for(const value of [token.replace(id,randomUUID()),token.slice(0,-2)+'ab'])assert.throws(()=>readHandoffToken(key,value),{code:'HANDOFF_NOT_FOUND'});
 assert.throws(()=>readHandoffToken(Buffer.alloc(32,8),token),{code:'HANDOFF_NOT_FOUND'});
 for(const value of ['',id,'v1.'+id+'.short',null])assert.throws(()=>readHandoffToken(key,value),{code:'INVALID_HANDOFF'});
});
test('confirmation requires unique exact IDs and count with no authority or custody timestamps from browser',()=>{
 const input={requestId:randomUUID(),cardIds:ids,confirmedCount:2};assert.deepEqual(handoffConfirmation(input),{...input,cardIds:[...ids].sort()});
 for(const change of [{confirmedCount:1},{cardIds:[ids[0],ids[0]]},{cardIds:[ids[0],'bad']},{confirmedCount:'2'},{accountId:id},{receivedAt:new Date().toISOString()}])assert.throws(()=>handoffConfirmation({...input,...change}),{code:'ALL_CARDS_CONFIRMATION_REQUIRED'});
});
test('scannable native QR preserves every encoded module and four-module quiet zone',()=>{
 const url='https://atlasgrading.com/account/dealer/handoff#'+handoffToken(key,id),actual=handoffQr(url),expected=QRCode.create(url,{errorCorrectionLevel:'M'});
 assert.equal(actual.size,expected.modules.size+8);const cells=new Set([...actual.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(m=>`${+m[1]-4}:${+m[2]-4}`));
 for(let y=0;y<expected.modules.size;y++)for(let x=0;x<expected.modules.size;x++)assert.equal(cells.has(`${x}:${y}`),!!expected.modules.get(y,x));
 assert.throws(()=>handoffQr('https://atlasgrading.com/account#'+handoffToken(key,id)));
});
test('customer can issue reference; read and receipt confirmation still require separate dealer CSRF/session',async()=>{
 const calls=[],ops=new DealerOperations({sessionKey:key,call:async(action,data)=>{calls.push({action,data});return {handoff:{id}};}});
 const customer={sessionHash:'a'.repeat(64),browserHash},issued=await ops.issueHandoff(customer,id);
 assert.equal(readHandoffToken(key,issued.token),id);assert.equal(calls[0].action,'dealer_handoff_issue');
 assert.throws(()=>ops.handoffRead(session,browserHash,'customer-csrf',issued.token),{code:'CSRF_REQUIRED'});assert.equal(calls.length,1);
 await ops.handoffRead(session,browserHash,ops.csrf(session),issued.token);
 assert.deepEqual(calls[1],{action:'dealer_handoff_read',data:{dealerSessionHash:createHash('sha256').update(session).digest('hex'),browserHash,handoffId:id}});
 await ops.handoffConfirm(session,browserHash,ops.csrf(session),issued.token,{requestId:id,cardIds:ids,confirmedCount:2});
 assert.equal(calls[2].action,'dealer_handoff_confirm');assert(!('sessionHash'in calls[2].data));assert(!('accountId'in calls[2].data));
});
