import {clone,hash,requireValue} from './contract.mjs';
import {exactKeys,requireSyncApproval} from './fee-policy.mjs';
import {quoteText} from './provider-quote-http.mjs';
import {assertShipStationTrackingAdapter} from './provider-tracking-shipstation.mjs';

const branded=new WeakMap();
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)&&!['constructor','prototype'].includes(value);
const view=r=>({shipmentKey:r.shipmentKey,orderId:r.orderId,direction:r.direction,caseId:r.caseId,status:r.attentionCode?'ATTENTION':r.deliveredAt!==null?'DELIVERED':r.firstPossessionAt!==null?'IN_CARRIER_CUSTODY':'ISSUED',carrierStatusCode:r.carrierStatusCode,issuedAt:r.original.labelCreatedAt,observedAt:r.observedAt,firstPossessionAt:r.firstPossessionAt,lastProgressAt:r.lastProgressAt,deliveredAt:r.deliveredAt,attentionCode:r.attentionCode,initialShippingPayer:r.direction==='RETURN'?'ATLAS':null,totalCostCents:r.original.facts.totalCostCents});
export function assertShippingLifecycle(lifecycle,{store,environment}={}) {
  const internal=branded.get(lifecycle);requireValue(internal&&(!store||internal.store===store)&&(!environment||internal.binding.environment===environment),'SHIPPING_LIFECYCLE_BINDING_MISMATCH');internal.current();return lifecycle;
}
export function createShippingLifecycle({enabled=false,store,trackingAdapter,approvalRef,assertReady,resolveShipment,validateEvidence,clock=Date.now}={}) {
  const disabled=()=>{requireValue(false,'SHIPPING_LIFECYCLE_DISABLED');};
  if(!enabled)return Object.freeze({enabled:false,retainIssued:async()=>disabled(),syncTracking:async()=>disabled(),status:async()=>[],missingScans:async()=>[],dispatchEvidence:async()=>disabled(),deliveryEvidence:async()=>disabled(),validateEvidence:async()=>false,assertInTransaction:()=>disabled(),close(){}});
  requireValue(typeof store?.read==='function'&&typeof store?.transaction==='function'&&quoteText(approvalRef)&&typeof assertReady==='function'&&typeof resolveShipment==='function'&&typeof validateEvidence==='function','SHIPPING_LIFECYCLE_CONFIG_REQUIRED');
  const adapter=assertShipStationTrackingAdapter(trackingAdapter),binding=Object.freeze({environment:adapter.binding.environment,adapterBindingHash:hash(adapter.binding),approvalRef});
  const pins={read:store.read,transaction:store.transaction};let lastNow=0,closed=false;
  const current=(authorizeCommit)=>{adapter.current();const now=clock();requireValue(!closed&&Number.isSafeInteger(now)&&now>=lastNow,'SHIPPING_LIFECYCLE_CLOCK_INVALID');lastNow=now;requireValue(store.read===pins.read&&store.transaction===pins.transaction,'SHIPPING_LIFECYCLE_PORT_CHANGED');requireSyncApproval(assertReady(binding),'SHIPPING_LIFECYCLE_APPROVAL_REQUIRED');if(authorizeCommit!==undefined){requireValue(typeof authorizeCommit==='function','SHIPPING_AUTHORIZATION_REQUIRED');requireSyncApproval(authorizeCommit(),'SHIPPING_AUTHORIZATION_REQUIRED');}return now;};
  async function refresh(options) {current(options.authorizeCommit);if(options.refreshAuthorization)requireValue(await options.refreshAuthorization()===true,'SHIPPING_AUTHORIZATION_REQUIRED');current(options.authorizeCommit);}
  function paid(state,orderId,direction,caseId) {
    const order=state.orders?.[orderId],payment=state.intents?.[order?.paymentIntentId];
    requireValue(order?.orderId===orderId&&order.status==='PAID'&&order.environment===binding.environment&&payment?.kind==='PAYMENT'&&payment.status==='SUCCEEDED'&&payment.confirmed===true&&payment.orderId===orderId&&payment.bindingHash===order.bindingHash&&Number.isSafeInteger(payment.reconciledAt),'SHIPPING_PAID_ORDER_REQUIRED');
    requireValue(['OUTBOUND','RETURN'].includes(direction)&&(direction==='OUTBOUND'?caseId===null:identifier(caseId)),'SHIPPING_DIRECTION_INVALID');
    if(direction==='RETURN'){const item=state.fulfillment?.[orderId]?.cases?.find(c=>c.id===caseId);requireValue(item?.kind==='RETURN'&&item.status==='OPEN'&&item.returnReview?.decision==='APPROVE'&&item.initialShippingPayer==='ATLAS_INITIALLY','SHIPPING_APPROVED_RETURN_REQUIRED');}
    return {order,payment};
  }
  const keyFor=(orderId,direction,caseId)=>'atlas_ship_'+hash({orderId,direction,caseId}).slice(0,40);
  function rowFor(state,key,{returnMayBeClosed=false}={}) {
    const row=state.shippingLifecycle?.[key];requireValue(row?.bindingHash===hash(binding),'SHIPPING_ORIGINAL_NOT_FOUND');
    const {order}=paid(state,row.orderId,returnMayBeClosed&&row.direction==='RETURN'?'OUTBOUND':row.direction,returnMayBeClosed&&row.direction==='RETURN'?null:row.caseId);
    requireValue(order.bindingHash===row.orderBindingHash&&order.cardId===row.cardId,'SHIPPING_ORDER_CHANGED');return row;
  }
  function evidenceFor(state,orderId,action) {
    const row=rowFor(state,keyFor(orderId,'OUTBOUND',null));requireValue(!row.attentionCode,'SHIPPING_RECONCILIATION_REQUIRED');
    const base={environment:binding.environment,orderId,cardId:row.cardId};
    if(action==='DISPATCH'){
      requireValue(row.firstPossessionAt!==null&&row.possessionObservationRef,'SHIPPING_CARRIER_ACCEPTANCE_REQUIRED');
      return {...base,ref:'atlas_dispatch_'+hash({key:row.shipmentKey,at:row.firstPossessionAt,ref:row.possessionObservationRef}).slice(0,40),carrierRef:'atlas_carrier_'+hash(adapter.binding).slice(0,40),trackingRef:row.shipmentKey,coverageRef:row.coverageEvidenceRef,dispatchReceiptRef:row.possessionObservationRef,dispatchedAt:row.firstPossessionAt};
    }
    requireValue(action==='DELIVER'&&row.deliveredAt!==null&&row.deliveryObservationRef,'SHIPPING_ACTUAL_DELIVERY_REQUIRED');
    return {...base,ref:'atlas_delivery_'+hash({key:row.shipmentKey,at:row.deliveredAt,ref:row.deliveryObservationRef}).slice(0,40),deliveryProofRef:row.deliveryObservationRef,deliveredAt:row.deliveredAt};
  }
  function assertInTransaction(tx,{kind,input}={}) {
    current();if(kind!=='FULFILLMENT')return false;
    const action=input?.action,orderId=input?.orderId;requireValue(identifier(orderId),'SHIPPING_ORDER_INVALID');
    if(action==='RELEASE'){
      const rows=Object.values(tx.state.shippingLifecycle??{}).filter(r=>r.orderId===orderId);
      requireValue(rows.length>0&&rows.every(r=>r.bindingHash===hash(binding)&&!r.attentionCode),'SHIPPING_RECONCILIATION_REQUIRED');
      const row=rowFor(tx.state,keyFor(orderId,'OUTBOUND',null)),fulfillment=tx.state.fulfillment?.[orderId];
      requireValue(row.deliveredAt!==null&&fulfillment?.deliveredAt===row.deliveredAt,'SHIPPING_ACTUAL_DELIVERY_REQUIRED');return true;
    }
    if(!['DISPATCH','DELIVER'].includes(action))return false;
    requireValue(hash(input.evidence)===hash(evidenceFor(tx.state,orderId,action)),'SHIPPING_MILESTONE_EVIDENCE_CHANGED');return true;
  }
  const lifecycle={enabled:true,binding,assertInTransaction,
    async retainIssued(input,options={}) {
      const {signal,...request}=input??{};const {authorizeCommit}=options;current(authorizeCommit);
      exactKeys(request,['requestId','orderId','direction','caseId','labelId','shipmentId','trackingNumber','externalShipmentId','issuanceEvidenceRef','coverageEvidenceRef','measurementRef'],'SHIPPING_ISSUANCE_INVALID');
      requireValue(['requestId','orderId','issuanceEvidenceRef','coverageEvidenceRef','measurementRef'].every(k=>identifier(request[k])),'SHIPPING_ISSUANCE_INVALID');
      const shipmentKey=keyFor(request.orderId,request.direction,request.caseId),inputHash=hash(request);
      const original=await store.read(state=>{paid(state,request.orderId,request.direction,request.caseId);return {order:clone(state.orders[request.orderId]),existing:clone(state.shippingLifecycle?.[shipmentKey]??null)};});
      current(authorizeCommit);if(original.existing){requireValue(original.existing.inputHash===inputHash&&original.existing.bindingHash===hash(binding),'SHIPPING_ORIGINAL_CONFLICT');return view(original.existing);}
      const expected=clone(await resolveShipment({order:clone(original.order),direction:request.direction,caseId:request.caseId,signal}));current(authorizeCommit);
      const manifest={environment:binding.environment,orderId:request.orderId,cardId:original.order.cardId,orderBindingHash:original.order.bindingHash,direction:request.direction,caseId:request.caseId,issuanceEvidenceRef:request.issuanceEvidenceRef,coverageEvidenceRef:request.coverageEvidenceRef,measurementRef:request.measurementRef,labelId:request.labelId,shipmentId:request.shipmentId,trackingNumber:request.trackingNumber,externalShipmentId:request.externalShipmentId,expectedHash:hash(expected),initialShippingPayer:request.direction==='RETURN'?'ATLAS':null};
      requireValue(await validateEvidence({kind:'SHIPMENT_ISSUANCE',input:clone(manifest),context:{environment:binding.environment}})===true,'SHIPPING_ISSUANCE_EVIDENCE_REQUIRED');current(authorizeCommit);
      const verified=await adapter.verifyIssuedShipment({...request,expected,signal});current(authorizeCommit);await refresh(options);
      return store.transaction(tx=>{current(authorizeCommit);const {order,payment}=paid(tx.state,request.orderId,request.direction,request.caseId);
        requireValue(hash(order)===hash(original.order)&&verified.labelCreatedAt>=payment.reconciledAt&&verified.facts.declaredValueCents===order.itemCents,'SHIPPING_ORDER_CHANGED');
        const rows=tx.state.shippingLifecycle??={},existing=rows[shipmentKey];if(existing){requireValue(existing.inputHash===inputHash&&existing.bindingHash===hash(binding),'SHIPPING_ORIGINAL_CONFLICT');return view(existing);}
        requireValue(!Object.values(rows).some(row=>row.original.labelId===request.labelId||row.original.shipmentId===request.shipmentId||(row.original.trackingNumber===request.trackingNumber&&row.original.bindingHash===verified.bindingHash)),'SHIPPING_ORIGINAL_ALREADY_USED');
        const row={shipmentKey,bindingHash:hash(binding),inputHash,orderId:request.orderId,cardId:order.cardId,orderBindingHash:order.bindingHash,direction:request.direction,caseId:request.caseId,original:clone(verified),issuanceEvidenceRef:request.issuanceEvidenceRef,coverageEvidenceRef:request.coverageEvidenceRef,measurementRef:request.measurementRef,manifestHash:hash(manifest),createdAt:tx.now,observedAt:null,carrierStatusCode:null,firstPossessionAt:null,lastProgressAt:null,deliveredAt:null,possessionObservationRef:null,deliveryObservationRef:null,attentionCode:null,observations:{}};
        rows[shipmentKey]=row;tx.emit('SHIPPING_ORIGINAL_RETAINED',{orderId:row.orderId,shipmentKey,direction:row.direction,caseId:row.caseId});return view(row);
      });
    },
    async syncTracking({shipmentKey,signal}={},options={}) {
      const {authorizeCommit}=options;current(authorizeCommit);requireValue(identifier(shipmentKey),'SHIPPING_ORIGINAL_INVALID');
      const original=await store.read(state=>clone(rowFor(state,shipmentKey,{returnMayBeClosed:true})));current(authorizeCommit);
      let observation;
      try{observation=await adapter.readTracking({original:clone(original.original),signal});current(authorizeCommit);}
      catch(error){await store.transaction(tx=>{current(authorizeCommit);const row=rowFor(tx.state,shipmentKey,{returnMayBeClosed:true});row.attentionCode='SHIPPING_ORIGINAL_READ_UNCONFIRMED';row.lastReadFailedAt=tx.now;tx.emit('SHIPPING_TRACKING_READ_FAILED',{orderId:row.orderId,shipmentKey});});throw error;}
      await refresh(options);return store.transaction(tx=>{current(authorizeCommit);const row=rowFor(tx.state,shipmentKey,{returnMayBeClosed:true});requireValue(hash(row.original)===hash(original.original),'SHIPPING_ORIGINAL_CHANGED');
        const observedRef='atlas_scan_'+observation.observationHash.slice(0,40);
        if(!row.observations[observedRef]){requireValue(Object.keys(row.observations).length<1024,'SHIPPING_OBSERVATION_CAPACITY');row.observations[observedRef]=clone(observation);tx.emit('SHIPPING_TRACKING_OBSERVED',{orderId:row.orderId,shipmentKey,observationRef:observedRef});}
        // Conflicting carrier delivery facts never reset the buyer's clock.
        const conflict=observation.deliveryConflict||(row.deliveredAt!==null&&(observation.statusCode!=='DE'||observation.deliveredAt!==null&&row.deliveredAt!==observation.deliveredAt));
        row.deliveryConflict=Boolean(row.deliveryConflict||conflict);
        row.attentionCode=row.deliveryConflict?'SHIPPING_DELIVERY_CONFLICT':observation.deliveryTimeMissing?'SHIPPING_DELIVERY_TIME_REQUIRED':['EX','UN'].includes(observation.statusCode)?'SHIPPING_CARRIER_ATTENTION':null;
        row.observedAt=Math.max(row.observedAt??0,observation.observedAt);row.carrierStatusCode=observation.statusCode;
        if(observation.firstPossessionAt!==null&&(row.firstPossessionAt===null||observation.firstPossessionAt<row.firstPossessionAt)){row.firstPossessionAt=observation.firstPossessionAt;row.possessionObservationRef=observedRef;}
        if(observation.lastProgressAt!==null)row.lastProgressAt=Math.max(row.lastProgressAt??0,observation.lastProgressAt);
        if(!row.attentionCode&&observation.deliveredAt!==null&&row.deliveredAt===null){row.deliveredAt=observation.deliveredAt;row.deliveryObservationRef=observedRef;}
        return view(row);
      });
    },
    async status({orderId}={},options={}) {current(options.authorizeCommit);requireValue(identifier(orderId),'SHIPPING_ORDER_INVALID');const result=await store.read(state=>Object.values(state.shippingLifecycle??{}).filter(r=>r.orderId===orderId&&r.bindingHash===hash(binding)).map(view));current(options.authorizeCommit);return result;},
    async missingScans({limit=50}={},options={}) {
      const now=current(options.authorizeCommit);requireValue(Number.isSafeInteger(limit)&&limit>0&&limit<=100,'SHIPPING_LIST_LIMIT_INVALID');
      const result=await store.read(state=>Object.values(state.shippingLifecycle??{}).filter(r=>r.bindingHash===hash(binding)&&r.deliveredAt===null).map(r=>{const period=state.orders[r.orderId]?.policy?.fulfillmentPolicy?.missingScanAfterMs;requireValue(Number.isSafeInteger(period)&&period>=0,'SHIPPING_SCAN_POLICY_REQUIRED');const dueAt=(r.lastProgressAt??r.original.labelCreatedAt)+period;requireValue(Number.isSafeInteger(dueAt),'TIME_OVERFLOW');return {...view(r),dueAt,reason:r.firstPossessionAt===null?'NO_CARRIER_ACCEPTANCE':'NO_RECENT_PROGRESS'};}).filter(r=>r.dueAt<=now).sort((a,b)=>a.dueAt-b.dueAt||a.shipmentKey.localeCompare(b.shipmentKey)).slice(0,limit));current(options.authorizeCommit);return result;
    },
    async dispatchEvidence({orderId}={},options={}) {current(options.authorizeCommit);const evidence=await store.read(state=>evidenceFor(state,orderId,'DISPATCH'));current(options.authorizeCommit);return evidence;},
    async deliveryEvidence({orderId}={},options={}) {current(options.authorizeCommit);const evidence=await store.read(state=>evidenceFor(state,orderId,'DELIVER'));current(options.authorizeCommit);return evidence;},
    async validateEvidence(request,options={}) {current(options.authorizeCommit);const result=await store.read(state=>assertInTransaction({state,now:clock()},request));current(options.authorizeCommit);return result;},
    close(){closed=true;}
  };const result=Object.freeze(lifecycle);branded.set(result,{store,binding,current});return result;
}
