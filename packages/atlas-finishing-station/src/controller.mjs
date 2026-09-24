import { stationAssert as check, stationObject as exact, stationCanonical, stationHash, stationProfileHash,
  createStationVerifier, validateStationArm, validateStationEnrollment, validateStationAcknowledgement, validateStationChallenge,
  verifyStationSignature, stationEnrollmentProof, stationSha } from '@atlas/finishing/station-protocol';
import { validateManualFinishingPlan } from '@atlas/finishing/manual';
import { createMacNfcStation, encodeApprovedNdef } from '@atlas/finishing/mac-nfc';

/** Trusted local composition only. Browser input is restricted to hosted signed
 * plans/acknowledgements; no device, printer, filesystem or command parameters. */
export function createStationController({ config, native, journal, nfcJournal, printer, capabilities, key, now = Date.now }) {
  const verifier = createStationVerifier({ publicKeys: [{ keyId: config.hostKeyId, publicKeySpki: config.hostPublicKeySpki }] });
  const profileHash = stationProfileHash(config.profile);
  check(config.profile.profileHash === profileHash, 'STATION_PROFILE_MISMATCH');
  if (key) check(key.protectedKey === true && ['stationId','enrollmentId','keyId','protectionEvidenceHash'].every(name => key[name] === config[name]), 'STATION_KEY_MISMATCH');
  let nfc = null, working = null, stopped = false;
  async function enrollment() {
    const envelope = (await journal.state()).enrollment; if (!envelope) return null;
    const claims = validateStationEnrollment(await verifier.verifyEnvelope(envelope));
    check(key && ['stationId','enrollmentId','keyId','protectionEvidenceHash'].every(name => claims[name] === config[name])
      && claims.keyFingerprint === key.fingerprint, 'STATION_ENROLLMENT_MISMATCH');
    if (claims.state === 'ACTIVE') check(claims.profileHash === profileHash && claims.qualificationHash === config.profile.qualificationHash, 'STATION_ENROLLMENT_PROFILE_MISMATCH');
    return claims;
  }
  async function ready() {
    const enrolled = await enrollment();
    return Boolean(key && capabilities.qualifiedProfileAvailable === true && printer?.capability.qualified === true && enrolled?.state === 'ACTIVE');
  }
  async function verifyArm(plan, association, allowExpired = false) {
    validateManualFinishingPlan(plan); check(plan.label.mode === 'PRODUCTION', 'STATION_FIXTURE_REFUSED');
    const claims = validateStationArm(await verifier.verifyEnvelope(association.authorization)), enrolled = await enrollment();
    check(enrolled?.state === 'ACTIVE' && association.armed === true && association.stationId === config.stationId
      && association.planHash === plan.planHash && association.cardId === plan.binding.cardId
      && association.approvalActionId === plan.binding.approvalActionId && association.expiresAt === claims.expiresAt,
    'STATION_ARM_BINDING_INVALID');
    const binding = { stationId: config.stationId, enrollmentId: config.enrollmentId, keyId: config.keyId,
      profileHash, qualificationHash: config.profile.qualificationHash, activationId: enrolled.activationId,
      ...plan.binding, intentId: plan.nfc.intentId, planHash: plan.planHash, url: plan.nfc.url,
      ndefHash: stationHash(encodeApprovedNdef(plan)), firstUserPage: config.profile.firstUserPage, lastUserPage: config.profile.lastUserPage };
    for (const name of ['stationId','enrollmentId','keyId','profileHash','qualificationHash','activationId','cardId','approvalActionId',
      'publicHash','reportHash','approvalVersion','reportNumber','intentId','planHash','url','ndefHash','firstUserPage','lastUserPage']) {
      check(claims[name] === binding[name], 'STATION_ARM_BINDING_INVALID');
    }
    check(claims.issuedAt <= now() && (allowExpired || claims.expiresAt > now()), 'STATION_ARM_EXPIRED'); return claims;
  }
  async function core() {
    if (nfc) return nfc; check(await ready(), 'STATION_SETUP_PENDING', 409);
    const call = (op, fields = {}, options) => native.request(op, fields, options);
    nfc = createMacNfcStation({ clock: now, journal: nfcJournal,
      profile: { ...config.profile, qualified: true,
        identifyWritable: async (_, options) => (await call('identify-qualified', {}, options)).qualified === true,
        lock: (_, options) => call('lock-qualified', {}, options),
        verifyLock: async (_, options) => (await call('verify-lock', {}, options)).lockVerified === true },
      signer: { capability: { enrolled: true, protectedKey: true, stationId: config.stationId, enrollmentId: config.enrollmentId, keyId: config.keyId },
        sign: async bytes => (await call('sign-receipt', { receipt: JSON.parse(bytes.toString('utf8')) })).signature,
        verify: (bytes, signature) => verifyStationSignature(key.publicKeySpki, JSON.parse(bytes.toString('utf8')), signature) },
      authority: { verifyArm: ({ plan, association, allowExpired }) => verifyArm(plan, association, allowExpired === true) },
      host: {
        async acknowledge({ receipt }) { const record = await journal.get(receipt.planHash); check(record?.writeAck, 'STATION_HOST_RELAY_REQUIRED'); return record.writeAck; },
        async verifyAcknowledgement(envelope) { return validateStationAcknowledgement(await verifier.verifyEnvelope(envelope)); },
      },
      pcsc: {
        async connectExclusive(options) {
          check((await call('open', {}, options)).opened === true, 'STATION_NATIVE_OPEN_REFUSED');
          return {
            async read16(page, opts) { const value = await call('read16', { page }, opts); check(/^[a-fA-F0-9]{32}$/.test(value.hex), 'STATION_NATIVE_READ_INVALID'); return Buffer.from(value.hex, 'hex'); },
            async writePage(page, bytes, opts) { check((await call('write4', { page, hex: bytes.toString('hex') }, opts)).written === true, 'STATION_NATIVE_WRITE_INVALID'); },
            async assertSameTag(opts) { check((await call('same-tag', {}, opts)).sameTag === true, 'STATION_TAG_CHANGED'); },
            async waitForRemoval(opts) { return (await call('wait-removed', { timeoutMs: 5000 }, opts)).removed === true; },
            close: () => call('close'),
          };
        },
        async observeEmpty(options) { return (await call('observe-empty', {}, options)).empty === true; },
      },
    }); return nfc;
  }
  async function removal(record) {
    const saved = await nfcJournal.read(record.plan.nfc.intentId);
    if (saved?.state !== 'NFC_COMPLETE' || !saved.removalObserved || !saved.hostedAcknowledged || record.removal) return;
    check(record.association.expiresAt > now(), 'STATION_REMOVAL_AUTHORIZATION_EXPIRED');
    check(record.writeAck && saved.receipt && saved.receiptHash === stationHash(stationCanonical(saved.receipt)), 'STATION_REMOVAL_INVALID');
    await native.request('accept-ack', { envelope: record.writeAck });
    const receipt = { version: 'atlas-mac-nfc-removal-v1', stationId: config.stationId, enrollmentId: config.enrollmentId,
      keyId: config.keyId, intentId: saved.intentId, planHash: saved.planHash, authorizationHash: saved.authorizationHash,
      nonce: saved.nonce, receiptHash: saved.receiptHash, removalObserved: true };
    const { signature } = await native.request('sign-removal', { receipt }); verifyStationSignature(key.publicKeySpki, receipt, signature);
    await journal.update(record.plan.planHash, { removal: { receipt, signature } });
  }
  function work(record, first = false) {
    if (working || stopped || record.completed) return;
    working = (async () => {
      const station = await core(); await verifyArm(record.plan, record.association, !first);
      const saved = await nfcJournal.read(record.plan.nfc.intentId);
      if (saved?.state === 'UNKNOWN') return;
      if (saved?.receipt) {
        if (record.association.expiresAt > now() && !record.removal) await native.request('restore-receipt', { envelope: record.association.authorization, receipt: saved.receipt, signature: saved.signature });
      } else {
        check(record.association.expiresAt > now(), 'STATION_ARM_EXPIRED');
        const nativeArm = await native.request('arm', { envelope: record.association.authorization });
        check(nativeArm.state === 'WAITING_FOR_TAG', 'STATION_SETUP_PENDING');
      }
      if (first) {
        // Independently dispatched branches. A rejected NFC path does not invent
        // print success, and CUPS errors do not suppress NFC preparation.
        const results = await Promise.allSettled([printer.prepare({ plan: record.plan }), station.prepare(record)]);
        if (results[0].status === 'rejected') await journal.update(record.plan.planHash, { lastError: 'STATION_PRINT_PREPARATION_FAILED' });
        if (results[1].status === 'rejected') throw results[1].reason;
      } else if (!saved) await station.prepare(record); // Crash after bridge reserve: no prior NFC effect exists. Never resubmit print here.
      else await station.recover(record);
      let state = await station.status(record.plan.nfc.intentId);
      while (!stopped && state?.state === 'WAITING_FOR_TAG' && record.association.expiresAt > now()) {
        const presence = await native.request('presence');
        if (presence.state === 'PRESENT' && [0, 1].includes(presence.selected)) { await station.onTagPresent(record); break; }
        check(presence.state === 'EMPTY' && presence.selected === null, 'STATION_TAG_SELECTION_AMBIGUOUS');
        await new Promise(resolve => setTimeout(resolve, 300)); state = await station.status(record.plan.nfc.intentId);
      }
      await removal(await journal.get(record.plan.planHash));
    })().catch(async error => { const code = error.code ?? error.message;
      try { await journal.update(record.plan.planHash, { lastError: /^[A-Z0-9_]{1,100}$/.test(code ?? '') ? code : 'STATION_RECOVERY_REQUIRED' }); } catch { /* Existing durable reservation still fences every later card. */ }
    }).finally(() => { working = null; });
  }
  async function operation({ planHash }) {
    stationSha(planHash); const record = await journal.get(planHash); check(record, 'STATION_INTENT_MISSING', 404);
    const saved = await nfcJournal.read(record.plan.nfc.intentId);
    if (!working && !record.completed) work(record);
    let print = { state: 'UNKNOWN' }; try { print = await printer.status(record.plan.print.intentId, planHash); } catch { /* Uncertain never means submitted. */ }
    return { planHash, cardId: record.plan.binding.cardId, approvalActionId: record.plan.binding.approvalActionId,
      print: { state: print.state }, nfc: { state: record.completed ? 'COMPLETE' : saved?.state ?? 'RECOVERY_REQUIRED' }, completed: record.completed, reason: record.lastError ?? null,
      ...(saved?.receipt && !record.writeAck ? { write: { receipt: saved.receipt, signature: saved.signature } } : {}),
      ...(record.removal && !record.removalAck ? { removal: record.removal } : {}) };
  }
  return Object.freeze({
    async status() {
      const state = await journal.state(), enrolled = await enrollment();
      return { stationId: config.stationId, enrollmentId: config.enrollmentId, keyId: config.keyId,
        ready: await ready(), state: state.active ? 'BUSY' : await ready() ? 'READY' : 'SETUP_PENDING',
        protectedKey: Boolean(key), qualifiedProfile: capabilities.qualifiedProfileAvailable === true,
        printerQualified: printer?.capability.qualified === true, enrollment: enrolled?.state ?? 'NOT_ENROLLED', activePlanHash: state.active };
    },
    async enrollmentProof(body) {
      exact(body, ['authorization']); check(key, 'STATION_PROTECTED_KEY_REQUIRED');
      const challenge = validateStationChallenge(await verifier.verifyEnvelope(body.authorization));
      check(challenge.version === 'atlas-mac-station-enrollment-challenge-v1' && challenge.origin === 'https://atlasgrading.com'
        && challenge.stationId === config.stationId && challenge.issuedAt <= now() && challenge.expiresAt > now()
        && challenge.expiresAt - challenge.issuedAt <= 120000, 'STATION_CHALLENGE_INVALID');
      const proof = await native.request('enrollment-proof', { envelope: body.authorization });
      check(['enrollmentId','keyId','publicKeySpki','protectionEvidenceHash'].every(name => proof[name] === (name === 'publicKeySpki' ? key[name] : config[name])), 'STATION_PROOF_INVALID');
      verifyStationSignature(key.publicKeySpki, stationEnrollmentProof(challenge, proof), proof.signature);
      return { challengeId: challenge.challengeId, ...proof };
    },
    async enroll(body) {
      exact(body, ['authorization']); const claims = validateStationEnrollment(await verifier.verifyEnvelope(body.authorization));
      check(key && ['stationId','enrollmentId','keyId','protectionEvidenceHash'].every(name => claims[name] === config[name])
        && claims.keyFingerprint === key.fingerprint, 'STATION_ENROLLMENT_MISMATCH');
      if (claims.state === 'ACTIVE') check(claims.profileHash === profileHash && claims.qualificationHash === config.profile.qualificationHash, 'STATION_ENROLLMENT_PROFILE_MISMATCH');
      await journal.enroll(body.authorization); return this.status();
    },
    async prepare(body) {
      exact(body, ['plan','association']); check(await ready(), 'STATION_SETUP_PENDING', 409);
      const previous = await journal.get(body.plan?.planHash);
      await verifyArm(body.plan, body.association, Boolean(previous));
      const record = await journal.reserve(body); if (!previous) work(record, true); return operation({ planHash: record.plan.planHash });
    },
    async operation(body) { exact(body, ['planHash']); return operation(body); },
    async acknowledge(body) {
      exact(body, ['authorization']); const ack = validateStationAcknowledgement(await verifier.verifyEnvelope(body.authorization));
      const record = await journal.get(ack.planHash); check(record, 'STATION_INTENT_MISSING');
      if (record.completed) return operation({ planHash: ack.planHash });
      const arm = await verifyArm(record.plan, record.association, true), saved = await nfcJournal.read(record.plan.nfc.intentId);
      const receipt = ack.kind === 'WRITE' ? saved?.receipt : record.removal?.receipt;
      check(receipt && ack.receiptHash === stationHash(stationCanonical(receipt)) && ack.intentId === arm.intentId
        && ack.enrollmentId === config.enrollmentId && ack.stationId === config.stationId
        && ack.authorizationHash === stationHash(stationCanonical(arm)), 'STATION_ACK_BINDING_INVALID');
      if (ack.kind === 'WRITE') { await journal.update(ack.planHash, { writeAck: body.authorization }); }
      else { await journal.update(ack.planHash, { removalAck: body.authorization, completed: true }); native.resetAfterCompletion(); nfc = null; }
      return operation({ planHash: ack.planHash });
    },
    stop() { stopped = true; native.shutdown(); },
  });
}
