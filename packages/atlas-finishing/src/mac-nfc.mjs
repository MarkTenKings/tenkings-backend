import { createHash } from 'node:crypto';
import { validateManualFinishingPlan } from './manual.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, code) => { if (!ok) throw new Error(code); };
const SHA = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROFILE = 'atlas-mac-f8215-production-v1';
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const interrupted = new Set(['PROCESSING', 'WRITE_INTENT', 'READBACK_VERIFIED', 'LOCK_INTENT']);

/** Same short URI/TLV layout used by the native diagnostic, but only accepts a
 * validated production plan's exact versioned public URL. No generic URL input. */
export function encodeApprovedNdef(plan) {
  validateManualFinishingPlan(plan); assert(plan.label.mode === 'PRODUCTION', 'MAC_NFC_FIXTURE_REJECTED');
  const suffix = Buffer.from(plan.nfc.url.slice('https://'.length), 'utf8'), length = suffix.length + 5;
  assert(length <= 254, 'MAC_NFC_URI_TOO_LONG');
  const bytes = Buffer.alloc(Math.ceil((length + 3) / 4) * 4);
  bytes.set([3, length, 0xd1, 1, suffix.length + 1, 0x55, 4]); suffix.copy(bytes, 7); bytes[suffix.length + 7] = 0xfe;
  return bytes;
}

/** PC/SC data primitives mirror CAtlasNFCDiagnostic read16/writePage. Native
 * session ownership, transient same-tag checks and deadlines belong to the
 * injected transport. There is no discovery, connect, or arbitrary APDU route.
 * Qualified page bounds come from protected station configuration, never a plan. */
export function createQualifiedType2Io({ transmit, firstPage, lastPage }) {
  assert(typeof transmit === 'function' && Number.isInteger(firstPage) && firstPage >= 4
    && Number.isInteger(lastPage) && lastPage >= firstPage + 3 && lastPage <= 255, 'MAC_NFC_DATA_RANGE_INVALID');
  return Object.freeze({
    async read16(page, options) {
      assert(Number.isInteger(page) && page >= firstPage && page + 3 <= lastPage, 'MAC_NFC_DATA_RANGE_INVALID');
      const response = await transmit(Buffer.from([0xff, 0xb0, 0, page, 16]), options);
      assert(Buffer.isBuffer(response) && response.length === 18 && response[16] === 0x90 && response[17] === 0, 'MAC_NFC_READ_REJECTED');
      return Buffer.from(response.subarray(0, 16));
    },
    async writePage(page, bytes, options) {
      assert(Number.isInteger(page) && page >= firstPage && page <= lastPage && Buffer.isBuffer(bytes) && bytes.length === 4, 'MAC_NFC_DATA_RANGE_INVALID');
      const command = Buffer.concat([Buffer.from([0xff, 0xd6, 0, page, 4]), Buffer.from(bytes)]);
      const response = await transmit(command, options);
      assert(Buffer.isBuffer(response) && response.length === 2 && response[0] === 0x90 && response[1] === 0, 'MAC_NFC_WRITE_REJECTED');
    },
  });
}

/** Qualified native station core. Dependencies are protected local services;
 * none may be supplied as browser callbacks or model-generated configuration.
 * This module imports no PC/SC binding and never touches hardware on creation. */
export function createMacNfcStation({ profile, signer, authority, pcsc, host, journal, clock = () => Date.now(), timeoutMs = 60000 }) {
  assert(profile?.id === PROFILE && profile.qualified === true && SHA.test(profile.qualificationHash)
    && typeof profile.identifyWritable === 'function' && typeof profile.lock === 'function' && typeof profile.verifyLock === 'function'
    && Number.isInteger(profile.firstUserPage) && profile.firstUserPage >= 4 && Number.isInteger(profile.lastUserPage)
    && profile.lastUserPage >= profile.firstUserPage + 3 && profile.lastUserPage <= 255, 'MAC_NFC_QUALIFIED_PROFILE_REQUIRED');
  const enrollment = structuredClone(signer?.capability);
  assert(enrollment?.enrolled === true && enrollment.protectedKey === true && ID.test(enrollment.keyId)
    && ID.test(enrollment.stationId) && ID.test(enrollment.enrollmentId)
    && typeof signer.sign === 'function' && typeof signer.verify === 'function', 'MAC_NFC_ENROLLED_SIGNER_REQUIRED');
  assert(typeof authority?.verifyArm === 'function' && typeof host?.acknowledge === 'function' && typeof host?.verifyAcknowledgement === 'function'
    && typeof pcsc?.connectExclusive === 'function' && typeof pcsc?.observeEmpty === 'function'
    && journal?.capability?.durable === true && ['reserve', 'read', 'advance'].every(name => typeof journal[name] === 'function')
    && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'MAC_NFC_CONFIGURATION_INVALID');
  const qualified = { id: profile.id, qualificationHash: profile.qualificationHash,
    firstUserPage: profile.firstUserPage, lastUserPage: profile.lastUserPage,
    identifyWritable: profile.identifyWritable.bind(profile), lock: profile.lock.bind(profile), verifyLock: profile.verifyLock.bind(profile) };
  const profileHash = hash(stable({ id: qualified.id, qualificationHash: qualified.qualificationHash,
    firstUserPage: qualified.firstUserPage, lastUserPage: qualified.lastUserPage }));
  const view = record => ({ intentId: record.intentId, planHash: record.planHash, state: record.state,
    readbackVerified: record.readbackVerified, lockVerified: record.lockVerified,
    removalObserved: record.removalObserved, hostedAcknowledged: record.hostedAcknowledged, assembly: 'NOT_RECORDED' });
  const checkTime = (record, signal) => { signal?.throwIfAborted(); assert(record.expiresAt > clock(), 'MAC_NFC_AUTHORIZATION_EXPIRED'); };
  async function authorize(plan, association, allowExpired = false) {
    validateManualFinishingPlan(plan); assert(plan.label.mode === 'PRODUCTION', 'MAC_NFC_FIXTURE_REJECTED');
    assert(association?.armed === true && association.stationId === enrollment.stationId && association.planHash === plan.planHash
      && association.cardId === plan.binding.cardId && association.approvalActionId === plan.binding.approvalActionId
      && Number.isSafeInteger(association.expiresAt) && (allowExpired || association.expiresAt > clock())
      && association.expiresAt - clock() <= 15 * 60000, 'MAC_NFC_ASSOCIATION_INVALID');
    const claims = await authority.verifyArm({ plan: structuredClone(plan), association: structuredClone(association), profileHash, enrollment, allowExpired });
    assert(claims?.intentId === plan.nfc.intentId && claims.planHash === plan.planHash && claims.profileHash === profileHash
      && claims.stationId === enrollment.stationId && claims.enrollmentId === enrollment.enrollmentId
      && claims.expiresAt === association.expiresAt && ID.test(claims.nonce), 'MAC_NFC_AUTHORIZATION_INVALID');
    return { version: 'atlas-mac-nfc-intent-v1', intentId: plan.nfc.intentId, planHash: plan.planHash, profileHash,
      stationId: enrollment.stationId, enrollmentId: enrollment.enrollmentId, keyId: enrollment.keyId,
      expiresAt: claims.expiresAt, authorizationHash: hash(stable(claims)), nonce: claims.nonce,
      ndefHash: hash(encodeApprovedNdef(plan)), revision: 0, state: 'WAITING_FOR_TAG',
      readbackVerified: false, lockVerified: false, removalObserved: false, hostedAcknowledged: false };
  }
  async function exact(plan, association, allowExpired = false) {
    const expected = await authorize(plan, association, allowExpired), record = await journal.read(expected.intentId);
    assert(record && ['intentId', 'planHash', 'profileHash', 'stationId', 'enrollmentId', 'keyId', 'expiresAt', 'authorizationHash', 'ndefHash']
      .every(key => record[key] === expected[key]), 'MAC_NFC_INTENT_CONFLICT'); return record;
  }
  const advance = (record, patch) => journal.advance(record.intentId, record.revision, patch);
  async function acknowledge(record) {
    if (record.hostedAcknowledged) return record;
    try {
      // Custody relay may outlive the arm only for the immutable signed receipt.
      // The host must return an exact already-committed result after expiry.
      assert(record.receipt && hash(stable(record.receipt)) === record.receiptHash
        && await signer.verify(Buffer.from(stable(record.receipt)), record.signature), 'MAC_NFC_STORED_RECEIPT_INVALID');
      const response = await host.acknowledge({ receipt: record.receipt, signature: record.signature });
      const ack = await host.verifyAcknowledgement(response);
      assert(ack?.intentId === record.intentId && ack.receiptHash === record.receiptHash && ack.enrollmentId === record.enrollmentId
        && ack.stationId === record.stationId && ack.planHash === record.planHash && ack.authorizationHash === record.authorizationHash
        && ack.kind === 'WRITE' && ack.committed === true, 'MAC_NFC_HOST_ACK_INVALID');
      return advance(record, { hostedAcknowledged: true, state: record.removalObserved ? 'NFC_COMPLETE' : 'WAITING_FOR_REMOVAL' });
    } catch { return record; } // Lost acknowledgement never means saved, nor permits a tag rewrite.
  }
  async function signVerified(record) {
    if (record.receipt) return record;
    checkTime(record); assert(record.readbackVerified && record.lockVerified, 'MAC_NFC_VERIFICATION_REQUIRED');
    const receipt = { version: 'atlas-mac-nfc-result-v1', intentId: record.intentId, planHash: record.planHash,
      profileHash: record.profileHash, stationId: record.stationId, enrollmentId: record.enrollmentId, keyId: record.keyId,
      authorizationHash: record.authorizationHash, nonce: record.nonce, ndefHash: record.ndefHash,
      readbackVerified: true, lockVerified: true };
    const bytes = Buffer.from(stable(receipt)), signature = await signer.sign(bytes);
    assert(typeof signature === 'string' && /^[A-Za-z0-9+/=_-]{16,4096}$/.test(signature)
      && await signer.verify(bytes, signature), 'MAC_NFC_SIGNATURE_INVALID');
    return advance(record, { receipt, receiptHash: hash(bytes), signature, state: 'WAITING_FOR_HOST_ACK' });
  }
  return Object.freeze({ capability: Object.freeze({ qualified: true, profile: PROFILE, profileHash, stationId: enrollment.stationId }),
    async prepare({ plan, association }) {
      plan = structuredClone(plan); association = structuredClone(association);
      const reserved = await journal.reserve(await authorize(plan, association)); return view(reserved.record);
    },
    async onTagPresent({ plan, association }) {
      plan = structuredClone(plan); association = structuredClone(association);
      let record = await exact(plan, association);
      if (record.state !== 'WAITING_FOR_TAG') return view(record);
      // Atomic durable claim prevents concurrent callbacks/processes from writing twice.
      record = await advance(record, { state: 'PROCESSING' });
      const signal = AbortSignal.timeout(Math.min(timeoutMs, Math.max(1, record.expiresAt - clock())));
      let session;
      try {
        checkTime(record, signal); session = await pcsc.connectExclusive({ signal });
        assert(['read16', 'writePage', 'assertSameTag', 'waitForRemoval', 'close'].every(name => typeof session?.[name] === 'function'), 'MAC_NFC_SESSION_INVALID');
        assert(await qualified.identifyWritable(session, { signal }) === true, 'MAC_NFC_TAG_UNQUALIFIED');
        const data = encodeApprovedNdef(plan), extent = Math.ceil((data.length + 16) / 16) * 16;
        assert(qualified.firstUserPage + extent / 4 - 1 <= qualified.lastUserPage, 'MAC_NFC_CAPACITY_INVALID');
        const read = async () => {
          const bytes = Buffer.alloc(extent);
          for (let offset = 0; offset < extent; offset += 16) {
            checkTime(record, signal); await session.assertSameTag({ signal });
            const part = await session.read16(qualified.firstUserPage + offset / 4, { signal });
            assert(Buffer.isBuffer(part) && part.length === 16, 'MAC_NFC_READ_REJECTED'); part.copy(bytes, offset);
          } return bytes;
        };
        const before = await read();
        assert(before[0] === 3 && before[1] === 0 && before[2] === 0xfe && before.subarray(3).every(byte => byte === 0), 'MAC_NFC_TAG_NOT_EMPTY');
        record = await advance(record, { state: 'WRITE_INTENT' });
        for (let step = 1; step <= data.length / 4; step++) {
          const index = step === data.length / 4 ? 0 : step, page = qualified.firstUserPage + index;
          checkTime(record, signal); await session.assertSameTag({ signal });
          const bytes = Buffer.from(data.subarray(index * 4, index * 4 + 4));
          await session.writePage(page, bytes, { signal }); // Header is published last.
          checkTime(record, signal); await session.assertSameTag({ signal });
          const found = await session.read16(page, { signal });
          assert(Buffer.isBuffer(found) && found.length === 16 && found.subarray(0, 4).equals(bytes), 'MAC_NFC_READBACK_MISMATCH');
        }
        const matches = bytes => bytes.subarray(0, data.length).equals(data) && bytes.subarray(data.length).equals(before.subarray(data.length));
        assert(matches(await read()), 'MAC_NFC_READBACK_MISMATCH');
        record = await advance(record, { state: 'READBACK_VERIFIED', readbackVerified: true });
        checkTime(record, signal); await session.assertSameTag({ signal });
        record = await advance(record, { state: 'LOCK_INTENT' });
        // Only the externally reviewed F8215 implementation supplies security-page
        // operations. This module contains no lock addresses, masks, or guesses.
        await qualified.lock(session, { signal });
        checkTime(record, signal); await session.assertSameTag({ signal });
        assert(await qualified.verifyLock(session, { signal }) === true && matches(await read()), 'MAC_NFC_LOCK_NOT_VERIFIED');
        record = await advance(record, { state: 'LOCK_VERIFIED', lockVerified: true });
        record = await signVerified(record); record = await acknowledge(record);
        checkTime(record, signal);
        assert(await session.waitForRemoval({ signal }) === true, 'MAC_NFC_REMOVAL_UNOBSERVED');
        record = await advance(record, { removalObserved: true, state: record.hostedAcknowledged ? 'NFC_COMPLETE' : 'WAITING_FOR_HOST_ACK' });
      } catch {
        // Verified/locked facts survive an uncertain later operation. There is no
        // automatic mutating retry, even when zero writes may have occurred.
        if (!record.receipt && record.state !== 'LOCK_VERIFIED') {
          try { record = await advance(record, { state: 'UNKNOWN' }); } catch { /* Durable prior state fences another write. */ }
        }
      } finally { try { await session?.close(); } catch { /* A lost release does not manufacture new tag evidence. */ } }
      return view(record);
    },
    async recover({ plan, association }) {
      let record = await exact(structuredClone(plan), structuredClone(association), true);
      if (record.expiresAt <= clock()) {
        // No new RF observation, signature, mutation attempt or renewed arm.
        // Missing signed evidence keeps this occupied for explicit reconciliation.
        if (record.receipt && !record.hostedAcknowledged) record = await acknowledge(record);
        return view(record);
      }
      if (interrupted.has(record.state)) return view(await advance(record, { state: 'UNKNOWN' }));
      if (record.state === 'LOCK_VERIFIED') record = await signVerified(record);
      if (record.receipt) {
        record = await acknowledge(record);
        if (!record.removalObserved && await pcsc.observeEmpty({ signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)) }) === true) {
          record = await advance(record, { removalObserved: true, state: record.hostedAcknowledged ? 'NFC_COMPLETE' : 'WAITING_FOR_HOST_ACK' });
        }
      }
      return view(record);
    },
    async status(intentId) { const record = await journal.read(intentId); return record ? view(record) : null; },
  });
}
