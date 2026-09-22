import { PhotoRuntimeError } from './process.mjs';
import { inspectJpeg } from './jpeg.mjs';

const fail = code => { throw new PhotoRuntimeError(code); };
const invalid = () => fail('PHOTO_DECODE_INVALID');

/** Bounded container checks complement the real decoder. No pixel allocation.
 * In particular, libvips can expose an APNG's first PNG frame as a still image. */
export function inspectContainer(bytes, options = {}) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let offset = 8, bitDepth = null, seenHeader = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length) invalid();
      if (!seenHeader) {
        if (type !== 'IHDR' || length !== 13) invalid();
        seenHeader = true; bitDepth = bytes[offset + 16];
      } else if (type === 'IHDR') invalid();
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') fail('PHOTO_MULTIFRAME_UNSUPPORTED');
      if (type === 'cICP' && (length !== 4 || [16, 18].includes(bytes[offset + 9]))) fail('PHOTO_HDR_UNSUPPORTED');
      offset += length + 12;
      if (type === 'IEND') {
        if (length !== 0 || offset !== bytes.length) invalid();
        return { mime: 'image/png', format: 'png', bitDepth };
      }
    }
    invalid();
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      if (type === 'ANIM' || type === 'ANMF') fail('PHOTO_MULTIFRAME_UNSUPPORTED');
      if (type === 'VP8X' && length >= 1 && (bytes[offset + 8] & 2)) fail('PHOTO_MULTIFRAME_UNSUPPORTED');
      offset += 8 + length + length % 2;
      if (offset > bytes.length) invalid();
    }
    if (offset !== bytes.length) invalid();
    return { mime: 'image/webp', format: 'webp', bitDepth: 8 };
  }
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 216) return inspectJpeg(bytes, options);
  // This marker only selects the native HEIF verifier. That verifier must prove
  // the actual HEVC primary item and decode pixels before issuing a receipt.
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const boxLength = bytes.readUInt32BE(0);
    if (boxLength < 16 || boxLength > bytes.length || boxLength % 4 !== 0) invalid();
    const hevcBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];
    const brands = [bytes.toString('ascii', 8, 12)];
    for (let at = 16; at + 4 <= boxLength; at += 4) brands.push(bytes.toString('ascii', at, at + 4));
    if (brands.some(brand => hevcBrands.includes(brand))) return { mime: 'image/heic', format: 'heif' };
  }
  fail('PHOTO_FORMAT_UNSUPPORTED');
}
