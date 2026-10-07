import { deny } from '../policy.mjs';
const SID = /^VE[0-9a-fA-F]{32}$/;
const MAX_RESPONSE_BYTES = 32 * 1024;

/** One request per durable claim. No SDK retries, redirects or caller URLs. */
export function twilioVerifyTransport({ accountSid, serviceSid, apiKeySid, apiKeySecret, fetch: transport = globalThis.fetch }) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid ?? '') || !/^VA[0-9a-fA-F]{32}$/.test(serviceSid ?? '')
        || !/^SK[0-9a-fA-F]{32}$/.test(apiKeySid ?? '') || typeof apiKeySecret !== 'string'
        || apiKeySecret.length < 20 || apiKeySecret.length > 256 || /[\r\n]/.test(apiKeySecret))
        deny(503, 'ACCESS_CONFIGURATION_INVALID');
    const authorization = `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString('base64')}`;
    async function request(resource, fields) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await transport(`https://verify.twilio.com/v2/Services/${serviceSid}/${resource}`, {
                method: 'POST', redirect: 'error', signal: controller.signal, cache: 'no-store',
                headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: new URLSearchParams(fields).toString(),
            });
            if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''))
                throw new Error('VERIFY_OUTCOME_UNAVAILABLE');
            const declared = response.headers.get('content-length');
            if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw new Error('VERIFY_OUTCOME_UNAVAILABLE');
            if (!response.body) throw new Error('VERIFY_OUTCOME_UNAVAILABLE');
            const reader = response.body.getReader();
            const chunks = []; let size = 0;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > MAX_RESPONSE_BYTES) throw new Error('VERIFY_OUTCOME_UNAVAILABLE');
                    chunks.push(value);
                }
            } finally { await reader.cancel().catch(() => {}); }
            const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !SID.test(raw.sid ?? '')
                || raw.account_sid !== accountSid || raw.service_sid !== serviceSid || raw.channel !== 'sms'
                || !/^\+[1-9]\d{7,14}$/.test(raw.to ?? '') || !['pending', 'approved'].includes(raw.status))
                throw new Error('VERIFY_OUTCOME_UNAVAILABLE');
            return { accountSid: raw.account_sid, serviceSid: raw.service_sid, verificationSid: raw.sid,
                phone: raw.to, channel: raw.channel, status: raw.status };
        } catch {
            // Never expose response bodies, codes, credentials or full numbers.
            throw new Error('VERIFY_OUTCOME_UNAVAILABLE');
        } finally { clearTimeout(timer); }
    }
    return Object.freeze({
        start: phone => {
            if (!/^\+[1-9]\d{7,14}$/.test(phone ?? '')) deny(400, 'USE_INTERNATIONAL_PHONE');
            return request('Verifications', { To: phone, Channel: 'sms' });
        },
        check: (verificationSid, code) => {
            if (!SID.test(verificationSid ?? '') || !/^\d{6}$/.test(code ?? '')) deny(400, 'CODE_NOT_ACCEPTED');
            return request('VerificationCheck', { VerificationSid: verificationSid, Code: code });
        },
    });
}
