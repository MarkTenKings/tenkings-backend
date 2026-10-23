import { cents, clone, hash, requireValue, sumCents } from './contract.mjs';
import { requiredText } from './eligibility.mjs';
import { authorityContext, contextFor, domainId, authorityId } from './authority-context.mjs';
import { assertCurrentHoldConsent, assertCurrentListingAuthority, assertListingBinding, isLocallyVoidedPayment } from './listing.mjs';
import { assertCheckoutQuoteBinding, CHECKOUT_QUOTE_SCHEMA } from './checkout-quote.mjs';

export function assertBuyerQuote(quote, listing, now, suppliedContext, buyerId) {
  const context = authorityContext(suppliedContext);
  assertListingBinding(listing, context);
  requireValue(quote && typeof quote === 'object', 'QUOTE_REQUIRED', 'A complete current buyer quote is required.');
  domainId(quote.quoteId, 'quote', context);
  requireValue(quote.policyId === listing.policy.id && quote.policyVersion === listing.policy.version && quote.listingHash === listing.bindingHash, 'QUOTE_BINDING_MISMATCH', 'The quote must bind this exact listing and policy.');
  requireValue(quote.itemCents === listing.askingPriceCents, 'QUOTE_PRICE_MISMATCH', 'The item price changed.');
  for (const field of ['itemCents', 'shippingCents', 'taxCents', 'buyerFeeCents', 'totalCents']) cents(quote[field]);
  requireValue(quote.buyerFeeCents === 0, 'BUYER_PREMIUM_UNSUPPORTED', 'This pilot does not support a buyer premium.');
  requireValue(quote.totalCents === sumCents(quote.itemCents, quote.shippingCents, quote.taxCents, quote.buyerFeeCents), 'QUOTE_TOTAL_MISMATCH', 'The buyer total must include every quoted amount exactly.');
  requiredText(quote.shippingQuoteRef, 'Shipping quote reference');
  requiredText(quote.taxQuoteRef, 'Tax quote reference');
  requiredText(quote.deliveryEstimate, 'Delivery estimate');
  requireValue(quote.protectionTerms === listing.policy.protectionTerms, 'QUOTE_PROTECTION_MISMATCH', 'The buyer must see the exact listing protection terms.');
  requireValue(Number.isFinite(Date.parse(quote.expiresAt)) && Date.parse(quote.expiresAt) > now, 'QUOTE_EXPIRED', 'Refresh the complete buyer quote before reserving.');
  if(quote.schema === CHECKOUT_QUOTE_SCHEMA) assertCheckoutQuoteBinding(quote, {listing,buyerId:buyerId ?? quote.buyerId,destinationId:quote.destination?.id},now,context);
  return quote;
}

function assertReservation(tx, reservationId) {
  const context = contextFor(tx);
  domainId(reservationId, 'reservation', context);
  const reservation = tx.state.reservations[reservationId];
  requireValue(reservation, 'RESERVATION_NOT_FOUND', 'Reservation not found.');
  const current = tx.state.listings[reservation.listingId];
  // Released historical checkouts retain their exact earlier price/report binding.
  const historical = reservation.status === 'RELEASED' && current?.bindingHash !== reservation.listingHash
    ? Object.values(tx.state.listingRevisions ?? {}).find(row => row.id === reservation.listingId && row.bindingHash === reservation.listingHash) : null;
  const listing = assertListingBinding(historical ?? current, context);
  requireValue(listing.bindingHash === reservation.listingHash && reservation.order.bindingHash === reservation.listingHash, 'RESERVATION_BINDING_INVALID', 'Reservation no longer matches its immutable listing.');
  requireValue(reservation.quoteHash === hash(reservation.quote), 'RESERVATION_BINDING_INVALID', 'The reserved buyer quote changed.');
  requireValue(hash(reservation.order) === hash(orderFromListing(reservation.id, reservation.orderId, reservation.buyerId, listing, reservation.quote)), 'RESERVATION_BINDING_INVALID', 'The order allocation must retain the exact reserved quote and listing.');
  return { reservation, listing };
}

function orderFromListing(reservationId, orderId, buyerId, listing, quote) {
  return {
    orderId, reservationId, listingId: listing.id, cardId: listing.cardId,
    sellerId: listing.sellerId, buyerId, currency: 'USD', totalCents: quote.totalCents,
    itemCents: listing.askingPriceCents, feeCents: listing.feeCents, sellerNetCents: listing.sellerNetCents,
    taxCents: quote.taxCents, shippingCents: quote.shippingCents,
    ...(quote.shippingPricing!==undefined?{shippingPricing:clone(quote.shippingPricing)}:{}),
    policyVersion: listing.policy.version, bindingHash: listing.bindingHash,
  };
}

function assertPaymentIntent(tx, reservation, paymentIntentId) {
  requireValue(paymentIntentId === reservation.paymentIntentId, 'PAYMENT_INTENT_MISMATCH', 'Only the original payment intent may resolve this reservation.');
  const intent = tx.state.intents[paymentIntentId];
  requireValue(intent?.kind === 'PAYMENT' && intent.intentId === paymentIntentId && intent.id === paymentIntentId, 'PAYMENT_INTENT_MISMATCH', 'The payment intent must be retained in the same durable transaction store.');
  requireValue(hash(intent.order) === hash(reservation.order) && intent.amountCents === reservation.order.totalCents && intent.currency === 'USD', 'PAYMENT_BINDING_MISMATCH', 'The retained payment intent does not match this exact order.');
  return intent;
}

function hasReconciledObject(intent, now) {
  return typeof intent.objectId === 'string' && intent.objectId.length > 0 && Number.isSafeInteger(intent.reconciledAt) && intent.reconciledAt >= 0 && intent.reconciledAt <= now;
}

export function reserveListing(tx, input) {
  const context = contextFor(tx);
  domainId(input.requestId, 'request', context);
  domainId(input.reservationId, 'reservation', context);
  domainId(input.listingId, 'listing', context);
  authorityId(input.buyerId, 'buyer', context);
  const orderId = input.orderId ?? (context.environment === 'SYNTHETIC_LOCAL' ? `demo_order_${input.reservationId.slice(5)}` : `order_${hash(input.reservationId).slice(0, 32)}`);
  domainId(orderId, 'order', context);
  const requestHash = hash({ reservationId: input.reservationId, orderId, listingId: input.listingId, listingVersion: input.listingVersion, listingHash: input.listingHash, buyerId: input.buyerId, quote: input.quote });
  const receiptKey = `reservation:${input.requestId}`;
  const receipt = tx.state.receipts[receiptKey];
  if (receipt) {
    requireValue(receipt.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT', 'The original reservation request has different inputs.');
    // Historical receipt remains the exact accepted result; current state is a separate read.
    return clone(receipt.result);
  }
  const listing = assertListingBinding(tx.state.listings[input.listingId], context);
  requireValue(listing.version === input.listingVersion && listing.bindingHash === input.listingHash, 'LISTING_CHANGED', 'Review the current exact listing before purchase.');
  requireValue(input.buyerId !== listing.sellerId, 'SELF_PURCHASE_REFUSED', 'A seller cannot purchase their own listing.');
  assertCurrentListingAuthority(listing, input.eligibility, tx.now, context);
  assertCurrentHoldConsent(tx, listing);
  assertBuyerQuote(input.quote, listing, tx.now, context, input.buyerId);
  requireValue(!tx.state.reservations[input.reservationId], 'RESERVATION_ID_CONFLICT', 'This reservation identity is already used.');
  requireValue(!Object.values(tx.state.reservations).some((other) => other.orderId === orderId), 'ORDER_ID_CONFLICT', 'This order identity is already used.');
  // Expiry frees only an untouched reservation. Payment work must reconcile first.
  for (const other of Object.values(tx.state.reservations)) {
    if (other.cardId !== listing.cardId || !['HELD', 'PAYMENT_PENDING'].includes(other.status)) continue;
    if (other.status === 'HELD' && other.paymentIntentId === null && Date.parse(other.expiresAt) <= tx.now) {
      releaseReservation(tx, { reservationId: other.id, reason: 'LEASE_EXPIRED' });
    } else {
      requireValue(false, 'CARD_RESERVED', 'Another checkout owns this permanent card; payment uncertainty retains the hold.');
    }
  }
  requireValue(listing.status === 'ACTIVE' && listing.activeReservationId === null, 'CARD_UNAVAILABLE', 'This card is not available for purchase.');
  const order = orderFromListing(input.reservationId, orderId, input.buyerId, listing, input.quote);
  const reservation = {
    id: input.reservationId, orderId, environment: contextFor(tx).environment, listingId: listing.id, cardId: listing.cardId,
    sellerId: listing.sellerId, buyerId: input.buyerId, listingHash: listing.bindingHash, status: 'HELD',
    createdAt: new Date(tx.now).toISOString(), expiresAt: new Date(Math.min(tx.now + listing.policy.reservationTtlMs, Date.parse(input.quote.expiresAt))).toISOString(),
    paymentIntentId: null, quote: clone(input.quote), quoteHash: hash(input.quote), order,
  };
  tx.state.reservations[reservation.id] = reservation;
  listing.status = 'RESERVED';
  listing.activeReservationId = reservation.id;
  tx.state.receipts[receiptKey] = { requestHash, result: clone(reservation) };
  tx.emit('CARD_RESERVED', { reservationId: reservation.id, listingId: listing.id, cardId: listing.cardId, environment: contextFor(tx).environment });
  return clone(reservation);
}

export function markReservationPaymentPending(tx, { reservationId, paymentIntentId, eligibility }) {
  const { reservation, listing } = assertReservation(tx, reservationId);
  if (reservation.paymentIntentId !== null) {
    const intent = assertPaymentIntent(tx, reservation, paymentIntentId);
    if (intent.status === 'PREPARED') {
      requireValue(reservation.status === 'PAYMENT_PENDING' && listing.status === 'RESERVED' && listing.activeReservationId === reservationId, 'RESERVATION_UNAVAILABLE', 'Only the still-held original checkout may dispatch its prepared payment.');
      assertCurrentListingAuthority(listing, eligibility, tx.now, contextFor(tx));
      assertCurrentHoldConsent(tx, listing);
      requireValue(Date.parse(reservation.expiresAt)>tx.now,'RESERVATION_EXPIRED','An undispatched prepared payment needs an unexpired original checkout.');
      assertBuyerQuote(reservation.quote,listing,tx.now,contextFor(tx),reservation.buyerId);
    }
    return clone(reservation);
  }
  domainId(paymentIntentId, 'payment intent', contextFor(tx));
  requireValue(reservation.status === 'HELD' && listing.activeReservationId === reservationId && listing.status === 'RESERVED', 'RESERVATION_UNAVAILABLE', 'The checkout no longer owns this card.');
  requireValue(Date.parse(reservation.expiresAt) > tx.now, 'RESERVATION_EXPIRED', 'The reservation expired before payment began.');
  assertCurrentListingAuthority(listing, eligibility, tx.now, contextFor(tx));
  assertCurrentHoldConsent(tx, listing);
  assertBuyerQuote(reservation.quote,listing,tx.now,contextFor(tx),reservation.buyerId);
  // Verify before mutating; the local store also rolls back the enclosing transaction.
  const intent = tx.state.intents[paymentIntentId];
  requireValue(intent?.kind === 'PAYMENT' && intent.id === paymentIntentId && intent.intentId === paymentIntentId && intent.status === 'PREPARED', 'PAYMENT_INTENT_REQUIRED', 'Prepare the exact payment intent in this transaction before dispatch.');
  requireValue(hash(intent.order) === hash(reservation.order) && intent.amountCents === reservation.order.totalCents && intent.currency === 'USD', 'PAYMENT_BINDING_MISMATCH', 'Payment must bind the exact reserved buyer total and seller allocation.');
  reservation.paymentIntentId = paymentIntentId;
  reservation.status = 'PAYMENT_PENDING';
  tx.emit('RESERVATION_PAYMENT_PENDING', { reservationId, paymentIntentId, environment: contextFor(tx).environment });
  return clone(reservation);
}

export function settleReservation(tx, { reservationId, paymentIntentId, orderId }) {
  const { reservation, listing } = assertReservation(tx, reservationId);
  requireValue(orderId === reservation.orderId, 'ORDER_ID_MISMATCH', 'Settlement must retain the original order identity.');
  const intent = assertPaymentIntent(tx, reservation, paymentIntentId);
  requireValue(intent.status === 'SUCCEEDED' && intent.confirmed === true && intent.terminalUnpaid !== true && hasReconciledObject(intent, tx.now), 'PAYMENT_UNCONFIRMED', 'Only exact retrieved and reconciled payment evidence can complete the sale.');
  const existing = tx.state.orders[orderId];
  if (existing) {
    requireValue(existing.reservationId === reservationId && existing.paymentIntentId === paymentIntentId && existing.bindingHash === listing.bindingHash && reservation.status === 'SOLD', 'ORDER_CONFLICT', 'Order identity is already bound to different work.');
    return clone(existing);
  }
  requireValue(reservation.status === 'PAYMENT_PENDING' && listing.activeReservationId === reservationId && listing.status === 'RESERVED', 'RESERVATION_UNAVAILABLE', 'Confirmed money requires manual reconciliation if the original reservation no longer owns the card.');
  const order = { ...clone(reservation.order), environment: contextFor(tx).environment, status: 'PAID', paymentIntentId, paymentObjectId: intent.objectId, paidAt: new Date(tx.now).toISOString(), approvedCard: clone(listing.approvedCard), policy: clone(listing.policy), quote: clone(reservation.quote), connectedAccountId: listing.connectedAccountId };
  tx.state.orders[orderId] = order;
  reservation.status = 'SOLD';
  listing.status = 'SOLD';
  tx.emit('SALE_CONFIRMED', { orderId, reservationId, listingId: listing.id, environment: contextFor(tx).environment });
  return clone(order);
}

export function releaseReservation(tx, { reservationId, reason, buyerId, paymentIntentId }) {
  const { reservation, listing } = assertReservation(tx, reservationId);
  requireValue(['LEASE_EXPIRED', 'BUYER_CANCELED', 'PAYMENT_CANCELED', 'UNDISPATCHED_CANCELED'].includes(reason), 'RELEASE_REASON_INVALID', 'A supported release reason is required.');
  if (reservation.status === 'RELEASED') return clone(reservation);
  requireValue(['HELD', 'PAYMENT_PENDING'].includes(reservation.status), 'RESERVATION_UNAVAILABLE', 'A sold reservation cannot be released.');
  requireValue(listing.status === 'RESERVED' && listing.activeReservationId === reservationId, 'RESERVATION_UNAVAILABLE', 'Reservation does not own this card.');
  if (reservation.paymentIntentId !== null) {
    const intent = assertPaymentIntent(tx, reservation, paymentIntentId);
    if (reason === 'UNDISPATCHED_CANCELED') requireValue(buyerId === reservation.buyerId && isLocallyVoidedPayment(tx,intent), 'PAYMENT_LOCAL_VOID_REFUSED', 'Only the exact owned, locally voided and never-dispatched intent may release this checkout.');
    else requireValue(reason === 'PAYMENT_CANCELED' && intent.status === 'CANCELED' && intent.terminalUnpaid === true && intent.confirmed === false && hasReconciledObject(intent, tx.now), 'PAYMENT_RECONCILIATION_REQUIRED', 'Unknown, pending or failed payment outcomes retain the card until exact terminal-unpaid reconciliation.');
  } else if (reason === 'LEASE_EXPIRED') {
    requireValue(Date.parse(reservation.expiresAt) <= tx.now, 'RESERVATION_NOT_EXPIRED', 'The reservation lease has not expired.');
  } else {
    requireValue(reason === 'BUYER_CANCELED' && buyerId === reservation.buyerId, 'RELEASE_UNAUTHORIZED', 'Only the reservation buyer may cancel before payment starts.');
  }
  reservation.status = 'RELEASED';
  reservation.releasedAt = new Date(tx.now).toISOString();
  reservation.releaseReason = reason;
  listing.status = 'ACTIVE';
  listing.activeReservationId = null;
  tx.emit('RESERVATION_RELEASED', { reservationId, reason, environment: contextFor(tx).environment });
  return clone(reservation);
}

export function cancelReservation(tx, { requestId, reservationId, buyerId }) {
  domainId(requestId, 'request', contextFor(tx)); authorityId(buyerId, 'buyer', contextFor(tx));
  const reservation = tx.state.reservations[reservationId];
  requireValue(reservation?.buyerId === buyerId, 'RELEASE_UNAUTHORIZED');
  const key = `reservation-cancel:${requestId}`, requestHash = hash({ reservationId, buyerId }), prior = tx.state.receipts[key];
  if (prior) { requireValue(prior.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT'); return clone(prior.result); }
  if (reservation.paymentIntentId !== null) requireValue(isLocallyVoidedPayment(tx,tx.state.intents[reservation.paymentIntentId]), 'PAYMENT_RECONCILIATION_REQUIRED', 'A saved payment must be reconciled; cancellation cannot release an uncertain payment.');
  const result = releaseReservation(tx, { reservationId, buyerId, reason: reservation.paymentIntentId === null ? 'BUYER_CANCELED' : 'UNDISPATCHED_CANCELED', ...(reservation.paymentIntentId !== null ? {paymentIntentId:reservation.paymentIntentId} : {}) });
  tx.state.receipts[key] = { requestHash, result: clone(result) };
  return result;
}

export function expireReservations(tx) {
  return Object.values(tx.state.reservations)
    .filter(row => row.status === 'HELD' && row.paymentIntentId === null && Date.parse(row.expiresAt) <= tx.now)
    .map(row => releaseReservation(tx, { reservationId: row.id, reason: 'LEASE_EXPIRED' }));
}
