import { createHmac, randomBytes } from 'node:crypto';
import { BROWSER_COOKIE, SESSION_COOKIE, FIXTURE_PHONE, FIXTURE_CODE, cookies, deny, equal, hash, parseApprovedPhones } from './policy.mjs';
import { phoneInput } from '../phone.mjs';
const opaque = () => randomBytes(32).toString('base64url');
const ACCOUNT = 'AC_SYNTHETIC_ATLAS';
const SERVICE = 'VA_SYNTHETIC_ATLAS';
const MINUTE = 60000;
const ROSTER = [
    { phone: FIXTURE_PHONE, id: 'fixture-reviewer', name: 'Alex Morgan', role: 'REVIEWER' },
    { phone: '+12025550142', id: 'fixture-observer', name: 'Jordan Lee', role: 'OBSERVER' }
];
/** Synthetic transport has no network import, credentials or SMS implementation. */
export function syntheticVerifyProvider() {
    const sent = new Map();
    return {
        async start(phone) {
            const verificationSid = `VE_${opaque()}`;
            const result = { accountSid: ACCOUNT, serviceSid: SERVICE, verificationSid, phone, channel: 'sms', status: 'pending' };
            sent.set(verificationSid, result);
            return { ...result };
        },
        async check(verificationSid, code) {
            const original = sent.get(verificationSid);
            if (!original)
                throw new Error('UNKNOWN_SYNTHETIC_CHALLENGE');
            return { ...original, status: code === FIXTURE_CODE ? 'approved' : 'pending' };
        }
    };
}
/** Process-local fixture store. Production must supply a separately reviewed durable adapter. */
export class LocalStaffAuth {
    constructor({ now = Date.now, provider = syntheticVerifyProvider(), approvedPhones = () => parseApprovedPhones(ROSTER.map(p => p.phone).join(',')) } = {}) {
        this.now = now;
        this.provider = provider;
        this.approvedPhones = approvedPhones;
        this.secret = randomBytes(32);
        this.browsers = new Map();
        this.challenges = new Map();
        this.sessions = new Map();
        this.rates = new Map();
        this.tail = Promise.resolve();
    }
    digest(value) { return createHmac('sha256', this.secret).update(value).digest('base64url'); }
    async locked(fn) {
        const previous = this.tail;
        let release;
        this.tail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
    prune() {
        const now = this.now();
        for (const map of [this.browsers, this.challenges, this.sessions, this.rates])
            for (const [key, row] of map)
                if (row.expiresAt <= now)
                    map.delete(key);
    }
    rate(key, limit, window = 15 * MINUTE) {
        let row = this.rates.get(key);
        if (!row || row.expiresAt <= this.now()) {
            row = { count: 0, expiresAt: this.now() + window };
            this.rates.set(key, row);
        }
        if (++row.count > limit)
            deny(429, 'PLEASE_WAIT');
    }
    approved(phone) {
        if (!this.approvedPhones().has(phone))
            deny(403, 'SIGN_IN_NOT_AVAILABLE');
        const staff = ROSTER.find(p => p.phone === phone);
        if (!staff)
            deny(403, 'SIGN_IN_NOT_AVAILABLE');
        return { id: staff.id, name: staff.name, role: staff.role, mode: 'SYNTHETIC' };
    }
    bootstrap(header, _client, { reauthenticate = false } = {}) {
        this.prune();
        const jar = cookies(header);
        let token = jar[BROWSER_COOKIE];
        if (!token || !this.browsers.has(hash(token))) {
            if (this.browsers.size >= 256)
                deny(429, 'PLEASE_WAIT');
            token = opaque();
            this.browsers.set(hash(token), { expiresAt: this.now() + 60 * MINUTE });
        }
        const staff = this.maybeAuthenticate(header);
        return { browserToken: token, csrf: staff && !reauthenticate ? this.digest(`session:${jar[SESSION_COOKIE]}`) : this.digest(`browser:${token}`), staff };
    }
    browser(header, csrf) {
        const token = cookies(header)[BROWSER_COOKIE];
        const key = token && hash(token);
        if (!key || !this.browsers.has(key) || this.browsers.get(key).expiresAt <= this.now() ||
            !equal(csrf, this.digest(`browser:${token}`)))
            deny(403, 'SIGN_IN_SESSION_EXPIRED');
        return key;
    }
    maybeAuthenticate(header) {
        const jar = cookies(header), token = jar[SESSION_COOKIE];
        const session = token && this.sessions.get(hash(token));
        if (!session || session.expiresAt <= this.now() || session.browserKey !== hash(jar[BROWSER_COOKIE] || ''))
            return null;
        try {
            return this.approved(session.phone);
        }
        catch {
            return null;
        }
    }
    authenticate(header, csrf) {
        const staff = this.maybeAuthenticate(header);
        if (!staff)
            deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== undefined && !equal(csrf, this.digest(`session:${cookies(header)[SESSION_COOKIE]}`)))
            deny(403, 'CSRF_REQUIRED');
        return staff;
    }
    exactResponse(result, challenge, status) {
        return result && result.accountSid === ACCOUNT && result.serviceSid === SERVICE &&
            result.phone === challenge.phone && result.verificationSid === challenge.verificationSid &&
            result.channel === 'sms' && result.status === status;
    }
    async send(header, csrf, { phone, requestId }, client) {
        const browserKey = this.browser(header, csrf);
        return this.locked(async () => {
            this.prune();
            this.rate(`send-client:${client}`, 12);
            this.rate('send-global', 40);
            phone = phoneInput(phone);
            if (!phone) deny(400, 'USE_INTERNATIONAL_PHONE');
            this.approved(phone);
            const prior = [...this.challenges.values()].find(c => c.browserKey === browserKey && c.requestId === requestId);
            if (prior) {
                if (prior.phone !== phone)
                    deny(409, 'REQUEST_CONFLICT');
                if (prior.state !== 'PENDING')
                    deny(409, 'SIGN_IN_RESTART_REQUIRED');
                return { challengeId: prior.id, expiresAt: prior.expiresAt };
            }
            const active = [...this.challenges.values()].find(c => c.phone === phone && !['CONSUMED', 'SUPERSEDED'].includes(c.state));
            if (active?.state === 'UNKNOWN')
                deny(409, 'SIGN_IN_RESTART_REQUIRED');
            if (active && active.createdAt + MINUTE > this.now())
                deny(429, 'PLEASE_WAIT');
            this.rate(`send-phone:${hash(phone)}`, 4);
            const challenge = { id: opaque(), requestId, phone, browserKey, state: 'SENDING', attempts: 0,
                createdAt: this.now(), expiresAt: this.now() + 5 * MINUTE };
            if (active)
                active.state = 'SUPERSEDED';
            this.challenges.set(challenge.id, challenge);
            try {
                const result = await this.provider.start(phone);
                challenge.verificationSid = result?.verificationSid;
                if (typeof challenge.verificationSid !== 'string' || !/^VE_[a-zA-Z0-9_-]{20,80}$/.test(challenge.verificationSid) || !this.exactResponse(result, challenge, 'pending'))
                    throw new Error('INVALID_PROVIDER_RESULT');
                this.approved(phone);
                challenge.state = 'PENDING';
            }
            catch {
                challenge.state = 'UNKNOWN';
                deny(503, 'SIGN_IN_RESTART_REQUIRED');
            }
            return { challengeId: challenge.id, expiresAt: challenge.expiresAt };
        });
    }
    async verify(header, csrf, { challengeId, code }, client) {
        const browserKey = this.browser(header, csrf);
        return this.locked(async () => {
            this.rate(`check-client:${client}`, 30);
            this.rate('check-global', 120);
            const challenge = this.challenges.get(challengeId);
            if (!challenge || challenge.browserKey !== browserKey || challenge.expiresAt <= this.now())
                deny(400, 'CODE_NOT_ACCEPTED');
            this.approved(challenge.phone);
            const replayHash = this.digest(`check:${challengeId}:${code}`);
            const token = this.digest(`issued:${challengeId}:${browserKey}`);
            if (challenge.state === 'CONSUMED') {
                if (!equal(challenge.replayHash, replayHash) || !this.sessions.has(hash(token)) || this.sessions.get(hash(token)).expiresAt <= this.now())
                    deny(400, 'CODE_NOT_ACCEPTED');
                return { token, staff: this.approved(challenge.phone), csrf: this.digest(`session:${token}`) };
            }
            if (challenge.state !== 'PENDING' || ++challenge.attempts > 5)
                deny(400, 'CODE_NOT_ACCEPTED');
            this.rate(`check-phone:${hash(challenge.phone)}`, 20);
            challenge.state = 'CHECKING';
            let result;
            try {
                result = await this.provider.check(challenge.verificationSid, code);
            }
            catch {
                challenge.state = 'UNKNOWN';
                deny(503, 'SIGN_IN_RESTART_REQUIRED');
            }
            if (this.exactResponse(result, challenge, 'pending')) {
                challenge.state = 'PENDING';
                deny(400, 'CODE_NOT_ACCEPTED');
            }
            if (!this.exactResponse(result, challenge, 'approved')) {
                challenge.state = 'UNKNOWN';
                deny(400, 'CODE_NOT_ACCEPTED');
            }
            if (challenge.expiresAt <= this.now()) {
                challenge.state = 'EXPIRED';
                deny(400, 'CODE_NOT_ACCEPTED');
            }
            const staff = this.approved(challenge.phone);
            // One serialized fixture transaction consumes the challenge and issues one hashed session.
            this.sessions.set(hash(token), { phone: challenge.phone, browserKey, expiresAt: this.now() + 30 * MINUTE });
            challenge.state = 'CONSUMED';
            challenge.replayHash = replayHash;
            return { token, staff, csrf: this.digest(`session:${token}`) };
        });
    }
    logout(header, csrf) {
        this.authenticate(header, csrf);
        this.sessions.delete(hash(cookies(header)[SESSION_COOKIE]));
    }
}
