import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { openLocalStore } from '../src/store.mjs';
import { createEncryptedProofStorage } from '../src/proof-storage.mjs';
import { createProofImageValidator } from '../src/proof-image.mjs';
import { createMarketplaceProofIntake } from '../src/proof-intake.mjs';

export const buyer={id:'demo_buyer',role:'BUYER'},staff={id:'demo_reviewer',role:'STAFF'},stranger={id:'demo_other',role:'BUYER'},seller={id:'demo_seller',role:'SELLER'};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function image(format='png'){return sharp({create:{width:20,height:30,channels:3,background:{r:64,g:128,b:200}}})[format]().toBuffer();}
export function fixture(t,{maxProofsPerOrder=20,policyChanges={},storageChanges={},authorize:customAuthorize,transactionHook}={}) {
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'atlas-r2-proof-test-'));mkdirSync(join(directory,'objects'),{mode:0o700});
  let now=Date.parse('2026-10-23T12:00:00.000Z'),allowed=true,reviewerAllowed=true,runtimeReady=true;
  const key=randomBytes(32),filename=join(directory,'state.sqlite');
  let store=openLocalStore({filename,environment:'SYNTHETIC_LOCAL',clock:()=>now}),storage;
  const rawStore=store;
  if(transactionHook)store={read:fn=>rawStore.read(fn),transaction:fn=>rawStore.transaction(tx=>{const result=fn(tx);transactionHook(tx);return result;}),close:()=>rawStore.close()};
  const policy={id:'demo_proof_policy',version:'demo_proof_v1',environment:'SYNTHETIC_LOCAL',approvalRef:'SYNTHETIC_APPROVAL_ONLY',retentionRef:'SYNTHETIC_RETENTION_ONLY',reviewerAuthorityRef:'SYNTHETIC_REVIEWER_AUTHORITY_ONLY',effectiveAt:now-1000,expiresAt:now+30*86400000,retentionMs:7*86400000,maxObjectBytes:10485760,maxProofsPerOrder,maxRetainedObjects:100,uploadTtlMs:300000,validationLeaseMs:30000,...policyChanges};
  const openStorage=()=>createEncryptedProofStorage({directory:join(directory,'objects'),encryptionKey:key,keyId:'demo_test_key',storageId:'demo_owned_proof_test',environment:'SYNTHETIC_LOCAL',retentionRef:policy.retentionRef,...storageChanges});
  storage=openStorage();
  const factory=()=>createMarketplaceProofIntake({enabled:true,store,policy,storage,validator:createProofImageValidator(),clock:()=>now,assertReady:()=>runtimeReady,authorize:(actor,scope)=>allowed&&(scope.action!=='REVIEW'||reviewerAllowed)&&(customAuthorize?customAuthorize(actor,scope):true)});
  let intake=factory();
  store.transaction(tx=>{for(const id of ['demo_order','demo_order_two']){tx.state.orders[id]={orderId:id,cardId:id==='demo_order'?'demo_card':'demo_card_two',buyerId:buyer.id,sellerId:seller.id,bindingHash:id+'_binding',policyVersion:'demo_terms_v1',paymentIntentId:id+'_payment'};tx.state.intents[id+'_payment']={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:id,bindingHash:id+'_binding'};tx.state.fulfillment[id]={orderId:id,status:'DELIVERED',deliveredAt:now-1000,releaseNotBefore:now-1000+86400000,cases:[]};}});
  t.after(()=>{store.close();storage.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,policy,get store(){return store;},get storage(){return storage;},get intake(){return intake;},get now(){return now;},set now(value){now=value;},set allowed(value){allowed=value;},set reviewerAllowed(value){reviewerAllowed=value;},set runtimeReady(value){runtimeReady=value;},
    reopen(){store.close();storage.close();store=openLocalStore({filename,environment:'SYNTHETIC_LOCAL',clock:()=>now});storage=openStorage();intake=factory();},
    async prepare(bytes,{actor=buyer,requestId='demo_upload_request',orderId='demo_order',purpose='RETURN_REQUEST',declaredType='image/png'}={}){return intake.prepare(actor,{requestId,orderId,purpose,declaredType,byteCount:bytes.length,sha256:digest(bytes)});},
    async retain(bytes,options={}){const upload=await this.prepare(bytes,options);return intake.upload(options.actor??buyer,{uploadId:upload.uploadId,bytes});}
  };
}
