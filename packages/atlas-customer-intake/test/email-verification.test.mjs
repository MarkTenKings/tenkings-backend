import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createEmailVerificationService } from '../src/email-verification.mjs';
import { canonicalEmail, shopProfile, contactProfileInput } from '../src/profile.mjs';

test('email comparison preserves local part and aliases; shop entry requires email without rewriting legacy contact shapes', () => {
  assert.equal(canonicalEmail('  Alex+Cards@EXAMPLE.COM  '), 'Alex+Cards@example.com');
  assert.notEqual(canonicalEmail('Alex@example.com'), canonicalEmail('alex@example.com'));
  assert.notEqual(canonicalEmail('a.b@example.com'), canonicalEmail('ab@example.com'));
  for (const value of [null, '', 'a@@example.com', 'a b@example.com', 'a@example.com\nheader', '\ta@example.com\t', '\u00a0a@example.com\u00a0']) assert.equal(canonicalEmail(value), null);
  assert.throws(() => shopProfile({ name: 'Alex' }), { code: 'CONTACT_DETAILS_REQUIRED' });
  assert.deepEqual(contactProfileInput({ name: 'Legacy' }), { name: 'Legacy' });
});
function fixture({ outcome = 'ACCEPTED' } = {}) {
  const raw = 'A'.repeat(43), id = randomUUID(), draftId = randomUUID(), requestId = randomUUID(), calls = [];
  let claimed = false;
  const sender = { async sendVerification(input, effectId) {
    assert(claimed); calls.push({ kind: 'SEND', input, effectId });
    if (outcome === 'THROW') throw Error('synthetic provider uncertainty');
    return { provider: 'SENDGRID', providerId: 'synthetic-id', deliveryStatus: outcome };
  } };
  const call = async (kind, value) => {
    calls.push({ kind, value });
    if (kind === 'claim') {
      if (claimed) return { dispatch: false, status: { state: 'UNKNOWN', verified: false } };
      claimed = true; return { dispatch: true, to: 'Alex@example.invalid' };
    }
    return { state: value.result ? 'SENT' : 'UNKNOWN', verified: false };
  };
  return { raw, id, calls, input: { draftId, requestId }, authority: { fixture: true },
    service: createEmailVerificationService({ enabled: true, sender, call, token: () => raw, claimId: () => id }) };
}
test('durable claim stores only token hash and precedes one sender call; accepted mail is still unverified', async () => {
  const f = fixture(), value = await f.service.request(f.authority, f.input);
  assert.deepEqual(value, { state: 'SENT', verified: false });
  assert.deepEqual(f.calls.map(c => c.kind), ['claim', 'SEND', 'finish']);
  assert.equal(f.calls[0].value.tokenHash, createHash('sha256').update(f.raw).digest('hex'));
  assert(!JSON.stringify(f.calls[0]).includes(f.raw));
  assert.equal(f.calls[1].input.verificationUrl, `https://atlasgrading.com/account/verify-email#token=${f.raw}`);
  assert.equal(f.calls[1].effectId, `email-verification:${f.id}`);
  assert(!JSON.stringify(value).includes(f.raw));
});
test('provider uncertainty and idempotent request replay never repeat dispatch', async () => {
  const f = fixture({ outcome: 'THROW' });
  assert.equal((await f.service.request(f.authority, f.input)).state, 'UNKNOWN');
  assert.equal((await f.service.request(f.authority, f.input)).state, 'UNKNOWN');
  assert.equal(f.calls.filter(c => c.kind === 'SEND').length, 1);
  assert.equal(f.calls.find(c => c.kind === 'finish').value.result, null);
});
test('malformed acceptance cannot become a claimed send or verification', async () => {
  const f = fixture({ outcome: 'DELIVERED' });
  assert.deepEqual(await f.service.request(f.authority, f.input), { state: 'UNKNOWN', verified: false });
});
test('cold configuration and malformed requests refuse before database or provider work', async () => {
  let calls = 0;
  const cold = createEmailVerificationService({ call: () => { calls++; } });
  await assert.rejects(cold.request({}, {}), { code: 'EMAIL_VERIFICATION_NOT_CONFIGURED' });
  assert.equal(calls, 0);
  const f = fixture();
  await assert.rejects(f.service.request({}, { ...f.input, to: 'untrusted@example.invalid' }), { code: 'INVALID_REQUEST' });
  assert.equal(f.calls.length, 0);
});
