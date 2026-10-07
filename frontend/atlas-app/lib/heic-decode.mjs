const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PIXELS = 64 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code = 'HEIC_INVALID') => { if (!condition) fail(code); };
const dimensions = (width, height) => check(Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width >= 2 && height >= 2 && width <= MAX_DIMENSION && height <= MAX_DIMENSION
    && width * height <= MAX_PIXELS, 'HEIC_TOO_LARGE');

// Exact standard ColorSync profiles, not names supplied by an image. The P3
// payload also matches both supplied iPhone photographs byte for byte.
const ICC_PROFILES = new Map([
    ['20789fdbea9835251a4f0796c8bf45cbd964896044886540da21ffc7457af0ab', 'display-p3'],
    ['2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e', 'srgb']
]);

/** Read only the primary item's bounded geometry/color associations. Auxiliary
 * gain maps and thumbnails can carry different profiles and bit depths. */
async function primaryMetadata(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u32 = offset => view.getUint32(offset);
    const text = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    let boxCount = 0;
    const boxes = (start, end) => {
        const result = [];
        for (let offset = start; offset < end;) {
            check(++boxCount <= 4096 && offset + 8 <= end);
            let size = u32(offset), header = 8;
            if (size === 1) {
                check(offset + 16 <= end);
                size = u32(offset + 8) * 2 ** 32 + u32(offset + 12); header = 16;
            } else if (size === 0) size = end - offset;
            check(Number.isSafeInteger(size) && size >= header && offset + size <= end);
            result.push({ type: text(offset + 4), start: offset + header, end: offset + size });
            offset += size;
        }
        return result;
    };
    const one = (list, type) => { const found = list.filter(box => box.type === type); check(found.length === 1); return found[0]; };
    const top = boxes(0, bytes.byteLength), ftyp = one(top, 'ftyp');
    check(ftyp.end - ftyp.start >= 8 && (ftyp.end - ftyp.start) % 4 === 0);
    const brands = [text(ftyp.start)];
    for (let offset = ftyp.start + 8; offset < ftyp.end; offset += 4) brands.push(text(offset));
    check(!top.some(box => box.type === 'moov') && !brands.some(brand => ['msf1', 'hevc', 'hevx', 'hevm', 'hevs', 'heis', 'avis'].includes(brand)), 'HEIC_SEQUENCE_UNSUPPORTED');
    check(brands.some(brand => ['heic', 'heix'].includes(brand)) && !brands.includes('avif'));
    const meta = one(top, 'meta'); check(meta.end - meta.start >= 4 && u32(meta.start) === 0);
    const children = boxes(meta.start + 4, meta.end), pitm = one(children, 'pitm');
    check(pitm.end - pitm.start >= 6);
    const pitmVersion = bytes[pitm.start];
    check(pitmVersion <= 1 && (u32(pitm.start) & 0xffffff) === 0 && pitm.end - pitm.start === (pitmVersion === 0 ? 6 : 8));
    const primaryId = pitmVersion === 0 ? view.getUint16(pitm.start + 4) : u32(pitm.start + 4);
    check(primaryId > 0);
    const iprp = one(children, 'iprp'), propertyBoxes = boxes(iprp.start, iprp.end);
    const ipco = one(propertyBoxes, 'ipco'), properties = boxes(ipco.start, ipco.end);
    const ipma = one(propertyBoxes, 'ipma'); check(ipma.end - ipma.start >= 8);
    const version = bytes[ipma.start], flags = u32(ipma.start) & 0xffffff, count = u32(ipma.start + 4);
    check(version <= 1 && flags <= 1 && count > 0 && count <= 4096);
    let offset = ipma.start + 8, primaryProperties = null, associations = 0;
    for (let item = 0; item < count; item++) {
        const idBytes = version === 0 ? 2 : 4;
        check(offset + idBytes + 1 <= ipma.end);
        const id = idBytes === 2 ? view.getUint16(offset) : u32(offset); offset += idBytes;
        const length = bytes[offset++], selected = [];
        check((associations += length) <= 16384 && offset + length * (flags ? 2 : 1) <= ipma.end);
        for (let index = 0; index < length; index++) {
            const value = flags ? view.getUint16(offset) : bytes[offset]; offset += flags ? 2 : 1;
            const propertyIndex = value & (flags ? 0x7fff : 0x7f);
            check(propertyIndex <= properties.length);
            if (propertyIndex) selected.push(properties[propertyIndex - 1]);
        }
        if (id === primaryId) { check(primaryProperties === null && new Set(selected).size === selected.length); primaryProperties = selected; }
    }
    check(offset === ipma.end && primaryProperties !== null);
    const ispe = one(primaryProperties, 'ispe');
    check(ispe.end - ispe.start === 12 && u32(ispe.start) === 0);
    dimensions(u32(ispe.start + 4), u32(ispe.start + 8));
    const pixi = one(primaryProperties, 'pixi');
    check(pixi.end - pixi.start >= 5 && u32(pixi.start) === 0);
    const channels = bytes[pixi.start + 4];
    check([3, 4].includes(channels) && pixi.end - pixi.start === 5 + channels
        && bytes.subarray(pixi.start + 5, pixi.end).every(bits => bits === 8), 'HEIC_DEPTH_UNSUPPORTED');
    for (const type of ['irot', 'imir']) {
        const transforms = primaryProperties.filter(box => box.type === type);
        check(transforms.length <= 1 && transforms.every(box => box.end - box.start === 1 && bytes[box.start] <= (type === 'irot' ? 3 : 1)));
    }
    const colr = one(primaryProperties, 'colr'); check(colr.end - colr.start >= 4, 'HEIC_COLOR_UNSUPPORTED');
    const kind = text(colr.start);
    if (kind === 'nclx') {
        // This libheif API uses default NCLX output conversion. Only sRGB is
        // accepted; P3 NCLX must not be mislabeled as preserved P3 pixels.
        check(colr.end - colr.start === 11 && view.getUint16(colr.start + 4) === 1
            && view.getUint16(colr.start + 6) === 13 && [0, 1, 5, 6].includes(view.getUint16(colr.start + 8))
            && (bytes[colr.start + 10] & 127) === 0, 'HEIC_COLOR_UNSUPPORTED');
        return { primaryId, colorSpace: 'srgb' };
    }
    check(['prof', 'rICC'].includes(kind) && colr.end - colr.start <= 65540, 'HEIC_COLOR_UNSUPPORTED');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.subarray(colr.start + 4, colr.end));
    const colorSpace = ICC_PROFILES.get(Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''));
    check(colorSpace, 'HEIC_COLOR_UNSUPPORTED');
    return { primaryId, colorSpace };
}

/** Decode one 8-bit still at its HEIF presentation size. libheif applies the
 * container rotation/mirroring/crop once; no EXIF or canvas rotation is added.
 * The caller owns a disposable worker, timeout, and matching-color PNG canvas. */
export async function decodeHeicPixels(input, libheif) {
    let context = null, handle = null, decoded = null;
    try {
        const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
        check(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer);
        check(bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES, 'HEIC_TOO_LARGE');
        const metadata = await primaryMetadata(bytes);
        context = libheif.heif_context_alloc(); check(context, 'HEIC_DECODE_FAILED');
        const read = libheif.heif_context_read_from_memory(context, bytes);
        check(read?.code === libheif.heif_error_code.heif_error_Ok, 'HEIC_DECODE_FAILED');
        check(libheif.heif_context_get_number_of_top_level_images(context) === 1, 'HEIC_MULTIPLE_IMAGES');
        const ids = libheif.heif_js_context_get_list_of_top_level_image_IDs(context);
        check(Array.isArray(ids) && ids.length === 1 && ids[0] === metadata.primaryId, 'HEIC_MULTIPLE_IMAGES');
        handle = libheif.heif_js_context_get_image_handle(context, ids[0]);
        if (!handle || handle.code) { handle = null; fail('HEIC_DECODE_FAILED'); }
        check(libheif.heif_image_handle_is_primary_image(handle), 'HEIC_MULTIPLE_IMAGES');
        const width = libheif.heif_image_handle_get_width(handle), height = libheif.heif_image_handle_get_height(handle);
        dimensions(width, height);
        decoded = await libheif.heif_js_decode_image2(handle, libheif.heif_colorspace.heif_colorspace_RGB, libheif.heif_chroma.heif_chroma_interleaved_RGBA);
        check(decoded?.image && !decoded.code && decoded.width === width && decoded.height === height
            && Array.isArray(decoded.channels) && decoded.channels.length === 1, 'HEIC_DECODE_FAILED');
        const channel = decoded.channels[0];
        check(channel.id === libheif.heif_channel.heif_channel_interleaved && channel.bits_per_pixel === 8
            && channel.width === width && channel.height === height && Number.isSafeInteger(channel.stride)
            && channel.stride >= width * 4 && channel.stride <= width * 4 + 4096
            && channel.data instanceof Uint8Array && channel.data.byteLength === channel.stride * height, 'HEIC_DECODE_FAILED');
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++) data.set(channel.data.subarray(row * channel.stride, row * channel.stride + width * 4), row * width * 4);
        return { data, width, height, colorSpace: metadata.colorSpace };
    } catch (error) {
        if (/^HEIC_[A-Z_]+$/.test(error?.code ?? '')) throw error;
        fail('HEIC_DECODE_FAILED');
    } finally {
        try { if (decoded?.image) libheif.heif_image_release(decoded.image); }
        finally { try { if (handle) libheif.heif_image_handle_release(handle); }
            finally { if (context) libheif.heif_context_free(context); } }
    }
}
