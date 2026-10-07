import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { canonical, digest } from '../src/protocol.mjs';
import { parseApprovedImageDescriptor, signPublicMediaRequest, verifyPublicMediaRequest, publicMediaClient, ApprovedPublicMedia } from '../src/public-media.mjs';
const config = () => ({ mediaOrigin: 'https://bridge.example.test', mediaKey: randomBytes(32), deploymentId: 'public-release.vercel.app', releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64) });
const reference = () => ({ token: 'ar_abcdefghijklmnopqrstuvwx', version: 1, side: 'FRONT', publicHash: 'c'.repeat(64), imageHash: digest('fixture-image') });
const descriptor = () => ({ sourceRef: 'private/capture/front.webp', sha256: digest('fixture-image'), byteCount: 13, width: 1270, height: 1778, contentType: 'image/webp' });
test('public media MAC grants only the exact approved image and cannot borrow another purpose', () => {
    const c = config(), verifier = { origin: c.mediaOrigin, key: c.mediaKey }, r = reference();
    const signed = signPublicMediaRequest(c, r, 100_000);
    assert.equal(verifyPublicMediaRequest(verifier, signed.body, signed.signature, 100_001).imageHash, r.imageHash);
    for (const now of [99_999, 130_000]) assert.throws(() => verifyPublicMediaRequest(verifier, signed.body, signed.signature, now));
    assert.throws(() => verifyPublicMediaRequest({ ...verifier, key: randomBytes(32) }, signed.body, signed.signature, 100_001));
    for (const change of [{ purpose: 'atlas-staff-grading-bridge-v1' }, { issuer: 'atlas-staff' }, { version: 0 }, { side: 'ORIGINAL' },
        { audience: 'https://other.example.test' }, { actorId: 'human' }, { sourceRef: 'private/other' }, { token: 'tk2c_not-public' }]) {
        const body = canonical({ ...JSON.parse(signed.body), ...change }), signature = createHmac('sha256', c.mediaKey).update(body).digest('hex');
        assert.throws(() => verifyPublicMediaRequest(verifier, body, signature, 100_001));
    }
    assert.throws(() => verifyPublicMediaRequest(verifier, signed.body.replace('"version":1', '"version":2'), signed.signature, 100_001));
    assert.throws(() => signPublicMediaRequest(c, { ...r, sourceRef: 'private/other' }));
    assert.throws(() => signPublicMediaRequest({ ...c, mediaKey: Buffer.alloc(1) }, r));
});
test('production image descriptors reject SVG, extra keys and unbounded or malformed image metadata', () => {
    const d = descriptor(); assert.equal(parseApprovedImageDescriptor(d, 'PRODUCTION'), d);
    for (const update of [{ contentType: 'image/svg+xml' }, { byteCount: 0 }, { byteCount: 52428801 }, { width: 20001 },
        { sourceRef: '' }, { sha256: 'f' }, { unused: true }]) assert.throws(() => parseApprovedImageDescriptor({ ...d, ...update }, 'PRODUCTION'));
    assert.throws(() => parseApprovedImageDescriptor(d, 'LOCAL_FIXTURE'));
});
test('public media transport sends no private descriptor, uses one fixed destination and verifies bounded bytes', async () => {
    const c = config(); let calls = 0;
    const client = publicMediaClient(c, async (url, init) => {
        calls++; assert.equal(url, c.mediaOrigin + '/api/internal/atlas/public-media'); assert.equal(init.redirect, 'error');
        assert(!init.body.includes('private/capture')); return new Response('fixture-image', { headers: { 'content-type': 'image/webp' } });
    });
    assert.equal((await client.read(reference(), descriptor())).toString(), 'fixture-image'); assert.equal(calls, 1);
    for (const body of ['fixture-imagf', 'too large fixture-image']) {
        const changed = publicMediaClient(c, async () => new Response(body, { headers: { 'content-type': 'image/webp' } }));
        await assert.rejects(() => changed.read(reference(), descriptor()));
    }
    let lost = 0;
    await assert.rejects(() => publicMediaClient(c, async () => { lost++; throw new Error('lost reply'); }).read(reference(), descriptor()));
    assert.equal(lost, 1);
});
test('media service checks activation after the storage read and never emits changed bytes', async () => {
    const d = descriptor(), r = reference(), cfg = { origin: 'https://bridge.example.test', deploymentId: 'media-release.vercel.app',
        releaseSha: 'a'.repeat(40), configHash: 'd'.repeat(64), clientKeyHash: 'e'.repeat(64) };
    let enabled = true, reads = 0;
    const tx = { async $queryRaw(strings) {
        return strings.join('').includes('PublicMediaControl') ? [{ ...cfg, mode: 'PRODUCTION', enabled }] :
            [{ canonical: canonical(d), digest: digest(canonical(d)), public_hash: r.publicHash, mode: 'PRODUCTION' }];
    } };
    const client = { async $transaction(work) { return work(tx); } };
    const claims = { ...r, expiresAt: Date.now() + 30_000 };
    const service = new ApprovedPublicMedia({ client, config: cfg, readStorage: async (ref, limit) => {
        reads++; assert.equal(ref, d.sourceRef); assert.equal(limit, d.byteCount); enabled = false; return Buffer.from('fixture-image');
    } });
    await assert.rejects(() => service.read(claims), /NOT_ENABLED/); assert.equal(reads, 1);
    await assert.rejects(() => service.read(claims), /NOT_ENABLED/); assert.equal(reads, 1);
    enabled = true;
    await assert.rejects(() => new ApprovedPublicMedia({ client, config: cfg, readStorage: async () => Buffer.from('fixture-imagf') }).read(claims), /BYTES_CHANGED/);
    await assert.rejects(() => service.read({ ...claims, expiresAt: Date.now() - 1 }), /EXPIRED/);
});
