import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { uploadRapidIntakeEntry } from '../lib/rapid-intake.mjs';
import { captureRapidCameraPhoto } from '../lib/rapid-camera.mjs';
import { fixture, photo, clone, settle, waitFor } from './rapid-intake-harness.mjs';
function uploadFixture() {
    const f = fixture();
    f.saved = [{ id: randomUUID(), title: 'Staff label', files: { FRONT: photo('front'), BACK: photo('back') }, identity: {}, uploads: {}, card: null, pending: null, pairConfirmed: true }];
    f.run = () => uploadRapidIntakeEntry(f.saved[0], { request: f.request, persist: async entry => { f.saved[0] = clone(entry); }, put: (...args) => f.put(...args) });
    return f;
}

test('large object PUTs overlap while manifests/completions retain exact revision order', async () => {
    const f = uploadFixture(), release = new Map(), originalPut = f.put;
    f.put = (grant, file) => new Promise(resolve => release.set(file.name, async () => { await originalPut(grant, file); resolve(); }));
    const run = f.run(); await waitFor(() => release.size === 2, 'both original photo PUTs to start');
    assert.equal(release.size, 2, 'Both PUTs start without waiting for Front bytes');
    assert.deepEqual(f.requests.map(value => value.path.split('/').at(-1)), ['cards', 'upload-plan', 'upload-plan']);
    await release.get('back.png')(); await settle(); assert.equal(f.requests.length, 3);
    await release.get('front.png')(); await run;
    assert.equal(f.saved[0].uploads.FRONT.phase, 'VERIFIED'); assert.equal(f.saved[0].uploads.BACK.phase, 'VERIFIED');
    assert.deepEqual(f.requests.slice(1).map(value => value.body.expectedRevision), [1, 2, 3, 4]);
    assert.equal(f.requests[0].body.title, 'Staff label', 'Explicit staff labels survive identification preparation');
});

test('lost Back plan settles before other work and preserves the completed Front PUT', async () => {
    const f = uploadFixture(), request = f.request; let lost = false;
    f.request = async (path, options) => {
        if (!lost && path.endsWith('/upload-plan') && options.body.side === 'BACK') { lost = true; f.failAfter.set('upload-plan', new Error('Lost Back plan')); }
        return request(path, options);
    };
    await assert.rejects(f.run(), /Lost Back plan/);
    const pending = clone(f.saved[0].pending); assert.equal(pending.body.side, 'BACK'); assert.equal(f.saved[0].uploads.FRONT.phase, 'COMPLETE');
    await f.run(); assert.equal(f.puts.filter(value => value.name === 'front.png').length, 1);
    const calls = f.requests.filter(value => value.body.operationId === pending.body.operationId); assert.equal(calls.length, 2); assert.deepEqual(calls[1].body, pending.body);
});

test('failed Front PUT drains successful Back and never resends the completed Back object', async () => {
    const f = uploadFixture(), put = f.put; let first = true;
    f.put = async (grant, file) => { if (first && file.name === 'front.png') { first = false; throw new Error('Interrupted Front'); } return put(grant, file); };
    await assert.rejects(f.run(), /Interrupted Front/);
    assert.equal(f.saved[0].uploads.FRONT.phase, 'UPLOAD'); assert.equal(f.saved[0].uploads.BACK.phase, 'COMPLETE'); assert.equal(f.saved[0].pending, null);
    await f.run(); assert.equal(f.puts.filter(value => value.name === 'back.png').length, 1); assert.equal(f.saved[0].uploads.BACK.phase, 'VERIFIED');
});

test('native camera capture keeps original still bytes and requests actual available maximum', async () => {
    const original = new Blob(['original still JPEG bytes'], { type: 'image/jpeg' }); let requested;
    class Camera {
        async getPhotoCapabilities() { return { imageWidth: { max: 8064 }, imageHeight: { max: 6048 } }; }
        async takePhoto(settings) { requested = settings; return original; }
    }
    const captured = await captureRapidCameraPhoto({ paused: false, videoWidth: 1920, videoHeight: 1440 }, { readyState: 'live' }, 'FRONT', {
        ImageCaptureImpl: Camera, documentImpl: { createElement: () => assert.fail('Do not recompress a native still') }, bitmap: async () => ({ width: 8064, height: 6048, close() {} })
    });
    assert.deepEqual(requested, { imageWidth: 8064, imageHeight: 6048 }); assert.equal(captured.capture.source, 'NATIVE_STILL');
    assert.deepEqual(await captured.file.arrayBuffer(), await original.arrayBuffer()); assert.equal(captured.capture.width, 8064);
});

test('video-only browsers preserve every delivered pixel as a lossless PNG', async () => {
    const draws = [], encoded = [], canvas = { width: 0, height: 0, getContext: () => ({ getContextAttributes: () => ({ colorSpace: 'display-p3' }), drawImage: (...args) => draws.push(args) }),
        toBlob(callback, type) { encoded.push([this.width, this.height, type]); callback(new Blob(['lossless frame PNG'], { type })); } };
    const video = { paused: false, videoWidth: 4032, videoHeight: 3024 };
    const captured = await captureRapidCameraPhoto(video, { readyState: 'live' }, 'BACK', { ImageCaptureImpl: undefined, documentImpl: { createElement: () => canvas } });
    assert.deepEqual(encoded, [[4032, 3024, 'image/png']]); assert.deepEqual(draws[0], [video, 0, 0, 4032, 3024]);
    assert.equal(captured.capture.source, 'LOSSLESS_VIDEO_FRAME'); assert.equal(captured.capture.colorSpace, 'display-p3'); assert.equal(canvas.width, 1);
});

test('camera hardware failures never silently replace a failed native still with a preview', async () => {
    class Camera { async takePhoto() { throw Object.assign(new Error('Camera stopped'), { name: 'NotReadableError' }); } }
    await assert.rejects(captureRapidCameraPhoto({ paused: false, videoWidth: 1920, videoHeight: 1440 }, { readyState: 'live' }, 'FRONT', { ImageCaptureImpl: Camera, documentImpl: { createElement: () => assert.fail('No alternate source') } }), /Camera stopped/);
});
