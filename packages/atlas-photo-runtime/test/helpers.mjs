import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const limits = { maxInputBytes: 2_000_000, maxPixels: 1_000_000,
  maxRasterBytes: 8_000_000, maxOutputBytes: 4_000_000, timeoutMs: 5_000 };
export function request(bytes, overrides = {}) {
  return { bytes, limits,
    uploadPlan: { schemaVersion: 1, uploadId: 'upload-front',
      binding: { cardId: 'new-synthetic-card', pairId: 'pair', side: 'FRONT', version: 1 },
      object: { key: 'originals/front', versionId: null },
      expected: { byteCount: bytes.length, sha256: sha256(bytes) } },
    observedObject: { key: 'originals/front', versionId: 'provider-version-1' }, ...overrides };
}
export const code = expected => error => error.code === expected;
export function chunk(type, data) {
  const typeBytes = Buffer.from(type), body = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
export function rgb16Png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 16; header[9] = 2;
  const samples = Buffer.alloc(height * (1 + width * 6));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = 1_000 + (y * width + x) * 17;
    for (let c = 0; c < 3; c++) samples.writeUInt16BE(value, y * (1 + width * 6) + 1 + x * 6 + c * 2);
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(samples)), chunk('IEND', Buffer.alloc(0))]);
}
// Independent integer pixel permutation, not photo-core's transform helper or
// the decoder's rotation API. Expected pixels come from the orientation-1 image.
export function orient(pixels, width, height, channels, orientation) {
  const outputWidth = orientation < 5 ? width : height;
  const outputHeight = orientation < 5 ? height : width;
  const output = Buffer.alloc(outputWidth * outputHeight * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let xx, yy;
    switch (orientation) {
      case 1: [xx, yy] = [x, y]; break;
      case 2: [xx, yy] = [width - x - 1, y]; break;
      case 3: [xx, yy] = [width - x - 1, height - y - 1]; break;
      case 4: [xx, yy] = [x, height - y - 1]; break;
      case 5: [xx, yy] = [y, x]; break;
      case 6: [xx, yy] = [height - y - 1, x]; break;
      case 7: [xx, yy] = [height - y - 1, width - x - 1]; break;
      case 8: [xx, yy] = [y, width - x - 1]; break;
    }
    pixels.copy(output, (yy * outputWidth + xx) * channels,
      (y * width + x) * channels, (y * width + x + 1) * channels);
  }
  return output;
}
