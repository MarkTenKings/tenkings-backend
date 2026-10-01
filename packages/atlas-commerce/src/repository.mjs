/** The injected call closes over authenticated customer or restricted worker authority. */
export class GatewayCommerceRepository {
    constructor(call) { if (typeof call !== 'function') throw new TypeError('Gateway call required'); this.call = call; }
    loadCheckout(draftId) { return this.call('commerce_checkout', { draftId }); }
    weeklyCapacity() { return this.call('commerce_weekly_capacity', {}); }
    saveQuote(expectedRevision, quote) { return this.call('commerce_save_quote', { expectedRevision, quote }); }
    reservePayment(data) { return this.call('commerce_reserve_payment', data); }
    recordPayment(attemptId, observation) { return this.call('commerce_record_payment', { attemptId, observation }); }
    payment(attemptId) { return this.call('commerce_payment', { attemptId }); }
    confirmPaid(data) { return this.call('commerce_confirm_paid', data); }
    order(orderId) { return this.call('commerce_order', { orderId }); }
    claimEffect(effectId, claimId) { return this.call('commerce_claim_effect', { effectId, claimId }); }
    effect(effectId) { return this.call('commerce_effect', {effectId}); }
    finishEffect(data) { return this.call('commerce_finish_effect', data); }
    providerEvent(event) { return this.call('commerce_provider_event', {event}); }
    callbackPayment(attemptId) { return this.call('commerce_callback_payment', {attemptId}); }
    callbackConfirm(data) { return this.call('commerce_callback_confirm', data); }
}
