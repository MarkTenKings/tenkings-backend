import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error(code); };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Only a bounded, hash-verified raster tile can become an SVG data image.
 * No URL, arbitrary SVG or full source-photo body is accepted here. */
export function validateLabelStylePng(value, { maxWidth = 256, maxHeight = 256, maxBytes = 65536, colorTypes = [2, 6], maxChunks = 64 } = {}) {
  const bad = () => fail('LABEL_STYLE_TEXTURE_INVALID');
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 4 || !['pngBase64', 'sha256', 'width', 'height'].every(k => Object.hasOwn(value, k))
    || typeof value.pngBase64 !== 'string' || value.pngBase64.length > Math.ceil(maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.pngBase64)
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > maxWidth
    || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > maxHeight) bad();
  const bytes = Buffer.from(value.pngBase64, 'base64');
  if (bytes.length < 57 || bytes.length > maxBytes || bytes.toString('base64') !== value.pngBase64
    || hash(bytes) !== value.sha256 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) bad();
  let at = 8, chunks = 0, idat = false, ended = false;
  while (at < bytes.length) {
    if (at + 12 > bytes.length || ++chunks > maxChunks) bad();
    const size = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8), end = at + 12 + size;
    if (end > bytes.length || crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) bad();
    if (chunks === 1) {
      if (type !== 'IHDR' || size !== 13 || bytes.readUInt32BE(at + 8) !== value.width
        || bytes.readUInt32BE(at + 12) !== value.height || bytes[at + 16] !== 8
        || !colorTypes.includes(bytes[at + 17]) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] !== 0) bad();
    } else if (type === 'IDAT') idat = true;
    else if (type === 'IEND') { if (size !== 0 || !idat || end !== bytes.length) bad(); ended = true; }
    else if (!['pHYs', 'sRGB', 'gAMA', 'cHRM'].includes(type)) bad();
    at = end;
  }
  if (!ended) bad();
  return { ...value };
}

export const validateLabelStyleTexture = value => validateLabelStylePng(value);

