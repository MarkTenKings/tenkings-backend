import { canonical, digest, requireBridge as check, UUID } from '@atlas/service-bridge/protocol';
import { boundedBytes } from '@atlas/service-bridge/transport';
import { MAX_RESPONSE_BYTES, RESPONSE_ENDPOINT, validateStoredRequest } from './responses.mjs';

export function openAiBinding(env) {
    const projectId = env.ATLAS_OPERATOR_OPENAI_PROJECT_ID, apiKey = env.ATLAS_OPERATOR_OPENAI_API_KEY;
    check(typeof projectId === 'string' && /^proj_[A-Za-z0-9_-]{10,128}$/.test(projectId)
        && typeof apiKey === 'string' && /^sk-[A-Za-z0-9_-]{20,240}$/.test(apiKey), 'ASTRA_PROVIDER_CONFIGURATION_REQUIRED');
    const bindingHash = digest(canonical({ endpoint: RESPONSE_ENDPOINT, projectId, keyHash: digest(apiKey) }));
    return { projectId, apiKey, bindingHash };
}

/** The trusted durable adapter owns takeDispatch: it must atomically consume
 * an unspent dispatch claim after current lease/pilot/budget checks and return
 * the immutable request. No HTTP body or model output can supply that grant.
 * There is no retry, alternate destination, ambient credential or tool execution
 * in this transport. Unknown outcomes keep their ledger reservation held. */
export function responsesTransport({ binding, takeDispatch, fetchImpl = fetch }) {
    return { async dispatch(attemptId) {
        check(typeof attemptId === 'string' && UUID.test(attemptId), 'ASTRA_ATTEMPT_INVALID');
        const grant = await takeDispatch(attemptId);
        check(grant?.attemptId === attemptId && grant.providerBindingHash === binding.bindingHash
            && Number.isSafeInteger(grant.expiresAtMs) && grant.expiresAtMs > Date.now(), 'ASTRA_DISPATCH_NOT_ADMITTED');
        validateStoredRequest(grant);
        const remaining = Math.min(grant.policy.requestTimeoutMs, grant.expiresAtMs - Date.now());
        check(remaining > 0, 'ASTRA_DISPATCH_EXPIRED');
        const startedAt = new Date().toISOString();
        let response;
        try {
            response = await fetchImpl(RESPONSE_ENDPOINT, { method: 'POST', redirect: 'error', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${binding.apiKey}`,
                    'OpenAI-Project': binding.projectId, 'X-Client-Request-Id': attemptId },
                body: grant.requestCanonical, signal: AbortSignal.timeout(remaining) });
            const providerRequestId = response.headers.get('x-request-id');
            check(providerRequestId === null || /^[A-Za-z0-9_-]{1,180}$/.test(providerRequestId), 'ASTRA_PROVIDER_REQUEST_ID_INVALID');
            const bytes = await boundedBytes(response, MAX_RESPONSE_BYTES);
            const contentType = response.headers.get('content-type')?.split(';')[0];
            const bodyHash = digest(bytes);
            if (contentType !== 'application/json') return { state: 'UNKNOWN', attemptId, startedAt, receivedAt: new Date().toISOString(),
                providerRequestId, httpStatus: response.status, bodyHash, failureCode: 'ASTRA_RESPONSE_CONTENT_INVALID' };
            let body; try { body = JSON.parse(bytes.toString('utf8')); } catch {
                return { state: 'UNKNOWN', attemptId, startedAt, receivedAt: new Date().toISOString(),
                    providerRequestId, httpStatus: response.status, bodyHash, failureCode: 'ASTRA_RESPONSE_JSON_INVALID' };
            }
            return { state: 'RECEIVED', attemptId, startedAt, receivedAt: new Date().toISOString(),
                providerRequestId, httpStatus: response.status, bodyHash, body,
                retryAfter: response.headers.get('retry-after')?.slice(0, 120) ?? null };
        } catch {
            return { state: 'UNKNOWN', attemptId, startedAt, receivedAt: new Date().toISOString(),
                httpStatus: response?.status ?? null, failureCode: 'ASTRA_OUTCOME_UNCONFIRMED' };
        }
    } };
}
