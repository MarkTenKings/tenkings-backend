import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CustomerIntakeError } from './contract.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (code, status = 400) => { throw new CustomerIntakeError(status, code); };

/** The committed database claim precedes delivery. A lost provider reply is
 * uncertain, never permission to resend the same request. Raw tokens exist
 * only in this invocation and the outgoing email; the database stores a hash. */
export function createEmailVerificationService({ call, sender, enabled = false,
    token = () => randomBytes(32).toString('base64url'), claimId = randomUUID }) {
  return Object.freeze({ async request(authority, input) {
    if (!enabled || !sender?.sendVerification) fail('EMAIL_VERIFICATION_NOT_CONFIGURED', 503);
    if (!input || Object.keys(input).sort().join(',') !== 'draftId,requestId'
        || !uuid.test(input.draftId ?? '') || !uuid.test(input.requestId ?? '')) fail('INVALID_REQUEST');
    const raw = token(), id = claimId();
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw) || !uuid.test(id)) fail('EMAIL_VERIFICATION_NOT_CONFIGURED', 503);
    const result = await call('claim', { authority, ...input, claimId: id, tokenHash: digest(raw) });
    if (!result.dispatch) return result.status;
    let accepted = null;
    try {
      const response = await sender.sendVerification({ to: result.to,
        verificationUrl: `https://atlasgrading.com/account/verify-email#token=${raw}` }, `email-verification:${id}`);
      if (response?.provider === 'SENDGRID' && response.deliveryStatus === 'ACCEPTED'
          && typeof response.providerId === 'string' && response.providerId.length > 0 && response.providerId.length <= 200)
        accepted = response;
    } catch { /* Uncertain dispatch remains durable and is never retried. */ }
    return call('finish', { claimId: id, tokenHash: digest(raw), result: accepted });
  } });
}
