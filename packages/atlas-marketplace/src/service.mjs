import {assertMarketplaceRequestAuthority,refreshMarketplaceRequestAuthority,currentMarketplaceRequestAuthority} from './request-authority.mjs';
import { clone, hash, requireValue, cents } from './contract.mjs';
import {assertR1ProofAuthorityProducer} from './proof-authority-r1.mjs';
import {assertMarketplaceProofIntake,PROOF_EVIDENCE_KINDS} from './proof-intake.mjs';
import {assertShippingLifecycle} from './shipping-lifecycle.mjs';
import { createUnavailableEligibilityAdapter } from './eligibility.mjs';
import { createListing, assertListingBinding, reviseListing, withdrawListing } from './listing.mjs';
import { assertBuyerQuote, reserveListing, markReservationPaymentPending, settleReservation, releaseReservation, cancelReservation, expireReservations } from './reservation.mjs';
import { preparePayment, prepareTransfer, preparePayout, prepareRefund, sellerBalance, recordHold, releaseHold, voidPreparedPayment,voidPreparedPayout } from './finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent, getPaymentCollection } from './payment.mjs';
import { assertFulfillmentPolicy, ensureFulfillmentState, recordHoldChoice, recordFulfillment, openProtectionCase, reviewReturnRequest, recordRefundObligation, resolveProtectionCase } from './fulfillment.mjs';
import { authorityContext, authorityId, domainId } from './authority-context.mjs';
import { catalogListings } from './catalog.mjs';
import { reconcileAccount, reconcilePendingFinance } from './reconciliation.mjs';
import { randomUUID } from 'node:crypto';
import { handleFinanceWebhook, scopedWebhookBinding, verifyScopedRawWebhook } from './webhook.mjs';
import { projectMarketplaceWorkspace, projectStaffQueue, marketplaceOperations } from './projections.mjs';
import { assertRecoverySettlementCapability } from './recovery-settlement.mjs';
import { reviewOperationalAlert } from './finance-alerts.mjs';
import {createInstantPayoutQuote,settleInstantProviderFees} from './payout-instant.mjs';
import {boundedOperationalCall} from './finance-scheduler.mjs';
import {assertMarketplaceDestinations} from './destinations.mjs';
import {assertStripeTaxLifecycle} from './tax-lifecycle.mjs';
import {retainTaxRequirement,assertOrderTaxComplete,projectTaxReporting} from './tax-obligations.mjs';

export const intentId = (kind, value, context) => `${authorityContext(context).environment === 'SYNTHETIC_LOCAL' ? 'demo_' : 'atlas_'}${kind}_${hash(value).slice(0, 32)}`;

// Trusted composition boundary. No production auth, eligibility or credentials
// are discovered here. Every runtime must explicitly provide its own ports.
export function createMarketplacePilot({ enabled = false, environment, store, eligibility = createUnavailableEligibilityAdapter(), quoteProvider, destinations, taxLifecycle, proofIntake, proofAuthority, shippingLifecycle, feeCalculator, instantPolicy,assertInstantPayoutReady,quoteInstantPayoutFee,readInstantFeeSettlement, provider, listingPolicy, financePolicy, fulfillmentPolicy, platformAccountId, context: suppliedContext, runtimeApproval, assertRuntimeReady, sellerAccount, onboarding, readEvidence, validateEvidence, webhook, recoverySettlementCapability, clock = Date.now } = {}) {
  const context = authorityContext(suppliedContext), rawStore = store;
  if (rawStore) store = { read: (...args) => rawStore.read(...args), transaction: fn => rawStore.transaction(tx => fn({ ...tx, context })) };
  const idFor = (kind,value) => intentId(kind,value,context);
  function destinationReady(){gate();return assertMarketplaceDestinations(destinations,{store:rawStore,context});}
  function taxReady(){gate();return assertStripeTaxLifecycle(taxLifecycle,{store:rawStore,environment,platformAccountId});}
  const instantPolicyHash=instantPolicy?hash(instantPolicy):null,instantIo=new Set();
  function instantReady(requested) {
    gate();requireValue(instantPolicy?.enabled===true&&hash(instantPolicy)===instantPolicyHash&&instantPolicy.platformAccountId===platformAccountId&&instantPolicy.environment===financePolicy.environment&&typeof assertInstantPayoutReady==='function','INSTANT_PAYOUT_UNAVAILABLE');
    if(requested)requireValue(hash(requested)===hash({policyHash:instantPolicyHash,environment:instantPolicy.environment,platformAccountId}),'INSTANT_PAYOUT_POLICY_CHANGED');
    const result=assertInstantPayoutReady({policyHash:instantPolicyHash,environment:instantPolicy.environment,platformAccountId});
    if(result&&typeof result.then==='function')void Promise.resolve(result).catch(()=>{});
    requireValue(result===true,'INSTANT_PAYOUT_UNAVAILABLE');return true;
  }
  async function instantPort(port,input) {
    instantReady();requireValue(typeof port==='function'&&instantIo.size<2,'INSTANT_PAYOUT_PORT_UNAVAILABLE');
    return boundedOperationalCall(signal=>{instantReady();requireValue(instantIo.size<2,'INSTANT_PAYOUT_PORT_UNAVAILABLE');const operation=Promise.resolve().then(()=>port({...input,signal}));instantIo.add(operation);operation.then(()=>instantIo.delete(operation),()=>instantIo.delete(operation));return operation;},{timeoutMs:20000,code:'INSTANT_PAYOUT_PORT_TIMEOUT'});
  }
  const approvalBinding = () => ({ environment, platformAccountId, listingPolicyHash:hash(listingPolicy), financePolicyHash:hash(financePolicy), fulfillmentPolicyHash:hash(fulfillmentPolicy), qualificationRefs:context.qualificationRefs });
  function gate() {
    assertMarketplaceRequestAuthority();
    requireValue(enabled === true && environment === context.environment, 'MARKETPLACE_DISABLED');
    if(environment !== 'SYNTHETIC_LOCAL') {
      requireValue(runtimeApproval?.approved===true && hash(runtimeApproval.binding)===hash(approvalBinding()) && typeof assertRuntimeReady==='function' && assertRuntimeReady(approvalBinding())===true, 'RUNTIME_QUALIFICATION_REQUIRED');
      requireValue(financePolicy?.environment === (environment==='PRODUCTION'?'stripe-production':'stripe-sandbox'), 'FINANCE_POLICY_REQUIRED');
    }
  }
  function authorize(actor, roles) { gate();assertMarketplaceRequestAuthority(actor); authorityId(actor?.id,'actor',context); requireValue(roles.includes(actor?.role), 'FORBIDDEN'); }
  function proofReady(){gate();if(proofAuthority)assertR1ProofAuthorityProducer(proofAuthority);return assertMarketplaceProofIntake(proofIntake,{store:rawStore,context});}
  function shippingReady(){gate();return assertShippingLifecycle(shippingLifecycle,{store:rawStore,environment});}
  function physicalRequirements(state,orderId,expectedBinding) {
    const saved=state.marketplacePhysicalRequirements?.[orderId];
    const proofs=Object.values(state.marketplaceProofUploads??{}).filter(row=>row.orderId===orderId);
    const shipments=Object.values(state.shippingLifecycle??{}).filter(row=>row.orderId===orderId);
    if(saved?.proofBindingHash||proofs.length){const proof=proofReady();requireValue((!saved?.proofBindingHash||saved.proofBindingHash===hash(proof.binding))&&proofs.every(row=>row.policyHash===proof.binding.policyHash),'PROOF_REQUIREMENT_CHANGED');proof.assertReady();}
    if(saved?.shippingBindingHash||shipments.length){const shipping=shippingReady();requireValue((!saved?.shippingBindingHash||saved.shippingBindingHash===hash(shipping.binding))&&shipments.every(row=>row.bindingHash===hash(shipping.binding)),'SHIPPING_REQUIREMENT_CHANGED');}
    if(saved)requireValue(saved.orderBindingHash===(state.orders[orderId]?.bindingHash??expectedBinding),'PHYSICAL_ORDER_CHANGED');
  }
  function retainPhysicalRequirements(tx,orderId,orderBindingHash=tx.state.orders[orderId]?.bindingHash) {
    physicalRequirements(tx.state,orderId,orderBindingHash);
    if(!proofIntake&&!shippingLifecycle)return;
    const row={orderBindingHash,proofBindingHash:proofIntake?hash(proofReady().binding):null,shippingBindingHash:shippingLifecycle?hash(shippingReady().binding):null};
    const rows=tx.state.marketplacePhysicalRequirements??={};if(rows[orderId])requireValue(hash(rows[orderId])===hash(row),'PHYSICAL_REQUIREMENT_CHANGED');else rows[orderId]=row;
  }
  function physicalValidator(kind,input,caseKind) {
    if(['CASE_RESOLUTION','REFUND_REVIEW'].includes(kind)&&caseKind!=='RETURN')return null;
    if(kind==='FULFILLMENT'&&['DISPATCH','DELIVER'].includes(input.action)&&shippingLifecycle)return shippingReady();
    if(proofIntake&&PROOF_EVIDENCE_KINDS.includes(kind)&&!(kind==='FULFILLMENT'&&['DISPATCH','DELIVER'].includes(input.action)))return proofReady();
    return null;
  }
  async function validated(kind,actor,input) {
    if(input.orderId)await store.read(state=>physicalRequirements(state,input.orderId));
    const caseKind=['CASE_RESOLUTION','REFUND_REVIEW'].includes(kind)?await store.read(state=>state.fulfillment[input.orderId]?.cases.find(row=>row.id===input.caseId)?.kind):null;
    const physical=physicalValidator(kind,input,caseKind);
    if(physical)requireValue(await physical.validateEvidence({kind,actor:clone(actor),input:clone(input),context},{refreshAuthorization:refreshMarketplaceRequestAuthority,authorizeCommit:()=>{authorize(actor,['BUYER','STAFF']);return true;}})===true,'EVIDENCE_UNAVAILABLE');
    // Artifact suitability never substitutes for the independent business/financial decision.
    if(environment!=='SYNTHETIC_LOCAL'&&(!physical||['RETURN_REQUEST_REVIEW','REFUND_REVIEW','CASE_RESOLUTION'].includes(kind)||kind==='FULFILLMENT'&&input.action==='RELEASE')) requireValue(typeof validateEvidence==='function'&&await validateEvidence({kind,actor:clone(actor),input:clone(input),context})===true,'EVIDENCE_UNAVAILABLE');
  }
  function physicalCommit(tx,kind,actor,input) {
    retainPhysicalRequirements(tx,input.orderId);
    physicalValidator(kind,input,tx.state.fulfillment[input.orderId]?.cases?.find(row=>row.id===input.caseId)?.kind)?.assertInTransaction(tx,{kind,actor,input});
    if(shippingLifecycle&&kind==='FULFILLMENT'&&input.action==='RELEASE')shippingReady().assertInTransaction(tx,{kind,actor,input});
  }
  const proofAuthorization=actor=>({refreshAuthorization:refreshMarketplaceRequestAuthority,authorizeCommit:()=>{authorize(actor,['BUYER','STAFF']);return true;}});
  const shippingAuthorization=actor=>({refreshAuthorization:refreshMarketplaceRequestAuthority,authorizeCommit:()=>{authorize(actor,['STAFF']);return true;}});
  async function authority(cardId, sellerId) {
    const result = await eligibility.read({ cardId, sellerId });
    requireValue(result?.available === true, 'ELIGIBILITY_UNAVAILABLE');
    return result.assertion;
  }
  function syncReceipt(result,receipt,code) {
    if(result&&typeof result.then==='function')void Promise.resolve(result).catch(()=>{});
    requireValue(result===receipt,code);
  }
  function sellerFee(tx, actor, input, listing=null) {
    const policy=listing?.policy??{...listingPolicy,fulfillmentPolicy:clone(fulfillmentPolicy)};
    if(!policy.feeSchedule) {requireValue(input.feeQuoteId===undefined,'FEE_QUOTE_UNEXPECTED');return undefined;}
    requireValue(feeCalculator?.enabled===true,'FEE_CALCULATOR_UNAVAILABLE');
    const receipt=tx.state.feeQuotes?.[input.feeQuoteId];
    requireValue(receipt?.sellerId===actor.id,'FEE_QUOTE_REQUIRED');
    const replay=tx.state.receipts[`${listing?'listing-revise':'listing'}:${input.requestId}`];
    if(!replay)syncReceipt(feeCalculator.assertCurrent(receipt,{policy,cardId:listing?.cardId??input.cardId,sellerId:actor.id,askingPriceCents:input.askingPriceCents,
      listingId:listing?.id??null,listingVersion:listing?.version??0,listingHash:listing?.bindingHash??null},tx.now),receipt,'FEE_CALCULATOR_UNAVAILABLE');
    return receipt;
  }
  function currentCheckout(tx,quote,listing,buyerId) {
    if(quoteProvider?.destinationRequired===true)requireValue(quote?.schema==='atlas-checkout-quote-v1','CHECKOUT_QUOTE_REQUIRED');
    if(quote?.schema==='atlas-checkout-quote-v1') {
      requireValue(typeof quoteProvider?.assertCurrent==='function','CHECKOUT_QUOTE_UNAVAILABLE');
      syncReceipt(quoteProvider.assertCurrent(quote,{listing,buyerId},tx.now),quote,'CHECKOUT_QUOTE_UNAVAILABLE');
      if(destinations)destinationReady().assertInTransaction(tx,quote.destination,{buyerId});
    }
  }
  async function buyerReservation(actor, reservationId) {
    authorize(actor, ['BUYER']);
    const reservation = await store.read(state => state.reservations[reservationId]);
    requireValue(reservation?.buyerId === actor.id, 'RESERVATION_NOT_FOUND');
    return reservation;
  }
  async function settle(intent, reservationId, authorizeCommit) {
    return await store.transaction(tx => {
      if (authorizeCommit) authorizeCommit();
      const reservation = tx.state.reservations[reservationId];
      if (intent.status === 'SUCCEEDED') {
        const order = settleReservation(tx, { reservationId, paymentIntentId: intent.id, orderId: reservation.orderId });
        ensureFulfillmentState(tx, order.orderId);retainPhysicalRequirements(tx,order.orderId);
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
      ? executeFinanceIntent({ store, provider, intentId: id, enabled: true,
        assertDispatchReady:(tx,intent)=>{
          gate();
          if(intent.kind==='TRANSFER') {
            physicalRequirements(tx.state,intent.orderId);assertOrderTaxComplete(tx,intent.orderId);
            if(shippingLifecycle)shippingReady().assertInTransaction(tx,{kind:'FULFILLMENT',input:{orderId:intent.orderId,action:'RELEASE'}});
            const fulfillment=tx.state.fulfillment[intent.orderId];
            requireValue(fulfillment?.status==='RELEASED'&&!fulfillment.cases.some(row=>row.status!=='CLOSED')&&hash(fulfillment.releaseEvidence)===hash(intent.releaseEvidence),'PROTECTION_HOLD');
          }
          return true;
        },
        assertInstantPayoutReady:instantReady,
        assertPaymentReady:(tx,intent)=>{gate();const reservation=tx.state.reservations[intent.order.reservationId];requireValue(reservation?.paymentIntentId===intent.id,'RESERVATION_NOT_FOUND');currentCheckout(tx,reservation.quote,tx.state.listings[reservation.listingId],reservation.buyerId);physicalRequirements(tx.state,reservation.orderId,reservation.order.bindingHash);return true;}
      })
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
      authorize(actor,['STAFF']);physicalRequirements(tx.state,orderId);assertOrderTaxComplete(tx,orderId);
      if(shippingLifecycle)shippingReady().assertInTransaction(tx,{kind:'FULFILLMENT',actor,input:{orderId,action:'RELEASE'}});
      const current=tx.state.fulfillment[orderId];
      requireValue(current?.status==='RELEASED'&&!current.cases.some(row=>row.status!=='CLOSED'),'PROTECTION_HOLD');
      if(!tx.state.intents[transferId]) prepareTransfer(tx,{intentId:transferId,paymentIntentId:order.paymentIntentId,releaseEvidence:current.releaseEvidence,accountEvidence:account});
    });
    return dispatchOrReconcile(transferId);
  }
  return Object.freeze({
    // Runtime qualification never establishes global title/custody authority.
    // Each sale action must independently obtain its exact current assertion.
    status() { let active=false; try { gate(); active=true; } catch {} return { enabled: active, environment: environment ?? null, realAuthorityEnabled: false, authorityStatus: 'PER_ACTION_VERIFICATION_REQUIRED', ownershipClaimsEnabled: false, ownershipHistoryEnabled: false }; },
    async prepareProof(actor,input){authorize(actor,['BUYER','STAFF']);proofReady();if(proofAuthority)return proofAuthority.prepare(currentMarketplaceRequestAuthority(),input);return proofIntake.prepare(actor,input,proofAuthorization(actor));},
    async uploadProof(actor,input){authorize(actor,['BUYER','STAFF']);proofReady();if(proofAuthority)return proofAuthority.upload(currentMarketplaceRequestAuthority(),input);return proofIntake.upload(actor,input,proofAuthorization(actor));},
    async recoverProof(actor,input){authorize(actor,['BUYER','STAFF']);proofReady();if(proofAuthority)return proofAuthority.recover(currentMarketplaceRequestAuthority(),input);return proofIntake.recover(actor,input,proofAuthorization(actor));},
    async readProof(actor,input){authorize(actor,['BUYER','STAFF']);return proofReady().read(actor,input,proofAuthorization(actor));},
    async listProofs(actor,input){authorize(actor,['BUYER','STAFF']);return proofReady().list(actor,input,proofAuthorization(actor));},
    async reviewProof(actor,input){authorize(actor,['STAFF']);return proofReady().review(actor,input,proofAuthorization(actor));},
    async retainIssuedShipment(actor,input){authorize(actor,['STAFF']);return shippingReady().retainIssued(input,shippingAuthorization(actor));},
    async syncShipmentTracking(actor,input){authorize(actor,['STAFF']);return shippingReady().syncTracking(input,shippingAuthorization(actor));},
    async shipmentStatus(actor,input){authorize(actor,['STAFF']);const value=await shippingReady().status(input,shippingAuthorization(actor));authorize(actor,['STAFF']);return value;},
    async missingShipmentScans(actor,input){authorize(actor,['STAFF']);const value=await shippingReady().missingScans(input,shippingAuthorization(actor));authorize(actor,['STAFF']);return value;},
    async recordCarrierMilestone(actor,{requestId,orderId,action}) {
      authorize(actor,['STAFF']);requireValue(['DISPATCH','DELIVER'].includes(action),'UNKNOWN_FULFILLMENT_ACTION');
      const shipping=shippingReady(),evidence=await shipping[action==='DISPATCH'?'dispatchEvidence':'deliveryEvidence']({orderId},shippingAuthorization(actor));
      const input={requestId,orderId,action,evidence};await validated('FULFILLMENT',actor,input);
      return store.transaction(tx=>{authorize(actor,['STAFF']);physicalCommit(tx,'FULFILLMENT',actor,input);return recordFulfillment(tx,{...input,actor,policy:fulfillmentPolicy});});
    },
    async saveDestination(actor,input){authorize(actor,['BUYER']);destinationReady();return store.transaction(tx=>{authorize(actor,['BUYER']);return destinationReady().save(tx,{...input,buyerId:actor.id});});},
    async removeDestination(actor,input){authorize(actor,['BUYER']);destinationReady();return store.transaction(tx=>{authorize(actor,['BUYER']);return destinationReady().remove(tx,{...input,buyerId:actor.id});});},
    async deliveryDestination(actor,input){authorize(actor,['STAFF']);destinationReady();return store.transaction(tx=>{authorize(actor,['STAFF']);return destinationReady().readOrderAddress(tx,{...input,actorId:actor.id});});},
    async recordConsent(actor, input) { authorize(actor, ['SELLER']); await validated('CONSENT',actor,input); return await store.transaction(tx => recordHoldChoice(tx, { ...input, actor })); },
    async previewListingFee(actor,input) {
      authorize(actor,['SELLER']);requireValue(feeCalculator?.enabled===true,'FEE_CALCULATOR_UNAVAILABLE');
      const listing=input.listingId?await store.read(state=>state.listings[input.listingId]):null;
      if(input.listingId)requireValue(listing?.sellerId===actor.id&&listing.cardId===input.cardId,'LISTING_UNAVAILABLE');
      const binding={policy:listing?.policy??{...listingPolicy,fulfillmentPolicy:clone(fulfillmentPolicy)},cardId:input.cardId,sellerId:actor.id,askingPriceCents:input.askingPriceCents,
        listingId:listing?.id??null,listingVersion:listing?.version??0,listingHash:listing?.bindingHash??null};
      const receipt=feeCalculator.preview(binding);
      return store.transaction(tx=>{authorize(actor,['SELLER']);syncReceipt(feeCalculator.assertCurrent(receipt,binding,tx.now),receipt,'FEE_CALCULATOR_UNAVAILABLE');
        if(listing)requireValue(tx.state.listings[listing.id]?.bindingHash===listing.bindingHash,'LISTING_CHANGED');
        const records=tx.state.feeQuotes??={};requireValue(!records[receipt.id]||hash(records[receipt.id])===hash(receipt),'FEE_QUOTE_ID_CONFLICT');records[receipt.id]=clone(receipt);return receipt;});
    },
    async publishListing(actor, input) {
      authorize(actor, ['SELLER']);
      assertFulfillmentPolicy(fulfillmentPolicy, context);
      requireValue(fulfillmentPolicy.id === listingPolicy.id && fulfillmentPolicy.version === listingPolicy.version, 'FULFILLMENT_POLICY_MISMATCH');
      const assertion = await authority(input.cardId, actor.id);
      return await store.transaction(tx => {authorize(actor,['SELLER']);const feeQuote=sellerFee(tx,actor,input);return createListing(tx, { requestId: input.requestId, listingId: idFor('listing', input.requestId), sellerId: actor.id, askingPriceCents: input.askingPriceCents, eligibility: assertion, policy: { ...listingPolicy, fulfillmentPolicy: clone(fulfillmentPolicy) },...(feeQuote?{feeQuote}:{}) });});
    },
    async reviseListing(actor, input) {
      authorize(actor, ['SELLER']);
      const listing = await store.read(state => state.listings[input.listingId]); requireValue(listing?.sellerId === actor.id, 'LISTING_UNAVAILABLE');
      const assertion = await authority(listing.cardId, actor.id);
      return store.transaction(tx => { authorize(actor,['SELLER']);expireReservations(tx);const feeQuote=sellerFee(tx,actor,input,tx.state.listings[listing.id]); return reviseListing(tx, { ...input, sellerId: actor.id, eligibility: assertion,...(feeQuote?{feeQuote}:{}) }); });
    },
    async withdrawListing(actor, input) {
      authorize(actor, ['SELLER']);
      return store.transaction(tx => { expireReservations(tx); return withdrawListing(tx, { ...input, sellerId: actor.id }); });
    },
    async cancelReservation(actor, input) {
      authorize(actor, ['BUYER']);
      return store.transaction(tx => {
        const reservation=tx.state.reservations[input.reservationId];requireValue(reservation?.buyerId===actor.id,'RESERVATION_NOT_FOUND');
        if(reservation.paymentIntentId)voidPreparedPayment(tx,{intentId:reservation.paymentIntentId});
        return cancelReservation(tx, { ...input, buyerId: actor.id });
      });
    },
    async expireReservations() { gate(); return store.transaction(tx => expireReservations(tx)); },
    async quote(actor, selection) {
      authorize(actor, ['BUYER']);
      const {listingId,destinationId}=typeof selection==='string'?{listingId:selection}:selection??{};
      await store.transaction(tx => expireReservations(tx));
      const listing = await store.read(state => state.listings[listingId]); assertListingBinding(listing,context);
      requireValue(listing.status === 'ACTIVE', 'CARD_UNAVAILABLE');
      const quote = await quoteProvider({ listing: clone(listing), buyerId: actor.id, destinationId, now: clock() });
      return await store.transaction(tx => {
        authorize(actor,['BUYER']);currentCheckout(tx,quote,tx.state.listings[listingId],actor.id);
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
        const { buyerId, ...legacyQuote } = record;
        const quote=record.schema==='atlas-checkout-quote-v1'?record:legacyQuote;
        if(!tx.state.receipts[`reservation:${input.requestId}`])currentCheckout(tx,quote,tx.state.listings[listing.id],actor.id);
        const result=reserveListing(tx, { requestId: input.requestId, reservationId: idFor('reservation', input.requestId), listingId: listing.id, listingVersion: input.listingVersion, listingHash: input.listingHash, buyerId: actor.id, eligibility: assertion, quote });
        if(destinations)destinationReady().retainForReservation(tx,{reservationId:result.id,buyerId:actor.id,destination:quote.destination});
        if(taxLifecycle)retainTaxRequirement(tx,{reservation:result,binding:taxReady()});retainPhysicalRequirements(tx,result.orderId,result.order.bindingHash);return result;
      });
    },
    async pay(actor, { reservationId }) {
      const reservation = await buyerReservation(actor, reservationId);
      if (reservation.paymentIntentId) {
        const existing = await store.read(state => state.intents[reservation.paymentIntentId]);
        requireValue(existing.status!=='VOIDED','PAYMENT_VOIDED');
        if (existing.status === 'PREPARED') {
          const assertion = await authority(reservation.cardId, reservation.sellerId);
          await store.transaction(tx => {authorize(actor,['BUYER']);currentCheckout(tx,tx.state.reservations[reservationId].quote,tx.state.listings[reservation.listingId],actor.id);return markReservationPaymentPending(tx, { reservationId, paymentIntentId: existing.id, eligibility: assertion });});
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
        authorize(actor,['BUYER']);currentCheckout(tx,current.quote,listing,actor.id);
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
      const original=await store.read(state=>state.intents[reservation.paymentIntentId]);
      if(original?.status==='VOIDED') {requireValue(reservation.status==='RELEASED'&&original.locallyVoided===true,'PAYMENT_LOCAL_VOID_REFUSED');return clone(reservation);}
      return settle(await reconcileOriginal(reservation.paymentIntentId), reservationId);
    },
    async fulfill(actor, input) {
      authorize(actor, ['STAFF']); await validated('FULFILLMENT',actor,input);
      const result = await store.transaction(tx => {authorize(actor,['STAFF']);physicalCommit(tx,'FULFILLMENT',actor,input);return recordFulfillment(tx, { ...input, actor, policy: fulfillmentPolicy });});
      if (input.action !== 'RELEASE') return result;
      await resumeTransfer(actor,{orderId:input.orderId});
      return await store.read(state => state.fulfillment[input.orderId]);
    },
    resumeTransfer,
    async quoteWithdrawal(actor,{amountCents,externalAccountId,method}) {
      authorize(actor,['SELLER']);requireValue(method==='instant','WITHDRAWAL_METHOD_UNSUPPORTED');instantReady();
      cents(amountCents,{positive:true});domainId(externalAccountId,'bank',context);
      const orders=await store.read(state=>Object.values(state.orders).filter(row=>row.sellerId===actor.id));
      requireValue(orders.length&&orders.every(row=>row.connectedAccountId===orders[0].connectedAccountId),'SELLER_ACCOUNT_UNAVAILABLE');
      const connectedAccountId=orders[0].connectedAccountId;
      requireValue(typeof provider.getInstantPayoutEligibility==='function','INSTANT_PAYOUT_UNAVAILABLE');
      const eligibilityEvidence=await provider.getInstantPayoutEligibility(connectedAccountId,{externalAccountId});
      const feeEvidence=await instantPort(quoteInstantPayoutFee,{sellerId:actor.id,connectedAccountId,externalAccountId,amountCents,policyHash:instantPolicyHash,environment,platformAccountId});
      await validated('INSTANT_PAYOUT_QUOTE',actor,{amountCents,externalAccountId,connectedAccountId,eligibilityEvidence,feeEvidence});
      return store.transaction(tx=>{authorize(actor,['SELLER']);instantReady();return createInstantPayoutQuote(tx,{quoteId:idFor('payout_quote',{sellerId:actor.id,nonce:randomUUID()}),sellerId:actor.id,connectedAccountId,externalAccountId,amountCents,policy:instantPolicy,eligibilityEvidence,feeEvidence});});
    },
    async withdraw(actor, { requestId, amountCents, externalAccountId,method='standard',quoteId }) {
      authorize(actor, ['SELLER']); domainId(requestId,'request',context);
      requireValue(['standard','instant'].includes(method)&&(method==='instant'||quoteId===undefined),'WITHDRAWAL_METHOD_UNSUPPORTED');
      const payoutId = idFor('payout', { requestId, sellerId: actor.id });
      const prior = await store.read(state => state.intents[payoutId]);
      if (prior) {
        requireValue(prior.amountCents === amountCents && prior.externalAccountId === externalAccountId&&(prior.method??'standard')===method&&(method!=='instant'||prior.instantQuote?.quoteId===quoteId), 'IDEMPOTENCY_CONFLICT');
        if(prior.status==='VOIDED'){requireValue(prior.locallyVoided===true,'PAYOUT_LOCAL_VOID_REFUSED');return prior;}
        if(prior.status==='PREPARED') await reconcileBeforePayout(prior.connectedAccountId);
        return dispatchOrReconcile(payoutId);
      }
      const orders = await store.read(state => Object.values(state.orders).filter(row => row.sellerId === actor.id));
      requireValue(orders.length > 0 && orders.every(row => row.connectedAccountId === orders[0].connectedAccountId), 'SELLER_ACCOUNT_UNAVAILABLE');
      const connectedAccountId = orders[0].connectedAccountId;
      await reconcileBeforePayout(connectedAccountId);
      const [accountEvidence, balanceEvidence] = await Promise.all([provider.getAccount(connectedAccountId), provider.getBalance(connectedAccountId)]);
      let instantEvidence;
      if(method==='instant'){instantReady();instantEvidence=await provider.getInstantPayoutEligibility(connectedAccountId,{externalAccountId});}
      await store.transaction(tx => {authorize(actor,['SELLER']);if(method==='instant')instantReady();return preparePayout(tx, { intentId: payoutId, sellerId: actor.id, connectedAccountId, externalAccountId, amountCents, allocationOrderIds: orders.map(row => row.orderId).sort(), accountEvidence, balanceEvidence,...(method==='instant'?{method,quoteId,instantPolicy,instantEvidence}:{}) });});
      return dispatchOrReconcile(payoutId);
    },
    async reconcileWithdrawal(actor, { intentId: id }) {
      authorize(actor, ['SELLER']);
      const current = await store.read(state => state.intents[id]);
      requireValue(current?.kind === 'PAYOUT' && current.sellerId === actor.id, 'INTENT_NOT_FOUND');
      if(current.status==='VOIDED'){requireValue(current.locallyVoided===true,'PAYOUT_LOCAL_VOID_REFUSED');return current;}
      return reconcileOriginal(id);
    },
    async cancelWithdrawal(actor,{intentId:id}) {
      authorize(actor,['SELLER']);
      return store.transaction(tx=>{authorize(actor,['SELLER']);const current=tx.state.intents[id];requireValue(current?.kind==='PAYOUT'&&current.sellerId===actor.id,'INTENT_NOT_FOUND');return voidPreparedPayout(tx,{intentId:id});});
    },
    async openCase(actor, input) {
      authorize(actor, ['BUYER', 'SELLER', 'STAFF']);
      if(input.kind==='RETURN')await validated('RETURN_REQUEST',actor,input);
      return await store.transaction(tx => {
        authorize(actor,['BUYER','SELLER','STAFF']);
        if(input.kind==='RETURN')physicalCommit(tx,'RETURN_REQUEST',actor,input);
        const result = openProtectionCase(tx, { ...input, actor });
        const order = tx.state.orders[input.orderId];
        recordHold(tx, { holdId: result.id, orderId: input.orderId, reason: result.kind, evidenceRef: input.evidenceRef, amountCents: order.sellerNetCents });
        return result;
      });
    },
    async reviewReturn(actor,input) {
      authorize(actor,['STAFF']);await validated('RETURN_REQUEST_REVIEW',actor,input);
      return store.transaction(tx=>{
        authorize(actor,['STAFF']);physicalCommit(tx,'RETURN_REQUEST_REVIEW',actor,input);const result=reviewReturnRequest(tx,{...input,actor});
        if(result.returnReview.decision==='DENY')releaseHold(tx,{holdId:input.caseId,evidenceRef:input.reviewRef});
        return result;
      });
    },
    async resolveCase(actor, input) {
      authorize(actor, ['STAFF']); await validated('CASE_RESOLUTION',actor,input);
      return await store.transaction(tx => {
        authorize(actor,['STAFF']);physicalCommit(tx,'CASE_RESOLUTION',actor,input);
        const result = resolveProtectionCase(tx, { ...input, actor });
        releaseHold(tx, { holdId: input.caseId, evidenceRef: input.evidence.ref });
        return result;
      });
    },
    async refundCase(actor, input) {
      authorize(actor, ['STAFF']); await validated('REFUND_REVIEW',actor,input);
      const refundId = idFor('refund', { orderId: input.orderId, caseId: input.caseId });
      await store.transaction(tx => {
        authorize(actor,['STAFF']);physicalCommit(tx,'REFUND_REVIEW',actor,input);
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
    getHostedWebhookBinding() {
      gate(); const binding = scopedWebhookBinding(webhook ?? {});
      requireValue(binding.endpoints.some(item=>item.scope==='PLATFORM')&&binding.endpoints.some(item=>item.scope==='CONNECTED'),'WEBHOOK_DUAL_SCOPE_REQUIRED');
      return {environment,platformAccountId,...binding,...(webhook?.ingress?.enabled===true?{ingress:{enabled:true,maxRetained:webhook.ingress.maxRetained,allowedConnectedAccountIds:clone(webhook.allowedConnectedAccountIds)}}:{})};
    },
    async retainProviderWebhook({rawBody,signature}) {
      gate();requireValue(webhook?.ingress?.enabled===true&&Array.isArray(webhook.endpoints),'WEBHOOK_INGRESS_UNAVAILABLE');
      const {retainFinanceWebhook}=await import('./ingress.mjs');
      gate();return retainFinanceWebhook({enabled:true,store,rawBody,signature,endpoints:webhook.endpoints,platformAccountId,
        allowedConnectedAccountIds:webhook.allowedConnectedAccountIds,expectedLivemode:environment==='PRODUCTION',now:clock(),maxRetained:webhook.ingress.maxRetained,
        assertRuntimeReady:()=>{gate();return true;}});
    },
    async receiveProviderWebhook({rawBody,signature}) {
      gate(); const now=clock(),expectedLivemode=environment==='PRODUCTION';
      let selectedSecret;
      if(webhook?.endpoints!==undefined) {
        const verified=verifyScopedRawWebhook({rawBody,signature,endpoints:webhook.endpoints,secret:webhook.secret,platformAccountId,now,expectedLivemode});
        selectedSecret=webhook.endpoints[verified.endpointIndex].secret;
      } else {requireValue(typeof webhook?.secret==='string','WEBHOOK_UNAVAILABLE');selectedSecret=webhook.secret;}
      const result=await handleFinanceWebhook({store,provider,rawBody,signature,secret:selectedSecret,platformAccountId,now,enabled:true,expectedLivemode,resolveDisputePolicy:webhook.resolveDisputePolicy});
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
      if(sellerEligibility){let available=false;try{instantReady();available=typeof quoteInstantPayoutFee==='function'&&typeof provider.getInstantPayoutEligibility==='function';}catch{}sellerEligibility.instantPayouts={available};}
      const eligible=actor.role==='SELLER'&&typeof eligibility.list==='function'?await eligibility.list({sellerId:actor.id}):null;
      const eligibilityCards=eligible?.available===true?eligible.cards:[];
      let quoteDestinations=[];
      if(actor.role==='BUYER'&&quoteProvider?.destinationRequired===true) {
        try {
          const destinations=await quoteProvider.listDestinations({buyerId:actor.id});requireValue(Array.isArray(destinations)&&destinations.length<=25,'QUOTE_DESTINATION_INVALID');
          const seen=new Set();quoteDestinations=destinations.map(row=>{domainId(row.id,'destination',context);requireValue(!seen.has(row.id)&&typeof row.label==='string'&&row.label.trim().length>0&&row.label.length<=1000&&typeof row.version==='string'&&row.version.length>0&&row.version.length<=1000,'QUOTE_DESTINATION_INVALID');seen.add(row.id);return {id:row.id,label:row.label,version:row.version};});
        }catch{quoteDestinations=[];}
      }
      authorize(actor,['SELLER','BUYER','STAFF']);
      let instantFeeSettlementAvailable=false;
      if(actor.role==='STAFF'){try{instantReady();instantFeeSettlementAvailable=typeof readInstantFeeSettlement==='function';}catch{}}
      let taxAvailable=false;if(actor.role==='STAFF'&&taxLifecycle){try{taxReady();taxAvailable=true;}catch{}}
      return store.read(state=>{const projected=projectMarketplaceWorkspace(state,actor,{now:clock(),sellerEligibility,environment,platformAccountId,policy:listingPolicy,eligibilityCards});
        if(projected.operations)projected.operations.instantFeeSettlementAvailable=instantFeeSettlementAvailable;
        return {...projected,...(actor.role==='STAFF'?{taxReporting:projectTaxReporting(state,{available:taxAvailable})}:{}),proofsEnabled:!!proofIntake&&['BUYER','STAFF'].includes(actor.role),shippingTrackingEnabled:!!shippingLifecycle&&actor.role==='STAFF',destinationsEnabled:!!destinations&&['BUYER','STAFF'].includes(actor.role),feePreviewRequired:actor.role==='SELLER'&&!!listingPolicy.feeSchedule,quoteDestinationRequired:actor.role==='BUYER'&&quoteProvider?.destinationRequired===true,quoteDestinations};});
    },
    async reviewFinanceIncident(actor,input) {
      authorize(actor,['STAFF']); await validated('FINANCE_INCIDENT_REVIEW',actor,input);
      return store.transaction(tx=>{authorize(actor,['STAFF']);return reviewOperationalAlert(tx,{...input,actor});});
    },
    async settleInstantFees(actor,input) {
      authorize(actor,['STAFF']);instantReady();
      for(const key of ['settlementId','evidenceRef','reviewRef'])domainId(input[key],key,context);
      requireValue(Array.isArray(input.intentIds)&&input.intentIds.length>0&&input.intentIds.length<=100&&new Set(input.intentIds).size===input.intentIds.length,'INSTANT_PROVIDER_FEE_SETTLEMENT_REQUIRED');
      for(const id of input.intentIds)domainId(id,'intent',context);
      const retained=await instantPort(readInstantFeeSettlement,{...clone(input),environment,platformAccountId,policyHash:instantPolicyHash});
      await validated('INSTANT_PROVIDER_FEE_SETTLEMENT',actor,{...clone(input),...clone(retained)});
      return store.transaction(tx=>{authorize(actor,['STAFF']);instantReady();return settleInstantProviderFees(tx,{settlementId:input.settlementId,platformAccountId,intentIds:input.intentIds,evidence:retained?.evidence,approval:retained?.approval});});
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
    // Separate server-only capability for a qualified recovery worker. This is
    // deliberately absent from HTTP operation maps and never impersonates staff.
    async settleRecoveredPayments(capability, { intentIds } = {}) {
      const authorizeCommit = () => {
        gate();
        requireValue(capability === recoverySettlementCapability, 'RECOVERY_SETTLEMENT_UNAVAILABLE');
        assertRecoverySettlementCapability(capability, { store: rawStore, environment, platformAccountId });
      };
      authorizeCommit();
      requireValue(Array.isArray(intentIds) && intentIds.length <= 100 && new Set(intentIds).size === intentIds.length && intentIds.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)), 'INVALID_REQUEST');
      const originals = await store.read(state => intentIds.map(id => {
        const intent = Object.hasOwn(state.intents, id) ? state.intents[id] : null;
        requireValue(intent?.kind === 'PAYMENT' && intent.id === id && intent.dispatchCount === 1 && intent.platformAccountId === platformAccountId && intent.accountId === platformAccountId && typeof intent.objectId === 'string' && intent.objectId.length > 0 && intent.order?.reservationId && Number.isSafeInteger(intent.reconciledAt) && intent.reconciledAt <= clock() && ((intent.status === 'SUCCEEDED' && intent.confirmed === true) || (intent.status === 'CANCELED' && intent.terminalUnpaid === true)), 'RECOVERY_PAYMENT_NOT_SETTLEABLE');
        return intent;
      }));
      const results = [];
      for (const intent of originals) {
        const result = await settle(intent, intent.order.reservationId, authorizeCommit);
        results.push({ intentId: intent.id, reservationId: intent.order.reservationId, status: result.status, orderId: intent.orderId });
      }
      return results;
    },
    async resumeTax(actor,{operationId}) {authorize(actor,['STAFF']);taxReady();return taxLifecycle.resume({operationId});},
    async recordTaxSale(actor,{orderId}) {authorize(actor,['STAFF']);taxReady();return taxLifecycle.recordSale({orderId});},
    async recordTaxRefund(actor,input) {
      authorize(actor,['STAFF']);taxReady();domainId(input.reviewRef,'tax refund review',context);
      await validated('TAX_REFUND_REVIEW',actor,input);authorize(actor,['STAFF']);taxReady();return taxLifecycle.recordRefund(input);
    },
    async reconcileTax(actor,{operationId,providerId,reviewRef}) {
      authorize(actor,['STAFF']);taxReady();
      if(providerId!==undefined){domainId(reviewRef,'tax recovery review',context);await validated('TAX_ORIGINAL_RECOVERY_REVIEW',actor,{operationId,providerId,reviewRef});}
      else requireValue(reviewRef===undefined,'TAX_RECOVERY_REVIEW_REQUIRED');
      authorize(actor,['STAFF']);taxReady();return taxLifecycle.reconcile({operationId,...(providerId!==undefined?{providerId,recoveryReviewRef:reviewRef}:{})});
    },
    // Explicitly approved reporting pass, separate from GET-only money recovery.
    // A tax failure never changes the original confirmed payment or its ledger.
    async runTaxFollowup(capability,{limit=10,signal}={}) {
      const ready=()=>{gate();requireValue(capability===recoverySettlementCapability,'RECOVERY_SETTLEMENT_UNAVAILABLE');assertRecoverySettlementCapability(capability,{store:rawStore,environment,platformAccountId});taxReady();};
      ready();requireValue(Number.isSafeInteger(limit)&&limit>0&&limit<=50,'TAX_LIST_LIMIT_INVALID');
      const candidates=await store.read(state=>projectTaxReporting(state).orders.filter(row=>row.saleStatus!=='SUCCEEDED').sort((a,b)=>(state.marketplaceTaxAttempts?.[a.orderId]?.at??0)-(state.marketplaceTaxAttempts?.[b.orderId]?.at??0)||a.orderId.localeCompare(b.orderId)).slice(0,limit));
      const results=[];
      for(const row of candidates){if(signal?.aborted)break;ready();let result;
        try{result=await taxLifecycle.recordSale({orderId:row.orderId,signal});}
        catch{result={orderId:row.orderId,status:'REVIEW_REQUIRED',errorCode:'TAX_SALE_RECORD_REQUIRED'};}
        // Keep an attempt receipt even when approval revokes after provider IO.
        await store.transaction(tx=>{(tx.state.marketplaceTaxAttempts??={})[row.orderId]={at:tx.now,status:result.status};});results.push(result);
      }
      return {status:signal?.aborted?'INTERRUPTED':results.some(row=>row.status!=='SUCCEEDED')?'REVIEW_REQUIRED':'COMPLETE',results};
    },
    async metrics(actor) { authorize(actor,['STAFF']); return store.read(state=>marketplaceOperations(state)); },
    async localSnapshot() { gate(); requireValue(environment==='SYNTHETIC_LOCAL','LOCAL_STORE_ONLY'); return await store.read(); },
  });
}
