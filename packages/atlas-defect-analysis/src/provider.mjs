import { check, digest } from './contract.mjs';
import { LIMITS, validatePreparedRequest } from './index.mjs';

export const RESPONSE_ENDPOINT = 'https://api.openai.com/v1/responses';

/** Call only after the durable repository grants claimed:true for this exact
 * requestHash. No SDK retries, ambient credentials, alternate URL or tools.
 * The in-memory fence adds protection against reusing a granted prepared object;
 * it does not replace the durable claim across processes or restarts. */
export function createAstraDefectProvider({ apiKey, projectId = null, fetchImpl = fetch, timeoutMs = LIMITS.timeoutMs }) {
  check(typeof apiKey === 'string' && /^sk-[A-Za-z0-9_-]{16,250}$/.test(apiKey), 'DEFECT_ANALYSIS_NOT_CONFIGURED', 503);
  check(projectId === null || /^proj_[A-Za-z0-9_-]{8,128}$/.test(projectId), 'DEFECT_ANALYSIS_NOT_CONFIGURED', 503);
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= LIMITS.timeoutMs);
  const dispatched = new WeakSet();
  return Object.freeze({
    bindingHash: digest(JSON.stringify({ endpoint: RESPONSE_ENDPOINT, projectId, keyHash: digest(apiKey) })),
    async dispatch(prepared, { signal, deadlineMs = null } = {}) {
      validatePreparedRequest(prepared);
      check(!dispatched.has(prepared), 'DEFECT_ANALYSIS_ALREADY_DISPATCHED', 409);
      signal?.throwIfAborted();
      check(deadlineMs === null || Number.isSafeInteger(deadlineMs), 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 409);
      const remaining = deadlineMs === null ? timeoutMs : Math.min(timeoutMs, deadlineMs - Date.now());
      check(remaining > 0, 'DEFECT_ANALYSIS_REQUEST_EXPIRED', 409);
      dispatched.add(prepared);
      const startedAt = new Date().toISOString(), controller = new AbortController();
      let response = null, reader = null, providerRequestId = null, timer;
      let abortReject;
      const aborted = new Promise((_resolve, reject) => { abortReject = reject; });
      const abort = () => { controller.abort(); abortReject(new Error('DEFECT_ANALYSIS_OUTCOME_UNKNOWN')); };
      signal?.addEventListener('abort', abort, { once: true });
      // Attach the rejection consumer before any synchronous abort is possible.
      const work = async () => {
        response = await fetchImpl(RESPONSE_ENDPOINT, { method: 'POST', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`,
            'X-Client-Request-Id': prepared.evidence.analysisId, ...(projectId ? { 'OpenAI-Project': projectId } : {}) },
          body: prepared.requestText, signal: controller.signal });
        const requestId = response.headers.get('x-request-id');
        if (requestId !== null && /^[A-Za-z0-9_-]{1,180}$/.test(requestId)) providerRequestId = requestId;
        check(requestId === null || providerRequestId !== null, 'DEFECT_ANALYSIS_RESPONSE_INVALID');
        check(Number.isSafeInteger(response.status) && response.status >= 100 && response.status <= 599);
        const declared = response.headers.get('content-length');
        if (declared !== null) check(/^\d+$/.test(declared) && Number(declared) <= LIMITS.responseBytes, 'DEFECT_ANALYSIS_RESPONSE_LIMIT');
        reader = response.body?.getReader(); check(reader, 'DEFECT_ANALYSIS_RESPONSE_INVALID');
        const chunks = []; let length = 0;
        while (true) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength; check(length <= LIMITS.responseBytes, 'DEFECT_ANALYSIS_RESPONSE_LIMIT');
          chunks.push(Buffer.from(part.value));
        }
        const bytes = Buffer.concat(chunks, length);
        return { state: 'RECEIVED', analysisId: prepared.evidence.analysisId, requestHash: prepared.requestHash, startedAt,
          receivedAt: new Date().toISOString(), httpStatus: response.status, providerRequestId,
          contentType: response.headers.get('content-type')?.split(';')[0].trim().slice(0, 100) ?? null,
          responseHash: digest(bytes), bytes };
      };
      try {
        timer = setTimeout(abort, remaining);
        if (signal?.aborted) abort();
        return await Promise.race([work(), aborted]);
      } catch {
        return { state: 'UNKNOWN', analysisId: prepared.evidence.analysisId, requestHash: prepared.requestHash, startedAt,
          receivedAt: new Date().toISOString(), httpStatus: response?.status ?? null, providerRequestId,
          code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' };
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
        // A broken stream must not hold the request open after the deadline.
        void reader?.cancel().catch(() => {});
      }
    },
  });
}
