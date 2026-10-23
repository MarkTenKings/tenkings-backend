import {hash,requireValue} from './contract.mjs';

// Persist the requirement with the reservation. Removing a runtime adapter or
// changing policy later cannot turn an already purchased tax obligation off.
export function retainTaxRequirement(tx,{reservation,binding}) {
  const row={orderId:reservation.orderId,bindingHash:hash(binding),calculationId:reservation.quote.taxQuoteRef,paymentBindingHash:reservation.order.bindingHash};
  requireValue(typeof row.calculationId==='string'&&row.calculationId.length>0,'TAX_CALCULATION_REQUIRED');
  const records=tx.state.marketplaceTaxRequirements??={};
  requireValue(!records[row.orderId]||hash(records[row.orderId])===hash(row),'TAX_REQUIREMENT_CHANGED');
  records[row.orderId]=row;return row;
}
function original(state,requirement,kind,refundIntentId) {
  return Object.values(state.taxLifecycleOperations??{}).find(row=>row.bindingHash===requirement.bindingHash&&row.orderId===requirement.orderId&&row.kind===kind&&(kind==='TAX_SALE'?row.calculationId===requirement.calculationId:row.refundIntentId===refundIntentId));
}
export function assertOrderTaxComplete(tx,orderId,{refundIntentId}={}) {
  const required=tx.state.marketplaceTaxRequirements?.[orderId];if(!required)return true;
  const order=tx.state.orders[orderId];requireValue(order?.bindingHash===required.paymentBindingHash,'TAX_REQUIREMENT_CHANGED');
  requireValue(original(tx.state,required,'TAX_SALE')?.status==='SUCCEEDED','TAX_SALE_RECORD_REQUIRED');
  const refunds=refundIntentId?[refundIntentId]:Object.values(tx.state.intents).filter(row=>row.kind==='REFUND'&&row.orderId===orderId&&row.status==='SUCCEEDED'&&row.confirmed===true).map(row=>row.id);
  for(const id of refunds)requireValue(original(tx.state,required,'TAX_REFUND',id)?.status==='SUCCEEDED','TAX_REFUND_RECORD_REQUIRED');
  return true;
}
export function projectTaxReporting(state,{available=false}={}) {
  return {available,orders:Object.values(state.marketplaceTaxRequirements??{}).filter(row=>state.orders[row.orderId]?.status==='PAID').map(row=>{
    const sale=original(state,row,'TAX_SALE');return {orderId:row.orderId,saleStatus:sale?.status??'MISSING',operationId:sale?.id??null,
      refunds:Object.values(state.intents).filter(item=>item.kind==='REFUND'&&item.orderId===row.orderId&&item.status==='SUCCEEDED'&&item.confirmed===true).map(item=>{const operation=original(state,row,'TAX_REFUND',item.id);return {refundIntentId:item.id,taxCents:item.allocations.taxCents,status:operation?.status??'MISSING',operationId:operation?.id??null};})};
  })};
}
