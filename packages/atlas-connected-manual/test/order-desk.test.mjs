import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createOrderDeskService,orderDeskGrantSQL,orderDeskListInput,orderDeskPhotoInput} from '../src/order-desk.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const staff={},calls=[],handle={sessionHash:'session',browserHash:'browser'},actors=new WeakMap([[staff,handle]]);
  const f={staff,calls,actors,role:'REVIEWER',result:{schemaVersion:1,orders:[],counts:{all:0,new:0},nextCursor:null},afterRead:null,photoCalls:0};
  f.config={mode:'LOCAL_FIXTURE',origin:'http://127.0.0.1:4318',deploymentId:'fixture',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64),phoneByHash:new Map([['staff-phone','+12025550100']])};
  f.service=createOrderDeskService({auth:{actors,config:f.config},boundary:{transaction:async(actor,fn)=>{assert.equal(actor,staff);return fn({principal:{role:f.role},tx:{$queryRawUnsafe:async(sql,...args)=>{calls.push({sql,args});return[{result:typeof f.result==='function'?f.result(calls.length):f.result}];}}});}},
    photos:{read:async(source,size)=>{f.photoCalls++;f.photoSource=source;f.photoSize=size;await f.afterRead?.();return{bytes:Buffer.from('photo'),contentType:'image/jpeg',sha256:sha('photo'),width:4,height:3};}}});
  return f;
}
test('list validates literal search, bounded pages and closed filters/cursors before SQL',async()=>{
  assert.deepEqual(orderDeskListInput({q:'  100%_Pikachu  ',limit:'50'}),{q:'100%_Pikachu',stage:'',view:'all',cursor:null,limit:50});
  for(const input of [{q:'a'.repeat(121)},{q:'line\nbreak'},{stage:'PACKED'},{view:'public'},{cursor:'not-id'},{limit:'01'},{limit:51},{limit:0},{limit:1.2},{principal:'forged'},[]])assert.throws(()=>orderDeskListInput(input),{code:'INVALID_ORDER_DESK_REQUEST'});
  const f=fixture();await f.service.list(f.staff,{q:'Pikachu',stage:'GRADING_REVIEW',view:'new',limit:1});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].sql,'SELECT atlas_dealer.order_desk_call($1,$2,$3,$4::jsonb,$5::text[],$6::jsonb) AS result');
  assert.deepEqual(f.calls[0].args.slice(0,3),['list','session','browser']);
  assert.deepEqual(JSON.parse(f.calls[0].args[3]),Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k=>[k,f.config[k]])));
  assert.deepEqual(f.calls[0].args[4],['staff-phone']);
  assert.deepEqual(JSON.parse(f.calls[0].args[5]),{q:'Pikachu',stage:'GRADING_REVIEW',view:'new',cursor:null,limit:1});
});
test('desk requires original WeakMap reviewer capability and preserves authoritative denials',async()=>{
  const f=fixture();await assert.rejects(f.service.list({...f.staff}),{code:'SIGN_IN_REQUIRED'});f.role='OBSERVER';await assert.rejects(f.service.list(f.staff),{code:'STAFF_REQUIRED'});assert.equal(f.calls.length,0);
  f.role='REVIEWER';f.result={error:{status:403,code:'STAFF_REQUIRED'}};await assert.rejects(f.service.detail(f.staff,{orderId:randomUUID()}),{code:'STAFF_REQUIRED'});
  assert.equal(f.calls.length,1);assert.doesNotMatch(orderDeskGrantSQL('atlas_fixture_manual'),/ON ALL|GRANT SELECT|atlas_customer/);
  assert.throws(()=>orderDeskGrantSQL('role";GRANT ALL'),{code:'INVALID_ORDER_DESK_REQUEST'});
});
test('customer photo loads without manual card link and reauthenticates exact source after storage',async()=>{
  const f=fixture(),orderId=randomUUID(),cardId=randomUUID(),uploadId=randomUUID();
  f.result={orderId,uploadId,upload:{cardId,side:'FRONT',plan:{uploadId}},paidPhotoPairHash:'f'.repeat(64),photoPairHash:'f'.repeat(64)};
  const result=await f.service.photo(f.staff,{orderId,cardId,side:'FRONT',size:'detail'});
  assert.equal(result.bytes.toString(),'photo');assert.equal(f.photoCalls,1);assert.equal(f.photoSize,'detail');assert.equal(f.calls.length,2);
  for(const call of f.calls){assert.equal(call.args[0],'photo_source');assert.deepEqual(JSON.parse(call.args[5]),{orderId,cardId,side:'FRONT'});}
  assert.equal(f.photoSource.uploadId,uploadId);assert(!Object.hasOwn(f.photoSource,'manualCardId'));
});
test('photo source mismatch and access revocation cannot leak bytes even after generation/cache',async()=>{
  const orderId=randomUUID(),cardId=randomUUID(),source={orderId,upload:{cardId,side:'BACK'},uploadId:randomUUID()};
  const f=fixture();f.result={...source,orderId:randomUUID()};await assert.rejects(f.service.photo(f.staff,{orderId,cardId,side:'BACK'}),{code:'ORDER_PHOTO_BINDING_CHANGED'});assert.equal(f.photoCalls,0);
  f.result=source;f.afterRead=()=>{f.actors.delete(f.staff);};await assert.rejects(f.service.photo(f.staff,{orderId,cardId,side:'BACK'}),{code:'SIGN_IN_REQUIRED'});
  const g=fixture();g.result=n=>n===1?source:{...source,uploadId:randomUUID()};await assert.rejects(g.service.photo(g.staff,{orderId,cardId,side:'BACK'}),{code:'ORDER_PHOTO_BINDING_CHANGED'});
});
test('photo and detail reject caller-selected storage/upload/principal fields',async()=>{
  const f=fixture(),orderId=randomUUID(),cardId=randomUUID();
  for(const input of [{orderId,cardId,side:'SIDE'},{orderId,cardId,side:'FRONT',size:'original'},{orderId,cardId,side:'FRONT',uploadId:randomUUID()},{orderId,cardId,side:'FRONT',key:'private'}])assert.throws(()=>orderDeskPhotoInput(input),{code:'INVALID_ORDER_DESK_REQUEST'});
  assert.throws(()=>f.service.detail(f.staff,{orderId,accountId:randomUUID()}),{code:'INVALID_ORDER_DESK_REQUEST'});assert.equal(f.calls.length,0);
});
test('staff inbound label validates exact binding, bounded canonical base64, header and hash',async()=>{
  const f=fixture(),orderId=randomUUID(),bytes=Buffer.from('%PDF-1.7\nfixture\n%%EOF'),label={orderId,leg:'INBOUND',mimeType:'application/pdf',labelBase64:bytes.toString('base64'),labelSha256:sha(bytes)};
  f.result={...label,providerSecret:'never-return'};assert.deepEqual(await f.service.label(f.staff,{orderId,leg:'INBOUND'}),{bytes,contentType:'application/pdf',sha256:sha(bytes)});
  for(const change of [{orderId:randomUUID()},{leg:'RETURN'},{mimeType:'text/html'},{labelSha256:'0'.repeat(64)},{labelBase64:label.labelBase64+'\n'},{labelBase64:Buffer.from('not PDF').toString('base64')},{labelBase64:'A'.repeat(5592409)}]){f.result={...label,...change};await assert.rejects(f.service.label(f.staff,{orderId,leg:'INBOUND'}),{code:'LABEL_NOT_READY'});}
});
