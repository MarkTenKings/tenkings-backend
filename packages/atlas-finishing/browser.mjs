// Browser transport only. Hosted verification and enrolled helper keys retain authority.
// No imports from the Node signing module: credentials never enter URLs or persistence.
export const ATLAS_HELPER = Object.freeze({ baseUrl: 'http://127.0.0.1:47662',
    capability: 'atlas-approved-report-f8215-v1', protocol: 'tenkings-ai-grader-nfc-loopback-v2',
    jobSchema: 'atlas-approved-report-nfc-job-v1', resultSchema: 'atlas-approved-report-nfc-result-v1' });
const SHA = /^[a-f0-9]{64}$/, ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const BINDING = ['specimenId', 'approvalId', 'approvalVersion', 'publicToken', 'publicHash'];
const JOB_FIELDS = ['schemaVersion', 'algorithm', 'signingKeyId', 'purpose', 'nonce', ...BINDING,
    'url', 'chipType', 'securityMode', 'programmingProfile', 'issuedAt', 'expiresAt'];
const RESULT_FIELDS = ['schemaVersion', 'algorithm', 'workstationKeyId', 'jobEnvelopeSha256', 'nonce', ...BINDING,
    'url', 'chipType', 'securityMode', 'programmingProfile', 'readerModel', 'adapterIdentity', 'adapterVersion',
    'readbackPayloadSha256', 'writeProtectionState', 'readerResultCode', 'helperCapability', 'observedAt'];
const PROFILE = { algorithm: 'ecdsa-p256-sha256-p1363', chipType: 'FEIJU_F8215', securityMode: 'static_url_v1', programmingProfile: 'gototags_manual_start_v1' };
const PHASES = ['preparing', 'awaiting_manual_start', 'completed', 'failed', 'uncertain', 'closing_success',
    'closing_discard_completed_unrecorded', 'closing_discard_failed', 'closing_discard_uncertain'];
const TERMINAL = PHASES.slice(2);
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
export class FinishingError extends Error {
    constructor(code, { status = 0, uncertain = false } = {}) { super(code); this.name = 'FinishingError'; this.code = code; this.status = status; this.uncertain = uncertain; }
}
function requireThat(value, code = 'HELPER_RESPONSE_INVALID') { if (!value) throw new FinishingError(code); }
function exact(value, keys) { requireThat(value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); }
function date(value) { const n = Date.parse(value); requireThat(typeof value === 'string' && Number.isFinite(n) && new Date(n).toISOString() === value); return n; }
export function approvedReportUrl(token, version) {
    requireThat(typeof token === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(token) && Number.isSafeInteger(version) && version > 0 && version <= 2147483647);
    return `https://atlasgrading.com/reports/${token}?v=${version}`;
}
function profile(value) {
    requireThat(Object.entries(PROFILE).every(([key, expected]) => value[key] === expected)
        && ID.test(value.specimenId) && ID.test(value.approvalId) && SHA.test(value.publicHash)
        && /^[A-Za-z0-9_-]{43}$/.test(value.nonce) && /^[A-Za-z0-9_-]{86}$/.test(value.signature)
        && value.url === approvedReportUrl(value.publicToken, value.approvalVersion));
}
async function sha(value, cryptoImpl) {
    requireThat(cryptoImpl?.subtle, 'SECURE_BROWSER_REQUIRED');
    return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function boundedJson(fetchImpl, url, options, timeoutMs, maximumBytes = 1048576) {
    const controller = new AbortController();
    let reader, closed = false, completed = false, timer;
    const cancel = target => { try { Promise.resolve(target?.cancel()).catch(() => {}); } catch { /* Cancellation must not hold the deadline open. */ } };
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new FinishingError('CONNECTION_UNCONFIRMED', { uncertain: true }));
    }, timeoutMs); });
    try {
        return await Promise.race([deadline, (async () => {
            const response = await fetchImpl(url, { ...options, signal: controller.signal, cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
            if (closed) { cancel(response.body); throw new FinishingError('CONNECTION_UNCONFIRMED', { uncertain: true }); }
            const length = response.headers?.get('content-length');
            if (length != null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximumBytes)) {
                cancel(response.body); throw new FinishingError('RESPONSE_UNCONFIRMED', { uncertain: true });
            }
            if (!response.body?.getReader) throw new FinishingError('RESPONSE_UNCONFIRMED', { uncertain: true });
            reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let raw = '', size = 0;
            while (!closed) {
                const chunk = await reader.read();
                if (closed) throw new FinishingError('CONNECTION_UNCONFIRMED', { uncertain: true });
                if (chunk.done) break;
                if (!(chunk.value instanceof Uint8Array) || (size += chunk.value.byteLength) > maximumBytes)
                    throw new FinishingError('RESPONSE_UNCONFIRMED', { uncertain: true });
                raw += decoder.decode(chunk.value, { stream: true });
            }
            raw += decoder.decode();
            let data; try { data = JSON.parse(raw); } catch { throw new FinishingError('RESPONSE_UNCONFIRMED', { uncertain: true }); }
            completed = true; return { response, data };
        })()]);
    } catch (error) {
        if (error instanceof FinishingError) throw error;
        throw new FinishingError('CONNECTION_UNCONFIRMED', { uncertain: true });
    } finally {
        closed = true; clearTimeout(timer);
        if (!completed) { controller.abort(); cancel(reader); }
        try { reader?.releaseLock(); } catch { /* A broken injected stream cannot prevent failure return. */ }
    }
}

export function createAtlasNfcBrowser({ fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, now = () => Date.now(), timeoutMs = 12000 } = {}) {
    let token = '', capabilities = null, active = null, operation = null, verified = null, ackAttempted = false, ackBody = null, discardBody = null, discardAttempted = false, busy = false, recoveredVerification = null, recoveryOutstanding = false;
    const recoveredJobs = new Set();
    async function exclusive(action) {
        requireThat(!busy, 'HELPER_REQUEST_IN_PROGRESS'); busy = true;
        try { return await action(); } finally { busy = false; }
    }
    async function helper(path, body) {
        requireThat(token, 'ATLAS_WORKSTATION_TOKEN_REQUIRED');
        const { response, data } = await boundedJson(fetchImpl, `${ATLAS_HELPER.baseUrl}/atlas/${path}`, {
            method: body === undefined ? 'GET' : 'POST', credentials: 'omit', mode: 'cors',
            headers: { 'x-tenkings-nfc-token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, timeoutMs, 65536);
        if (!response.ok || data?.ok !== true) throw new FinishingError(typeof data?.error?.code === 'string' && /^[a-z0-9_]{1,100}$/.test(data.error.code)
            ? data.error.code : 'HELPER_RESPONSE_INVALID', { status: response.status, uncertain: response.status >= 500 });
        requireThat(data.result && typeof data.result === 'object'); return data.result;
    }
    async function checkedReceipt(receipt) {
        const job = receipt?.job; exact(job, [...JOB_FIELDS, 'signature']); profile(job);
        requireThat(job.schemaVersion === ATLAS_HELPER.jobSchema && job.purpose === 'atlas-program-approved-report-url-v1');
        const start = date(job.issuedAt), end = date(job.expiresAt);
        requireThat(end > start && end - start <= 900000);
        const envelope = await sha(`${JOB_FIELDS.map(key => job[key]).join('\n')}\n${job.signature}`, cryptoImpl);
        requireThat(SHA.test(receipt.jobEnvelopeSha256) && envelope === receipt.jobEnvelopeSha256 && ID.test(receipt.id));
        return clone(receipt);
    }
    async function acceptHosted(receipt) {
        requireThat(active && operation?.result && receipt?.status === 'URL_AND_PERMANENT_LOCK_VERIFIED' && receipt.jobId === active.id
            && receipt.approvalId === active.job.approvalId && receipt.resultHash === await sha(canonical(operation.result), cryptoImpl), 'HOSTED_VERIFICATION_REQUIRED');
        verified = clone(receipt);
    }
    async function inspect(value) {
        requireThat(active && capabilities);
        exact(value, ['helperProtocolVersion', 'helperVersion', 'helperCapability', 'jobEnvelopeSha256', ...BINDING,
            'url', 'phase', 'terminal', 'errorCode', 'discardAcknowledgementNonce', 'result']);
        requireThat(value.helperProtocolVersion === ATLAS_HELPER.protocol && value.helperCapability === ATLAS_HELPER.capability
            && value.jobEnvelopeSha256 === active.jobEnvelopeSha256 && [...BINDING, 'url'].every(key => value[key] === active.job[key])
            && PHASES.includes(value.phase) && value.terminal === TERMINAL.includes(value.phase));
        requireThat(value.errorCode === null || typeof value.errorCode === 'string' && /^[a-z0-9_]{1,100}$/.test(value.errorCode));
        requireThat(value.discardAcknowledgementNonce === null || /^[A-Za-z0-9_-]{32}$/.test(value.discardAcknowledgementNonce));
        if (value.result !== null) {
            const r = value.result; exact(r, [...RESULT_FIELDS, 'signature']); profile(r);
            requireThat(r.schemaVersion === ATLAS_HELPER.resultSchema && r.jobEnvelopeSha256 === active.jobEnvelopeSha256
                && [...BINDING, 'nonce', 'url'].every(key => r[key] === active.job[key]) && r.workstationKeyId === capabilities.workstationKeyId
                && r.readerModel === 'ACS_ACR1552U' && r.adapterIdentity === 'gototags_desktop' && r.adapterVersion === '4.37.0.1'
                && r.helperCapability === ATLAS_HELPER.capability && r.writeProtectionState === 'permanently_read_only_verified'
                && r.readerResultCode === 'write_locked_verified_gototags_readback'
                && r.readbackPayloadSha256 === await sha(active.job.url, cryptoImpl)
                && date(r.observedAt) >= date(active.job.issuedAt) && date(r.observedAt) <= date(active.job.expiresAt));
        }
        requireThat(!['completed', 'closing_success'].includes(value.phase) || value.result !== null);
        operation = clone(value);
        if (recoveredVerification) {
            requireThat(operation.result && ['completed', 'closing_success'].includes(operation.phase), 'HOSTED_VERIFICATION_REQUIRED');
            await acceptHosted(recoveredVerification);
        }
        return clone(operation);
    }
    return Object.freeze({
        setToken(value) {
            requireThat(!busy, 'HELPER_REQUEST_IN_PROGRESS');
            requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{43,192}$/.test(value), 'ATLAS_WORKSTATION_TOKEN_REQUIRED');
            token = value; capabilities = null;
        },
        disconnect() { token = ''; capabilities = null; },
        // No token, nonce, signature or workstation key is returned by this projection.
        summary() { return { connected: Boolean(capabilities), jobId: active?.id ?? null, phase: operation?.phase ?? null,
            hostedVerified: Boolean(verified), acknowledgementPending: ackAttempted, recoveryOnly: active?.recoveryOnly === true, recoveryOutstanding }; },
        connect: () => exclusive(async () => {
            const c = await helper('capabilities'); exact(c, ['helperCapability', 'workstationKeyId', 'trustedJobSigningKeyIds']);
            requireThat(c.helperCapability === ATLAS_HELPER.capability && SHA.test(c.workstationKeyId)
                && Array.isArray(c.trustedJobSigningKeyIds) && c.trustedJobSigningKeyIds.length > 0 && c.trustedJobSigningKeyIds.length <= 2
                && c.trustedJobSigningKeyIds.every(k => SHA.test(k) && k !== c.workstationKeyId), 'ATLAS_CAPABILITY_REQUIRED');
            capabilities = clone(c); return { helperCapability: c.helperCapability };
        }),
        prepare: (receipt, { freshTagConfirmed = false } = {}) => exclusive(async () => {
            requireThat(!recoveryOutstanding && !receipt?.recoveryOnly && !active?.recoveryOnly && !recoveredJobs.has(receipt?.jobEnvelopeSha256), 'NFC_RECOVERY_STATUS_ONLY');
            requireThat(freshTagConfirmed === true, 'FRESH_TAG_CONFIRMATION_REQUIRED');
            requireThat(capabilities, 'ATLAS_CAPABILITY_REQUIRED');
            const job = receipt?.job; exact(job, [...JOB_FIELDS, 'signature']); profile(job);
            requireThat(job.schemaVersion === ATLAS_HELPER.jobSchema && job.purpose === 'atlas-program-approved-report-url-v1'
                && capabilities.trustedJobSigningKeyIds.includes(job.signingKeyId), 'ATLAS_JOB_TRUST_MISMATCH');
            const start = date(job.issuedAt), end = date(job.expiresAt);
            requireThat(end > start && end - start <= 900000 && start <= now() + 30000 && now() <= end, 'ATLAS_JOB_EXPIRED');
            const envelope = await sha(`${JOB_FIELDS.map(key => job[key]).join('\n')}\n${job.signature}`, cryptoImpl);
            requireThat(SHA.test(receipt.jobEnvelopeSha256) && envelope === receipt.jobEnvelopeSha256 && ID.test(receipt.id));
            requireThat(!active || active.id === receipt.id && active.jobEnvelopeSha256 === envelope, 'HELPER_JOB_STILL_OPEN');
            // Retain exact signed job before a possibly lost prepare reply. Status never starts encoding.
            active = clone(receipt);
            return inspect(await helper('prepare', { job: active.job, freshTagConfirmed: true }));
        }),
        resume: recovery => exclusive(async () => {
            requireThat(recovery?.recoveryOnly === true, 'NFC_RECOVERY_STATUS_ONLY');
            requireThat(capabilities, 'ATLAS_CAPABILITY_REQUIRED');
            requireThat(!active || active.recoveryOnly && !ackAttempted && !discardAttempted, 'HELPER_JOB_STILL_OPEN');
            const receipt = await checkedReceipt(recovery.receipt);
            recoveredJobs.add(receipt.jobEnvelopeSha256);
            active = { ...receipt, recoveryOnly: true }; operation = null; verified = null; recoveryOutstanding = true;
            recoveredVerification = recovery.verification ? clone(recovery.verification) : null;
            // Recovery never calls prepare, even for an unexpired current job.
            try { return await inspect(await helper('status', { jobEnvelopeSha256: active.jobEnvelopeSha256 })); }
            catch (e) { if (e.code === 'atlas_nfc_job_not_found' && e.status === 404) recoveryOutstanding = false; throw e; }
        }),
        releaseRecovery() {
            requireThat(!busy && active?.recoveryOnly && !ackAttempted && !discardAttempted, 'HELPER_JOB_STILL_OPEN');
            active = null; operation = null; verified = null; recoveredVerification = null;
        },
        hostedVerification: () => verified ? clone(verified) : null,
        status: () => exclusive(async () => {
            requireThat(active, 'NFC_JOB_REQUIRED');
            try { return await inspect(await helper('status', { jobEnvelopeSha256: active.jobEnvelopeSha256 })); }
            catch (e) { if (active.recoveryOnly && e.code === 'atlas_nfc_job_not_found' && e.status === 404) recoveryOutstanding = false; throw e; }
        }),
        verificationInput() {
            requireThat(active && operation?.result && ['completed', 'closing_success'].includes(operation.phase), 'NFC_RESULT_NOT_READY');
            return { jobId: active.id, result: clone(operation.result) };
        },
        acknowledgeSuccess: ({ receipt, tagRemoved = false } = {}) => exclusive(async () => {
            requireThat(active && operation?.result && tagRemoved === true, 'TAG_REMOVAL_CONFIRMATION_REQUIRED');
            await acceptHosted(receipt);
            ackBody ??= { jobEnvelopeSha256: active.jobEnvelopeSha256, tagRemoved: true };
            const retry = ackAttempted; ackAttempted = true;
            let state;
            try { const r = await helper('success-ack', ackBody); requireThat(r.cleaned === true); state = 'ACKNOWLEDGED'; }
            catch (e) {
                // Only a retry of this exact prior ack can reconcile its lost deletion response.
                if (!(retry && e.code === 'atlas_nfc_job_not_found' && e.status === 404)) throw e;
                state = 'NO_ACTIVE_OPERATION_AFTER_ACK_RETRY';
            }
            active = null; operation = null; ackAttempted = false; ackBody = null; verified = null; recoveredVerification = null; recoveryOutstanding = false;
            return { state };
        }),
        acknowledgeDiscard: ({ tagRemoved = false } = {}) => exclusive(async () => {
            requireThat(active && operation && tagRemoved === true, 'TAG_REMOVAL_CONFIRMATION_REQUIRED');
            requireThat(!verified && !ackAttempted, 'DISCARD_CONFIRMATION_UNAVAILABLE');
            if (!discardBody) {
                const phase = ({ completed: 'completed_unrecorded', closing_discard_completed_unrecorded: 'completed_unrecorded',
                    closing_discard_failed: 'failed', closing_discard_uncertain: 'uncertain' })[operation.phase] ?? operation.phase;
                requireThat(['failed', 'uncertain', 'completed_unrecorded'].includes(phase)
                    && operation.discardAcknowledgementNonce, 'DISCARD_CONFIRMATION_UNAVAILABLE');
                discardBody = { jobEnvelopeSha256: active.jobEnvelopeSha256, acknowledgementNonce: operation.discardAcknowledgementNonce, phase, tagRemoved: true };
            }
            // Preserve the exact nonce and phase across a lost response or closing-state status.
            let state; const retry = discardAttempted; discardAttempted = true;
            try { const r = await helper('discard-ack', discardBody); requireThat(r.cleaned === true); state = 'DISCARDED'; }
            catch (e) {
                if (!(retry && e.code === 'atlas_nfc_job_not_found' && e.status === 404)) throw e;
                state = 'NO_ACTIVE_OPERATION_AFTER_DISCARD_RETRY';
            }
            active = null; operation = null; discardBody = null; discardAttempted = false; recoveredVerification = null; recoveryOutstanding = false; return { state };
        }),
    });
}

// One pending mutation per mounted workspace. A lost response never creates a new operation ID.
export function createFinishingRequests({ cardId, csrf, fetchImpl = globalThis.fetch, randomUUID = () => globalThis.crypto.randomUUID(), timeoutMs = 15000 } = {}) {
    requireThat(typeof cardId === 'string' && /^[a-f0-9-]{36}$/.test(cardId), 'CARD_REQUIRED');
    let pending = null, busy = false;
    const base = `/admin/api/staff/cards/${cardId}/finishing`;
    async function send() {
        requireThat(pending && !busy, 'REQUEST_IN_PROGRESS'); busy = true;
        try {
            const { response, data } = await boundedJson(fetchImpl, `${base}/${pending.kind}`, { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' }, body: pending.body }, timeoutMs);
            if (!response.ok) {
                const code = typeof data?.error === 'string' && /^[A-Z0-9_]{1,100}$/.test(data.error) ? data.error : 'SAVE_UNCONFIRMED';
                throw new FinishingError(code, { status: response.status, uncertain: response.status >= 500 });
            }
            requireThat(data.receipt?.id, 'SAVE_UNCONFIRMED'); const result = clone(data.receipt); pending = null; return result;
        } catch (e) {
            pending.uncertain ||= e.uncertain || !e.status;
            pending.rejected = !pending.uncertain && e.status >= 400 && e.status < 500;
            throw e;
        } finally { busy = false; }
    }
    return Object.freeze({
        setCsrf(value) { csrf = value; },
        pending: () => pending ? { kind: pending.kind, operationId: pending.operationId, uncertain: pending.uncertain, rejected: pending.rejected } : null,
        async read() {
            const { response, data } = await boundedJson(fetchImpl, base, { method: 'GET', credentials: 'same-origin', headers: {} }, timeoutMs);
            if (!response.ok) throw new FinishingError(typeof data.error === 'string' ? data.error : 'FINISHING_UNAVAILABLE', { status: response.status });
            requireThat(data.finishing?.specimenId === cardId, 'FINISHING_UNAVAILABLE'); return data.finishing;
        },
        async retrieveNfcJob(jobId) {
            requireThat(typeof jobId === 'string' && /^[a-f0-9-]{36}$/.test(jobId), 'NFC_JOB_REQUIRED');
            const { response, data } = await boundedJson(fetchImpl, `${base}/nfc-job/${jobId}`, { method: 'GET', credentials: 'same-origin', headers: {} }, timeoutMs);
            if (!response.ok) throw new FinishingError(typeof data.error === 'string' ? data.error : 'FINISHING_UNAVAILABLE', { status: response.status });
            requireThat(data.recoveryOnly === true && data.receipt?.id === jobId && data.receipt?.job?.specimenId === cardId, 'FINISHING_UNAVAILABLE');
            return { ...clone(data), receipt: { ...clone(data.receipt), recoveryOnly: true } };
        },
        mutate(kind, input) {
            requireThat(['label', 'nfc-job', 'nfc-verify', 'physical'].includes(kind), 'INVALID_FINISHING_ACTION');
            requireThat(!pending && !busy, 'SAVE_PENDING'); requireThat(input && !Object.hasOwn(input, 'operationId'), 'INVALID_FINISHING_ACTION');
            const operationId = randomUUID(); pending = { kind, operationId, body: JSON.stringify({ ...clone(input), operationId }), uncertain: false, rejected: false };
            return send();
        },
        retry: send,
        clearRejected() { requireThat(pending?.rejected && !busy, 'SAVE_PENDING'); pending = null; },
    });
}
