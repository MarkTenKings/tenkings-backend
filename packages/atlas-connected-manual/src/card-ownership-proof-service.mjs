import { createHash } from 'node:crypto';
import { requireThat } from '@atlas/manual-service/contract';
import { ownershipProofCanonical, ownershipProofObjectPlan, ownershipProofObjectObservation } from './card-ownership-proof-contract.mjs';

const need = (ok, status = 409, code = 'OWNERSHIP_PROOF_SOURCE_CHANGED') => requireThat(ok, status, code);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function input(value) {
  need(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 2
    && ['bundleId', 'objectId'].every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(value, k) ?? {}, 'value')
      && typeof value[k] === 'string' && UUID.test(value[k])), 400, 'INVALID_OWNERSHIP_PROOF');
  return { bundleId: value.bundleId, objectId: value.objectId };
}
function credentials(cookie, csrf) {
  need(typeof cookie === 'string' && cookie.length > 0 && cookie.length <= 8192, 401, 'SIGN_IN_REQUIRED');
  need(typeof csrf === 'string' && csrf.length > 0 && csrf.length <= 1024, 403, 'CSRF_REQUIRED');
}
const active = signal => need(signal === undefined || signal instanceof AbortSignal, 400, 'INVALID_OWNERSHIP_PROOF');
const cancelled = signal => need(!signal?.aborted, 409, 'OWNERSHIP_PROOF_CANCELLED');

/** Unregistered metadata-only orchestration. The injected server gateway owns
 * CustomerAuth and a separate restricted ingestor DB role; its live SQL checks
 * cannot be replaced by a caller account, observation, key or "verified" flag.
 * There are no DB locks across external I/O and no automatic retry after CAS.
 * Claim submission, reviewer decisions and attachment delivery are not exposed.
 */
export function createOwnershipProofService({ gateway, storage, validator, now = Date.now } = {}) {
  need(typeof gateway?.readPlan === 'function' && typeof gateway?.retainObject === 'function'
    && typeof storage?.signUpload === 'function' && typeof storage?.readOriginal === 'function'
    && typeof validator?.validate === 'function' && typeof now === 'function', 500, 'OWNERSHIP_PROOF_ADAPTER_INVALID');
  // Capture server functions so mutable wiring cannot replace one phase mid-call.
  const readPlan = gateway.readPlan.bind(gateway), retain = gateway.retainObject.bind(gateway);
  const sign = storage.signUpload.bind(storage), read = storage.readOriginal.bind(storage), validate = validator.validate.bind(validator);
  async function current(cookie, csrf, data, before, signal) {
    cancelled(signal);
    const plan = ownershipProofObjectPlan(await readPlan(cookie, csrf, { ...data }));
    cancelled(signal);
    need(plan.bundleId === data.bundleId && plan.objectId === data.objectId);
    need(Number.isFinite(now()) && Date.parse(plan.expiresAt) > now(), 409, 'OWNERSHIP_PROOF_PLAN_EXPIRED');
    // planHash includes account, source approval, both policies and reservation.
    if (before) need(ownershipProofCanonical(plan) === ownershipProofCanonical(before));
    return plan;
  }
  return Object.freeze({
    async sign(cookie, csrf, supplied, { signal } = {}) {
      credentials(cookie, csrf); active(signal); const data = input(supplied);
      const plan = await current(cookie, csrf, data, null, signal);
      const capability = await sign({ plan: structuredClone(plan), signal });
      await current(cookie, csrf, data, plan, signal);
      need(capability?.schema === 'atlas-ownership-proof-put-v2' && capability.bundleId === plan.bundleId
        && capability.objectId === plan.objectId && capability.planHash === plan.planHash
        && capability.byteCount === plan.byteCount && capability.sha256 === plan.sha256, 503, 'OWNERSHIP_PROOF_STORAGE_RESPONSE_INVALID');
      // The capability is private and temporary. It must never enter history,
      // logs, an attachment URL, or a public report projection.
      return { ...capability, accountId: plan.accountId };
    },
    async complete(cookie, csrf, supplied, { signal } = {}) {
      credentials(cookie, csrf); active(signal); const data = input(supplied);
      const plan = await current(cookie, csrf, data, null, signal);
      let bytes;
      try {
        const found = await read({ plan: structuredClone(plan), signal });
        need(found?.bytes instanceof Uint8Array && found.bytes.buffer instanceof ArrayBuffer
          && found.bytes.byteLength === plan.byteCount && found.sha256 === plan.sha256 && found.byteCount === plan.byteCount
          && found.contentType === 'application/octet-stream', 503, 'OWNERSHIP_PROOF_STORAGE_RESPONSE_INVALID');
        bytes = Buffer.from(found.bytes);
        need(sha(bytes) === plan.sha256, 503, 'OWNERSHIP_PROOF_STORAGE_RESPONSE_INVALID');
        // Refuse a revoked account/source before spending decoder capacity.
        await current(cookie, csrf, data, plan, signal);
        const validation = await validate({ plan: structuredClone(plan), bytes, signal });
        need(sha(bytes) === plan.sha256, 503, 'OWNERSHIP_PROOF_VALIDATOR_RESPONSE_INVALID');
        const observation = ownershipProofObjectObservation({ schema: 'atlas-ownership-proof-object-observation-v2',
          planHash: plan.planHash, object: found.object, sha256: found.sha256, byteCount: found.byteCount,
          contentType: found.contentType, validation }, plan);
        await current(cookie, csrf, data, plan, signal);
        // This gateway must refresh live authorization again atomically after
        // its locks, then CAS the same plan/policy and immutable observation.
        const saved = ownershipProofObjectObservation(await retain(cookie, csrf, { ...data }, structuredClone(observation)), plan);
        need(ownershipProofCanonical(saved) === ownershipProofCanonical(observation), 503, 'OWNERSHIP_PROOF_RETAIN_RESPONSE_INVALID');
        await current(cookie, csrf, data, plan, signal);
        return { schema: 'atlas-ownership-proof-retained-v2', accountId: plan.accountId, bundleId: plan.bundleId, objectId: plan.objectId,
          state: 'RETAINED', byteCount: plan.byteCount, sha256: plan.sha256, declaredType: plan.declaredType };
      } finally { bytes?.fill(0); }
    },
  });
}
