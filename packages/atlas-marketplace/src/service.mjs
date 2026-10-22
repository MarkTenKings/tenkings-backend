import { clone, hash, requireValue } from './contract.mjs';
import { createUnavailableEligibilityAdapter } from './eligibility.mjs';
import { createListing, assertListingBinding, reviseListing, withdrawListing } from './listing.mjs';
import { assertBuyerQuote, reserveListing, markReservationPaymentPending, settleReservation, releaseReservation, cancelReservation, expireReservations } from './reservation.mjs';
import { preparePayment, prepareTransfer, preparePayout, prepareRefund, sellerBalance, recordHold, releaseHold } from './finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent, getPaymentCollection } from './payment.mjs';
import { assertFulfillmentPolicy, ensureFulfillmentState, recordHoldChoice, recordFulfillment, openProtectionCase, recordRefundObligation, resolveProtectionCase } from './fulfillment.mjs';
import { authorityContext, authorityId, domainId } from './authority-context.mjs';
import { catalogListings } from './catalog.mjs';
import { reconcileAccount, reconcilePendingFinance } from './reconciliation.mjs';
import { randomUUID } from 'node:crypto';
import { handleFinanceWebhook } from './webhook.mjs';
import { projectMarketplaceWorkspace, projectStaffQueue, marketplaceOperations } from './projections.mjs';

export const intentId = (kind, value, context) => `${authorityContext(context).environment === 'SYNTHETIC_LOCAL' ? 'demo_' : 'atlas_'}${kind}_${hash(value).slice(0, 32)}`;

// Trusted composition boundary. No production auth, eligibility or credentials
// are discovered here. Every runtime must explicitly provide its own ports.
export function createMarketplacePilot({ enabled = false, environment, store, eligibility = createUnavailableEligibilityAdapter(), quoteProvider, provider, listingPolicy, financePolicy, fulfillmentPolicy, platformAccountId, context: suppliedContext, runtimeApproval, assertRuntimeReady, sellerAccount, onboarding, readEvidence, validateEvidence, webhook, clock = Date.now } = {}) {
  const context = authorityContext(suppliedContext), rawStore = store;
  if (rawStore) store = { read: (...args) => rawStore.read(...args), transaction: fn => rawStore.transaction(tx => fn({ ...tx, context })) };
  const idFor = (kind,value) => intentId(kind,value,context);
  const approvalBinding = () => ({ environment, platformAccountId, listingPolicyHash:hash(listingPolicy), financePolicyHash:hash(financePolicy), fulfillmentPolicyHash:hash(fulfillmentPolicy), qualificationRefs:context.qualificationRefs });
  function gate() {
    requireValue(enabled === true && environment === context.environment, 'MARKETPLACE_DISABLED');
    if(environment !== 'SYNTHETIC_LOCAL') {
      requireValue(runtimeApproval?.approved===true && hash(runtimeApproval.binding)===hash(approvalBinding()) && typeof assertRuntimeReady==='function' && assertRuntimeReady(approvalBinding())===true, 'RUNTIME_QUALIFICATION_REQUIRED');
      requireValue(financePolicy?.environment === (environment==='PRODUCTION'?'stripe-production':'stripe-sandbox'), 'FINANCE_POLICY_REQUIRED');
    }
  }
  function authorize(actor, roles) { gate(); authorityId(actor?.id,'actor',context); requireValue(roles.includes(actor?.role), 'FORBIDDEN'); }
  async function validated(kind,actor,input) {
    if(environment!=='SYNTHETIC_LOCAL') requireValue(typeof validateEvidence==='function'&&await validateEvidence({kind,actor:clone(actor),input:clone(input),context})===true,'EVIDENCE_UNAVAILABLE');
  }
  async function authority(cardId, sellerId) {
    const result = await eligibility.read({ cardId, sellerId });
    requireValue(result?.available === true, 'ELIGIBILITY_UNAVAILABLE');
    return result.assertion;
  }
  async function buyerReservation(actor, reservationId) {
    authorize(actor, ['BUYER']);
    const reservation = await store.read(state => state.reservations[reservationId]);
    requireValue(reservation?.buyerId === actor.id, 'RESERVATION_NOT_FOUND');
    return reservation;
  }
  async function settle(intent, reservationId) {
    return await store.transaction(tx => {
      const reservation = tx.state.reservations[reservationId];
      if (intent.status === 'SUCCEEDED') {
        const order = settleReservation(tx, { reservationId, paymentIntentId: intent.id, orderId: reservation.orderId });
        ensureFulfillmentState(tx, order.orderId);
        return order;
      }
      if (intent.status === 'CANCELED' && intent.terminalUnpaid) return releaseReservation(tx, { reservationId, paymentIntentId: intent.id, reason: 'PAYMENT_CANCELED' });
      return clone(reservation);
    });
  }
  async function reconcileOriginal(id) {
    const current=await store.read(state=>state.intents[id]); requireValue(current,'INTENT_NOT_FOUND');
    let objectId=current.objectId;
    if(!objectId&&current.status!=='PREPARED'&&typeof provider.discover==='function') {
      const found=await provider.discover(current); requireValue(found?.complete===true&&found.objectId,'PROVIDER_RESULT_UNKNOWN'); objectId=found.objectId;
    }
    return reconcileFinanceIntent({store,provider,intentId:id,...(objectId?{objectId}:{})});
  }
  async function dispatchOrReconcile(id) {
    const current = await store.read(state => state.intents[id]);
    return current.status === 'PREPARED'
      ? executeFinanceIntent({ store, provider, intentId: id, enabled: true })
      : reconcileOriginal(id);
  }
  async function reconcileBeforePayout(accountId) {
    if(environment==='SYNTHETIC_LOCAL') return;
    for(const scopedAccountId of new Set([platformAccountId,accountId])) {
    const report=await reconcileAccount({store,provider,accountId:scopedAccountId,platformAccountId,reportId:`account_${randomUUID().replaceAll('-','')}`,maxEvidenceAgeMs:financePolicy.maxEvidenceAgeMs,enabled:true});
    requireValue(report.status==='RECONCILED','ACCOUNT_RECONCILIATION_REQUIRED');
    }
  }
  async function resumeTransfer(actor,{orderId}) {
    authorize(actor,['STAFF']);
    const order=await store.read(state=>state.orders[orderId]); requireValue(order,'ORDER_UNAVAILABLE');
    const account=await provider.getAccount(order.connectedAccountId), transferId=idFor('transfer',orderId);
    await store.transaction(tx=>{
      const current=tx.state.fulfillment[orderId];
      requireValue(current?.status==='RELEASED'&&!current.cases.some(row=>row.status!=='CLOSED'),'PROTECTION_HOLD');
      if(!tx.state.intents[transferId]) prepareTransfer(tx,{intentId:transferId,paymentIntentId:order.paymentIntentId,releaseEvidence:current.releaseEvidence,accountEvidence:account});
    });
    return dispatchOrReconcile(transferId);
  }
  return Object.freeze({
    status() { let active=false; try { gate(); active=true; } catch {} return { enabled: active, environment: environment ?? null, realAuthorityEnabled: active && environment==='PRODUCTION', ownershipClaimsEnabled: false, ownershipHistoryEnabled: false }; },
    async recordConsent(actor, input) { authorize(actor, ['SELLER']); await validated('CONSENT',actor,input); return await store.transaction(tx => recordHoldChoice(tx, { ...input, actor })); },
    async publishListing(actor, input) {
      authorize(actor, ['SELLER']);
      assertFulfillmentPolicy(fulfillmentPolicy, context);
      requireValue(fulfillmentPolicy.id === listingPolicy.id && fulfillmentPolicy.version === listingPolicy.version, 'FULFILLMENT_POLICY_MISMATCH');
      const assertion = await authority(input.cardId, actor.id);
      return await store.transaction(tx => createListing(tx, { requestId: input.requestId, listingId: idFor('listing', input.requestId), sellerId: actor.id, askingPriceCents: input.askingPriceCents, eligibility: assertion, policy: { ...listingPolicy, fulfillmentPolicy: clone(fulfillmentPolicy) } }));
    },
    async reviseListing(actor, input) {
      authorize(actor, ['SELLER']);
      const listing = await store.read(state => state.listings[input.listingId]); requireValue(listing?.sellerId === actor.id, 'LISTING_UNAVAILABLE');
      const assertion = await authority(listing.cardId, actor.id);
      return store.transaction(tx => { expireReservations(tx); return reviseListing(tx, { ...input, sellerId: actor.id, eligibility: assertion }); });
    },
    async withdrawListing(actor, input) {
      authorize(actor, ['SELLER']);
      return store.transaction(tx => { expireReservations(tx); return withdrawListing(tx, { ...input, sellerId: actor.id }); });
    },
    async cancelReservation(actor, input) {
      authorize(actor, ['BUYER']);
      return store.transaction(tx => cancelReservation(tx, { ...input, buyerId: actor.id }));
    },
    async expireReservations() { gate(); return store.transaction(tx => expireReservations(tx)); },
    async quote(actor, listingId) {
      authorize(actor, ['BUYER']);
      await store.transaction(tx => expireReservations(tx));
      const listing = await store.read(state => state.listings[listingId]); assertListingBinding(listing,context);
      requireValue(listing.status === 'ACTIVE', 'CARD_UNAVAILABLE');
      const quote = await quoteProvider({ listing: clone(listing), buyerId: actor.id, now: clock() });
      return await store.transaction(tx => {
        assertBuyerQuote(quote, tx.state.listings[listingId], tx.now,context);
        const quotes = tx.state.quotes ??= {};
        const record = { ...quote, buyerId: actor.id };
        requireValue(!quotes[quote.quoteId] || hash(quotes[quote.quoteId]) === hash(record), 'QUOTE_ID_CONFLICT');
        quotes[quote.quoteId] = record;
        return quote;
      });
    },
    async reserve(actor, input) {
      authorize(actor, ['BUYER']);
      const listing = await store.read(state => state.listings[input.listingId]); requireValue(listing, 'LISTING_UNAVAILABLE');
      const assertion = await authority(listing.cardId, listing.sellerId);
      return await store.transaction(tx => {
        const record = tx.state.quotes?.[input.quoteId]; requireValue(record?.buyerId === actor.id, 'QUOTE_REQUIRED');
        const { buyerId, ...quote } = record;
        return reserveListing(tx, { requestId: input.requestId, reservationId: idFor('reservation', input.requestId), listingId: listing.id, listingVersion: input.listingVersion, listingHash: input.listingHash, buyerId: actor.id, eligibility: assertion, quote });
      });
    },
    async pay(actor, { reservationId }) {
      const reservation = await buyerReservation(actor, reservationId);
      if (reservation.paymentIntentId) {
        const existing = await store.read(state => state.intents[reservation.paymentIntentId]);
        if (existing.status === 'PREPARED') {
          const assertion = await authority(reservation.cardId, reservation.sellerId);
          await store.transaction(tx => markReservationPaymentPending(tx, { reservationId, paymentIntentId: existing.id, eligibility: assertion }));
        }
        // The only undispatched state is the durable prepared intent. All other
        // states use exact retrieval; a retry cannot create another payment.
        return settle(await dispatchOrReconcile(existing.id), reservationId);
      }
      const assertion = await authority(reservation.cardId, reservation.sellerId);
      const paymentId = idFor('payment', reservation.id);
      await store.transaction(tx => {
        const current = tx.state.reservations[reservationId];
        const listing = tx.state.listings[current.listingId];
        preparePayment(tx, { intentId: paymentId, order: current.order, platformAccountId, connectedAccountId: listing.connectedAccountId, policy: financePolicy });
        markReservationPaymentPending(tx, { reservationId, paymentIntentId: paymentId, eligibility: assertion });
      });
      return settle(await dispatchOrReconcile(paymentId), reservationId);
    },
    async paymentCollection(actor,{reservationId}) {
      const reservation=await buyerReservation(actor,reservationId);
      requireValue(reservation.paymentIntentId,'PAYMENT_INTENT_REQUIRED');
      return {...await getPaymentCollection({store,provider,intentId:reservation.paymentIntentId,buyerId:actor.id,reservationId,enabled:true}),reservationId,intentId:reservation.paymentIntentId};
    },
    async catalog(actor,filters={}) { authorize(actor,['BUYER','SELLER','STAFF']); await store.transaction(tx=>expireReservations(tx)); return store.read(state=>catalogListings(state,filters,context)); },
    async publicCatalog(filters={}) { gate(); return store.read(state=>({...catalogListings(state,filters,context),environment})); },
    async evidence(actor,path) { authorize(actor,['BUYER','SELLER','STAFF']); requireValue(typeof readEvidence==='function','EVIDENCE_UNAVAILABLE'); return readEvidence({actor:clone(actor),path,context}); },
    async onboard(actor) {
      authorize(actor,['SELLER']); requireValue(typeof sellerAccount==='function'&&onboarding,'ONBOARDING_UNAVAILABLE');
      const binding=await sellerAccount(actor.id); requireValue(binding?.sellerId===actor.id&&binding.accountId,'SELLER_ACCOUNT_UNAVAILABLE');
      return provider.createOnboardingLink({...onboarding,accountId:binding.accountId,policyEvidence:binding.onboardingPolicy});
    },
    async reconcilePayment(actor, { reservationId }) {
      const reservation = await buyerReservation(actor, reservationId);
      requireValue(reservation.paymentIntentId, 'PAYMENT_INTENT_REQUIRED');
      return settle(await reconcileOriginal(reservation.paymentIntentId), reservationId);
    },
    async fulfill(actor, input) {
      authorize(actor, ['STAFF']); await validated('FULFILLMENT',actor,input);
      const result = await store.transaction(tx => recordFulfillment(tx, { ...input, actor, policy: fulfillmentPolicy }));
      if (input.action !== 'RELEASE') return result;
      await resumeTransfer(actor,{orderId:input.orderId});
      return await store.read(state => state.fulfillment[input.orderId]);
    },
    resumeTransfer,
    async withdraw(actor, { requestId, amountCents, externalAccountId }) {
      authorize(actor, ['SELLER']); domainId(requestId,'request',context);
      const payoutId = idFor('payout', { requestId, sellerId: actor.id });
      const prior = await store.read(state => state.intents[payoutId]);
      if (prior) {
        requireValue(prior.amountCents === amountCents && prior.externalAccountId === externalAccountId, 'IDEMPOTENCY_CONFLICT');
        if(prior.status==='PREPARED') await reconcileBeforePayout(prior.connectedAccountId);
        return dispatchOrReconcile(payoutId);
      }
      const orders = await store.read(state => Object.values(state.orders).filter(row => row.sellerId === actor.id));
      requireValue(orders.length > 0 && orders.every(row => row.connectedAccountId === orders[0].connectedAccountId), 'SELLER_ACCOUNT_UNAVAILABLE');
      const connectedAccountId = orders[0].connectedAccountId;
      await reconcileBeforePayout(connectedAccountId);
      const [accountEvidence, balanceEvidence] = await Promise.all([provider.getAccount(connectedAccountId), provider.getBalance(connectedAccountId)]);
      await store.transaction(tx => preparePayout(tx, { intentId: payoutId, sellerId: actor.id, connectedAccountId, externalAccountId, amountCents, allocationOrderIds: orders.map(row => row.orderId).sort(), accountEvidence, balanceEvidence }));
      return dispatchOrReconcile(payoutId);
    },
    async reconcileWithdrawal(actor, { intentId: id }) {
      authorize(actor, ['SELLER']);
      const current = await store.read(state => state.intents[id]);
      requireValue(current?.kind === 'PAYOUT' && current.sellerId === actor.id, 'INTENT_NOT_FOUND');
      return reconcileOriginal(id);
    },
    async openCase(actor, input) {
      authorize(actor, ['BUYER', 'SELLER', 'STAFF']);
      return await store.transaction(tx => {
        const result = openProtectionCase(tx, { ...input, actor });
        const order = tx.state.orders[input.orderId];
        recordHold(tx, { holdId: result.id, orderId: input.orderId, reason: result.kind, evidenceRef: input.evidenceRef, amountCents: order.sellerNetCents });
        return result;
      });
    },
    async resolveCase(actor, input) {
      authorize(actor, ['STAFF']); await validated('CASE_RESOLUTION',actor,input);
      return await store.transaction(tx => {
        const result = resolveProtectionCase(tx, { ...input, actor });
        releaseHold(tx, { holdId: input.caseId, evidenceRef: input.evidence.ref });
        return result;
      });
    },
    async refundCase(actor, input) {
      authorize(actor, ['STAFF']); await validated('REFUND_REVIEW',actor,input);
      const refundId = idFor('refund', { orderId: input.orderId, caseId: input.caseId });
      await store.transaction(tx => {
        const obligation = recordRefundObligation(tx, { ...input, actor });
        const order = tx.state.orders[input.orderId];
        prepareRefund(tx, { intentId: refundId, paymentIntentId: order.paymentIntentId, amountCents: obligation.amountCents, allocations: obligation.allocations,
          policyEvidence: { approved: true, orderId: order.orderId, caseId: input.caseId, obligationHash: obligation.hash, policyVersion: obligation.policyVersion, evidenceRef: obligation.reviewRef } });
      });
      return dispatchOrReconcile(refundId);
    },
    async reconcileRefund(actor, { orderId, caseId }) {
      authorize(actor, ['STAFF']);
      return reconcileOriginal(idFor('refund', { orderId, caseId }));
    },
    async balance(actor) { authorize(actor, ['SELLER']); return await store.read(state => sellerBalance(state, actor.id)); },
    async receiveProviderWebhook({rawBody,signature}) {
      gate(); requireValue(typeof webhook?.secret==='string','WEBHOOK_UNAVAILABLE');
      const result=await handleFinanceWebhook({store,provider,rawBody,signature,secret:webhook.secret,platformAccountId,now:clock(),enabled:true,expectedLivemode:environment==='PRODUCTION',resolveDisputePolicy:webhook.resolveDisputePolicy});
      // Completing the order is a separate idempotent commit. If it fails, the
      // endpoint fails and redelivery retrieves and settles the same payment.
      const paymentCandidate=result.affectedPaymentIntentId??result.intentId;
      if(paymentCandidate) {
        const intent=await store.read(state=>state.intents[paymentCandidate]);
        if(intent?.kind==='PAYMENT'&&intent.order?.reservationId) await settle(intent,intent.order.reservationId);
      }
      return {eventId:result.eventId,status:result.status};
    },
    async workspace(actor) {
      authorize(actor,['SELLER','BUYER','STAFF']);
      await store.transaction(tx=>expireReservations(tx));
      let sellerEligibility=null;
      if(actor.role==='SELLER') {
        const binding=typeof sellerAccount==='function'?await sellerAccount(actor.id):null;
        const accounts=binding?.sellerId===actor.id?[binding.accountId]:await store.read(state=>[...new Set(Object.values(state.listings).filter(row=>row.sellerId===actor.id).map(row=>row.connectedAccountId))]);
        if(accounts.length===1) {
          try {
            const account=await provider.getAccount(accounts[0]);
            const bankIds=account.payoutEligibleExternalAccountIds??(environment==='SYNTHETIC_LOCAL'?account.verifiedExternalAccountIds:[])??[];
            const ready=account.requirementsSatisfied&&account.transfersActive&&account.payoutsEnabled&&account.manualPayouts&&bankIds.length>0;
            sellerEligibility={status:ready?'ELIGIBLE':'RESTRICTED',chargesEnabled:account.chargesEnabled===true,transfersEnabled:account.transfersActive,payoutsEnabled:account.payoutsEnabled,
              bank:{status:ready?'PAYOUT_READY':'UNAVAILABLE',label:'Stripe payout destination',externalAccountId:ready?bankIds[0]:null},
              banks:ready?bankIds.map(id=>({id,label:'Stripe payout destination',status:'PAYOUT_READY'})):[],
              requirements:Array.isArray(account.requirements)?account.requirements:[...(account.requirements?.currentlyDue??[]),...(account.requirements?.pastDue??[]),...(account.requirements?.pendingVerification??[])],observedAt:account.observedAt,
              reason:ready?null:'Account, manual payout or bank requirements remain'};
          } catch {
            sellerEligibility={status:'UNAVAILABLE',chargesEnabled:false,transfersEnabled:false,payoutsEnabled:false,bank:{status:'UNAVAILABLE',label:'Payout destination unavailable'},banks:[],requirements:[],observedAt:clock(),reason:'Stripe account eligibility is unavailable. Saved orders remain visible; refresh before requesting a payout.'};
          }
        } else sellerEligibility={status:'UNAVAILABLE',chargesEnabled:false,transfersEnabled:false,payoutsEnabled:false,bank:{status:'UNAVAILABLE',label:'No qualified bank'},requirements:[],observedAt:clock(),reason:'Seller account is not bound'};
      }
      const eligible=actor.role==='SELLER'&&typeof eligibility.list==='function'?await eligibility.list({sellerId:actor.id}):null;
      const eligibilityCards=eligible?.available===true?eligible.cards:[];
      return store.read(state=>projectMarketplaceWorkspace(state,actor,{now:clock(),sellerEligibility,environment,policy:listingPolicy,eligibilityCards}));
    },
    async staffQueue(actor,filters={}) { authorize(actor,['STAFF']); return store.read(state=>projectStaffQueue(state,{...filters,...(filters.offset!==undefined?{offset:Number(filters.offset)}:{}),...(filters.limit!==undefined?{limit:Number(filters.limit)}:{})})); },
    async reconcileFinance(actor,{intentIds,limit=100}={}) {
      authorize(actor,['STAFF']); requireValue(intentIds===undefined||Array.isArray(intentIds)&&intentIds.length<=100&&intentIds.every(id=>typeof id==='string'),'INVALID_REQUEST');
      const results=await reconcilePendingFinance({store,provider,intentIds,limit,enabled:true});
      for(const result of results) {
        const intent=await store.read(state=>state.intents[result.intentId]);
        if(intent?.kind==='PAYMENT'&&intent.order?.reservationId) await settle(intent,intent.order.reservationId);
      }
      return results;
    },
    async metrics(actor) { authorize(actor,['STAFF']); return store.read(state=>marketplaceOperations(state)); },
    async localSnapshot() { gate(); requireValue(environment==='SYNTHETIC_LOCAL','LOCAL_STORE_ONLY'); return await store.read(); },
  });
}
