import { canonical, digest, keys, requireBridge as check, UUID, SHA } from './protocol.mjs';

export const LEGACY_IMAGE_TRANSFORM = 'atlas-oriented-source-crop-srgb-png-v1';
export const IMAGE_TRANSFORM = 'atlas-oriented-source-crop-srgb-png-v2';
// Exact current decoder imported by the legacy application (distinct from
// the calibration package's separately traced Sharp version).
export const OPERATOR_IMAGE_DECODER = 'sharp-0.33.5/vips-8.15.3';
// Base64 plus the complete signed receipt must fit the deployed HTTP body
// limit. This still admits a lossless 1024-square noisy RGB crop.
export const MAX_OPERATOR_IMAGE_BYTES = 3_200_000;
export const MAX_OPERATOR_CROP_PIXELS = 1024 * 1024;
export const OVERVIEW_LONG_EDGE = 1024;
const uuid = value => typeof value === 'string' && UUID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const integer = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function assertOperatorPngContainer(bytes) {
    check(Buffer.isBuffer(bytes) && bytes.length >= 45 && bytes.length <= 50*1024*1024
        && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'ASTRA_SOURCE_CONTAINER_TRUNCATED');
    let offset=8, chunks=0, ended=false;
    while (offset < bytes.length) {
        check(++chunks <= 4096 && offset+12 <= bytes.length, 'ASTRA_SOURCE_CONTAINER_TRUNCATED');
        const length=bytes.readUInt32BE(offset), type=bytes.toString('ascii',offset+4,offset+8), end=offset+12+length;
        check(end <= bytes.length && /^[A-Za-z]{4}$/.test(type)
            && (chunks === 1 ? type === 'IHDR' && length === 13 : type !== 'IHDR'), 'ASTRA_SOURCE_CONTAINER_TRUNCATED');
        // This libvips version omits APNG frame count in metadata. Never select
        // an implicit animation frame and call it a single preserved image.
        check(!['acTL','fcTL','fdAT'].includes(type), 'ASTRA_SOURCE_ANIMATION_UNSUPPORTED');
        if (type === 'IEND') { check(length === 0 && end === bytes.length, 'ASTRA_SOURCE_CONTAINER_TRUNCATED'); ended=true; }
        offset=end;
    }
    check(ended && bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])), 'ASTRA_SOURCE_CONTAINER_TRUNCATED');
}

export function operatorImageTransform(request, asset, orientation, version = IMAGE_TRANSFORM) {
    // V1 receipts remain verifiable under their original native-crop contract.
    // V2 keeps the complete requested source rectangle, while bounding only
    // the delivered raster. A large evidence region is not an invalid crop.
    check([LEGACY_IMAGE_TRANSFORM,IMAGE_TRANSFORM].includes(version), 'ASTRA_IMAGE_TRANSFORM_UNSUPPORTED');
    keys(request,['runId','expectedRevision','evidenceHash','manifestHash','assetId','sourceSha256','side','purpose','rect']);
    check(uuid(request.runId) && integer(request.expectedRevision,1,2147483647) && sha(request.evidenceHash) && sha(request.manifestHash)
        && uuid(request.assetId) && sha(request.sourceSha256) && ['FRONT','BACK'].includes(request.side)
        && ['OVERVIEW','CROP'].includes(request.purpose), 'ASTRA_IMAGE_REQUEST_INVALID');
    check(asset?.assetId === request.assetId && asset.sha256 === request.sourceSha256 && asset.side === request.side
        && ['RECTIFIED','ORIGINAL'].includes(asset.view) && integer(asset.width,2,20_000) && integer(asset.height,2,20_000)
        && asset.width*asset.height <= 64*1024*1024 && integer(asset.byteCount,1,50*1024*1024)
        && ['image/png','image/jpeg','image/webp'].includes(asset.contentType) && integer(orientation,1,8), 'ASTRA_IMAGE_SCOPE_INVALID');
    const rect = request.rect;
    keys(rect,['x','y','width','height']);
    check(integer(rect.x,0,asset.width-1) && integer(rect.y,0,asset.height-1)
        && integer(rect.width,1,asset.width) && integer(rect.height,1,asset.height)
        && rect.x+rect.width <= asset.width && rect.y+rect.height <= asset.height, 'ASTRA_CROP_OUTSIDE_SOURCE');
    if (request.purpose === 'OVERVIEW') check(rect.x === 0 && rect.y === 0 && rect.width === asset.width && rect.height === asset.height, 'ASTRA_OVERVIEW_INCOMPLETE');
    else if (version === LEGACY_IMAGE_TRANSFORM) check(rect.width*rect.height <= MAX_OPERATOR_CROP_PIXELS, 'ASTRA_CROP_TOO_LARGE');
    const scale = request.purpose === 'OVERVIEW' ? Math.min(1,OVERVIEW_LONG_EDGE/Math.max(rect.width,rect.height))
        : Math.min(1,Math.sqrt(MAX_OPERATOR_CROP_PIXELS/(rect.width*rect.height)));
    // Preserve V1/overview rounding exactly. Floor resized crops so even a
    // nearly square region cannot exceed the pixel cap after rounding.
    const dimension = request.purpose === 'CROP' && scale < 1 ? Math.floor : Math.round;
    const output = { width: Math.max(1,dimension(rect.width*scale)), height: Math.max(1,dimension(rect.height*scale)) };
    return { version, sourceAssetId: asset.assetId, sourceSha256: asset.sha256,
        sourceWidth: asset.width, sourceHeight: asset.height, coordinateFrame: 'EXIF_ORIENTED_SOURCE_PIXELS',
        exifOrientation: orientation, rect: structuredClone(rect), output, purpose: request.purpose,
        kernel: 'lanczos3', colourSpace: 'srgb', metadata: 'REMOVED', annotations: 'NONE' };
}

/** An ordinary source-bound region mistake can be returned to Astra without
 * image delivery or another external request. Identity, schema and hash errors
 * are not recoverable region mistakes and must retain their failure status. */
export function operatorCropRejection(request, asset) {
    try { operatorImageTransform(request,asset,1); return null; }
    catch (error) {
        if (error?.code !== 'ASTRA_CROP_OUTSIDE_SOURCE') throw error;
        const rect = request.rect;
        check(request.purpose === 'CROP' && integer(rect.x,0,19_999) && integer(rect.y,0,19_999)
            && integer(rect.width,1,20_000) && integer(rect.height,1,20_000), 'ASTRA_IMAGE_REQUEST_INVALID');
        return { status: 'REGION_NOT_AVAILABLE', code: 'ASTRA_CROP_OUTSIDE_SOURCE', assetId: asset.assetId,
            rect: structuredClone(rect), sourceWidth: asset.width, sourceHeight: asset.height };
    }
}
function pngDimensions(bytes) {
    check(Buffer.isBuffer(bytes) && bytes.length >= 45 && bytes.length <= MAX_OPERATOR_IMAGE_BYTES
        && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        && bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]))
        && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii',12,16) === 'IHDR', 'ASTRA_IMAGE_PNG_INVALID');
    assertOperatorPngContainer(bytes);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
/** Called only by the trusted decoder after full source decoding/cropping. The
 * wire validator proves exact bytes/scope, not optical correctness by itself. */
export function createOperatorImagePacket({ imageId, request, asset, orientation, decoder, bytes }) {
    const transform = operatorImageTransform(request,asset,orientation), transformCanonical = canonical(transform);
    const packet = { version: 'atlas-operator-image-v1', imageId, request: structuredClone(request), transformCanonical,
        transformHash: digest(transformCanonical), decoder, contentType: 'image/png', width: transform.output.width,
        height: transform.output.height, byteCount: bytes.length, sha256: digest(bytes), bytesBase64: bytes.toString('base64') };
    parseOperatorImagePacket(packet,request,asset); return packet;
}
export function parseOperatorImagePacket(packet, request, asset) {
    keys(packet,['version','imageId','request','transformCanonical','transformHash','decoder','contentType','width','height','byteCount','sha256','bytesBase64']);
    check(packet.version === 'atlas-operator-image-v1' && uuid(packet.imageId) && canonical(packet.request) === canonical(request)
        && typeof packet.transformCanonical === 'string' && Buffer.byteLength(packet.transformCanonical) <= 4096
        && sha(packet.transformHash) && digest(packet.transformCanonical) === packet.transformHash
        && packet.decoder === OPERATOR_IMAGE_DECODER && packet.contentType === 'image/png'
        && integer(packet.byteCount,45,MAX_OPERATOR_IMAGE_BYTES) && sha(packet.sha256)
        && typeof packet.bytesBase64 === 'string' && packet.bytesBase64.length <= Math.ceil(MAX_OPERATOR_IMAGE_BYTES/3)*4,
    'ASTRA_IMAGE_PACKET_INVALID');
    let supplied;
    try { supplied = JSON.parse(packet.transformCanonical); }
    catch { check(false,'ASTRA_IMAGE_TRANSFORM_INVALID'); }
    const transform = operatorImageTransform(request,asset,supplied?.exifOrientation,supplied?.version);
    check(canonical(transform) === packet.transformCanonical && packet.width === transform.output.width && packet.height === transform.output.height,
        'ASTRA_IMAGE_TRANSFORM_CHANGED');
    const bytes = Buffer.from(packet.bytesBase64,'base64');
    check(bytes.toString('base64') === packet.bytesBase64 && bytes.length === packet.byteCount && digest(bytes) === packet.sha256, 'ASTRA_IMAGE_BYTES_CHANGED');
    const size = pngDimensions(bytes);
    check(size.width === packet.width && size.height === packet.height, 'ASTRA_IMAGE_DIMENSIONS_CHANGED');
    return { packet, bytes, transform, dataUrl: `data:image/png;base64,${packet.bytesBase64}` };
}
