import { clone, hash, requireValue } from './contract.mjs';
import { publicApprovedCard } from './card-projection.mjs';
import { sellerBalance } from './finance.mjs';

const pick = (row, keys) => Object.fromEntries(keys.filter(key => row?.[key] !== undefined).map(key => [key,clone(row[key])]));
export function projectBuyerQuote(quote,{includeDestination=true}={}) {
  if(!quote)return null;
  return {...pick(quote,['quoteId','schema','environment','currency','listingId','listingVersion','listingHash','policyId','policyVersion','itemCents','shippingCents','taxCents','buyerFeeCents','totalCents','deliveryEstimate','protectionTerms','issuedAt','expiresAt']),
    ...(quote.shippingPricing?{shippingCharge:pick(quote.shippingPricing,['label','disclosure'])}:{}),
    ...(quote.destination&&includeDestination?{destination:pick(quote.destination,['id','label','version'])}:{})};
}
export function projectMarketplaceWorkspace(state, actor, { now, sellerEligibility = null, environment, platformAccountId, policy, eligibilityCards=[] } = {}) {
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
    cases[order.orderId].cases=fulfillment.cases.map(item=>({...pick(item,staff ? ['id','kind','status','openedAt','outcome','returnReason','evidenceRef','initialShippingPayer','finalResponsibility','refundObligation','history'] : ['id','kind','status','openedAt','outcome','returnReason','initialShippingPayer','finalResponsibility']),...(item.returnReview?{returnReview:pick(item.returnReview,staff?['decision','reviewRef','actorId','at']:['decision','at'])}:{})}));
    cases[order.orderId].history=fulfillment.history.map(item=>pick(item,['action','at']));
  }
  return {
    schema:'atlas-marketplace-workspace-v1', environment, scope:{role:actor.role,actorId:actor.id}, now,
    policy:policy?pick(policy,['id','version','environment','currency','feeCents','feeDisclosure','fulfillmentRoute','protectionTerms','returnsTerms','transferReleaseTerms','payoutTerms','reservationTtlMs']):null,
    eligibilityCards:seller?eligibilityCards.map(publicApprovedCard).filter(Boolean):[],
    consent:seller?Object.fromEntries(Object.entries(state.consent).filter(([,row])=>row.sellerId===actor.id).map(([id,row])=>[id,pick(row,['cardId','choice','at'])])):{},
    listings:listings.map(row=>({...pick(row,['id','version','bindingHash','status','environment','cardId','askingPriceCents','currency',...(seller||staff?['feeCents','sellerNetCents']:[])]),policy:pick(row.policy,['id','version','feeDisclosure','fulfillmentRoute','protectionTerms','returnsTerms','transferReleaseTerms','payoutTerms','reservationTtlMs']),approvedCard:publicApprovedCard(row.approvedCard)})),
    reservations:reservations.map(row=>({...pick(row,['id','orderId','listingId','cardId','listingHash','status','createdAt','expiresAt','paymentIntentId']),quote:projectBuyerQuote(row.quote)})),
    orders:orders.map(row=>({...pick(row,['orderId','reservationId','listingId','cardId','status','totalCents','itemCents','taxCents','shippingCents','currency','paidAt',...(seller||staff?['feeCents','sellerNetCents']:[])]),quote:projectBuyerQuote(row.quote,{includeDestination:!seller}),...(staff&&row.shippingPricing?{shippingPricing:pick(row.shippingPricing,['quotedCarrierCostCents','handlingCents','buyerChargeCents','costStatus'])}:{}),...(row.policy?.commercialTerms?.returns?{returnPolicy:pick(row.policy.commercialTerms.returns,['returnWindowMs','startsAt','deadlineExclusive','eligibleReasons','requiresBuyerEvidence','requiresStaffReview','returnShippingPayer','finalResponsibility'])}:{}),approvedCard:publicApprovedCard(row.approvedCard)})),
    fulfillment:cases,
    intents:Object.values(state.intents).filter(row=>staff || seller&&row.sellerId===actor.id || !seller&&row.kind==='PAYMENT'&&reservationIds.has(row.order?.reservationId)).map(row=>({ ...pick(row,['id','kind','status','orderId','amountCents','confirmed']), reservationId:row.order?.reservationId??null, caseId:row.policyEvidence?.caseId??null })),
    balance:seller?sellerBalance(state,actor.id):null,
    sellerEligibility:seller?clone(sellerEligibility):null,
    ...(staff?{operations:projectFinanceOperations(state,{environment,platformAccountId})}:{}),
    gates:{ownershipClaimsEnabled:false,ownershipHistoryEnabled:false},
  };
}

export function projectFinanceOperations(state, { environment, platformAccountId } = {}) {
  const scope = platformAccountId ? hash({environment,platformAccountId}) : null;
  const scoped = row => !scope || row.scope === scope;
  const alerts = Object.values(state.financeOperationalAlerts ?? {}).filter(scoped);
  const count = status => alerts.filter(row=>row.status===status).length;
  const runs = Object.values(state.financeHostedRuns ?? {}).filter(scoped).sort((a,b)=>b.completedAt-a.completedAt);
  const schedules = Object.values(state.financeSchedules ?? {}).filter(scoped);
  const ingress = Object.values(state.financeWebhookIngress ?? {}).filter(row=>!platformAccountId || row.platformAccountId===platformAccountId);
  return {
    incidentCounts:{open:count('OPEN'),acknowledged:count('ACKNOWLEDGED'),resolved:count('RESOLVED')},
    incidents:alerts.sort((a,b)=>(a.status==='RESOLVED')-(b.status==='RESOLVED')||b.lastObservedAt-a.lastObservedAt||a.alertId.localeCompare(b.alertId)).slice(0,100).map(row=>({
      ...pick(row,['alertId','status','code','firstObservedAt','lastObservedAt','latestEvidenceHash']),reference:row.latestReference??row.reference,generation:row.generation??1,version:row.version??1,
      deliveryStatus:state.financeAlertOutbox?.[row.deliveryKey??row.alertId]?.status??'UNAVAILABLE',
    })),
    recovery:{latestRun:runs.length?pick(runs[0],['runId','status','recoveryStatus','completedAt','deliveryStatus']):null,
      // A saved heartbeat is evidence of a previous run, not proof that the
      // process is alive. External liveness monitoring remains independent.
      liveness:'EXTERNAL_MONITOR_REQUIRED',schedules:schedules.map(row=>pick(row,['nextDueAt','lastStartedAt','lastCompletedAt','status']))},
    inbox:{total:ingress.length,byStatus:Object.fromEntries([...new Set(ingress.map(row=>row.status))].sort().map(status=>[status,ingress.filter(row=>row.status===status).length]))},
    unsettledInstantFeeIntents:Object.values(state.intents??{}).filter(row=>row.kind==='PAYOUT'&&row.method==='instant'&&row.cashDebited&&!row.providerFeeSettlementId&&(!platformAccountId||row.platformAccountId===platformAccountId)).slice(0,100).map(row=>({id:row.id,amountCents:row.amountCents,providerFeeCents:row.instantQuote.providerFeeCents})),
  };
}

export function marketplaceOperations(state, { includeSynthetic = false, since = 0 } = {}) {
  requireValue(Number.isSafeInteger(since)&&since>=0,'METRIC_WINDOW_INVALID');
  const events=state.events.filter(row=>row.at>=since && (includeSynthetic || row.environment==='PRODUCTION'));
  const count=type=>events.filter(row=>row.type===type).length;
  const accepted=row=>includeSynthetic||row.environment==='PRODUCTION';
  const orders=Object.values(state.orders??{}).filter(accepted);
  const periodOrders=orders.filter(row=>Date.parse(row.paidAt)>=since);
  const reservations=Object.values(state.reservations??{}).filter(row=>accepted(row)&&Date.parse(row.createdAt)>=since);
  const converted=reservations.filter(row=>orders.some(order=>order.reservationId===row.id)).length;
  const buyers=new Set(periodOrders.map(row=>row.buyerId));
  const repeat=[...buyers].filter(id=>orders.filter(row=>row.buyerId===id).length>1).length;
  const payouts=Object.values(state.intents??{}).filter(row=>row.kind==='PAYOUT'&&(includeSynthetic||row.policy?.environment==='stripe-production')&&row.createdAt>=since);
  const paid=payouts.filter(row=>row.confirmed===true&&!row.returned).length;
  const failed=payouts.filter(row=>row.returned||['FAILED','CANCELED'].includes(row.status)).length;
  const voided=payouts.filter(row=>row.status==='VOIDED').length;
  const caseOrders=periodOrders.filter(order=>state.fulfillment?.[order.orderId]?.cases?.some(row=>row.kind==='DISPUTE')).length;
  const ratio=(numerator,denominator)=>denominator?numerator/denominator:null;
  return { environment:includeSynthetic?'SYNTHETIC_OR_MIXED':'PRODUCTION', syntheticExcluded:state.events.filter(row=>row.environment!=='PRODUCTION').length,
    listingCount:count('LISTING_CREATED'), reservationCount:count('CARD_RESERVED'), salesCount:count('SALE_CONFIRMED'), casesOpened:count('PROTECTION_CASE_OPENED'),
    eventCount:events.length, contributionProfit:null, contributionProfitStatus:'COST_EVIDENCE_REQUIRED',
    // This is a durable checkout cohort, not unmeasured browsing conversion.
    conversionRate:null, conversionStatus:'PAGE_VISIT_DENOMINATOR_UNAVAILABLE',
    checkoutConversion:{numerator:converted,denominator:reservations.length,rate:ratio(converted,reservations.length),basis:'RESERVATIONS_CREATED_IN_WINDOW'},
    repeatPurchaseRate:ratio(repeat,buyers.size),repeatPurchases:{repeatBuyers:repeat,buyers:buyers.size,basis:'PAID_BUYERS_IN_WINDOW_WITH_MULTIPLE_RETAINED_PURCHASES'},
    payoutReliability:{paid,failed,voided,pending:payouts.length-paid-failed-voided,rate:ratio(paid,paid+failed),basis:'TERMINAL_ORIGINAL_PAYOUTS_CREATED_IN_WINDOW'},
    disputes:{orders:caseOrders,paidOrders:periodOrders.length,rate:ratio(caseOrders,periodOrders.length),basis:'ORDERS_PAID_IN_WINDOW_WITH_RECORDED_DISPUTE_CASE'},
    handlingTime:null,handlingTimeStatus:'ACTIVE_WORK_DURATION_EVIDENCE_REQUIRED',compAccuracy:null,compAccuracyStatus:'QUALIFIED_COMPARISON_DATA_REQUIRED',
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
