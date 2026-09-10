import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { convertHeicPhoto } from '../lib/heic-import.mjs';
import { isHeicPhoto, PHOTO_ACCEPT, PHOTO_MAX_BYTES, prepareIntakePhoto, replaceIntakePhoto, describePhoto } from '../lib/workspace-client.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const heic = () => new File(['retained camera bytes'], 'IMG_9474.HEIC', { type: 'image/heic', lastModified: 123456 });
const converted = () => ({ ok: true, blob: new Blob(['fixture PNG bytes'], { type: 'image/png' }), width: 3024, height: 4032, colorSpace: 'display-p3' });
function workerFixture() {
    return { messages: [], terminated: 0, postMessage(value) { this.messages.push(value); }, terminate() { this.terminated++; } };
}

test('HEIC selection accepts iPhone MIME and extension-only exports without changing ordinary image bytes', async () => {
    for (const [name, type] of [['IMG_9474.HEIC', 'image/heic'], ['photo.HEIF', ''], ['photo.heic', 'application/octet-stream'], ['photo', 'image/heif']]) {
        assert.equal(isHeicPhoto(new File(['bytes'], name, { type })), true);
    }
    assert.match(PHOTO_ACCEPT, /\.heic/); assert.match(PHOTO_ACCEPT, /\.heif/);
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
        const original = new File(['unchanged'], 'photo.HEIC', { type });
        const result = await prepareIntakePhoto(original, { convert: () => assert.fail('Native image must not be converted') });
        assert.equal(result.file, original); assert.equal(result.original, null);
    }
    assert.equal(isHeicPhoto(new File(['x'], 'document.pdf', { type: 'application/pdf' })), false);
});

test('HEIC import keeps selected bytes and hashes separately from the PNG upload descriptor', async () => {
    const original = heic(), png = converted(), progress = [];
    const result = await prepareIntakePhoto(original, { convert: async () => png, onProgress: value => progress.push(value) });
    assert.equal(result.original, original);
    assert.equal(result.file.name, 'IMG_9474.HEIC.png'); assert.equal(result.file.type, 'image/png');
    assert.equal(result.file.lastModified, original.lastModified);
    assert.equal(result.conversion.originalSha256, sha256('retained camera bytes'));
    assert.equal(result.conversion.imported.sha256, sha256('fixture PNG bytes'));
    assert.deepEqual(result.conversion.imported, await describePhoto(result.file));
    assert.equal(result.conversion.width, 3024); assert.equal(result.conversion.height, 4032);
    assert.equal(result.conversion.colorSpace, 'display-p3'); assert.equal(progress.length, 1);
    const old = { files: { BACK: { name: 'other.png' } }, uploads: {}, pending: null, pairConfirmed: true };
    const next = replaceIntakePhoto(old, 'FRONT', result.file, result);
    assert.equal(next.sourceFiles.FRONT, original); assert.equal(next.files.FRONT, result.file);
    assert.equal(next.files.BACK, old.files.BACK); assert.equal(next.pairConfirmed, false);
    assert.equal(old.files.FRONT, undefined, 'Import does not mutate an existing draft');
});

test('bad or oversized selections fail before decoding or replacing a saved photo', async () => {
    let calls = 0;
    await assert.rejects(prepareIntakePhoto({ name: 'big.heic', type: 'image/heic', size: PHOTO_MAX_BYTES + 1 }, { convert: () => { calls++; } }), /50 MB/);
    await assert.rejects(prepareIntakePhoto(new File([], 'empty.heic', { type: 'image/heic' }), { convert: () => { calls++; } }), /50 MB/);
    assert.equal(calls, 0);
    await assert.rejects(prepareIntakePhoto(heic(), { convert: async () => { throw new Error('Invalid HEIC'); } }), /Invalid HEIC/);
});

test('worker terminates on success and transfers only the selected photo', async () => {
    const worker = workerFixture(), original = heic(), result = converted();
    const pending = convertHeicPhoto(original, { workerFactory: () => worker });
    assert.deepEqual(worker.messages, [{ file: original }]);
    worker.onmessage({ data: result });
    assert.equal(await pending, result); assert.equal(worker.terminated, 1);
    worker.onmessage({ data: result }); assert.equal(worker.terminated, 1);
});

test('decoder failure, malformed output, crash and timeout release the worker without a usable image', async () => {
    for (const fire of [worker => worker.onmessage({ data: { ok: false, error: 'Unsupported HEIC color profile' } }),
        worker => worker.onmessage({ data: { ...converted(), width: 20000 } }),
        worker => worker.onmessage({ data: { ...converted(), blob: new Blob(['jpeg'], { type: 'image/jpeg' }) } }),
        worker => worker.onmessage({ data: { ...converted(), colorSpace: 'unknown' } }),
        worker => worker.onerror({ preventDefault() {} }), worker => worker.onmessageerror()]) {
        const worker = workerFixture(), pending = convertHeicPhoto(heic(), { workerFactory: () => worker });
        fire(worker); await assert.rejects(pending); assert.equal(worker.terminated, 1);
    }
    const worker = workerFixture();
    await assert.rejects(convertHeicPhoto(heic(), { workerFactory: () => worker, timeoutMs: 5 }), /too long/);
    assert.equal(worker.terminated, 1);
});

test('navigation cancellation stops conversion and a pre-cancelled selection starts no decoder', async () => {
    const worker = workerFixture(), controller = new AbortController();
    const pending = convertHeicPhoto(heic(), { workerFactory: () => worker, signal: controller.signal });
    controller.abort(); await assert.rejects(pending, /cancelled/); assert.equal(worker.terminated, 1);
    await assert.rejects(convertHeicPhoto(heic(), { signal: controller.signal, workerFactory: () => assert.fail('No worker after cancellation') }), /cancelled/);
});
