import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRapidCameraPhoto, fitRapidCameraPreview } from '../../atlas-shared/rapid-camera.mjs';
test('full-frame preview keeps camera aspect and every edge through phone rotation', () => {
    for (const [width, height] of [[4032, 3024], [3024, 4032], [1920, 1080], [1080, 1920]]) {
        for (const [availableWidth, availableHeight] of [[366, 450], [610, 210], [296, 270]]) {
            const frame = fitRapidCameraPreview(width, height, availableWidth, availableHeight);
            assert(Math.abs(frame.width / frame.height - width / height) < 1e-10);
            assert(frame.width <= availableWidth + 1e-8 && frame.height <= availableHeight + 1e-8);
            const guide = fitRapidCameraPreview(63.5, 88.9, frame.width * .9, frame.height * .9);
            assert(Math.abs(guide.width / guide.height - 63.5 / 88.9) < 1e-10);
            assert(guide.width <= frame.width * .9 + 1e-8 && guide.height <= frame.height * .9 + 1e-8);
        }
    }
    assert.equal(fitRapidCameraPreview(0, 0, 390, 450), null);
    assert.equal(fitRapidCameraPreview(3024, 4032, 390, 0), null);
});

test('rapid viewfinder captures exactly the delivered image even when native still framing differs', async () => {
    const video = { paused: false, videoWidth: 3024, videoHeight: 4032 };
    let draws;
    const canvas = { getContext: () => ({ drawImage: (...args) => { draws = args; } }),
        toBlob(callback, type) { assert.equal(type, 'image/png'); callback(new Blob(['full camera frame'], { type })); } };
    class DifferentStillCamera { constructor() { assert.fail('A native still can have a different field of view'); } }
    const result = await captureRapidCameraPhoto(video, { readyState: 'live' }, 'FRONT', {
        matchPreview: true, ImageCaptureImpl: DifferentStillCamera, documentImpl: { createElement: () => canvas }
    });
    assert.deepEqual(draws, [video, 0, 0, 3024, 4032]);
    assert.equal(result.capture.source, 'LOSSLESS_VIDEO_FRAME');
    assert.equal(result.capture.width, 3024); assert.equal(result.capture.height, 4032);
    assert.equal(result.file.type, 'image/png');
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
