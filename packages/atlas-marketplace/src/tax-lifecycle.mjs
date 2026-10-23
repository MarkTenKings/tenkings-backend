import {clone,hash,requireValue,cents,sumCents} from './contract.mjs';
import {requireSyncApproval} from './fee-policy.mjs';
import {quoteText} from './provider-quote-http.mjs';
import {assertStripeTaxAdapter} from './provider-tax-stripe.mjs';

const branded=new WeakMap();
const view=operation=>({id:operation.id,kind:operation.kind,status:operation.status,orderId:operation.orderId,refundIntentId:operation.refundIntentId??null,createdAt:operation.createdAt,updatedAt:operation.updatedAt??operation.createdAt,dispatchCount:operation.dispatchCount,errorCode:operation.errorCode??null});
export function assertStripeTaxLifecycle(lifecycle,{store,environment,platformAccountId}={}) {
  const internal=branded.get(lifecycle);requireValue(internal&&(!store||internal.store===store)&&(!environment||internal.binding.environment===environment)&&(!platformAccountId||internal.binding.platformAccountId===platformAccountId),'TAX_LIFECYCLE_BINDING_MISMATCH');internal.current();return lifecycle.binding;
}
export function createStripeTaxLifecycle({enabled=false,store,taxAdapter,approvalRef,assertReady,clock=Date.now}={}) {
  if(!enabled)return Object.freeze({enabled:false,recordSale:async()=>{requireValue(false,'TAX_LIFECYCLE_DISABLED');},recordRefund:async()=>{requireValue(false,'TAX_LIFECYCLE_DISABLED');},resume:async()=>{requireValue(false,'TAX_LIFECYCLE_DISABLED');},reconcile:async()=>{requireValue(false,'TAX_LIFECYCLE_DISABLED');},listUnresolved:async()=>[],status:async()=>[]});
  const adapter=assertStripeTaxAdapter(taxAdapter,{store});requireValue(quoteText(approvalRef)&&typeof assertReady==='function','TAX_LIFECYCLE_APPROVAL_REQUIRED');
  const binding=Object.freeze({environment:adapter.environment,platformAccountId:adapter.accountId,adapterBindingHash:hash(adapter.binding),approvalRef});let lastNow=0;
  function current(review) {adapter.current();const now=clock();requireValue(Number.isSafeInteger(now)&&now>=lastNow,'TAX_LIFECYCLE_CLOCK_INVALID');lastNow=now;requireSyncApproval(assertReady({...binding,...(review?{recoveryReview:review}:{})}),'TAX_LIFECYCLE_APPROVAL_REQUIRED');return now;}
  function paid(tx,orderId) {
    const order=tx.state.orders[orderId],payment=tx.state.intents[order?.paymentIntentId];
    requireValue(order?.status==='PAID'&&order.environment===binding.environment&&payment?.kind==='PAYMENT'&&payment.status==='SUCCEEDED'&&payment.confirmed===true&&payment.platformAccountId===binding.platformAccountId&&payment.objectId===order.paymentObjectId&&payment.order?.orderId===orderId&&payment.order.bindingHash===order.bindingHash&&payment.amountCents===order.totalCents&&Number.isSafeInteger(payment.reconciledAt)&&payment.reconciledAt<=tx.now,'TAX_CONFIRMED_SALE_REQUIRED');
    const requirement=tx.state.marketplaceTaxRequirements?.[orderId];
    requireValue(!requirement||(requirement.orderId===orderId&&requirement.bindingHash===hash(binding)&&requirement.calculationId===order.quote?.taxQuoteRef&&requirement.paymentBindingHash===order.bindingHash),'TAX_REQUIREMENT_CHANGED');
    return {order,payment};
  }
  function operationId(kind,id){return `atlas_taxop_${hash({binding,kind,id}).slice(0,40)}`;}
  async function read(id){return store.read(state=>clone(state.taxLifecycleOperations?.[id]??null));}
  function validateOriginal(tx,operation){
    requireValue(operation&&operation.bindingHash===hash(binding),'TAX_OPERATION_NOT_FOUND');const {order,payment}=paid(tx,operation.orderId);
    requireValue(operation.kind!=='TAX_SALE'||operation.calculationId===order.quote?.taxQuoteRef,'TAX_REQUIREMENT_CHANGED');
    if(operation.kind==='TAX_REFUND'){
      const refund=tx.state.intents[operation.refundIntentId],sale=tx.state.taxLifecycleOperations[operationId('TAX_SALE',order.orderId)],e=operation.expected;
      requireValue(refund?.kind==='REFUND'&&refund.status==='SUCCEEDED'&&refund.confirmed===true&&refund.platformAccountId===binding.platformAccountId&&refund.orderId===order.orderId&&refund.parentObjectId===payment.chargeId&&quoteText(refund.objectId)&&Number.isSafeInteger(refund.reconciledAt)&&refund.reconciledAt<=tx.now,'TAX_CONFIRMED_REFUND_REQUIRED');
      requireValue(sale?.status==='SUCCEEDED'&&sale.providerId===operation.originalTransactionId&&sale.evidence?.lineId===operation.originalLineId&&quoteText(operation.reviewRef)&&operation.inputHash===hash({refundIntentId:operation.refundIntentId,itemTaxCents:-e.itemTaxCents,shippingTaxCents:-e.shippingTaxCents,reviewRef:operation.reviewRef})&&-e.itemCents===sumCents(refund.allocations.sellerCents,refund.allocations.feeCents)&&-e.shippingCents===refund.allocations.shippingCents&&sumCents(-e.itemTaxCents,-e.shippingTaxCents)===refund.allocations.taxCents&&sumCents(-e.itemCents,-e.shippingCents,-e.itemTaxCents,-e.shippingTaxCents)===refund.amountCents,'TAX_REFUND_REVIEW_CONFLICT');
    }
  }
  async function readOriginal(id){const now=current();return store.read(state=>{const operation=state.taxLifecycleOperations?.[id];validateOriginal({state,now},operation);return clone(operation);});}
  async function keepFailure(id) {await store.transaction(tx=>{const operation=tx.state.taxLifecycleOperations?.[id];if(operation&&operation.status!=='SUCCEEDED')Object.assign(operation,{status:'UNKNOWN',errorCode:'TAX_ORIGINAL_RECONCILIATION_REQUIRED',updatedAt:tx.now});});}
  async function retrieve(operation,{signal}={}) {
    current();if(!operation.providerId)return view(operation);
    try {
      const evidence=await adapter.retrieveTransaction(operation,operation.providerId,{signal});current();
      return await store.transaction(tx=>{current();const row=tx.state.taxLifecycleOperations[operation.id];validateOriginal(tx,row);requireValue(row.providerId===evidence.providerId&&row.bindingHash===operation.bindingHash,'TAX_OPERATION_CONFLICT');Object.assign(row,{status:'SUCCEEDED',evidence:clone(evidence),updatedAt:tx.now,errorCode:null});return view(row);});
    }catch{await keepFailure(operation.id);return view(await read(operation.id));}
  }
  async function dispatch(id,{signal}={}) {
    let operation=await readOriginal(id);if(operation.status==='SUCCEEDED')return view(operation);
    if(operation.status!=='PREPARED')return operation.providerId?retrieve(operation,{signal}):view(operation);
    // Calculation GET is read-only. Failure before claim leaves PREPARED for a
    // later original retry; it cannot manufacture a fresh calculation or tax.
    if(operation.kind==='TAX_SALE')await adapter.verifyCalculation(operation.calculationId,{signal});
    const claim=await store.transaction(tx=>{current();const row=tx.state.taxLifecycleOperations[id];if(row.status!=='PREPARED')return false;validateOriginal(tx,row);Object.assign(row,{status:'DISPATCHING',dispatchCount:1,updatedAt:tx.now});return true;});
    if(!claim)return view(await read(id));operation=await read(id);
    try {
      const created=await adapter.createTransaction(operation,{signal});
      // Preserve the returned original ID even when approval changes after IO.
      await store.transaction(tx=>{const row=tx.state.taxLifecycleOperations[id];requireValue(!row.providerId||row.providerId===created.providerId,'TAX_OPERATION_CONFLICT');row.providerId=created.providerId;row.updatedAt=tx.now;});
      return await retrieve(await read(id),{signal});
    }catch{await keepFailure(id);return view(await read(id));}
  }
  const lifecycle={enabled:true,binding,
    async recordSale({orderId,signal}={}) {
      current();requireValue(quoteText(orderId,128),'TAX_ORDER_INVALID');
      const id=operationId('TAX_SALE',orderId),existing=await read(id);if(existing)return dispatch(id,{signal});
      const snapshot=await store.read(state=>state.orders[orderId]);requireValue(snapshot?.quote?.taxQuoteRef,'TAX_CALCULATION_REQUIRED');
      const calculation=await adapter.findCalculation(snapshot.quote.taxQuoteRef);
      await store.transaction(tx=>{current();const {order}=paid(tx,orderId),e=calculation.evidence,r=calculation.request;
        requireValue(order.quote.taxReceipt?.requestHash===calculation.requestHash&&order.quote.taxQuoteRef===calculation.providerId&&order.bindingHash===r.listingHash&&order.buyerId===r.buyerId&&order.itemCents===e.itemCents&&order.shippingCents===e.shippingCents&&order.taxCents===e.taxCents&&order.totalCents===e.totalCents,'TAX_SALE_BINDING_MISMATCH');
        const operations=tx.state.taxLifecycleOperations??={};if(operations[id])return;
        requireValue(!Object.values(operations).some(row=>row.kind==='TAX_SALE'&&row.orderId===orderId),'TAX_ORIGINAL_OPERATION_CONFLICT');
        operations[id]={id,kind:'TAX_SALE',bindingHash:hash(binding),orderId,paymentIntentId:order.paymentIntentId,calculationId:calculation.providerId,reference:`atlas-marketplace:${orderId}:tax-sale`,expected:{itemCents:e.itemCents,itemTaxCents:e.itemTaxCents,shippingCents:e.shippingCents,shippingTaxCents:e.shippingTaxCents,itemTaxCode:e.itemTaxCode,lineReference:e.lineReference,customerAddressHash:e.customerAddressHash,shipFromAddressHash:e.shipFromAddressHash},status:'PREPARED',dispatchCount:0,providerId:null,createdAt:tx.now};
      });return dispatch(id,{signal});
    },
    async recordRefund({refundIntentId,itemTaxCents,shippingTaxCents,reviewRef,signal}={}) {
      current();requireValue(quoteText(refundIntentId,128)&&quoteText(reviewRef),'TAX_REFUND_REVIEW_REQUIRED');cents(itemTaxCents);cents(shippingTaxCents);
      const id=operationId('TAX_REFUND',refundIntentId),inputHash=hash({refundIntentId,itemTaxCents,shippingTaxCents,reviewRef});
      await store.transaction(tx=>{current();const refund=tx.state.intents[refundIntentId],{order,payment}=paid(tx,refund?.orderId);
        requireValue(refund.kind==='REFUND'&&refund.status==='SUCCEEDED'&&refund.confirmed===true&&refund.platformAccountId===binding.platformAccountId&&refund.parentObjectId===payment.chargeId&&quoteText(refund.objectId)&&Number.isSafeInteger(refund.reconciledAt)&&refund.reconciledAt<=tx.now,'TAX_CONFIRMED_REFUND_REQUIRED');
        const operations=tx.state.taxLifecycleOperations??={},previous=operations[id];if(previous){requireValue(previous.inputHash===inputHash,'TAX_REFUND_REVIEW_CONFLICT');return;}
        requireValue(!Object.values(operations).some(row=>row.kind==='TAX_REFUND'&&row.refundIntentId===refundIntentId),'TAX_ORIGINAL_OPERATION_CONFLICT');
        const sale=operations[operationId('TAX_SALE',order.orderId)];requireValue(sale?.status==='SUCCEEDED'&&sale.evidence?.lineId,'TAX_SALE_RECORD_REQUIRED');
        const itemCents=sumCents(refund.allocations.sellerCents,refund.allocations.feeCents),shippingCents=refund.allocations.shippingCents;
        requireValue(sumCents(itemTaxCents,shippingTaxCents)===refund.allocations.taxCents&&sumCents(itemCents,shippingCents,itemTaxCents,shippingTaxCents)===refund.amountCents,'TAX_REFUND_ALLOCATION_MISMATCH');
        const reserved=Object.values(operations).filter(row=>row.kind==='TAX_REFUND'&&row.orderId===order.orderId);
        for(const [key,value]of Object.entries({itemCents,itemTaxCents,shippingCents,shippingTaxCents}))requireValue(sumCents(value,...reserved.map(row=>-row.expected[key]))<=sale.expected[key],'TAX_REFUND_EXCEEDS_ORIGINAL');
        const expected={...clone(sale.expected),itemCents:-itemCents,itemTaxCents:-itemTaxCents,shippingCents:-shippingCents,shippingTaxCents:-shippingTaxCents,lineReference:`refund:${refundIntentId}`};
        operations[id]={id,kind:'TAX_REFUND',bindingHash:hash(binding),inputHash,orderId:order.orderId,refundIntentId,reviewRef,originalTransactionId:sale.providerId,originalLineId:sale.evidence.lineId,reference:`atlas-marketplace:${refundIntentId}:tax-refund`,expected,status:'PREPARED',dispatchCount:0,providerId:null,createdAt:tx.now};
      });return dispatch(id,{signal});
    },
    async resume({operationId:id,signal}={}) {
      const operation=await readOriginal(id);requireValue(operation.status==='PREPARED'&&operation.dispatchCount===0&&!operation.providerId,'TAX_PREPARED_OPERATION_REQUIRED');return dispatch(id,{signal});
    },
    async reconcile({operationId: id,providerId,recoveryReviewRef,signal}={}) {
      current();let operation=await readOriginal(id);
      if(providerId!==undefined){requireValue(/^tax_[A-Za-z0-9]+$/.test(providerId)&&quoteText(recoveryReviewRef)&&operation.status!=='PREPARED','TAX_RECOVERY_REVIEW_REQUIRED');current({operationId:id,providerId,recoveryReviewRef});
        requireValue(!operation.providerId||operation.providerId===providerId,'TAX_ORIGINAL_OBJECT_CONFLICT');
        const evidence=await adapter.retrieveTransaction(operation,providerId,{signal});
        return store.transaction(tx=>{current({operationId:id,providerId,recoveryReviewRef});const row=tx.state.taxLifecycleOperations[id];validateOriginal(tx,row);requireValue(!row.providerId||row.providerId===providerId,'TAX_ORIGINAL_OBJECT_CONFLICT');Object.assign(row,{providerId,recoveryReviewRef,evidence:clone(evidence),status:'SUCCEEDED',errorCode:null,updatedAt:tx.now});return view(row);});}
      return retrieve(operation,{signal});
    },
    async listUnresolved({limit=50}={}) {current();requireValue(Number.isSafeInteger(limit)&&limit>0&&limit<=100,'TAX_LIST_LIMIT_INVALID');return store.read(state=>Object.values(state.taxLifecycleOperations??{}).filter(row=>row.bindingHash===hash(binding)&&row.status!=='SUCCEEDED').sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)).slice(0,limit).map(view));},
    async status({orderId}={}) {current();requireValue(quoteText(orderId,128),'TAX_ORDER_INVALID');return store.read(state=>Object.values(state.taxLifecycleOperations??{}).filter(row=>row.bindingHash===hash(binding)&&row.orderId===orderId).map(view));},
  };
  const result=Object.freeze(lifecycle);branded.set(result,{store,binding,current});return result;
}
