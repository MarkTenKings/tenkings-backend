import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { digest, requireBridge } from '@atlas/service-bridge/protocol';
import { createOperatorImagePacket, operatorImageTransform, assertOperatorPngContainer, MAX_OPERATOR_IMAGE_BYTES,
    type OperatorImageAsset, type OperatorImageRequest } from '@atlas/service-bridge/operator-images';

/** Pure deterministic decoder. Call only after private bridge admission, then
 * recheck the exact job/lease/source before delivering its returned bytes.
 * Rectangles use preserved-source pixels after EXIF orientation. No annotations,
 * enhancement, generated content or caller-supplied transform is accepted. */
export async function renderAtlasOperatorImage(input: { sourceBytes: Buffer; asset: OperatorImageAsset;
    request: OperatorImageRequest; signal?: AbortSignal }) {
    const bytes = Buffer.from(input.sourceBytes), { asset, request, signal } = input;
    signal?.throwIfAborted();
    requireBridge(bytes.length === asset.byteCount && digest(bytes) === asset.sha256, 'ASTRA_SOURCE_BYTES_CHANGED');
    const signature = bytes.length >= 12 && (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
        : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : null);
    requireBridge(signature === asset.contentType, 'ASTRA_SOURCE_FORMAT_INVALID');
    if (signature === 'image/png') assertOperatorPngContainer(bytes);
    if (signature === 'image/webp') requireBridge(bytes.readUInt32LE(4)+8 === bytes.length, 'ASTRA_SOURCE_CONTAINER_TRUNCATED');
    if (signature === 'image/jpeg') requireBridge(bytes.at(-2) === 255 && bytes.at(-1) === 217, 'ASTRA_SOURCE_CONTAINER_TRUNCATED');
    const decoder = sharp(bytes,{ failOn: 'warning', limitInputPixels: 64*1024*1024 });
    const metadata = await decoder.metadata(), orientation = metadata.orientation ?? 1;
    requireBridge(['png','jpeg','webp'].includes(metadata.format ?? '') && asset.contentType === `image/${metadata.format}`
        && (metadata.pages ?? 1) === 1 && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8
        && metadata.width && metadata.height, 'ASTRA_SOURCE_FORMAT_INVALID');
    const rotated = orientation >= 5;
    requireBridge((rotated ? metadata.height : metadata.width) === asset.width
        && (rotated ? metadata.width : metadata.height) === asset.height, 'ASTRA_SOURCE_DIMENSIONS_CHANGED');
    const transform = operatorImageTransform(request,asset,orientation);
    // Force full decode before admitting a metadata-readable truncated source.
    await decoder.stats(); signal?.throwIfAborted();
    const rect = request.rect;
    let crop = sharp(bytes,{ failOn: 'warning', limitInputPixels: 64*1024*1024 }).rotate()
        .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
    if (request.purpose === 'OVERVIEW') crop = crop.resize(transform.output.width,transform.output.height,{ fit: 'fill', kernel: 'lanczos3', withoutEnlargement: true });
    const output = await crop.toColourspace('srgb').png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer({ resolveWithObject: true });
    signal?.throwIfAborted();
    requireBridge(output.info.width === transform.output.width && output.info.height === transform.output.height
        && output.data.length <= MAX_OPERATOR_IMAGE_BYTES, 'ASTRA_IMAGE_OUTPUT_TOO_LARGE');
    return createOperatorImagePacket({ imageId: randomUUID(), request, asset, orientation,
        decoder: `sharp-${sharp.versions.sharp}/vips-${sharp.versions.vips}`, bytes: output.data });
}
