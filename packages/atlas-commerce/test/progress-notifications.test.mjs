import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProgressNotificationWorker,progressMessage} from '../src/progress-notifications.mjs';
import {notificationAdapter} from '../src/notifications.mjs';
const request=()=>({cardId:randomUUID(),reference:'ATLAS-TEST',eventKind:'ATLAS_RECEIVED',occurredAt:'2026-10-01T00:00:00Z',to:'customer@example.test'});
function fixture({send=async()=>({provider:'SENDGRID',providerId:'message-1',deliveryStatus:'ACCEPTED'}),finishFailure=false,enabled=true,dispatch=true}={}){
 let state='PENDING',calls=[],sends=0;const data=request();
 const call=async(name,input)=>{calls.push({name,input});if(name==='pending')return{ids:state==='PENDING'?['event:email']:[]};if(name==='claim'){if(state!=='PENDING'||!dispatch)return{dispatch:false};state='DISPATCHED';return{dispatch:true,effect:{id:input.id,kind:'EMAIL_PROGRESS',request:data}};}if(name==='finish'){if(finishFailure)throw Error('lost database acknowledgement');state=input.state;return{state};}throw Error(name);};
 const worker=createProgressNotificationWorker({call,enabled,notifications:{send:async(...args)=>{assert.equal(state,'DISPATCHED');sends++;return send(...args);}}});
 return{worker,calls,get sends(){return sends;},get state(){return state;}};
}
test('only recorded, allowlisted event templates can be dispatched; no grade or ETA invented',()=>{
 const m=progressMessage(request());assert.match(m.text,/has arrived at ATLAS/);assert.doesNotMatch(m.text,/\$|grade [0-9]|tomorrow|will arrive/i);
 assert.throws(()=>progressMessage({...request(),eventKind:'GUESSED_IN_TRANSIT'}));assert.throws(()=>progressMessage({...request(),reference:'unsafe\nheader'}));
 assert.match(progressMessage({...request(),eventKind:'DEALER_RECEIVED'}).text,/received and confirmed by the drop-off shop/);
 assert.match(progressMessage({...request(),eventKind:'GRADING_STARTED',title:'Saved card title'}).text,/“Saved card title”.*is being graded/);
 assert.match(progressMessage(request()).text,/Your card in order/);
 assert.throws(()=>progressMessage({...request(),title:'bad\nvalue'}));
});
test('worker commits claim before one provider call and repeated polls cannot resend',async()=>{const f=fixture();assert.deepEqual(await f.worker.runOnce(),{enabled:true,processed:1});assert.equal(f.state,'ACCEPTED');await f.worker.runOnce();assert.equal(f.sends,1);assert.equal(f.calls.find(v=>v.name==='finish').input.result.deliveryStatus,'ACCEPTED');});
test('unknown send and lost finish acknowledgement never become automatic retries',async()=>{const unknown=fixture({send:async()=>{throw Error('timeout after request');}});await unknown.worker.runOnce();assert.equal(unknown.state,'UNKNOWN');await unknown.worker.runOnce();assert.equal(unknown.sends,1);const lost=fixture({finishFailure:true});await assert.rejects(lost.worker.runOnce());assert.equal(lost.state,'DISPATCHED');await lost.worker.runOnce();assert.equal(lost.sends,1);});
test('cold worker and suppressed/revoked preference claims make no provider request',async()=>{const cold=fixture({enabled:false});assert.deepEqual(await cold.worker.runOnce(),{enabled:false,processed:0});assert.equal(cold.calls.length,0);const stopped=fixture({dispatch:false});await stopped.worker.runOnce();assert.equal(stopped.sends,0);});
test('existing receipt senders support factual progress without changing receipt kind or login service',async()=>{
 const calls=[];const adapter=notificationAdapter({emailApiKey:'test-only',emailFrom:'updates@example.test',smsAccountSid:`AC${'1'.repeat(32)}`,smsApiKeySid:`SK${'2'.repeat(32)}`,smsApiKeySecret:'test-only',smsServiceSid:`MG${'3'.repeat(32)}`,fetchImpl:async(url,options)=>{calls.push({url,options});return url.includes('sendgrid')?new Response(null,{status:202,headers:{'x-message-id':'message-123'}}):new Response(JSON.stringify({sid:`SM${'4'.repeat(32)}`,account_sid:`AC${'1'.repeat(32)}`,status:'queued'}));}});
 const email=await adapter.send('EMAIL_PROGRESS',request(),'event:email');assert.equal(email.deliveryStatus,'ACCEPTED');const payload=JSON.parse(calls[0].options.body);assert.match(payload.subject,/card update/);assert.match(payload.content[0].value,/arrived at ATLAS/);assert.equal(payload.personalizations[0].custom_args.atlas_effect,'event:email');assert.doesNotMatch(payload.content[0].value,/payment/);
 const sms=await adapter.send('SMS_PROGRESS',{...request(),to:'+15555550123'},'event:sms');assert.equal(sms.deliveryStatus,'QUEUED');assert.match(calls[1].url,/api.twilio.com.*Messages.json/);assert.doesNotMatch(calls[1].url,/verify/);
});
