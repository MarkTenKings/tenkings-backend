import sharp from 'sharp';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import { canonical, digest, immutable, requireThat } from '@atlas/manual-service/contract';
import { LABEL_WORDMARK_LIMITS as LIMITS, LABEL_WORDMARK_POLICY, wordmarkHash, validateLabelWordmarkRequest,
  validateLabelWordmarkReading } from './label-wordmark-contract.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const LABEL_WORDMARK_RASTER_POLICY = 'atlas-label-wordmark-near-monochrome-v1';
const check = (ok, code = 'LABEL_WORDMARK_IMAGE_INVALID') => requireThat(ok, 409, code);
const blankBox = () => ({ x: Infinity, y: Infinity, right: -1, bottom: -1, count: 0 });
const add = (box, x, y) => { box.x = Math.min(box.x, x); box.y = Math.min(box.y, y); box.right = Math.max(box.right, x);
  box.bottom = Math.max(box.bottom, y); box.count++; };
const rectangle = box => ({ x: box.x, y: box.y, width: box.right - box.x + 1, height: box.bottom - box.y + 1 });

export function decodeLabelWordmarkBase64(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(LIMITS.imageBytes / 3) * 4
    && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value));
  const bytes = Buffer.from(value, 'base64');
  check(bytes.length <= LIMITS.imageBytes && bytes.toString('base64') === value && bytes.subarray(0, 8).equals(PNG));
  return bytes;
}

/** Decode actual PNG samples. Tiny isolated near-gray sampling differences are
 * allowed, with strict per-pixel, area and average limits. Color artwork,
 * transparency and malformed images still fail closed. Raw bytes stay intact. */
export async function validateLabelWordmarkImage(image) {
  check(image && Buffer.isBuffer(image.bytes) && image.bytes.length > 0 && image.bytes.length <= LIMITS.imageBytes
    && image.bytes.subarray(0, 8).equals(PNG) && image.mimeType === 'image/png' && wordmarkHash(image.sha256)
    && digest(image.bytes) === image.sha256 && image.width === LIMITS.width && image.height === LIMITS.height);
  let decoded;
  try {
    const decoder = sharp(image.bytes, { failOn: 'warning', limitInputPixels: LIMITS.width * LIMITS.height, animated: false, ignoreIcc: true });
    const metadata = await decoder.metadata();
    check(metadata.format === 'png' && metadata.width === image.width && metadata.height === image.height
      && (!metadata.pages || metadata.pages === 1) && !metadata.orientation);
    decoded = await decoder.removeAlpha().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Removing alpha is only safe after proving every source pixel is opaque.
    if (metadata.hasAlpha) {
      const alpha = await sharp(image.bytes, { failOn: 'warning', limitInputPixels: LIMITS.width * LIMITS.height, ignoreIcc: true })
        .extractChannel('alpha').raw().toBuffer();
      check(alpha.every(value => value === 255));
    }
  } catch { check(false); }
  check(decoded.info.width === image.width && decoded.info.height === image.height && decoded.info.channels === 4);
  const gray = Buffer.alloc(image.width * image.height), bounds = blankBox();
  let black = 0, maxChannelSpread = 0, spreadSum = 0, noisyPixels = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const index = y * image.width + x, offset = index * 4;
    const r = decoded.data[offset], g = decoded.data[offset + 1], b = decoded.data[offset + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    check(spread <= 16, 'LABEL_WORDMARK_COLOR_INVALID');
    maxChannelSpread = Math.max(maxChannelSpread, spread); spreadSum += spread; if (spread > 8) noisyPixels++;
    const value = Math.round((r + g + b) / 3);
    // The independently checked near-white background cannot leave a faint
    // rectangle in the output alpha mask. Dark ink and antialiasing stay exact.
    gray[index] = value >= 250 ? 255 : value;
    if (x < 16 || y < 16 || x >= image.width - 16 || y >= image.height - 16) check(value >= 250, 'LABEL_WORDMARK_CLIPPED');
    if (value < 224) add(bounds, x, y);
    if (value < 64) black++;
  }
  check(noisyPixels <= Math.floor(gray.length * .001) && spreadSum <= gray.length * 2, 'LABEL_WORDMARK_COLOR_INVALID');
  check(bounds.count >= 100 && bounds.count < gray.length * 0.45 && black > bounds.count * 0.25, 'LABEL_WORDMARK_INK_INVALID');
  return { gray, bounds: rectangle(bounds), inkPixels: bounds.count, normalization: { policy: LABEL_WORDMARK_RASTER_POLICY,
    grayscale: 'rounded-channel-mean', whiteFloor: 250, maxChannelSpread, pixelsAboveSpread8: noisyPixels,
    totalPixels: gray.length, channelSpreadSum: spreadSum } };
}

function measuredWords(decoded, reading, image) {
  const boxes = reading.words.map(blankBox); let unassigned = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (decoded.gray[y * image.width + x] >= 224) continue;
    const index = reading.words.findIndex(word => x >= word.x && x < word.x + word.width && y >= word.y && y < word.y + word.height);
    if (index < 0) unassigned++; else add(boxes[index], x, y);
  }
  // No extra ink is silently discarded by a loose OCR answer or crop.
  check(unassigned === 0, 'LABEL_WORDMARK_UNASSIGNED_INK');
  let cursor = 0;
  const measured = boxes.map((box, index) => {
    check(box.count >= 32, 'LABEL_WORDMARK_BOX_EMPTY');
    const bounds = rectangle(box); check(bounds.width >= 8 && bounds.height >= 16, 'LABEL_WORDMARK_BOX_EMPTY');
    const text = reading.words[index].text, start = cursor; cursor += text.length + 1;
    return { text, start, end: start + text.length, ...bounds };
  });
  const largest = Math.max(...measured.map(word => word.height)), smallest = Math.min(...measured.map(word => word.height));
  check(largest / smallest <= 3, 'LABEL_WORDMARK_OPTICAL_SCALE_INVALID');
  const center = measured.reduce((total, word) => total + word.y + word.height / 2, 0) / measured.length;
  check(measured.every(word => Math.abs(word.y + word.height / 2 - center) <= largest / 2), 'LABEL_WORDMARK_MULTILINE');
  return measured;
}

/** Rebuilds only generated lettering. Each word keeps its aspect ratio; the
 * optional optical normalization gives every measured ink box equal height. */
export async function compileLabelWordmark({ request: rawRequest, image, verification }) {
  const request = validateLabelWordmarkRequest(rawRequest), decoded = await validateLabelWordmarkImage(image);
  check(verification?.imageSha256 === image.sha256 && verification?.sourceHash === request.sourceHash
    && verification?.generationRequestKey === request.requestKey && wordmarkHash(verification.responseSha256), 'LABEL_WORDMARK_VERIFICATION_CHANGED');
  const reading = validateLabelWordmarkReading(verification.reading, request, image), measured = measuredWords(decoded, reading, image);
  let bytes, width, height, words;
  if (request.normalizeWordInkHeight) {
    const padding = 2, aspectSum = measured.reduce((sum, word) => sum + word.width / word.height, 0);
    const capHeight = Math.min(LIMITS.opticalHeight, Math.floor((LIMITS.outputWidth - padding * 2 - measured.length) / (aspectSum + 0.25 * (measured.length - 1))));
    check(capHeight >= 64, 'LABEL_WORDMARK_OUTPUT_TOO_WIDE');
    const gap = Math.round(capHeight * 0.25);
    const widths = measured.map(word => Math.max(1, Math.round(word.width / word.height * capHeight)));
    width = widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1) + padding * 2;
    height = capHeight + padding * 2; check(width <= LIMITS.outputWidth, 'LABEL_WORDMARK_OUTPUT_TOO_WIDE');
    let x = padding; const layers = []; words = [];
    for (let index = 0; index < measured.length; index++) {
      const word = measured[index];
      const input = await sharp(decoded.gray, { raw: { width: image.width, height: image.height, channels: 1 } })
        .extract({ left: word.x, top: word.y, width: word.width, height: word.height })
        .resize(widths[index], capHeight, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
      layers.push({ input, left: x, top: padding }); words.push({ text: word.text, start: word.start, end: word.end,
        x, y: padding, width: widths[index], height: capHeight });
      x += widths[index] + gap;
    }
    bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(layers).grayscale().png().toBuffer();
  } else {
    const bounds = decoded.bounds, padding = 2;
    const scale = Math.min(1, (LIMITS.outputWidth - padding * 2) / bounds.width, (LIMITS.outputHeight - padding * 2) / bounds.height);
    const scaledWidth = Math.round(bounds.width * scale), scaledHeight = Math.round(bounds.height * scale);
    width = scaledWidth + padding * 2; height = scaledHeight + padding * 2;
    bytes = await sharp(decoded.gray, { raw: { width: image.width, height: image.height, channels: 1 } })
      .extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
      .resize(scaledWidth, scaledHeight, { fit: 'fill', kernel: 'lanczos3' })
      .extend({ top: padding, bottom: padding, left: padding, right: padding, background: '#ffffff' }).png().toBuffer();
    words = measured.map(word => ({ ...word, x: Math.round((word.x - bounds.x) * scale) + padding,
      y: Math.round((word.y - bounds.y) * scale) + padding, width: Math.round(word.width * scale), height: Math.round(word.height * scale) }));
  }
  check(bytes.length <= LIMITS.imageBytes && width <= LIMITS.outputWidth && height <= LIMITS.outputHeight);
  const luminance = await sharp(bytes).grayscale().raw().toBuffer(), rgba = Buffer.alloc(width * height * 4, 255);
  check(luminance.length === width * height);
  for (let pixel = 0; pixel < luminance.length; pixel++) rgba[pixel * 4 + 3] = 255 - luminance[pixel];
  const maskBytes = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  check(maskBytes.length <= LIMITS.maskBytes, 'LABEL_WORDMARK_MASK_TOO_LARGE');
  const descriptor = { version: LABEL_WORDMARK_POLICY, requestKey: request.requestKey, sourceHash: request.sourceHash,
    text: request.text, role: request.role, mimeType: 'image/png', sha256: digest(bytes), byteCount: bytes.length, width, height,
    mask: { sha256: digest(maskBytes), byteCount: maskBytes.length, width, height, mimeType: 'image/png' },
    ink: 'BLACK_ON_WHITE', words, normalizeWordInkHeight: request.normalizeWordInkHeight,
    provenance: { kind: 'ORIGINAL_GENERATED_LETTERING', imageModel: request.model, sourceImageSha256: image.sha256,
      verificationResponseSha256: verification.responseSha256, imageNormalization: decoded.normalization, readingHash: digest(canonical(reading)),
      sourceWordBounds: measured, sourceFontReproduced: false, fontMatchPercentageClaimed: false, ownershipClaimed: false } };
  return { bytes, maskBytes, descriptor: immutable({ ...descriptor, artifactHash: digest(canonicalJson(descriptor)) }) };
}
