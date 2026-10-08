import { randomUUID } from 'node:crypto';
import { assertCheckout, assertPaidEvidence, assertPaymentBinding, clone, digest, requireValue, minor, receiptEffects, receiptEmail, SERVICE, UUID } from './contract.mjs';
import { customerCheckout, customerOrder, customerPayment, customerQuote } from './projections.mjs';
import { assertShipmentDate, assertShippingPlan, availableShippingPlans, materializeShippingRequest, localDate } from './shipping-plan.mjs';
import { SHIPSTATION_PLAN, shipStationCustomer, validateShipStationShipment, validateInboundPackage } from './shipstation.mjs';
import { validateShipment } from './providers.mjs';
import { customerCapacity, capacityBlockers } from './capacity.mjs';
export { CommerceError } from './contract.mjs';

export class CommerceService {
    constructor({ repository, payment, tax, carrier, carriers, notifications, packageLabel, terms, clock = () => new Date(), uuid = randomUUID }) {
        Object.assign(this, { repository, payment, tax, carrier, carriers, notifications, packageLabel, terms, clock, uuid });
    }
    carrierFor(provider) { return this.carriers?.[provider] ?? (this.carrier && (this.carrier.provider ?? 'FEDEX') === provider ? this.carrier : null); }
    deferred(source) { return source.channel === 'MAIL_IN' && this.terms?.shippingPayment === 'SEPARATE_PAYMENT'; }
    async capacity() {
        return customerCapacity(this.repository.weeklyCapacity ? await this.repository.weeklyCapacity() : null, this.clock());
    }
    async checkout(draftId) {
        requireValue(UUID.test(draftId), 'INVALID_REQUEST', 400);
        const loaded = await this.repository.loadCheckout(draftId);
        // A paid historical receipt remains readable if a kiosk is disabled or
        // today's provider configuration has changed. Its saved terms prevail.
        if (loaded.activePayment?.state === 'PAID' && loaded.activePayment.order) {
            const order=customerOrder(loaded.activePayment.order), saved=order.receipt;
            return customerCheckout({draftId,revision:loaded.revision,channel:saved.channel,cards:saved.cards,location:saved.location,shippingOptions:[]}, {
                unitCents:SERVICE[saved.channel].unitCents,turnaroundDays:saved.terms.days,
                activePayment:{attemptId:loaded.activePayment.id??loaded.activePayment.attemptId,state:'PAID',channel:saved.channel,order}});
        }
        // Disabled-provider reads use the normal customer SQL gateway, whose
        // safe DTO intentionally has no account/profile/device authority.
        const publicSource = loaded.version === 'atlas-commerce-checkout-v1';
        if (publicSource) {
            requireValue(!this.payment && !this.tax && loaded.draftId === draftId && SERVICE[loaded.channel], 'INVALID_CHECKOUT_SOURCE');
        }
        const source = publicSource ? loaded : assertCheckout(loaded);
        if (!publicSource && source.channel === 'MAIL_IN') source.shippingPlans = availableShippingPlans(source.shippingPlans, source.cards.length, this.terms?.mailChargedLegs, this.clock());
        const blockers = [];
        const capacity = await this.capacity();
        if (source.cards.length && !source.activePayment) blockers.push(...capacityBlockers(capacity, source.channel, source.cards.length));
        if (!this.payment) blockers.push('PAYMENT_NOT_CONFIGURED');
        if (!this.tax) blockers.push('TAX_NOT_CONFIGURED');
        if (source.channel === 'MAIL_IN') {
            if (!this.deferred(source) && !this.carrier) blockers.push('SHIPPING_NOT_CONFIGURED');
            if (!this.deferred(source) && !(source.shippingPlans ?? source.shippingOptions)?.length) blockers.push('MEASURED_PACKAGING_NOT_CONFIGURED');
            if (this.terms?.mailClockStart !== 'ATLAS_RECEIPT') blockers.push('MAIL_TURNAROUND_NOT_CONFIGURED');
            if (!this.deferred(source) && !['INBOUND_ONLY','BOTH_LEGS'].includes(this.terms?.mailChargedLegs)) blockers.push('MAIL_SHIPPING_TERMS_NOT_CONFIGURED');
        }
        const activePayment = source.activePayment ? publicSource ? customerPayment(source.activePayment) : await this.reconcile(source.activePayment.id) : null;
        return customerCheckout({...source,terms:{shippingPayment:this.deferred(source)?'SEPARATE_PAYMENT':null}}, {activePayment,capacity,unitCents: SERVICE[source.channel].unitCents,
            turnaroundDays: SERVICE[source.channel].days,blockers});
    }
    async quote({ draftId, expectedRevision, packingPresetId, shippingServiceCode, inboundPackage }) {
        requireValue(UUID.test(draftId), 'INVALID_REQUEST', 400);
        const source = assertCheckout(await this.repository.loadCheckout(draftId));
        requireValue(receiptEmail(source.profile.email), 'PROFILE_EMAIL_REQUIRED', 409);
        requireValue(source.emailVerified === true, 'EMAIL_VERIFICATION_REQUIRED', 409);
        requireValue(source.revision === expectedRevision, 'CHECKOUT_CHANGED');
        requireValue(this.payment && this.tax, 'COMMERCE_NOT_CONFIGURED', 503);
        return this.buildQuote(source, {draftId,packingPresetId,shippingServiceCode,inboundPackage,expectedRevision});
    }
    async buildQuote(source, {draftId,packingPresetId,shippingServiceCode,inboundPackage,expectedRevision,orderId}) {
        const shippingOnly = Boolean(orderId), deferred = !shippingOnly && this.deferred(source);
        const service = SERVICE[source.channel], now = this.clock(), id = this.uuid();
        const lines = source.cards.map(card => ({ cardId: card.id, revision: card.revision, photoPairHash: card.photoPairHash,
            identity: clone(card.identity), unitCents: service.unitCents, commissionCents: service.commissionCents }));
        const subtotalCents = shippingOnly ? 0 : lines.length * service.unitCents;
        let shipping = [], shippingPlan = null, clockStart = source.channel === 'MAIL_IN' ? 'ATLAS_RECEIPT' : 'ATLAS_COLLECTION', measuredInbound;
        if (deferred) {
            requireValue(this.terms.mailClockStart === 'ATLAS_RECEIPT','MAIL_TURNAROUND_NOT_CONFIGURED',503);
            requireValue(packingPresetId === undefined && shippingServiceCode === undefined && inboundPackage === undefined,'SHIPPING_SELECTION_DEFERRED',400);
        }
        if (source.channel === 'MAIL_IN' && !deferred) {
            requireValue(this.terms?.mailClockStart === 'ATLAS_RECEIPT', 'MAIL_TURNAROUND_NOT_CONFIGURED', 503);
            requireValue(['INBOUND_ONLY','BOTH_LEGS'].includes(this.terms?.mailChargedLegs), 'MAIL_SHIPPING_TERMS_NOT_CONFIGURED', 503);
            requireValue(this.carrier, 'SHIPPING_NOT_CONFIGURED', 503);
            clockStart = this.terms.mailClockStart;
            const matches = source.shippingPlans?.filter(value => value.packingPresetId === packingPresetId && value.shippingServiceCode === shippingServiceCode && value.cardCount === lines.length) ?? [];
            requireValue(matches.length === 1, 'PACKAGING_REQUIRED', 400);
            const plan = assertShippingPlan(matches[0], lines.length, this.terms.mailChargedLegs, now);
            const provider = plan.version === SHIPSTATION_PLAN ? 'SHIPSTATION' : 'FEDEX';
            const carrier = this.carrierFor(provider);
            requireValue(carrier, 'SHIPPING_NOT_CONFIGURED',503);
            if(plan.inboundPackaging === 'CUSTOMER_MEASURED') measuredInbound=clone(validateInboundPackage(inboundPackage));
            else requireValue(inboundPackage === undefined,'UNEXPECTED_PACKAGE_MEASUREMENTS',400);
            shippingPlan = clone(plan);
            const legs = this.terms.mailChargedLegs === 'BOTH_LEGS' ? ['INBOUND','RETURN'] : ['INBOUND'];
            for (const leg of legs) {
                const template = plan.legs?.[leg];
                requireValue(template, 'SHIPPING_LEG_NOT_CONFIGURED', 503);
                const request = materializeShippingRequest(plan, leg, now), p = source.profile;
                const customer = { contact: { personName: p.name, phoneNumber: source.phone }, address: {
                    streetLines: [p.address1, p.address2].filter(Boolean), city: p.city, stateOrProvinceCode: p.region,
                    postalCode: p.postalCode, countryCode: p.country } };
                if (provider === 'SHIPSTATION') {
                    request.shipment[leg === 'INBOUND' ? 'ship_from' : 'ship_to'] = shipStationCustomer(p,source.phone);
                    if(leg === 'INBOUND' && measuredInbound) request.shipment.packages=[{package_code:'package',...clone(measuredInbound)}];
                    validateShipStationShipment(request);
                } else {
                    requireValue(request.requestedShipment, 'SHIPPING_LEG_NOT_CONFIGURED', 503);
                    if (leg === 'INBOUND') request.requestedShipment.shipper = customer;
                    else request.requestedShipment.recipients = [customer];
                    validateShipment(request);
                }
                const rate = await carrier.quote(clone(request));
                requireValue(rate.provider === provider && rate.currency === 'usd' && minor(rate.amountCents)
                    && rate.requestHash === digest(request) && Date.parse(rate.expiresAt) > now.getTime() && rate.providerId, 'SHIPPING_QUOTE_INVALID', 503);
                shipping.push({ leg, amountCents: rate.amountCents, currency: rate.currency, providerId: rate.providerId,
                    expiresAt: rate.expiresAt, request: clone(request), requestHash: rate.requestHash,
                    ...(provider === 'SHIPSTATION' ? {provider,carrierName:rate.carrierName,serviceName:rate.serviceName,rate:clone(rate)} : {}) });
            }
        }
        const shippingCents = shipping.reduce((sum, rate) => sum + rate.amountCents, 0);
        const taxInput = { quoteId: id, currency: 'usd', profile: clone(source.profile), channel: source.channel,
            location: source.location ?? null, lines: shippingOnly ? [] : lines, subtotalCents, shippingCents };
        const calculated = shippingOnly ? await this.tax.calculateShipping(taxInput) : await this.tax.calculate(taxInput);
        requireValue(calculated?.providerId && calculated.currency === 'usd' && minor(calculated.taxCents)
            && calculated.totalCents === subtotalCents + shippingCents + calculated.taxCents
            && calculated.requestHash === digest(taxInput) && Date.parse(calculated.expiresAt) > now.getTime(), 'TAX_QUOTE_INVALID', 503);
        const routeDeadline = source.channel === 'KIOSK' ? Date.parse(source.location.schedule.cutoffAt ?? source.location.schedule.nextCollectionAt) : Infinity;
        requireValue(routeDeadline > now.getTime(), 'KIOSK_SCHEDULE_CHANGED');
        const expires = Math.min(now.getTime() + 15 * 60 * 1000, Date.parse(calculated.expiresAt), routeDeadline,
            shippingPlan?.validUntil ? Date.parse(shippingPlan.validUntil) : Infinity, ...shipping.map(rate => Date.parse(rate.expiresAt)));
        const quote = { version: 'atlas-commerce-v1', ...(shippingOnly ? {orderId,purpose:'SHIPPING',shippingStatus:'QUOTED_UNPAID'} : deferred ? {shippingStatus:'UNQUOTED_UNPAID'} : {}), id, draftId, draftRevision: source.revision, accountId: source.accountId,
            profile: clone(source.profile), profileRevision: source.profileRevision, phone: source.phone, channel: source.channel,
            location: source.location ? clone(source.location) : null, cards: lines, currency: 'usd', subtotalCents, shippingCents,
            taxCents: calculated.taxCents, totalCents: calculated.totalCents, tax: clone(calculated), shipping, shippingPlan,
            ...(measuredInbound ? {inboundPackage:measuredInbound} : {}),
            merchant: clone(this.payment.binding), terms: { days: service.days, clockStart, paymentFlow: 'CUSTOMER_PHONE',
                mailChargedLegs: source.channel === 'MAIL_IN' && !deferred ? this.terms.mailChargedLegs : null,
                ...(deferred || shippingOnly ? {shippingPayment:'SEPARATE_PAYMENT'} : {}) },
            createdAt: now.toISOString(), expiresAt: new Date(expires).toISOString() };
        quote.contentHash = digest(quote);
        return customerQuote(shippingOnly ? await this.repository.saveShippingQuote(orderId,quote) : await this.repository.saveQuote(expectedRevision, quote));
    }
    async shippingCheckout({orderId}) {
        requireValue(UUID.test(orderId),'INVALID_REQUEST',400);
        const source=await this.repository.shippingCheckout(orderId);
        const plans=availableShippingPlans(source.shippingPlans,source.cards.length,this.terms?.mailChargedLegs,this.clock());
        const blockers=[];
        if(!this.payment)blockers.push('PAYMENT_NOT_CONFIGURED');
        if(!this.tax?.calculateShipping || this.tax.shippingConfigured===false)blockers.push('SHIPPING_TAX_NOT_CONFIGURED');
        if(!this.carrier)blockers.push('SHIPPING_NOT_CONFIGURED');
        if(!plans.length)blockers.push('MEASURED_PACKAGING_NOT_CONFIGURED');
        if(!['INBOUND_ONLY','BOTH_LEGS'].includes(this.terms?.mailChargedLegs))blockers.push('MAIL_SHIPPING_TERMS_NOT_CONFIGURED');
        const activePayment=source.activePayment ? await this.shippingReconcile({orderId,attemptId:source.activePayment.id??source.activePayment.attemptId}) : null;
        const checkout=customerCheckout({...source,shippingPlans:plans},{activePayment,blockers});
        return {orderId,cards:checkout.cards,shippingOptions:checkout.shippingOptions,blockers,activePayment,
            shippingPayment:customerOrder(source.order)?.shippingPayment};
    }
    async shippingQuote({orderId,packingPresetId,shippingServiceCode,inboundPackage}) {
        requireValue(UUID.test(orderId),'INVALID_REQUEST',400);
        requireValue(this.payment && this.tax?.calculateShipping && this.tax.shippingConfigured!==false,'SHIPPING_TAX_NOT_CONFIGURED',503);
        const source=await this.repository.shippingCheckout(orderId);
        requireValue(!source.activePayment,'SHIPPING_PAYMENT_ALREADY_STARTED');
        return this.buildQuote(source,{draftId:source.draftId,orderId,packingPresetId,shippingServiceCode,inboundPackage});
    }
    async shippingPay({orderId,quoteId,requestId}) {
        requireValue([orderId,quoteId,requestId].every(id=>UUID.test(id)),'INVALID_REQUEST',400);
        requireValue(this.payment,'PAYMENT_NOT_CONFIGURED',503);
        const reserved=await this.repository.reserveShippingPayment({orderId,quoteId,requestId,attemptId:this.uuid(),merchant:this.payment.binding});
        if(!reserved.dispatch)return this.publicAttempt(reserved.attempt);
        const attempt=reserved.attempt;
        try { await this.repository.recordShippingPayment(orderId,attempt.id,await this.payment.create(attempt)); }
        catch { await this.repository.recordShippingPayment(orderId,attempt.id,{state:'UNKNOWN',code:'PAYMENT_RECONCILIATION_REQUIRED'}); }
        return this.shippingReconcile({orderId,attemptId:attempt.id});
    }
    async shippingReconcile({orderId,attemptId}) {
        requireValue(UUID.test(orderId)&&UUID.test(attemptId),'INVALID_REQUEST',400);
        const attempt=await this.repository.shippingPayment(orderId,attemptId);
        requireValue(attempt.orderId===orderId && attempt.quote?.purpose==='SHIPPING','PAYMENT_BINDING_MISMATCH');
        if(attempt.state==='PAID'&&attempt.order)return this.publicAttempt(attempt);
        requireValue(this.payment,'PAYMENT_NOT_CONFIGURED',503);
        let evidence;
        try { evidence=await this.payment.retrieve(attempt); } catch { return this.publicAttempt({...attempt,state:'UNKNOWN'}); }
        assertPaymentBinding(attempt,evidence);
        if(evidence.status==='succeeded') {
            assertPaidEvidence(attempt,evidence);
            const {order}=await this.repository.confirmShippingPaid({orderId,attemptId,evidence,receiptId:this.uuid()});
            return this.publicAttempt({...attempt,state:'PAID',order});
        }
        const state=evidence.status==='canceled'?'CANCELED':['requires_payment_method','requires_confirmation','requires_action'].includes(evidence.status)?'AWAITING_PAYMENT':'PROCESSING';
        return this.publicAttempt(await this.repository.recordShippingPayment(orderId,attemptId,{...evidence,state}));
    }
    async pay({ quoteId, requestId }) {
        requireValue(UUID.test(quoteId) && UUID.test(requestId), 'INVALID_REQUEST', 400);
        requireValue(this.payment, 'PAYMENT_NOT_CONFIGURED', 503);
        const reserved = await this.repository.reservePayment({ quoteId, requestId, attemptId: this.uuid(),
            merchant: this.payment.binding, now: this.clock().toISOString() });
        const attempt = reserved.attempt;
        if (!reserved.dispatch) return this.publicAttempt(attempt);
        try {
            const observation = await this.payment.create(attempt);
            await this.repository.recordPayment(attempt.id, observation);
        } catch {
            await this.repository.recordPayment(attempt.id, { state: 'UNKNOWN', code: 'PAYMENT_RECONCILIATION_REQUIRED' });
        }
        return this.reconcile(attempt.id);
    }
    publicAttempt(attempt) {
        return customerPayment(attempt, this.payment?.publishableKey);
    }
    async reconcile(attemptId) {
        requireValue(UUID.test(attemptId), 'INVALID_REQUEST', 400);
        let attempt = await this.repository.payment(attemptId);
        if (attempt.state === 'PAID' && attempt.order) return this.publicAttempt(attempt);
        requireValue(this.payment, 'PAYMENT_NOT_CONFIGURED', 503);
        let evidence;
        try { evidence = await this.payment.retrieve(attempt); }
        catch { return customerPayment({ id: attemptId, state: 'UNKNOWN', quote: attempt.quote }); }
        assertPaymentBinding(attempt,evidence);
        if (evidence.status === 'succeeded') {
            assertPaidEvidence(attempt, evidence);
            const receiptId = this.uuid();
            const { order } = await this.repository.confirmPaid({ attemptId, evidence, receiptId, effects: receiptEffects(receiptId, attempt.quote) });
            return customerPayment({ id:attemptId,state:'PAID',quote:attempt.quote,order });
        }
        const state = evidence.status === 'canceled' ? 'CANCELED' : evidence.status === 'requires_payment_method'
            || evidence.status === 'requires_confirmation' || evidence.status === 'requires_action' ? 'AWAITING_PAYMENT' : 'PROCESSING';
        attempt = await this.repository.recordPayment(attemptId, { ...evidence, state });
        return this.publicAttempt(attempt);
    }
    async runEffect(effectId) {
        const pending = await this.repository.effect(effectId);
        const shipping = ['FEDEX_LABEL','SHIPSTATION_LABEL'].includes(pending.kind);
        const provider = pending.kind === 'SHIPSTATION_LABEL' ? 'SHIPSTATION' : 'FEDEX';
        const carrier = shipping ? this.carrierFor(provider) : null;
        // Email-first launch retains historical SMS evidence without claiming a send.
        requireValue(pending.kind !== 'SMS_RECEIPT' || pending.state !== 'PENDING', 'SMS_NOTIFICATIONS_DISABLED', 409);
        // A missing adapter is a proven pre-dispatch refusal. Leave the durable
        // job pending so configuration can be supplied without a false UNKNOWN.
        let dispatchSnapshot;
        if (shipping) {
            requireValue(carrier, 'SHIPPING_NOT_CONFIGURED',503);
            if (pending.state === 'PENDING' && provider === 'FEDEX') assertShipmentDate(pending.request.shipment, this.clock());
            if (pending.state === 'PENDING' && provider === 'SHIPSTATION') {
                requireValue(pending.request.leg !== 'RETURN' || pending.fulfillment?.requestId, 'RETURN_LABEL_NOT_PREPARED',409);
                const shipment=clone(pending.request.shipment), now=this.clock();
                shipment.shipment.ship_date=localDate(now,shipment.shipDateTimeZone);
                const selected=pending.request.rate;
                const rate=selected?.requestHash===digest(shipment) && Date.parse(selected.expiresAt)>now.getTime() ? clone(selected) : await carrier.quote(shipment);
                const preparedAt=this.clock();
                // Rate retrieval takes time. Bind the durable preparation instant
                // after it completes; crossing local midnight requires a fresh rate.
                requireValue(shipment.shipment.ship_date===localDate(preparedAt,shipment.shipDateTimeZone),'SHIPPING_DATE_CHANGED',409);
                dispatchSnapshot={shipment,rate,preparedAt:preparedAt.toISOString(),originalRequestHash:digest(pending.request.shipment)};
            }
        }
        else if (pending.kind === 'TAX_TRANSACTION') requireValue(this.tax?.recordTransaction, 'TAX_NOT_CONFIGURED',503);
        else if (pending.kind === 'PACKAGE_LABEL') requireValue(this.packageLabel, 'PACKAGE_PRINT_NOT_CONFIGURED',503);
        else requireValue(this.notifications, 'RECEIPTS_NOT_CONFIGURED',503);
        const claimId = this.uuid(), claim = await this.repository.claimEffect(effectId, claimId, dispatchSnapshot);
        if (!claim.dispatch) return claim.effect;
        const effect = claim.effect;
        let result;
        try {
            if (effect.kind === 'SHIPSTATION_LABEL') {
                const dispatch=effect.dispatchSnapshot;
                requireValue(dispatch,'SHIPPING_DISPATCH_NOT_RECORDED');
                result = {...await carrier.createLabel(dispatch.shipment,effect.id,dispatch.rate),
                    requestHash:digest(effect.request.shipment),dispatchRequestHash:digest(dispatch.shipment)};
            } else if (effect.kind === 'FEDEX_LABEL') {
                result = await carrier.createLabel(effect.request.shipment, effect.id);
            } else if (effect.kind === 'TAX_TRANSACTION') {
                requireValue(this.tax?.recordTransaction, 'TAX_NOT_CONFIGURED');
                result = await this.tax.recordTransaction(effect.request, effect.id);
            } else if (effect.kind === 'PACKAGE_LABEL') {
                requireValue(this.packageLabel, 'PACKAGE_PRINT_NOT_CONFIGURED');
                result = await this.packageLabel(effect.request, effect.id);
            } else {
                requireValue(this.notifications, 'RECEIPTS_NOT_CONFIGURED');
                result = await this.notifications.send(effect.kind, effect.request, effect.id);
            }
        } catch {
            return this.repository.finishEffect({ effectId, claimId, state: 'UNKNOWN', result: { code: 'EFFECT_RECONCILIATION_REQUIRED' } });
        }
        return this.repository.finishEffect({ effectId, claimId, state: result?.state === 'PROCESSING' ? 'UNKNOWN' : 'SUCCEEDED', result });
    }
    async reconcileEffect(effectId) {
        const effect=await this.repository.effect(effectId);
        if(effect.state==='UNKNOWN' && effect.kind==='SHIPSTATION_LABEL') {
            const carrier=this.carrierFor('SHIPSTATION'),dispatch=effect.dispatchSnapshot;
            requireValue(carrier?.retrieveLabel && dispatch,'SHIPPING_NOT_CONFIGURED',503);
            const result={...await carrier.retrieveLabel(dispatch.shipment,effect.id,dispatch.rate),requestHash:digest(effect.request.shipment),dispatchRequestHash:digest(dispatch.shipment)};
            if(result.state==='PROCESSING')return effect;
            return this.repository.finishEffect({effectId,claimId:effect.claimId,state:'SUCCEEDED',result});
        }
        if(effect.state!=='UNKNOWN'||effect.kind!=='FEDEX_LABEL'||!effect.result?.jobId)return effect;
        const carrier=this.carrierFor('FEDEX');
        requireValue(carrier?.retrieveAsync,'SHIPPING_NOT_CONFIGURED',503);
        const result={...await carrier.retrieveAsync(effect.result.jobId,effect.request.shipment),jobId:effect.result.jobId};
        return this.repository.finishEffect({effectId,claimId:effect.claimId,state:'SUCCEEDED',result});
    }
    async trackEffect(effectId) {
        const effect=await this.repository.effect(effectId);
        requireValue(effect.kind==='SHIPSTATION_LABEL' && effect.state==='SUCCEEDED','LABEL_NOT_READY',409);
        const carrier=this.carrierFor('SHIPSTATION'); requireValue(carrier?.track,'SHIPPING_NOT_CONFIGURED',503);
        return this.repository.recordTracking(effectId,await carrier.track(effect.result.providerId,effect.result.trackingNumber));
    }
}
