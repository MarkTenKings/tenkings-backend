import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { bridgeOrigin, canonical, digest, keys, requireBridge, SHA, UUID } from './protocol.mjs';
import { boundedBytes } from './transport.mjs';

export const MEDIA_PATH = '/api/internal/atlas/public-media';
export const MEDIA_PURPOSE = 'atlas-approved-public-image-v1';
export function parseApprovedImageDescriptor(value, mode) {
    keys(value, ['sourceRef', 'sha256', 'byteCount', 'width', 'height', 'contentType']);
    requireBridge(typeof value.sourceRef === 'string' && value.sourceRef.length > 0 && value.sourceRef.length <= 2048
        && typeof value.sha256 === 'string' && SHA.test(value.sha256)
        && Number.isSafeInteger(value.byteCount) && value.byteCount > 0 && value.byteCount <= 50 * 1024 * 1024
        && ['width', 'height'].every(k => Number.isSafeInteger(value[k]) && value[k] > 0 && value[k] <= 20_000)
        && ((mode === 'LOCAL_FIXTURE' && value.contentType === 'image/svg+xml' && /^sample-00[123]:(FRONT|BACK)$/.test(value.sourceRef))
            || (mode === 'PRODUCTION' && ['image/webp', 'image/jpeg', 'image/png'].includes(value.contentType))), 'APPROVED_IMAGE_INVALID');
    return value;
}
export function signPublicMediaRequest(config, reference, now = Date.now()) {
    keys(reference, ['token', 'version', 'side', 'publicHash', 'imageHash']);
    bridgeOrigin(config.mediaOrigin);
    requireBridge(Buffer.isBuffer(config.mediaKey) && config.mediaKey.length === 32, 'PUBLIC_MEDIA_CONFIGURATION_INVALID');
    const claims = { purpose: MEDIA_PURPOSE, issuer: 'atlas-public', audience: config.mediaOrigin,
        deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash,
        ...reference, issuedAt: now, expiresAt: now + 30_000, nonce: randomUUID() };
    const body = canonical(claims);
    const signature = createHmac('sha256', config.mediaKey).update(body).digest('hex');
    verifyPublicMediaRequest({ origin: config.mediaOrigin, key: config.mediaKey }, body, signature, now);
    return { body, signature };
}
export function verifyPublicMediaRequest(config, body, signature, now = Date.now()) {
    requireBridge(typeof body === 'string' && Buffer.byteLength(body) <= 4096 && typeof signature === 'string' && SHA.test(signature));
    requireBridge(timingSafeEqual(createHmac('sha256', config.key).update(body).digest(), Buffer.from(signature, 'hex')), 'PUBLIC_MEDIA_AUTHENTICATION_REQUIRED');
    const c = JSON.parse(body);
    keys(c, ['purpose', 'issuer', 'audience', 'deploymentId', 'releaseSha', 'configHash', 'token', 'version', 'side', 'publicHash', 'imageHash', 'issuedAt', 'expiresAt', 'nonce']);
    requireBridge(canonical(c) === body && c.purpose === MEDIA_PURPOSE && c.issuer === 'atlas-public' && c.audience === config.origin
        && typeof c.deploymentId === 'string' && /^[a-z0-9-]+\.vercel\.app$/.test(c.deploymentId)
        && typeof c.releaseSha === 'string' && /^[a-f0-9]{40}$/.test(c.releaseSha)
        && [c.configHash, c.publicHash, c.imageHash].every(v => typeof v === 'string' && SHA.test(v))
        && typeof c.token === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(c.token)
        && Number.isSafeInteger(c.version) && c.version > 0 && c.version <= 2147483647 && ['FRONT', 'BACK'].includes(c.side)
        && Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt) && c.issuedAt <= now && c.expiresAt > now
        && c.expiresAt - c.issuedAt <= 30_000 && typeof c.nonce === 'string' && UUID.test(c.nonce));
    return c;
}
export function publicMediaClient(config, fetchImpl = fetch) {
    bridgeOrigin(config.mediaOrigin);
    return { async read(reference, descriptor) {
        const signed = signPublicMediaRequest(config, reference);
        const response = await fetchImpl(`${config.mediaOrigin}${MEDIA_PATH}`, { method: 'POST', redirect: 'error',
            headers: { 'content-type': 'application/json', 'x-atlas-public-media-signature': signed.signature }, body: signed.body,
            signal: AbortSignal.timeout(30_000) });
        requireBridge(response.status === 200 && response.headers.get('content-type')?.split(';')[0] === descriptor.contentType, 'PUBLIC_IMAGE_UNAVAILABLE');
        const bytes = await boundedBytes(response, descriptor.byteCount);
        requireBridge(bytes.length === descriptor.byteCount && digest(bytes) === descriptor.sha256, 'PUBLIC_IMAGE_BYTES_CHANGED');
        return bytes;
    } };
}

/** Read-only legacy storage adapter. Both activations and exact approval are
 * checked before and after the bounded storage read. */
export class ApprovedPublicMedia {
    constructor({ client, config, readStorage }) { this.client = client; this.config = config; this.readStorage = readStorage; }
    async descriptor(claims) {
        requireBridge(claims.expiresAt > Date.now(), 'PUBLIC_MEDIA_REQUEST_EXPIRED');
        return this.client.$transaction(async tx => {
            const [control] = await tx.$queryRaw`SELECT * FROM atlas_staff."PublicMediaControl" WHERE id='active' FOR SHARE`;
            requireBridge(control?.enabled && control.mode === 'PRODUCTION' && control.origin === this.config.origin
                && control.deploymentId === this.config.deploymentId && control.releaseSha === this.config.releaseSha
                && control.configHash === this.config.configHash && control.clientKeyHash === this.config.clientKeyHash, 'PUBLIC_MEDIA_NOT_ENABLED');
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.read_approved_image(${claims.token}::text,${claims.version}::int,${claims.side}::text,
                ${claims.deploymentId}::text,${claims.releaseSha}::text,${claims.configHash}::text)`;
            requireBridge(rows.length === 1 && rows[0].mode === 'PRODUCTION' && rows[0].public_hash === claims.publicHash
                && digest(rows[0].canonical) === rows[0].digest, 'APPROVED_IMAGE_NOT_FOUND');
            const descriptor = parseApprovedImageDescriptor(JSON.parse(rows[0].canonical), 'PRODUCTION');
            requireBridge(canonical(descriptor) === rows[0].canonical && descriptor.sha256 === claims.imageHash, 'APPROVED_IMAGE_INVALID');
            return descriptor;
        }, { maxWait: 5000, timeout: 10_000 });
    }
    async read(claims) {
        const descriptor = await this.descriptor(claims);
        const bytes = Buffer.from(await this.readStorage(descriptor.sourceRef, descriptor.byteCount));
        requireBridge(bytes.length === descriptor.byteCount && digest(bytes) === descriptor.sha256, 'PUBLIC_IMAGE_BYTES_CHANGED');
        requireBridge(canonical(await this.descriptor(claims)) === canonical(descriptor), 'APPROVED_IMAGE_CHANGED');
        return { bytes, contentType: descriptor.contentType };
    }
}
