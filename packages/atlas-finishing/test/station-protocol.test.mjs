import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { stationKeys } from '../../atlas-connected-manual/test/finishing-station-fixture.mjs';
import { stationCanonical, stationPublicKey, verifyStationSignature, validateStationChallenge, STATION_WIRE as W } from '../src/station-protocol.mjs';

test('real P256 envelope validates exact canonical bytes and rejects tampering, wrong key, extra fields and noncanonical payload', async () => {
  const f = stationKeys(), value = { z: [true, 42], a: 'card' }, signed = await f.signer.signClaims(value);
  assert.deepEqual(await f.verifier.verifyEnvelope(signed), value);
  await assert.rejects(f.verifier.verifyEnvelope({ ...signed, keyId: 'foreign-key' }));
  await assert.rejects(f.verifier.verifyEnvelope({ ...signed, payload: Buffer.from(stationCanonical({ ...value, a: 'other card' })).toString('base64url') }));
  await assert.rejects(f.verifier.verifyEnvelope({ ...signed, qualified: true }));
  const bytes = Buffer.from(JSON.stringify(value));
  await assert.rejects(f.verifier.verifyEnvelope({ ...signed, payload: bytes.toString('base64url'), signature: sign('sha256', bytes, f.host.privateKey).toString('base64url') }));
  await assert.rejects(stationKeys().verifier.verifyEnvelope(signed));
});
test('station signatures use real DER verification and refuse curve/key encoding confusion', () => {
  const f = stationKeys(), value = { test: 'native-proof' };
  assert.equal(verifyStationSignature(f.enrollment.publicKeySpki, value, f.signNative(value)), true);
  assert.throws(() => verifyStationSignature(f.enrollment.publicKeySpki, { test: 'altered' }, f.signNative(value)));
  assert.throws(() => verifyStationSignature(f.enrollment.publicKeySpki, value, 'A'.repeat(96)));
  assert.throws(() => stationPublicKey(f.enrollment.publicKeySpki + '='));
  const other = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  assert.throws(() => stationPublicKey(other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')));
});
test('challenge bounds expire within two minutes and reject replay-shaped injected metadata', () => {
  const f = { version: W.challenge, challengeId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222',
    stationId: 'fixture', origin: 'https://atlasgrading.com', nonce: 'A'.repeat(43), issuedAt: 1000, expiresAt: 121000 };
  assert.equal(validateStationChallenge(f), f);
  for (const patch of [{ expiresAt: 121001 }, { issuedAt: 121000 }, { origin: 'https://app.atlasgrading.com' }, { nonce: 'short' }, { trusted: true }])
    assert.throws(() => validateStationChallenge({ ...f, ...patch }));
});
