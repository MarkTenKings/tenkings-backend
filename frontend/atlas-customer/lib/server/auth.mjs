import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { cookies, deny, equal, hash, keys, normalizePhone, tokenShape, UUID } from './policy.mjs';
const opaque = () => randomBytes(32).toString('base64url');

export class CustomerAuth {
    constructor({ database, config, provider }) { this.database = database; this.config = config; this.provider = provider; }
    digest(value, encoding = 'hex') { return createHmac('sha256', this.config.sessionKey).update(`atlas-customer-v1:${value}`).digest(encoding); }
    authority(header, csrf, purpose = 'session') {
        const jar = cookies(header), browser = jar[this.config.cookies.browser], session = jar[this.config.cookies.session];
        if (!tokenShape(browser)) deny(401, 'SIGN_IN_REQUIRED');
        if (purpose === 'session' && !tokenShape(session)) deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== undefined && !equal(csrf, this.digest(`${purpose}:${purpose === 'session' ? session : browser}`))) deny(403, 'CSRF_REQUIRED');
        return { browserHash: hash(browser), ...(tokenShape(session) ? { sessionHash: hash(session) } : {}) };
    }
    async bootstrap(header, client) {
        const jar = cookies(header), oldBrowser = jar[this.config.cookies.browser], session = jar[this.config.cookies.session], fresh = opaque();
        const result = await this.database.call('bootstrap', { browserHash: tokenShape(oldBrowser) ? hash(oldBrowser) : null,
            newBrowserHash: hash(fresh), sessionHash: tokenShape(session) ? hash(session) : null, clientHash: hash(client ?? 'unknown') });
        const browser = result.browserHash === hash(fresh) ? fresh : oldBrowser;
        if (!tokenShape(browser) || hash(browser) !== result.browserHash) deny(503, 'CUSTOMER_ACCESS_NOT_ENABLED');
        return { browserToken: browser, customer: result.customer, csrf: this.digest(result.customer ? `session:${session}` : `browser:${browser}`) };
    }
    async send(header, csrf, input, client) {
        keys(input, ['phone', 'requestId']);
        if (!UUID.test(input.requestId ?? '')) deny(400, 'INVALID_REQUEST');
        const phone = normalizePhone(input.phone), authority = this.authority(header, csrf, 'browser');
        const challengeId = opaque(), claimId = randomUUID();
        const claim = await this.database.call('send_claim', { ...authority, phone, requestId: input.requestId,
            phoneHash: this.config.phoneHash(phone), challengeId, claimId, accountSid: this.config.accountSid,
            serviceSid: this.config.serviceSid, clientHash: hash(client ?? 'unknown') });
        if (claim.existing) return { challengeId: claim.challengeId, expiresAt: claim.expiresAt };
        let result = null;
        try { result = await this.provider.start(phone); } catch { /* Claim remains unknown on any provider failure. */ }
        return this.database.call('send_finish', { ...authority, challengeId, claimId, result });
    }
    async verify(header, csrf, input, client) {
        keys(input, ['challengeId', 'code']);
        if (!tokenShape(input.challengeId) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) deny(400, 'CODE_NOT_ACCEPTED');
        const authority = this.authority(header, csrf, 'browser'), claimId = randomUUID();
        const token = this.digest(`issued:${input.challengeId}:${authority.browserHash}`, 'base64url');
        const replayHash = this.digest(`check:${input.challengeId}:${input.code}`);
        const data = { ...authority, challengeId: input.challengeId, claimId, replayHash, sessionHash: hash(token) };
        const claim = await this.database.call('check_claim', { ...data, clientHash: hash(client ?? 'unknown') });
        let customer = claim.customer;
        if (!claim.existing) {
            let result = null;
            try { result = await this.provider.check(claim.verificationSid, input.code); } catch { /* No inferred login or automatic retry. */ }
            ({ customer } = await this.database.call('check_finish', { ...data, result }));
        }
        return { token, customer, csrf: this.digest(`session:${token}`) };
    }
    logout(header, csrf) { return this.database.call('logout', this.authority(header, csrf)); }
    call(header, action, data, csrf) { return this.database.call(action, { ...data, ...this.authority(header, csrf) }); }
}
