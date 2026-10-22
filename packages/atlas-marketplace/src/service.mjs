import { clone, hash, requireValue } from './contract.mjs';
import { createUnavailableEligibilityAdapter, demoId } from './eligibility.mjs';
import { createListing, assertListingBinding } from './listing.mjs';
import { assertBuyerQuote, reserveListing, markReservationPaymentPending, settleReservation, releaseReservation } from './reservation.mjs';
import { preparePayment, prepareTransfer, preparePayout, prepareRefund, sellerBalance, recordHold, releaseHold } from './finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent } from './payment.mjs';
import { assertFulfillmentPolicy, ensureFulfillmentState, recordHoldChoice, recordFulfillment, openProtectionCase, recordRefundObligation, resolveProtectionCase } from './fulfillment.mjs';

export const intentId = (kind, value) => `demo_${kind}_${hash(value).slice(0, 32)}`;

// Trusted composition boundary. No production auth, eligibility or credentials
// are discovered here. Every runtime must explicitly provide its own ports.
export function createMarketplacePilot({ enabled = false, environment, store, eligibility = createUnavailableEligibilityAdapter(), quoteProvider, provider, listingPolicy, financePolicy, fulfillmentPolicy, platformAccountId, clock = Date.now } = {}) {
  function gate() { requireValue(enabled === true && environment === 'SYNTHETIC_LOCAL', 'MARKETPLACE_DISABLED'); }
  function authorize(actor, roles) { gate(); demoId(actor?.id); requireValue(roles.includes(actor?.role), 'FORBIDDEN'); }
  async function authority(cardId, sellerId) {
    const result = await eligibility.read({ cardId, sellerId });
    requireValue(result?.available === true, 'ELIGIBILITY_UNAVAILABLE');
    return result.assertion;
  }
  function buyerReservation(actor, reservationId) {
    authorize(actor, ['BUYER']);
    const reservation = store.read(state => state.reservations[reservationId]);
    requireValue(reservation?.buyerId === actor.id, 'RESERVATION_NOT_FOUND');
    return reservation;
  }
  function settle(intent, reservationId) {
    return store.transaction(tx => {
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
  async function dispatchOrReconcile(id) {
    const current = store.read(state => state.intents[id]);
    return current.status === 'PREPARED'
      ? executeFinanceIntent({ store, provider, intentId: id, enabled: true })
      : reconcileFinanceIntent({ store, provider, intentId: id });
  }
  return Object.freeze({
    status() { return { enabled: enabled === true && environment === 'SYNTHETIC_LOCAL', environment: environment ?? null, realAuthorityEnabled: false, ownershipClaimsEnabled: false, ownershipHistoryEnabled: false }; },
    recordConsent(actor, input) { authorize(actor, ['SELLER']); return store.transaction(tx => recordHoldChoice(tx, { ...input, actor })); },
    async publishListing(actor, input) {
      authorize(actor, ['SELLER']);
      assertFulfillmentPolicy(fulfillmentPolicy);
      requireValue(fulfillmentPolicy.id === listingPolicy.id && fulfillmentPolicy.version === listingPolicy.version, 'FULFILLMENT_POLICY_MISMATCH');
      const assertion = await authority(input.cardId, actor.id);
      return store.transaction(tx => createListing(tx, { requestId: input.requestId, listingId: intentId('listing', input.requestId), sellerId: actor.id, askingPriceCents: input.askingPriceCents, eligibility: assertion, policy: { ...listingPolicy, fulfillmentPolicy: clone(fulfillmentPolicy) } }));
    },
    async quote(actor, listingId) {
      authorize(actor, ['BUYER']);
      const listing = store.read(state => state.listings[listingId]); assertListingBinding(listing);
      requireValue(listing.status === 'ACTIVE', 'CARD_UNAVAILABLE');
      const quote = await quoteProvider({ listing: clone(listing), buyerId: actor.id, now: clock() });
      return store.transaction(tx => {
        assertBuyerQuote(quote, tx.state.listings[listingId], tx.now);
        const quotes = tx.state.quotes ??= {};
        const record = { ...quote, buyerId: actor.id };
        requireValue(!quotes[quote.quoteId] || hash(quotes[quote.quoteId]) === hash(record), 'QUOTE_ID_CONFLICT');
        quotes[quote.quoteId] = record;
        return quote;
      });
    },
    async reserve(actor, input) {
      authorize(actor, ['BUYER']);
      const listing = store.read(state => state.listings[input.listingId]); requireValue(listing, 'LISTING_UNAVAILABLE');
      const assertion = await authority(listing.cardId, listing.sellerId);
      return store.transaction(tx => {
        const record = tx.state.quotes?.[input.quoteId]; requireValue(record?.buyerId === actor.id, 'QUOTE_REQUIRED');
        const { buyerId, ...quote } = record;
        return reserveListing(tx, { requestId: input.requestId, reservationId: intentId('reservation', input.requestId), listingId: listing.id, listingVersion: input.listingVersion, listingHash: input.listingHash, buyerId: actor.id, eligibility: assertion, quote });
      });
    },
    async pay(actor, { reservationId }) {
      const reservation = buyerReservation(actor, reservationId);
      if (reservation.paymentIntentId) {
        const existing = store.read(state => state.intents[reservation.paymentIntentId]);
        if (existing.status === 'PREPARED') {
          const assertion = await authority(reservation.cardId, reservation.sellerId);
          store.transaction(tx => markReservationPaymentPending(tx, { reservationId, paymentIntentId: existing.id, eligibility: assertion }));
        }
        // The only undispatched state is the durable prepared intent. All other
        // states use exact retrieval; a retry cannot create another payment.
        return settle(await dispatchOrReconcile(existing.id), reservationId);
      }
      const assertion = await authority(reservation.cardId, reservation.sellerId);
      const paymentId = intentId('payment', reservation.id);
      store.transaction(tx => {
        const current = tx.state.reservations[reservationId];
        const listing = tx.state.listings[current.listingId];
        preparePayment(tx, { intentId: paymentId, order: current.order, platformAccountId, connectedAccountId: listing.connectedAccountId, policy: financePolicy });
        markReservationPaymentPending(tx, { reservationId, paymentIntentId: paymentId, eligibility: assertion });
      });
      return settle(await dispatchOrReconcile(paymentId), reservationId);
    },
    async reconcilePayment(actor, { reservationId }) {
      const reservation = buyerReservation(actor, reservationId);
      requireValue(reservation.paymentIntentId, 'PAYMENT_INTENT_REQUIRED');
      return settle(await reconcileFinanceIntent({ store, provider, intentId: reservation.paymentIntentId }), reservationId);
    },
    async fulfill(actor, input) {
      authorize(actor, ['STAFF']);
      const result = store.transaction(tx => recordFulfillment(tx, { ...input, actor, policy: fulfillmentPolicy }));
      if (input.action !== 'RELEASE') return result;
      const order = store.read(state => state.orders[input.orderId]);
      const account = await provider.getAccount(order.connectedAccountId);
      const transferId = intentId('transfer', input.orderId);
      store.transaction(tx => {
        const current = tx.state.fulfillment[input.orderId];
        requireValue(current.status === 'RELEASED' && !current.cases.some(row => row.status !== 'CLOSED'), 'PROTECTION_HOLD');
        // Exact prior intent is returned without inventing a new evidence-time
        // request hash on retry. Provider dispatch remains once-only.
        if (!tx.state.intents[transferId]) prepareTransfer(tx, { intentId: transferId, paymentIntentId: order.paymentIntentId, releaseEvidence: current.releaseEvidence, accountEvidence: account });
      });
      await dispatchOrReconcile(transferId);
      return store.read(state => state.fulfillment[input.orderId]);
    },
    async withdraw(actor, { requestId, amountCents, externalAccountId }) {
      authorize(actor, ['SELLER']); demoId(requestId);
      const payoutId = intentId('payout', { requestId, sellerId: actor.id });
      const prior = store.read(state => state.intents[payoutId]);
      if (prior) {
        requireValue(prior.amountCents === amountCents && prior.externalAccountId === externalAccountId, 'IDEMPOTENCY_CONFLICT');
        return dispatchOrReconcile(payoutId);
      }
      const orders = store.read(state => Object.values(state.orders).filter(row => row.sellerId === actor.id));
      requireValue(orders.length > 0 && orders.every(row => row.connectedAccountId === orders[0].connectedAccountId), 'SELLER_ACCOUNT_UNAVAILABLE');
      const connectedAccountId = orders[0].connectedAccountId;
      const [accountEvidence, balanceEvidence] = await Promise.all([provider.getAccount(connectedAccountId), provider.getBalance(connectedAccountId)]);
      store.transaction(tx => preparePayout(tx, { intentId: payoutId, sellerId: actor.id, connectedAccountId, externalAccountId, amountCents, allocationOrderIds: orders.map(row => row.orderId).sort(), accountEvidence, balanceEvidence }));
      return dispatchOrReconcile(payoutId);
    },
    async reconcileWithdrawal(actor, { intentId: id }) {
      authorize(actor, ['SELLER']);
      const current = store.read(state => state.intents[id]);
      requireValue(current?.kind === 'PAYOUT' && current.sellerId === actor.id, 'INTENT_NOT_FOUND');
      return reconcileFinanceIntent({ store, provider, intentId: id });
    },
    openCase(actor, input) {
      authorize(actor, ['BUYER', 'SELLER', 'STAFF']);
      return store.transaction(tx => {
        const result = openProtectionCase(tx, { ...input, actor });
        const order = tx.state.orders[input.orderId];
        recordHold(tx, { holdId: result.id, orderId: input.orderId, reason: result.kind, evidenceRef: input.evidenceRef, amountCents: order.sellerNetCents });
        return result;
      });
    },
    resolveCase(actor, input) {
      authorize(actor, ['STAFF']);
      return store.transaction(tx => {
        const result = resolveProtectionCase(tx, { ...input, actor });
        releaseHold(tx, { holdId: input.caseId, evidenceRef: input.evidence.ref });
        return result;
      });
    },
    async refundCase(actor, input) {
      authorize(actor, ['STAFF']);
      const refundId = intentId('refund', { orderId: input.orderId, caseId: input.caseId });
      store.transaction(tx => {
        const obligation = recordRefundObligation(tx, { ...input, actor });
        const order = tx.state.orders[input.orderId];
        prepareRefund(tx, { intentId: refundId, paymentIntentId: order.paymentIntentId, amountCents: obligation.amountCents, allocations: obligation.allocations,
          policyEvidence: { approved: true, orderId: order.orderId, caseId: input.caseId, obligationHash: obligation.hash, policyVersion: obligation.policyVersion, evidenceRef: obligation.reviewRef } });
      });
      return dispatchOrReconcile(refundId);
    },
    async reconcileRefund(actor, { orderId, caseId }) {
      authorize(actor, ['STAFF']);
      return reconcileFinanceIntent({ store, provider, intentId: intentId('refund', { orderId, caseId }) });
    },
    balance(actor) { authorize(actor, ['SELLER']); return store.read(state => sellerBalance(state, actor.id)); },
    localSnapshot() { gate(); return store.read(); },
  });
}
