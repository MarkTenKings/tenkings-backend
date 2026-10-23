import { randomUUID } from 'node:crypto';
import { digest, requireThat } from '@atlas/manual-service/contract';
import { validateLabelWordmarkRequest, LABEL_WORDMARK_LIMITS } from './label-wordmark-contract.mjs';
import { readLabelWordmarkGeneration, readLabelWordmarkVerification } from './label-wordmark-provider.mjs';
import { compileLabelWordmark } from './label-wordmark-image.mjs';

const same = (left, right) => digest(JSON.stringify(left)) === digest(JSON.stringify(right));
const pending = stage => ({ state: 'PENDING', code: `LABEL_WORDMARK_${stage}_PENDING` });
const unknownAfterMs = LABEL_WORDMARK_LIMITS.timeoutMs + 30000;
const safeCode = error => /^(?:LABEL_WORDMARK|LABEL_STYLE_CACHE)_[A-Z_]+$/.test(error?.code ?? '')
  ? error.code : 'LABEL_WORDMARK_UNAVAILABLE';

/** Two independent permanent reservations, one per paid provider request.
 * No timer, stale reservation or worker restart authorizes another dispatch.
 * Every cached result is reproduced from the two saved raw provider responses. */
export function createLabelWordmarkResolver({ provider, cache, now = () => new Date() } = {}) {
  requireThat(provider && ['prepareGeneration', 'generate', 'prepareVerification', 'verify'].every(key => typeof provider[key] === 'function')
    && cache && typeof cache.read === 'function' && typeof cache.putIfAbsent === 'function' && typeof now === 'function',
  503, 'LABEL_WORDMARK_RESOLVER_NOT_CONFIGURED');

  const clock = () => {
    const value = new Date(now()).getTime();
    requireThat(Number.isFinite(value), 503, 'LABEL_WORDMARK_CLOCK_INVALID'); return value;
  };
  function unfinished(name, reservation, evidence) {
    const time = Date.parse(reservation?.reservedAt), age = clock() - time;
    requireThat(Number.isFinite(time) && new Date(time).toISOString() === reservation.reservedAt
      && age >= 0 && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(reservation.reservationId)
      && reservation.requestEvidence && typeof reservation.requestEvidence === 'object'
      && same(reservation.requestEvidence, evidence), 409, 'LABEL_WORDMARK_RESERVATION_INVALID');
    return age >= unknownAfterMs ? { state: 'UNAVAILABLE', code: `LABEL_WORDMARK_${name}_OUTCOME_UNKNOWN` } : pending(name);
  }

  async function stage(prepared, send, name, signal) {
    const request = prepared.evidence.request, options = { signal };
    const retainedRequest = await cache.putIfAbsent(request, 'request', request, options);
    requireThat(same(retainedRequest.value, request), 409, 'LABEL_WORDMARK_CACHE_CONFLICT');
    let response = await cache.read(request, 'response', options);
    if (response !== null) return { response };
    const reservedAt = new Date(clock()).toISOString();
    const reservation = await cache.putIfAbsent(request, 'reservation', {
      requestEvidence: prepared.evidence, reservationId: randomUUID(), reservedAt }, options);
    if (!reservation.created) {
      // Another worker may have completed while we lost the conditional create.
      response = await cache.read(request, 'response', options);
      return response === null ? unfinished(name, reservation.value, prepared.evidence) : { response };
    }
    try { response = await send({ prepared, signal }); }
    catch { return unfinished(name, reservation.value, prepared.evidence); } // The paid outcome is unknown; never retry.
    try {
      const saved = await cache.putIfAbsent(request, 'response', response, options);
      requireThat(same(saved.value, response), 409, 'LABEL_WORDMARK_CACHE_CONFLICT');
      return { response: saved.value };
    } catch (error) {
      if (error?.code === 'LABEL_WORDMARK_CACHE_CONFLICT') throw error;
      return unfinished(name, reservation.value, prepared.evidence); // Raw persistence is uncertain; a later read may recover it.
    }
  }

  return Object.freeze({ async resolve(rawRequest, { signal } = {}) {
    try {
      signal?.throwIfAborted();
      const request = validateLabelWordmarkRequest(rawRequest);
      const generation = await stage(await provider.prepareGeneration(request), provider.generate, 'GENERATION', signal);
      if (generation.state) return generation;
      const image = await readLabelWordmarkGeneration(generation.response, request);
      const verification = await stage(await provider.prepareVerification(request, image), provider.verify, 'VERIFICATION', signal);
      if (verification.state) return verification;
      const reading = await readLabelWordmarkVerification(verification.response, request, image);
      const compiled = await compileLabelWordmark({ request, image, verification: reading });
      const result = { state: 'READY', artifact: { descriptor: compiled.descriptor,
        pngBase64: compiled.bytes.toString('base64'), maskBase64: compiled.maskBytes.toString('base64') } };
      const retained = await cache.putIfAbsent(request, 'result', result, { signal });
      requireThat(same(retained.value, result), 409, 'LABEL_WORDMARK_CACHE_CONFLICT');
      return result;
    } catch (error) { return { state: 'UNAVAILABLE', code: safeCode(error) }; }
  } });
}
