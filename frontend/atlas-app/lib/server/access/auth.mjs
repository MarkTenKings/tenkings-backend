import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { cookies, deny, equal, hash, identifier, strictObject } from '../policy.mjs';
import { phoneInput } from '../../phone.mjs';

const MINUTE = 60_000;
const opaque = () => randomBytes(32).toString('base64url');
const error = (status, code) => ({ error: { status, code } });
const unwrap = result => { if (result?.error) deny(result.error.status, result.error.code); return result; };
const tokenShape = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
    && Buffer.from(value, 'base64url').toString('base64url') === value;

export class DurableStaffAuth {
    constructor({ database, config, provider }) {
        this.database = database; this.config = config; this.provider = provider;
        this.actors = new WeakMap();
    }
    digest(value, encoding = 'hex') { return createHmac('sha256', this.config.sessionKey).update(value).digest(encoding); }
    async audit(tx, event, subjectId, actorId = null, details = {}) {
        await tx.staffAudit.create({ data: { id: randomUUID(), event, subjectId, actorId, details: JSON.stringify(details) } });
    }
    async rate(tx, now, entries) {
        let allowed = true;
        for (const [key, limit] of entries) {
            const old = await tx.staffRateBucket.findUnique({ where: { key } });
            const count = old && old.expiresAt > now ? Math.min(old.count + 1, limit + 1) : 1;
            const expiresAt = old && old.expiresAt > now ? old.expiresAt : new Date(+now + 15 * MINUTE);
            await tx.staffRateBucket.upsert({ where: { key }, create: { key, count, expiresAt }, update: { count, expiresAt } });
            if (count > limit) allowed = false;
        }
        return allowed;
    }
    jar(header) { return cookies(header); }
    async browser(context, header, csrf) {
        const token = this.jar(header)[this.config.cookies.browser];
        if (!tokenShape(token) || !equal(csrf, this.digest(`browser:${token}`))) return null;
        const row = await context.tx.staffBrowser.findUnique({ where: { tokenHash: hash(token) } });
        return row && row.expiresAt > context.now && row.controlRevision === context.control.revision ? row : null;
    }
    async current(context, sessionHash, browserHash) {
        const { tx, now, control } = context;
        const session = await tx.staffSession.findUnique({ where: { tokenHash: sessionHash }, include: { identity: true, browser: true } });
        if (!session || session.revokedAt || session.expiresAt <= now || session.browserHash !== browserHash
            || session.controlRevision !== control.revision || session.browser.controlRevision !== control.revision
            || session.browser.expiresAt <= now) return null;
        // Holding the identity row prevents a concurrent revocation/role change
        // from passing the final mutation's authorization check.
        const rows = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentity" WHERE id = ${session.identityId}::uuid FOR SHARE`;
        const identity = rows[0];
        if (!identity || identity.revokedAt || identity.accessVersion !== session.accessVersion
            || !this.config.phoneByHash.has(identity.phoneHash) || !['REVIEWER', 'OBSERVER'].includes(identity.role)) return null;
        return { identity, session };
    }
    actor(current, browserHash) {
        const staff = { id: current.identity.id, name: current.identity.name, role: current.identity.role, mode: this.config.mode };
        this.actors.set(staff, { sessionHash: current.session.tokenHash, browserHash });
        return staff;
    }
    async withStaff(staff, work) {
        const authority = this.actors.get(staff);
        if (!authority) deny(401, 'SIGN_IN_REQUIRED');
        return this.database.transaction(async context => {
            const current = await this.current(context, authority.sessionHash, authority.browserHash);
            if (!current) deny(401, 'SIGN_IN_REQUIRED');
            return work({ ...context, identity: current.identity, session: current.session });
        });
    }
    async bootstrap(header, client = 'loopback', { reauthenticate = false } = {}) {
        return unwrap(await this.database.transaction(async context => {
            const { tx, now, control } = context, jar = this.jar(header);
            let token = jar[this.config.cookies.browser];
            const row = tokenShape(token) && await tx.staffBrowser.findUnique({ where: { tokenHash: hash(token) } });
            if (!row || row.expiresAt <= now || row.controlRevision !== control.revision) {
                if (!await this.rate(tx, now, [['browser-global', 120], [`browser-client:${hash(client)}`, 30]])) return error(429, 'PLEASE_WAIT');
                token = opaque();
                await tx.staffBrowser.create({ data: { tokenHash: hash(token), controlRevision: control.revision, createdAt: now, expiresAt: new Date(+now + 60 * MINUTE) } });
            }
            const sessionToken = jar[this.config.cookies.session];
            const current = tokenShape(sessionToken) && await this.current(context, hash(sessionToken), hash(token));
            return { browserToken: token, csrf: this.digest(current && !reauthenticate ? `session:${sessionToken}` : `browser:${token}`),
                staff: current ? this.actor(current, hash(token)) : null };
        }));
    }
    async maybeAuthenticate(header) {
        const jar = this.jar(header), token = jar[this.config.cookies.session], browser = jar[this.config.cookies.browser];
        if (!tokenShape(token) || !tokenShape(browser)) return null;
        return this.database.transaction(async context => {
            const current = await this.current(context, hash(token), hash(browser));
            return current ? this.actor(current, hash(browser)) : null;
        });
    }
    async authenticate(header, csrf) {
        const staff = await this.maybeAuthenticate(header);
        if (!staff) deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== undefined && !equal(csrf, this.digest(`session:${this.jar(header)[this.config.cookies.session]}`))) deny(403, 'CSRF_REQUIRED');
        return staff;
    }
    exact(result, challenge, status) {
        return result && /^VE[0-9a-fA-F]{32}$/.test(result.verificationSid ?? '')
            && result.accountSid === challenge.accountSid && result.serviceSid === challenge.serviceSid
            && result.verificationSid === challenge.verificationSid && result.channel === 'sms' && result.status === status
            && result.phone === this.config.phoneByHash.get(challenge.phoneHash);
    }
    async send(header, csrf, input, client) {
        strictObject(input, ['phone', 'requestId']); identifier(input.requestId);
        const phone = phoneInput(input.phone);
        if (!phone) deny(400, 'USE_INTERNATIONAL_PHONE');
        const claim = unwrap(await this.database.transaction(async context => {
            const { tx, now, control } = context;
            const browser = await this.browser(context, header, csrf);
            if (!browser) return error(403, 'SIGN_IN_SESSION_EXPIRED');
            if (!await this.rate(tx, now, [['send-global', 40], [`send-client:${hash(client)}`, 12]])) return error(429, 'PLEASE_WAIT');
            const phoneHash = this.config.phoneHash(phone);
            if (!this.config.phoneByHash.has(phoneHash)) return error(403, 'SIGN_IN_NOT_AVAILABLE');
            const identity = await tx.staffIdentity.findUnique({ where: { phoneHash } });
            if (identity?.revokedAt) return error(403, 'SIGN_IN_NOT_AVAILABLE');
            const prior = await tx.staffChallenge.findUnique({ where: { browserHash_requestId: { browserHash: browser.tokenHash, requestId: input.requestId } } });
            if (prior) {
                if (prior.phoneHash !== phoneHash) return error(409, 'REQUEST_CONFLICT');
                if (prior.state !== 'PENDING' || prior.expiresAt <= now || prior.controlRevision !== control.revision) return error(409, 'SIGN_IN_RESTART_REQUIRED');
                return { result: { challengeId: prior.id, expiresAt: +prior.expiresAt } };
            }
            const active = await tx.staffChallenge.findFirst({ where: { phoneHash, state: { in: ['SENDING', 'PENDING', 'CHECKING', 'UNKNOWN'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
            if (active && active.quarantineUntil > now && ['SENDING', 'CHECKING', 'UNKNOWN'].includes(active.state)) return error(409, 'SIGN_IN_RESTART_REQUIRED');
            if (active && +active.createdAt + MINUTE > +now) return error(429, 'PLEASE_WAIT');
            if (!await this.rate(tx, now, [[`send-phone:${phoneHash}`, 4]])) return error(429, 'PLEASE_WAIT');
            if (active) await tx.staffChallenge.update({ where: { id: active.id }, data: { state: 'SUPERSEDED' } });
            const challenge = await tx.staffChallenge.create({ data: { id: opaque(), browserHash: browser.tokenHash,
                requestId: input.requestId, phoneHash, controlRevision: control.revision,
                accountSid: this.config.accountSid, serviceSid: this.config.serviceSid, state: 'SENDING', sendClaimId: randomUUID(),
                createdAt: now, expiresAt: new Date(+now + 5 * MINUTE), quarantineUntil: new Date(+now + this.config.providerLifetimeMs + MINUTE) } });
            await this.audit(tx, 'VERIFY_SEND_CLAIMED', challenge.id);
            return { challenge };
        }));
        if (claim.result) return claim.result;
        let result;
        try { result = await this.provider.start(phone); } catch { result = null; }
        return unwrap(await this.database.transaction(async ({ tx, now, control }) => {
            const challenge = await tx.staffChallenge.findUnique({ where: { id: claim.challenge.id } });
            if (!challenge || challenge.state !== 'SENDING' || challenge.sendClaimId !== claim.challenge.sendClaimId) return error(409, 'SIGN_IN_RESTART_REQUIRED');
            const bound = { ...challenge, verificationSid: result?.verificationSid };
            const identity = await tx.staffIdentity.findUnique({ where: { phoneHash: challenge.phoneHash } });
            if (!this.exact(result, bound, 'pending') || challenge.expiresAt <= now || challenge.controlRevision !== control.revision || identity?.revokedAt) {
                await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'UNKNOWN' } });
                await this.audit(tx, 'VERIFY_SEND_UNRESOLVED', challenge.id);
                return error(503, 'SIGN_IN_RESTART_REQUIRED');
            }
            await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'PENDING', verificationSid: result.verificationSid } });
            await this.audit(tx, 'VERIFY_SEND_RECORDED', challenge.id);
            return { challengeId: challenge.id, expiresAt: +challenge.expiresAt };
        }));
    }
    issuedToken(challenge) { return this.digest(`issued:${challenge.id}:${challenge.browserHash}`, 'base64url'); }
    async verify(header, csrf, input, client) {
        strictObject(input, ['challengeId', 'code']); identifier(input.challengeId);
        if (!/^\d{6}$/.test(input.code ?? '')) deny(400, 'CODE_NOT_ACCEPTED');
        const claim = unwrap(await this.database.transaction(async context => {
            const { tx, now, control } = context;
            const browser = await this.browser(context, header, csrf);
            if (!browser) return error(403, 'SIGN_IN_SESSION_EXPIRED');
            if (!await this.rate(tx, now, [['check-global', 120], [`check-client:${hash(client)}`, 30]])) return error(429, 'PLEASE_WAIT');
            const challenge = await tx.staffChallenge.findUnique({ where: { id: input.challengeId } });
            if (!challenge || challenge.browserHash !== browser.tokenHash || challenge.expiresAt <= now
                || challenge.controlRevision !== control.revision || !this.config.phoneByHash.has(challenge.phoneHash)) return error(400, 'CODE_NOT_ACCEPTED');
            const token = this.issuedToken(challenge), replayHash = this.digest(`check:${challenge.id}:${input.code}`);
            if (challenge.state === 'CONSUMED') {
                const current = await this.current(context, hash(token), browser.tokenHash);
                if (!current || !challenge.replayUntil || challenge.replayUntil <= now || !equal(challenge.replayHash, replayHash)) return error(400, 'CODE_NOT_ACCEPTED');
                return { result: { token, staff: this.actor(current, browser.tokenHash), csrf: this.digest(`session:${token}`) } };
            }
            const identity = await tx.staffIdentity.findUnique({ where: { phoneHash: challenge.phoneHash } });
            if (identity?.revokedAt || challenge.state !== 'PENDING' || challenge.attempts >= 5) return error(400, 'CODE_NOT_ACCEPTED');
            if (!await this.rate(tx, now, [[`check-phone:${challenge.phoneHash}`, 20]])) return error(429, 'PLEASE_WAIT');
            const checkClaimId = randomUUID();
            await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'CHECKING', checkClaimId, attempts: { increment: 1 } } });
            await this.audit(tx, 'VERIFY_CHECK_CLAIMED', challenge.id, null, { attempt: challenge.attempts + 1 });
            return { challenge, checkClaimId, replayHash };
        }));
        if (claim.result) return claim.result;
        let result;
        try { result = await this.provider.check(claim.challenge.verificationSid, input.code); } catch { result = null; }
        return unwrap(await this.database.transaction(async context => {
            const { tx, now, control } = context;
            const challenge = await tx.staffChallenge.findUnique({ where: { id: claim.challenge.id } });
            if (!challenge || challenge.state !== 'CHECKING' || challenge.checkClaimId !== claim.checkClaimId) return error(409, 'SIGN_IN_RESTART_REQUIRED');
            const existing = await tx.staffIdentity.findUnique({ where: { phoneHash: challenge.phoneHash } });
            if (challenge.expiresAt <= now || challenge.controlRevision !== control.revision || existing?.revokedAt
                || !this.config.phoneByHash.has(challenge.phoneHash)) {
                await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'UNKNOWN' } });
                return error(400, 'CODE_NOT_ACCEPTED');
            }
            if (this.exact(result, challenge, 'pending')) {
                await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'PENDING', checkClaimId: null } });
                await this.audit(tx, 'VERIFY_CODE_REJECTED', challenge.id);
                return error(400, 'CODE_NOT_ACCEPTED');
            }
            if (!this.exact(result, challenge, 'approved')) {
                await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'UNKNOWN' } });
                await this.audit(tx, 'VERIFY_CHECK_UNRESOLVED', challenge.id);
                return error(503, 'SIGN_IN_RESTART_REQUIRED');
            }
            // Explicit columns keep database-owned role/training defaults out of
            // Prisma's generated upsert INSERT column list.
            const [identity] = await tx.$queryRaw`INSERT INTO atlas_staff."StaffIdentity" (id,"phoneHash","lastLoginAt")
                VALUES (${randomUUID()}::uuid,${challenge.phoneHash},${now})
                ON CONFLICT ("phoneHash") DO UPDATE SET "lastLoginAt"=EXCLUDED."lastLoginAt" RETURNING *`;
            // The upsert holds the identity lock. A revocation that raced the
            // earlier lookup must be observed before a session can be issued.
            if (identity.revokedAt || !['REVIEWER', 'OBSERVER'].includes(identity.role)) {
                await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'UNKNOWN' } });
                return error(403, 'SIGN_IN_NOT_AVAILABLE');
            }
            const token = this.issuedToken(challenge);
            const session = await tx.staffSession.create({ data: { tokenHash: hash(token), identityId: identity.id,
                browserHash: challenge.browserHash, challengeId: challenge.id, controlRevision: control.revision,
                accessVersion: identity.accessVersion, createdAt: now, expiresAt: new Date(+now + 30 * MINUTE) } });
            await tx.staffChallenge.update({ where: { id: challenge.id }, data: { state: 'CONSUMED', consumedAt: now,
                replayHash: claim.replayHash, replayUntil: new Date(Math.min(+challenge.expiresAt, +now + MINUTE)) } });
            await this.audit(tx, 'STAFF_SESSION_ISSUED', challenge.id, identity.id);
            return { token, staff: this.actor({ identity, session }, challenge.browserHash), csrf: this.digest(`session:${token}`) };
        }));
    }
    async logout(header, csrf) {
        const jar = this.jar(header), token = jar[this.config.cookies.session], browser = jar[this.config.cookies.browser];
        if (!tokenShape(token) || !tokenShape(browser) || !equal(csrf, this.digest(`session:${token}`))) deny(403, 'CSRF_REQUIRED');
        await this.database.transaction(async ({ tx, now }) => {
            const session = await tx.staffSession.findUnique({ where: { tokenHash: hash(token) } });
            if (!session || session.browserHash !== hash(browser)) deny(401, 'SIGN_IN_REQUIRED');
            if (!session.revokedAt) {
                await tx.staffSession.update({ where: { tokenHash: session.tokenHash }, data: { revokedAt: now } });
                await this.audit(tx, 'STAFF_SESSION_REVOKED', session.challengeId, session.identityId);
            }
        });
    }
}
