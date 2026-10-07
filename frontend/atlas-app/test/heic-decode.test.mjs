import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeHeicPixels } from '../lib/heic-decode.mjs';

const u16 = number => { const b = Buffer.alloc(2); b.writeUInt16BE(number); return b; };
const u32 = number => { const b = Buffer.alloc(4); b.writeUInt32BE(number); return b; };
const join = (...values) => Buffer.concat(values.map(value => typeof value === 'string' ? Buffer.from(value) : value));
const box = (type, ...values) => { const data = join(...values); return join(u32(data.length + 8), type, data); };
const full = (...values) => join(u32(0), ...values);
function fixture({ width = 3, height = 2, bits = 8, primaryId = 1, brand = 'heic', color, extraProperties = [], association = [1, 2, 3, 4], movie = false } = {}) {
    const colr = color ?? join('nclx', u16(1), u16(13), u16(1), Buffer.from([128]));
    const properties = [box('ispe', full(u32(width), u32(height))), box('pixi', full(Buffer.from([3, bits, bits, bits]))), box('colr', colr), box('irot', Buffer.from([3])), ...extraProperties];
    return join(box('ftyp', brand, u32(0), 'mif1', 'heic'), box('meta', full(
        box('pitm', full(u16(primaryId))), box('iprp', box('ipco', ...properties), box('ipma', full(u32(1), u16(1), Buffer.from([association.length, ...association]))))
    )), ...(movie ? [box('moov')] : []));
}
function native(options = {}) {
    const calls = [], context = {}, handle = {}, image = {}, channelId = {}, ok = {};
    const width = options.width ?? 2, height = options.height ?? 3, stride = width * 4 + (options.padding ?? 0);
    const data = new Uint8Array(stride * height);
    for (let row = 0; row < height; row++) for (let column = 0; column < width * 4; column++) data[row * stride + column] = row * width * 4 + column;
    const decoded = { image, width, height, channels: [{ id: channelId, bits_per_pixel: 8, width, height, stride, data }] };
    if (options.mutateDecoded) options.mutateDecoded(decoded);
    const lib = {
        heif_error_code: { heif_error_Ok: ok }, heif_colorspace: { heif_colorspace_RGB: {} },
        heif_chroma: { heif_chroma_interleaved_RGBA: {} }, heif_channel: { heif_channel_interleaved: channelId },
        heif_context_alloc() { calls.push('context'); return context; },
        heif_context_read_from_memory(actual, bytes) { assert.equal(actual, context); assert.ok(bytes instanceof Uint8Array); return { code: options.readError ? {} : ok }; },
        heif_context_get_number_of_top_level_images() { return options.count ?? 1; },
        heif_js_context_get_list_of_top_level_image_IDs() { return options.ids ?? [1]; },
        heif_js_context_get_image_handle() { calls.push('handle'); return handle; },
        heif_image_handle_is_primary_image() { return options.primary ?? true; },
        heif_image_handle_get_width() { return width; }, heif_image_handle_get_height() { return height; },
        async heif_js_decode_image2(actual, colorspace, chroma) {
            assert.equal(actual, handle); assert.equal(colorspace, lib.heif_colorspace.heif_colorspace_RGB); assert.equal(chroma, lib.heif_chroma.heif_chroma_interleaved_RGBA);
            calls.push('decode'); if (options.throwDecode) throw new Error('Untrusted image diagnostics'); return decoded;
        },
        heif_image_release(actual) { assert.equal(actual, image); calls.push('release-image'); },
        heif_image_handle_release(actual) { assert.equal(actual, handle); calls.push('release-handle'); },
        heif_context_free(actual) { assert.equal(actual, context); calls.push('release-context'); }
    };
    return { lib, calls };
}

test('keeps native presentation orientation and exact RGBA rows, including native stride padding', async () => {
    const source = fixture(), original = Buffer.from(source), { lib, calls } = native({ padding: 8 });
    const result = await decodeHeicPixels(source, lib);
    assert.deepEqual({ width: result.width, height: result.height, colorSpace: result.colorSpace }, { width: 2, height: 3, colorSpace: 'srgb' });
    assert.ok(result.data instanceof Uint8ClampedArray);
    assert.deepEqual([...result.data], Array.from({ length: 24 }, (_, i) => i));
    assert.deepEqual(source, original);
    assert.deepEqual(calls, ['context', 'handle', 'decode', 'release-image', 'release-handle', 'release-context']);
});

test('an unrelated HDR property cannot override the primary item profile or bit depth', async () => {
    const source = fixture({ extraProperties: [box('pixi', full(Buffer.from([3, 10, 10, 10]))), box('colr', join('nclx', u16(9), u16(16), u16(9), Buffer.from([128])))] });
    const result = await decodeHeicPixels(source, native().lib);
    assert.equal(result.colorSpace, 'srgb');
});

for (const [label, source, code] of [
    ['truncated container', () => fixture().subarray(0, 64), 'HEIC_INVALID'],
    ['truncated large box header', () => join(u32(1), 'ftyp'), 'HEIC_INVALID'],
    ['unsafe 64-bit box size', () => join(u32(1), 'ftyp', u32(0xffffffff), u32(0xffffffff)), 'HEIC_INVALID'],
    ['sequence brand', () => fixture({ brand: 'msf1' }), 'HEIC_SEQUENCE_UNSUPPORTED'],
    ['timeline even with still branding', () => fixture({ movie: true }), 'HEIC_SEQUENCE_UNSUPPORTED'],
    ['unbound primary item', () => fixture({ primaryId: 2 }), 'HEIC_INVALID'],
    ['duplicate primary property', () => fixture({ association: [1, 2, 3, 4, 3] }), 'HEIC_INVALID'],
    ['nonexistent property', () => fixture({ association: [1, 2, 99] }), 'HEIC_INVALID'],
    ['oversized encoded dimension', () => fixture({ width: 16385 }), 'HEIC_TOO_LARGE'],
    ['oversized encoded pixel count', () => fixture({ width: 16384, height: 4097 }), 'HEIC_TOO_LARGE'],
    ['10-bit primary', () => fixture({ bits: 10 }), 'HEIC_DEPTH_UNSUPPORTED'],
    ['unknown ICC cannot use its claimed profile name', () => fixture({ color: join('prof', 'Display P3') }), 'HEIC_COLOR_UNSUPPORTED'],
    ['unproven P3 NCLX', () => fixture({ color: join('nclx', u16(12), u16(13), u16(1), Buffer.from([128])) }), 'HEIC_COLOR_UNSUPPORTED'],
    ['PQ HDR NCLX', () => fixture({ color: join('nclx', u16(9), u16(16), u16(9), Buffer.from([128])) }), 'HEIC_COLOR_UNSUPPORTED']
]) test(`${label} is rejected before native allocation`, async () => {
    const { lib, calls } = native();
    await assert.rejects(decodeHeicPixels(source(), lib), { code });
    assert.deepEqual(calls, []);
});

for (const [label, options, code, expectedCalls] of [
    ['failed container parse', { readError: true }, 'HEIC_DECODE_FAILED', ['context', 'release-context']],
    ['multiple top-level images', { count: 2 }, 'HEIC_MULTIPLE_IMAGES', ['context', 'release-context']],
    ['mismatched primary ID', { ids: [2] }, 'HEIC_MULTIPLE_IMAGES', ['context', 'release-context']],
    ['multiple returned IDs', { ids: [1, 2] }, 'HEIC_MULTIPLE_IMAGES', ['context', 'release-context']],
    ['non-primary handle', { primary: false }, 'HEIC_MULTIPLE_IMAGES', ['context', 'handle', 'release-handle', 'release-context']],
    ['oversized presented dimension', { width: 16385, height: 2 }, 'HEIC_TOO_LARGE', ['context', 'handle', 'release-handle', 'release-context']],
    ['native decoder exception', { throwDecode: true }, 'HEIC_DECODE_FAILED', ['context', 'handle', 'decode', 'release-handle', 'release-context']],
    ['invalid decoded stride', { mutateDecoded: r => { r.channels[0].stride = 1; } }, 'HEIC_DECODE_FAILED', ['context', 'handle', 'decode', 'release-image', 'release-handle', 'release-context']],
    ['unexpected native pixel depth', { mutateDecoded: r => { r.channels[0].bits_per_pixel = 16; } }, 'HEIC_DECODE_FAILED', ['context', 'handle', 'decode', 'release-image', 'release-handle', 'release-context']],
    ['missing native pixel data', { mutateDecoded: r => { r.channels[0].data = new Uint8Array(0); } }, 'HEIC_DECODE_FAILED', ['context', 'handle', 'decode', 'release-image', 'release-handle', 'release-context']]
]) test(`${label} fails with all acquired native resources released`, async () => {
    const { lib, calls } = native(options);
    await assert.rejects(decodeHeicPixels(fixture(), lib), { code, message: code });
    assert.deepEqual(calls, expectedCalls);
});
