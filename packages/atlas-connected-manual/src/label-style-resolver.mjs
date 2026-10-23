import { randomUUID } from 'node:crypto';
import { canonical, requireThat } from '@atlas/manual-service/contract';
import { LABEL_STYLE_POLICY, LABEL_STYLE_LIMITS, validateLabelStyleRequest, fallbackLabelStyleSpec } from './label-style-contract.mjs';
import { readLabelStyleResponse } from './label-style-provider.mjs';

const VERSION = 'atlas-label-style-result-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (left, right) => canonical(left) === canonical(right);
function reservationValid(value, evidence) {
  requireThat(exact(value, ['version', 'reservationId', 'reservedAtMs', 'expiresAtMs', 'requestEvidence'])
    && value.version === LABEL_STYLE_POLICY && UUID.test(value.reservationId)
    && Number.isSafeInteger(value.reservedAtMs) && value.reservedAtMs >= 0
    && value.expiresAtMs === value.reservedAtMs + LABEL_STYLE_LIMITS.timeoutMs + 30000
    && same(value.requestEvidence, evidence), 503, 'LABEL_STYLE_RESERVATION_CHANGED');
  return value;
}

/** One source-bound style analysis with immutable request/reservation/response/
 * result records. Preparation can be repeated before a reservation; no paid
 * dispatch is repeated after one exists. A result is never silently upgraded.
 *
 * PENDING means another exact request may still be in flight. A caller may
 * defer its label job; it must not claim an original or photo-informed result
 * from the placeholder. Expired/uncertain work has an explicit fallback.
 * Original-wordmark generation/verification are separate paid stages. */
export function createLabelStyleResolver({ provider = null, cache, now = Date.now } = {}) {
  requireThat(cache?.read && cache?.putIfAbsent && (provider === null || typeof provider === 'function' && typeof provider.prepare === 'function')
    && typeof now === 'function', 503, 'LABEL_STYLE_RESOLVER_UNAVAILABLE');
  const active = new Map();
  const timestamp = () => { const value = now(); requireThat(Number.isSafeInteger(value) && value >= 0, 503, 'LABEL_STYLE_CLOCK_INVALID'); return value; };

  async function retained(request, kind, signal) { return cache.read(request, kind, { signal }); }
  async function requestEvidence(request, signal) {
    const record = await retained(request, 'request', signal);
    requireThat(exact(record, ['request', 'evidence']) && same(record.request, request) && same(record.evidence?.request, request),
      503, 'LABEL_STYLE_REQUEST_CHANGED');
    return record.evidence;
  }
  async function fromResponse(request, response, signal) {
    requireThat(exact(response, ['reservationId', 'saved']), 503, 'LABEL_STYLE_RESPONSE_BINDING_INVALID');
    const evidence = await requestEvidence(request, signal), reservation = reservationValid(await retained(request, 'reservation', signal), evidence);
    requireThat(response.reservationId === reservation.reservationId && same(response.saved?.requestEvidence, evidence),
      503, 'LABEL_STYLE_RESPONSE_BINDING_INVALID');
    return readLabelStyleResponse(response.saved, request);
  }
  async function resultValue(request, record, signal) {
    requireThat(record?.version === VERSION && ['MODEL', 'FALLBACK'].includes(record.outcome), 503, 'LABEL_STYLE_RESULT_INVALID');
    let spec;
    if (record.outcome === 'MODEL') {
      requireThat(exact(record, ['version', 'outcome', 'spec']), 503, 'LABEL_STYLE_RESULT_INVALID');
      spec = (await fromResponse(request, await retained(request, 'response', signal), signal)).spec;
    } else {
      requireThat(exact(record, ['version', 'outcome', 'reason', 'spec']), 503, 'LABEL_STYLE_RESULT_INVALID');
      spec = fallbackLabelStyleSpec(request, record.reason);
    }
    requireThat(same(spec, record.spec), 503, 'LABEL_STYLE_RESULT_CHANGED');
    return { state: record.outcome === 'MODEL' ? 'READY' : 'FALLBACK', spec, cached: true };
  }
  async function saveResult(request, record, signal) {
    const stored = await cache.putIfAbsent(request, 'result', record, { signal });
    const result = await resultValue(request, stored.value, signal);
    return { ...result, cached: !stored.created };
  }
  const fallback = (request, reason, signal) => saveResult(request, { version: VERSION, outcome: 'FALLBACK', reason,
    spec: fallbackLabelStyleSpec(request, reason) }, signal);
  async function project(request, response, signal) {
    let parsed;
    try { parsed = await fromResponse(request, response, signal); }
    catch (error) {
      // Corrupt cache/source bindings remain failures. Only retained provider
      // content failures may yield a visible, correctly described fallback.
      if (error?.code === 'LABEL_STYLE_PROVIDER_HTTP_ERROR') return fallback(request, 'PROVIDER_REJECTED', signal);
      if (['LABEL_STYLE_RESPONSE_INVALID', 'LABEL_STYLE_RESPONSE_INCOMPLETE', 'LABEL_STYLE_RESPONSE_TOO_LARGE',
        'LABEL_STYLE_OBSERVATION_INVALID'].includes(error?.code)) return fallback(request, 'MODEL_RESPONSE_INVALID', signal);
      throw error;
    }
    return saveResult(request, { version: VERSION, outcome: 'MODEL', spec: parsed.spec }, signal);
  }
  async function reconcileReserved(request, reservation, signal) {
    reservationValid(reservation, await requestEvidence(request, signal));
    const response = await retained(request, 'response', signal);
    if (response) return project(request, response, signal);
    if (timestamp() <= reservation.expiresAtMs) return { state: 'PENDING', code: 'LABEL_STYLE_PROVIDER_PENDING', requestKey: request.requestKey };
    return fallback(request, 'PROVIDER_OUTCOME_UNKNOWN', signal);
  }
  async function execute(request, signal) {
    const result = await retained(request, 'result', signal);
    if (result) return resultValue(request, result, signal);
    const previous = await retained(request, 'reservation', signal);
    if (previous) return reconcileReserved(request, previous, signal);
    if (!provider) return { state: 'FALLBACK', spec: fallbackLabelStyleSpec(request, 'PROVIDER_UNAVAILABLE'), cached: false };
    signal?.throwIfAborted();
    let prepared;
    try { prepared = await provider.prepare({ request, signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      // An unavailable verified image has no paid liability. It may be retried
      // by an explicit new layout; this returned fallback is not globally saved.
      return { state: 'FALLBACK', spec: fallbackLabelStyleSpec(request, 'PHOTO_PREPARATION_UNAVAILABLE'), cached: false };
    }
    requireThat(same(prepared.evidence?.request, request), 503, 'LABEL_STYLE_REQUEST_CHANGED');
    const retainedRequest = await cache.putIfAbsent(request, 'request', { request, evidence: prepared.evidence }, { signal });
    requireThat(same(retainedRequest.value, { request, evidence: prepared.evidence }), 503, 'LABEL_STYLE_REQUEST_CHANGED');
    const reservedAtMs = timestamp(), proposed = { version: LABEL_STYLE_POLICY, reservationId: randomUUID(), reservedAtMs,
      expiresAtMs: reservedAtMs + LABEL_STYLE_LIMITS.timeoutMs + 30000, requestEvidence: prepared.evidence };
    const reserved = await cache.putIfAbsent(request, 'reservation', proposed, { signal });
    if (!reserved.created) return reconcileReserved(request, reserved.value, signal);
    reservationValid(reserved.value, prepared.evidence);
    requireThat(reserved.value.reservationId === proposed.reservationId, 503, 'LABEL_STYLE_RESERVATION_CHANGED');
    signal?.throwIfAborted();
    let saved;
    try { saved = await provider({ prepared, signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      // The exact permanent reservation survives even when no reply exists.
      return fallback(request, 'PROVIDER_OUTCOME_UNKNOWN', signal);
    }
    requireThat(same(saved.requestEvidence, prepared.evidence), 503, 'LABEL_STYLE_RESPONSE_BINDING_INVALID');
    const response = { reservationId: proposed.reservationId, saved };
    const stored = await cache.putIfAbsent(request, 'response', response, { signal });
    requireThat(JSON.stringify(stored.value) === JSON.stringify(response), 503, 'LABEL_STYLE_RESPONSE_CHANGED');
    return project(request, stored.value, signal);
  }
  return Object.freeze({
    resolve(rawRequest, { signal } = {}) {
      const request = validateLabelStyleRequest(rawRequest);
      // Share this process's exact in-flight work without another image read or
      // paid dispatch. A different process uses the durable reservation above.
      if (active.has(request.requestKey)) return active.get(request.requestKey);
      const work = execute(request, signal).finally(() => active.delete(request.requestKey));
      active.set(request.requestKey, work); return work;
    },
  });
}
