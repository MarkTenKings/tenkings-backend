import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {clone,hash,requireValue} from './contract.mjs';
import {authorityContext,authorityId,domainId} from './authority-context.mjs';
import {exactKeys,requireSyncApproval} from './fee-policy.mjs';

const adapters=new WeakMap();
const text=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const states=new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
export function validateShippingAddress(value) {
  exactKeys(value,['name','phone','line1','line2','city','state','postalCode','country','residential'],'DESTINATION_ADDRESS_INVALID');
  for(const [key,max] of [['name',100],['line1',200],['city',100]])requireValue(text(value[key],max),'DESTINATION_ADDRESS_INVALID');
  requireValue(value.line2===null||text(value.line2,200),'DESTINATION_ADDRESS_INVALID');
  requireValue(/^\+[1-9][0-9]{7,14}$/.test(value.phone)&&value.country==='US'&&states.has(value.state)&&/^\d{5}(?:-\d{4})?$/.test(value.postalCode)&&['yes','no','unknown'].includes(value.residential),'DESTINATION_ADDRESS_INVALID');
  // User-entered shipping data. Syntax acceptance does not assert postal,
  // identity, title, bank, seller or physical-delivery verification.
  return clone(value);
}
export function assertMarketplaceDestinations(adapter,{store,context}) {
  const binding=adapters.get(adapter);
  requireValue(binding?.store===store&&binding.context===authorityContext(context),'DESTINATION_STORE_MISMATCH');
  adapter.assertReady();return adapter;
}
export function createMarketplaceDestinations({enabled=false,store,context:suppliedContext,policy,keyring,assertReady,clock=Date.now}={}) {
  if(!enabled)return Object.freeze({enabled:false});
  const context=authorityContext(suppliedContext);
  exactKeys(policy,['id','version','environment','approvalRef','privacyRef','allowedCountries','maxActive','receiptTtlMs'],'DESTINATION_POLICY_REQUIRED');
  requireValue(policy.environment===context.environment&&text(policy.id,128)&&text(policy.version,128)&&text(policy.approvalRef,500)&&text(policy.privacyRef,500)&&hash(policy.allowedCountries)===hash(['US'])&&Number.isSafeInteger(policy.maxActive)&&policy.maxActive>=1&&policy.maxActive<=25&&Number.isSafeInteger(policy.receiptTtlMs)&&policy.receiptTtlMs>0&&policy.receiptTtlMs<=300000,'DESTINATION_POLICY_REQUIRED');
  requireValue(typeof store?.read==='function'&&typeof store.transaction==='function'&&typeof assertReady==='function','DESTINATION_RUNTIME_REQUIRED');
  requireValue(keyring&&text(keyring.activeKeyId,100)&&/^[A-Za-z0-9_-]+$/.test(keyring.activeKeyId)&&keyring.keys&&Object.getPrototypeOf(keyring.keys)===Object.prototype,'DESTINATION_ENCRYPTION_REQUIRED');
  const ids=Object.keys(keyring.keys);requireValue(ids.length>0&&ids.length<=4&&ids.includes(keyring.activeKeyId)&&ids.every(id=>/^[A-Za-z0-9_-]{1,100}$/.test(id)&&Buffer.isBuffer(keyring.keys[id])&&keyring.keys[id].length===32),'DESTINATION_ENCRYPTION_REQUIRED');
  const savedKeys=new Map(ids.map(id=>[id,Buffer.from(keyring.keys[id])])),keyPin=()=>hash(ids.map(id=>[id,keyring.keys[id]?.toString('hex')??null])),pinnedKeys=keyPin();
  const policyHash=hash(policy),activeKeyId=keyring.activeKeyId,read=store.read,transaction=store.transaction;
  const binding=Object.freeze({schema:'atlas-marketplace-destinations-v1',environment:context.environment,policyHash,approvalRef:policy.approvalRef,privacyRef:policy.privacyRef,keyIds:Object.freeze([...ids]),activeKeyId});
  let closed=false;
  function ready(){requireValue(!closed&&hash(policy)===policyHash&&keyring.activeKeyId===activeKeyId&&keyPin()===pinnedKeys&&store.read===read&&store.transaction===transaction,'DESTINATION_RUNTIME_CHANGED');requireSyncApproval(assertReady(binding),'DESTINATION_APPROVAL_REQUIRED');return true;}
  const safe=row=>({id:row.id,version:String(row.version),label:row.label,active:row.active});
  const aad=row=>JSON.stringify({id:row.id,buyerId:row.buyerId,version:row.version,environment:row.environment,keyId:row.encrypted.keyId});
  function encrypt(row,address){const iv=randomBytes(12);row.encrypted={keyId:activeKeyId};const cipher=createCipheriv('aes-256-gcm',savedKeys.get(activeKeyId),iv);cipher.setAAD(Buffer.from(aad(row)));const data=Buffer.concat([cipher.update(JSON.stringify(address),'utf8'),cipher.final()]);row.encrypted={keyId:activeKeyId,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
  function decrypt(row){try{const e=row.encrypted,key=savedKeys.get(e.keyId);requireValue(key,'DESTINATION_KEY_UNAVAILABLE');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));decipher.setAAD(Buffer.from(aad(row)));decipher.setAuthTag(Buffer.from(e.tag,'base64'));const address=validateShippingAddress(JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]).toString('utf8')));requireValue(hash(address)===row.addressHash,'DESTINATION_ADDRESS_CHANGED');return address;}catch{requireValue(false,'DESTINATION_DECRYPTION_UNAVAILABLE');}}
  function selected(state,buyerId,id){authorityId(buyerId,'buyer',context);domainId(id,'destination',context);const row=state.marketplaceDestinations?.[id];requireValue(row?.buyerId===buyerId&&row.environment===context.environment&&row.active,'DESTINATION_UNAVAILABLE');return row;}
  function descriptor(row,now){requireValue(Number.isSafeInteger(now)&&now>=row.updatedAt,'DESTINATION_CLOCK_INVALID');return {id:row.id,buyerId:row.buyerId,version:String(row.version),addressHash:row.addressHash,countryCode:'US',label:row.label,evidenceRef:`${context.environment==='SYNTHETIC_LOCAL'?'demo_':'atlas_'}destination_${hash([row.id,row.version,row.addressHash]).slice(0,32)}`,observedAt:new Date(now).toISOString(),expiresAt:new Date(now+policy.receiptTtlMs).toISOString()};}
  function checkDescriptor(value,{buyerId,destinationId}){ready();authorityId(buyerId,'buyer',context);domainId(destinationId,'destination',context);requireValue(value?.id===destinationId&&value.buyerId===buyerId&&/^[1-9][0-9]{0,8}$/.test(value.version)&&/^[a-f0-9]{64}$/.test(value.addressHash)&&value.countryCode==='US','DESTINATION_CHANGED');return true;}
  const adapter={enabled:true,binding,assertReady:ready,
    assertCurrent:checkDescriptor,
    assertInTransaction(tx,value,{buyerId}){checkDescriptor(value,{buyerId,destinationId:value?.id});const row=selected(tx.state,buyerId,value.id);requireValue(String(row.version)===value.version&&row.addressHash===value.addressHash&&row.label===value.label,'DESTINATION_CHANGED');return true;},
    async list({buyerId}){ready();authorityId(buyerId,'buyer',context);return store.read(state=>{ready();return Object.values(state.marketplaceDestinations??{}).filter(row=>row.buyerId===buyerId&&row.environment===context.environment&&row.active).slice(0,policy.maxActive).map(row=>descriptor(row,clock()));});},
    async resolve({buyerId,destinationId}){ready();return store.read(state=>{ready();return descriptor(selected(state,buyerId,destinationId),clock());});},
    async readAddress({buyerId,destinationId,version,addressHash}){ready();return store.read(state=>{ready();const row=selected(state,buyerId,destinationId);requireValue(String(row.version)===version&&row.addressHash===addressHash,'DESTINATION_CHANGED');return decrypt(row);});},
    retainForReservation(tx,{reservationId,buyerId,destination}){ready();domainId(reservationId,'reservation',context);const snapshots=tx.state.marketplaceDeliveryDestinations??={},old=snapshots[reservationId];if(old){requireValue(old.buyerId===buyerId&&old.id===destination.id&&String(old.version)===destination.version&&old.addressHash===destination.addressHash,'DESTINATION_CHANGED');return;}adapter.assertInTransaction(tx,destination,{buyerId});snapshots[reservationId]=clone(selected(tx.state,buyerId,destination.id));},
    readOrderAddress(tx,{orderId,actorId,requestId}){ready();domainId(orderId,'order',context);authorityId(actorId,'staff',context);domainId(requestId,'request',context);const order=tx.state.orders?.[orderId],row=tx.state.marketplaceDeliveryDestinations?.[order?.reservationId];requireValue(order?.status==='PAID'&&row&&row.buyerId===order.buyerId&&row.id===order.quote?.destination?.id&&row.addressHash===order.quote.destination.addressHash&&String(row.version)===order.quote.destination.version,'ORDER_DESTINATION_UNAVAILABLE');const address=decrypt(row);const key=hash({actorId,requestId}),seen=tx.state.marketplaceAddressAccess??={};if(seen[key])requireValue(seen[key]===orderId,'IDEMPOTENCY_CONFLICT');else{seen[key]=orderId;tx.emit('MARKETPLACE_DELIVERY_ADDRESS_ACCESSED',{actorId,orderId});}return {orderId,address};},
    save(tx,{buyerId,requestId,destinationId,expectedVersion,label,address}){
      ready();authorityId(buyerId,'buyer',context);domainId(requestId,'request',context);domainId(destinationId,'destination',context);
      requireValue(Number.isSafeInteger(expectedVersion)&&expectedVersion>=0&&expectedVersion<999999999&&text(label,100),'DESTINATION_INPUT_INVALID');
      address=validateShippingAddress(address);const requestHash=hash({buyerId,destinationId,expectedVersion,label,address}),key=hash({buyerId,requestId,operation:'SAVE'}),receipts=tx.state.marketplaceDestinationReceipts??={};
      if(receipts[key]){requireValue(receipts[key].requestHash===requestHash,'IDEMPOTENCY_CONFLICT');return clone(receipts[key].result);}
      const rows=tx.state.marketplaceDestinations??={},old=rows[destinationId];
      requireValue(old?old.buyerId===buyerId&&old.environment===context.environment&&old.active&&old.version===expectedVersion:expectedVersion===0,'DESTINATION_CHANGED');
      if(!old)requireValue(Object.values(rows).filter(row=>row.buyerId===buyerId&&row.active).length<policy.maxActive,'DESTINATION_LIMIT');
      const row={id:destinationId,buyerId,environment:context.environment,version:expectedVersion+1,label,addressHash:hash(address),active:true,createdAt:old?.createdAt??tx.now,updatedAt:tx.now};encrypt(row,address);rows[destinationId]=row;
      const result=safe(row);receipts[key]={requestHash,result};tx.emit('MARKETPLACE_DESTINATION_SAVED',{destinationId,buyerId,version:row.version});return result;
    },
    remove(tx,{buyerId,requestId,destinationId,expectedVersion}){
      ready();authorityId(buyerId,'buyer',context);domainId(requestId,'request',context);domainId(destinationId,'destination',context);requireValue(Number.isSafeInteger(expectedVersion)&&expectedVersion>0,'DESTINATION_INPUT_INVALID');
      const requestHash=hash({buyerId,destinationId,expectedVersion}),key=hash({buyerId,requestId,operation:'REMOVE'}),receipts=tx.state.marketplaceDestinationReceipts??={};
      if(receipts[key]){requireValue(receipts[key].requestHash===requestHash,'IDEMPOTENCY_CONFLICT');return clone(receipts[key].result);}
      const row=selected(tx.state,buyerId,destinationId);requireValue(row.version===expectedVersion,'DESTINATION_CHANGED');row.active=false;row.version++;row.updatedAt=tx.now;const result=safe(row);receipts[key]={requestHash,result};tx.emit('MARKETPLACE_DESTINATION_REMOVED',{destinationId,buyerId,version:row.version});return result;
    },
    close(){closed=true;for(const key of savedKeys.values())key.fill(0);},
  };
  adapters.set(adapter,{store,context});return Object.freeze(adapter);
}
