import { clone, requireValue } from './contract.mjs';
import { publicApprovedCard } from './card-projection.mjs';
import { sellerBalance } from './finance.mjs';

const pick = (row, keys) => Object.fromEntries(keys.filter(key => row?.[key] !== undefined).map(key => [key,clone(row[key])]));
export function projectMarketplaceWorkspace(state, actor, { now, sellerEligibility = null, environment, policy, eligibilityCards=[] } = {}) {
  requireValue(['BUYER','SELLER','STAFF'].includes(actor?.role), 'FORBIDDEN');
  const staff=actor.role==='STAFF', seller=actor.role==='SELLER';
  const orders=Object.values(state.orders).filter(row=>staff || (seller ? row.sellerId : row.buyerId)===actor.id);
  const reservations=Object.values(state.reservations).filter(row=>staff || row.buyerId===actor.id);
  const reservationIds=new Set(reservations.map(row=>row.id));
  const heldListingIds=new Set(reservations.map(row=>row.listingId));
  const listings=Object.values(state.listings).filter(row=>staff || (seller?row.sellerId===actor.id:heldListingIds.has(row.id)));
  const cases={};
  for(const order of orders) {
    const fulfillment=state.fulfillment[order.orderId]; if(!fulfillment) continue;
    cases[order.orderId]=pick(fulfillment,['orderId','cardId','status','dispatchedAt','deliveredAt','releaseNotBefore','releasedAt']);
    cases[order.orderId].cases=fulfillment.cases.map(item=>pick(item,staff ? ['id','kind','status','openedAt','outcome','refundObligation','history'] : ['id','kind','status','openedAt','outcome']));
    cases[order.orderId].history=fulfillment.history.map(item=>pick(item,['action','at']));
  }
  return {
    schema:'atlas-marketplace-workspace-v1', environment, scope:{role:actor.role,actorId:actor.id}, now,
    policy:policy?pick(policy,['id','version','environment','currency','feeCents','feeDisclosure','fulfillmentRoute','protectionTerms','returnsTerms','transferReleaseTerms','payoutTerms','reservationTtlMs']):null,
    eligibilityCards:seller?eligibilityCards.map(publicApprovedCard).filter(Boolean):[],
    consent:seller?Object.fromEntries(Object.entries(state.consent).filter(([,row])=>row.sellerId===actor.id).map(([id,row])=>[id,pick(row,['cardId','choice','at'])])):{},
    listings:listings.map(row=>({...pick(row,['id','version','bindingHash','status','environment','cardId','askingPriceCents','currency',...(seller||staff?['feeCents','sellerNetCents']:[])]),approvedCard:publicApprovedCard(row.approvedCard)})),
    reservations:reservations.map(row=>pick(row,['id','orderId','listingId','cardId','listingHash','status','createdAt','expiresAt','paymentIntentId','quote'])),
    orders:orders.map(row=>({...pick(row,['orderId','reservationId','listingId','cardId','status','totalCents','itemCents','taxCents','shippingCents','currency','paidAt','quote',...(seller||staff?['feeCents','sellerNetCents']:[])]),approvedCard:publicApprovedCard(row.approvedCard)})),
    fulfillment:cases,
    intents:Object.values(state.intents).filter(row=>staff || seller&&row.sellerId===actor.id || !seller&&row.kind==='PAYMENT'&&reservationIds.has(row.order?.reservationId)).map(row=>({ ...pick(row,['id','kind','status','orderId','amountCents','confirmed']), reservationId:row.order?.reservationId??null, caseId:row.policyEvidence?.caseId??null })),
    balance:seller?sellerBalance(state,actor.id):null,
    sellerEligibility:seller?clone(sellerEligibility):null,
    gates:{ownershipClaimsEnabled:false,ownershipHistoryEnabled:false},
  };
}

export function marketplaceOperations(state, { includeSynthetic = false, since = 0 } = {}) {
  const events=state.events.filter(row=>row.at>=since && (includeSynthetic || row.environment==='PRODUCTION'));
  const count=type=>events.filter(row=>row.type===type).length;
  return { environment:includeSynthetic?'SYNTHETIC_OR_MIXED':'PRODUCTION', syntheticExcluded:state.events.filter(row=>row.environment!=='PRODUCTION').length,
    listingCount:count('LISTING_CREATED'), reservationCount:count('CARD_RESERVED'), salesCount:count('SALE_CONFIRMED'), casesOpened:count('PROTECTION_CASE_OPENED'),
    eventCount:events.length, contributionProfit:null, contributionProfitStatus:'COST_EVIDENCE_REQUIRED',
    // No fabricated conversion denominator or profit from fixture activity.
    conversionRate:null, repeatPurchaseRate:null,
  };
}

export function projectStaffQueue(state, { status, kind, query='', offset=0, limit=30 }={}) {
  requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=100&&typeof query==='string'&&query.length<=200,'FILTER_INVALID');
  const q=query.toLowerCase();
  const rows=Object.values(state.orders).flatMap(order=>{
    const fulfillment=state.fulfillment[order.orderId];
    if(status && fulfillment?.status!==status) return [];
    if(q && ![order.orderId,order.cardId,order.approvedCard?.certificateId,order.approvedCard?.identity?.name].some(value=>String(value??'').toLowerCase().includes(q))) return [];
    if(kind && !fulfillment?.cases.some(item=>item.kind===kind&&item.status==='OPEN')) return [];
    return [{orderId:order.orderId,cardId:order.cardId,certificateId:order.approvedCard?.certificateId??null,name:order.approvedCard?.identity?.name??null,status:fulfillment?.status??'AWAITING_PACKING',openCases:fulfillment?.cases.filter(item=>item.status==='OPEN').length??0,paidAt:order.paidAt,totalCents:order.totalCents}];
  }).sort((a,b)=>a.paidAt.localeCompare(b.paidAt)||a.orderId.localeCompare(b.orderId));
  return {items:rows.slice(offset,offset+limit),total:rows.length,offset,nextOffset:offset+limit<rows.length?offset+limit:null};
}

export function staffQueueCsv(queue) {
  const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  const keys=['orderId','cardId','certificateId','name','status','openCases','paidAt','totalCents'];
  return [keys.join(','),...queue.items.map(row=>keys.map(key=>cell(row[key])).join(','))].join('\r\n')+'\r\n';
}
