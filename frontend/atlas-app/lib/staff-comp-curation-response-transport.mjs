// Explicit browser composition only. No default fetch, route activation,
// local/session storage, automatic write retry or pricing policy.
import { curationStaff, curationSame, curationDecisionInput, curationError, parseCurationResponse } from './staff-comp-curation-client.mjs';
import { requireCompTransportRoute } from './staff-comp-curation-transport-contract.mjs';
const check = (value, code = 'COMP_TRANSPORT_INVALID') => { if (!value) throw curationError(code); };
const discard = response => { try { void response?.body?.cancel().catch(() => {}); } catch {} };
function interruptible(work, signal, late) {
  return new Promise((resolve, reject) => {
    let done = false;
    const abort = () => { signal.removeEventListener('abort', abort); if (!done) { done = true; reject(curationError('COMP_CANCELLED')); } };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', abort); if (done) { late?.(value); return; } done = true; resolve(value); },
      error => { signal.removeEventListener('abort', abort); if (!done) { done = true; reject(error); } });
  });
}
export function createStaffCompCurationResponseTransport(options = {}) {
  if (options.enabled !== true) return null;
  const { staff, fetchImpl } = options, actor = curationStaff(staff), active = new Set();
  const events = options.events ?? globalThis, eventsInput = options.events;
  let ended = false;
  const close = () => { ended = true; for (const controller of active) controller.abort(); active.clear(); events.removeEventListener?.('pagehide', close); };
  const current = () => {
    let sameActor = false; try { sameActor = curationSame(curationStaff(staff), actor); } catch { /* invalid in-place actor must also close */ }
    if (ended || options.enabled !== true || options.staff !== staff || !sameActor
      || options.fetchImpl !== fetchImpl || typeof fetchImpl !== 'function' || options.events !== eventsInput
      || Reflect.ownKeys(options).some(key => !['enabled', 'staff', 'fetchImpl', 'events'].includes(key))) {
      close(); throw curationError('COMP_ACCESS_ENDED');
    }
  };
  current(); events.addEventListener?.('pagehide', close);
  return Object.freeze({ close, assertScope(value) { if (value !== staff) close(); try { current(); return true; } catch { return false; } },
    async request(value) {
      current(); check(value && Object.getPrototypeOf(value) === Object.prototype
        && Reflect.ownKeys(value).every(key => ['method', 'path', 'body', 'signal'].includes(key)), 'COMP_REQUEST_INVALID');
      const { method, path, signal } = value, route = requireCompTransportRoute(path, { includeReads: true });
      check(method === route.method && (method !== 'GET' || value.body === undefined), 'COMP_REQUEST_INVALID');
      const body = method === 'POST' ? curationDecisionInput(value.body) : undefined;
      const controller = new AbortController(), abort = () => controller.abort(); active.add(controller);
      const timer = setTimeout(abort, 25000);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const alive = () => { current(); if (controller.signal.aborted) throw curationError('COMP_CANCELLED'); };
      async function read(path, body, csrf) {
        alive(); let response, reader;
        const cancel = () => { try { void reader?.cancel().catch(() => {}); } catch {} };
        try {
          response = await interruptible(Promise.resolve().then(() => {
            alive(); return Reflect.apply(fetchImpl, options, [`/admin${path}`, { method: body === undefined ? 'GET' : 'POST',
              credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
              headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }) }]);
          }), controller.signal, discard);
          alive();
          if ([401, 403].includes(response?.status)) { close(); throw curationError('COMP_ACCESS_ENDED'); }
          check(response && !response.redirected && response.status >= 200 && response.status < 600 && !(response.status >= 300 && response.status < 400)
            && /^application\/json(?:;|$)/i.test(response.headers?.get('content-type') ?? '')
            && /\bprivate\b/i.test(response.headers.get('cache-control') ?? '') && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
          const length = response.headers.get('content-length'); check(length === null || /^\d+$/.test(length) && Number(length) <= 2097152);
          reader = response.body?.getReader(); check(reader);
          controller.signal.addEventListener('abort', cancel, { once: true }); if (controller.signal.aborted) cancel();
          const chunks = []; let size = 0;
          while (true) {
            const part = await interruptible(reader.read(), controller.signal); alive();
            check(part && typeof part.done === 'boolean'); if (part.done) break;
            check(part.value instanceof Uint8Array); size += part.value.length; check(size <= 2097152); chunks.push(part.value);
          }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); alive();
          if (response.status !== 200) check(data && Object.keys(data).length === 1 && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.error ?? ''));
          return { data, bytes, status: response.status };
        } finally { controller.signal.removeEventListener('abort', cancel); cancel(); try { reader?.releaseLock(); } catch {} discard(response); }
      }
      async function session() {
        const value = await read('/api/staff/session');
        // Existing local session HTTP uses top-level SYNTHETIC_LOCAL while its
        // actor mode is SYNTHETIC. The exact actor below is the access binding.
        check(value.status === 200 && typeof value.data?.mode === 'string' && value.data.mode.length > 0 && value.data.mode.length <= 80
          && typeof value.data.csrf === 'string' && value.data.csrf.length > 0 && value.data.csrf.length <= 512);
        if (!curationSame(curationStaff(value.data.staff), actor)) { close(); throw curationError('COMP_ACCESS_ENDED'); }
        return value;
      }
      try {
        const before = await session();
        const result = route.kind === 'session' ? before : await read(path, body, before.data.csrf);
        if (route.kind !== 'session') {
          const after = await session();
          if (after.data.csrf !== before.data.csrf) { close(); throw curationError('COMP_ACCESS_ENDED'); }
        }
        alive();
        if (result.status === 200 && ['read', 'decide'].includes(route.kind))
          parseCurationResponse(result.data, { staff: actor, cardId: route.cardId, input: body ?? route.input, action: route.kind });
        return new Response(result.bytes, { status: result.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
      } catch (error) {
        if (ended) throw curationError('COMP_ACCESS_ENDED');
        if (error.code === 'COMP_ACCESS_ENDED') { close(); throw error; }
        // Unknown includes a successful save followed by a lost final session
        // response. No automatic POST retry and no claim of rollback.
        throw curationError(method === 'POST' ? 'COMP_OUTCOME_UNKNOWN' : controller.signal.aborted ? 'COMP_CANCELLED' : 'COMP_UNAVAILABLE');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); active.delete(controller); }
    },
  });
}
