import { createHash, randomUUID } from 'node:crypto';
import { assertPaidEvidence, requireValue, receiptEffects, UUID } from './contract.mjs';
import { verifyStripeWebhook } from './providers.mjs';

/** Called from a separate raw-body endpoint with a commerce-only SQL role. */
export async function consumeStripeWebhook({rawBody,signature,secret,payment,repository,now=Date.now()}) {
    const event=verifyStripeWebhook({rawBody,signature,secret,now});
    requireValue(event.livemode===payment.binding.livemode && (!event.account||event.account===payment.binding.accountId),'WEBHOOK_MERCHANT_MISMATCH',400);
    if(!event.type.startsWith('payment_intent.'))return {received:true,ignored:true};
    const attemptId=event.data.object.metadata?.atlas_attempt;
    requireValue(UUID.test(attemptId??''),'WEBHOOK_ATTEMPT_INVALID',400);
    const attempt=await repository.callbackPayment(attemptId);
    requireValue(event.data.object.id && (!attempt.providerId||attempt.providerId===event.data.object.id),'PAYMENT_ID_MISMATCH');
    await repository.providerEvent({eventId:event.id,merchantId:payment.binding.accountId,livemode:event.livemode,
        attemptId,bodyHash:createHash('sha256').update(rawBody).digest('hex')});
    // Replayed events still retrieve/reconcile: a previous request may have
    // committed the event then failed before the paid-order transaction.
    const evidence=await payment.retrieve({...attempt,providerId:event.data.object.id});
    if(evidence.status!=='succeeded')return {received:true,state:evidence.status};
    assertPaidEvidence(attempt,evidence);const receiptId=randomUUID();
    const {order}=await repository.callbackConfirm({attemptId,evidence,receiptId,...(attempt.quote.purpose==='SHIPPING'?{orderId:attempt.orderId}:{effects:receiptEffects(receiptId,attempt.quote)})});
    return {received:true,orderId:order.id};
}
