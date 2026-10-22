// Inert browser adapter: no default fetch, endpoints registered, credentials,
// policy, account assertions, automatic retries or persistent private data.
import { claimIdValid, claimCertificateValid, claimLifecycleInput } from './ownership-claim-submission-client.mjs';
const BASE = '/account/api/customer/ownership/';
const reads = { read_claim: ['claim', 'claimId'], read_bundle: ['bundle', 'bundleId'], recover_request: ['request', 'requestId'] };
const writes = { reserve_bundle: 'reserve', submit_claim: 'submit', withdraw_claim: 'withdraw', replace_evidence: 'replace' };
const need = ok => { if (!ok) throw Object.assign(new Error('CLAIM_TRANSPORT_UNAVAILABLE'), { code: 'CLAIM_TRANSPORT_UNAVAILABLE' }); };
const ids = value => { need(value && Object.keys(value).length === 2 && ['bundleId', 'objectId'].every(k => claimIdValid(value[k]))); return { bundleId: value.bundleId, objectId: value.objectId }; };

export function createOwnershipClaimsTransport({ fetchImpl, csrf, storageOrigin = null, storagePathPrefix = null } = {}) {
  need(typeof fetchImpl === 'function' && typeof csrf === 'function');
  async function request(path, input, signal) {
    need(signal === undefined || signal instanceof AbortSignal); if (signal?.aborted) throw signal.reason ?? Error('Cancelled');
    const headers = { accept: 'application/json' };
    if (input !== undefined) {
      const token = csrf(); need(typeof token === 'string' && token.length > 0 && token.length <= 512);
      headers['content-type'] = 'application/json'; headers['x-atlas-customer-csrf'] = token;
    }
    return fetchImpl(BASE + path, { method: input === undefined ? 'GET' : 'POST', headers,
      credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal });
  }
  return Object.freeze({
    configuration({ signal } = {}) { return request('configuration', undefined, signal); },
    resolve(input, { signal } = {}) {
      need(input && Object.keys(input).length === 1 && claimCertificateValid(input.certificateNumber));
      return request('target?certificateNumber=' + input.certificateNumber, undefined, signal);
    },
    lifecycle(action, raw, { signal } = {}) {
      const input = claimLifecycleInput(action, raw);
      if (Object.hasOwn(reads, action)) { const [path, key] = reads[action]; return request(`${path}?${key}=${input[key]}`, undefined, signal); }
      need(Object.hasOwn(writes, action)); return request(writes[action], input, signal);
    },
    sign(input, { signal } = {}) { return request('sign', ids(input), signal); },
    complete(input, { signal } = {}) { return request('complete', ids(input), signal); },
    put(input) {
      need(storageOrigin && storagePathPrefix && input?.method === 'PUT' && input.body instanceof Blob
        && input.credentials === 'omit' && input.redirect === 'error' && input.cache === 'no-store');
      const url = new URL(input.url), suffix = url.pathname.slice(storagePathPrefix.length).split('/');
      need(url.protocol === 'https:' && url.origin === storageOrigin && !url.username && !url.password && !url.hash
        && url.pathname.startsWith(storagePathPrefix) && suffix.length === 4 && suffix[0] === 'atlas-ownership-proof' && suffix[1] === 'v2'
        && claimIdValid(suffix[2]) && claimIdValid(suffix[3]) && input.body.size > 0 && input.body.size <= 20971520);
      const names = ['content-type', 'if-none-match', 'x-amz-checksum-sha256', 'x-amz-meta-atlas-kind', 'x-amz-meta-atlas-binding-sha256'];
      need(input.headers && Object.keys(input.headers).length === names.length && names.every(k => typeof input.headers[k] === 'string')
        && input.headers['content-type'] === 'application/octet-stream' && input.headers['if-none-match'] === '*'
        && input.headers['x-amz-meta-atlas-kind'] === 'ownership-proof-v2' && /^[a-f0-9]{64}$/.test(input.headers['x-amz-meta-atlas-binding-sha256'])
        && /^[A-Za-z0-9+/]{43}=$/.test(input.headers['x-amz-checksum-sha256']));
      need(input.signal === undefined || input.signal instanceof AbortSignal); if (input.signal?.aborted) throw input.signal.reason ?? Error('Cancelled');
      return fetchImpl(url.href, { method: 'PUT', headers: { ...input.headers }, body: input.body, credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: input.signal });
    },
  });
}
