import { createHash } from 'node:crypto';
import { PhotoRuntimeError } from './process.mjs';

const need = (ok, code = 'PHOTO_GEOMETRY_UNSUPPORTED') => { if (!ok) throw new PhotoRuntimeError(code); };

// Qualification is by exact bytes, never a caller's profile name. These SDR RGB
// profiles have independently checked matrix/TRC semantics and pixel-preservation
// oracles. Adding another profile requires its own evidence. The Apple profile is
// observed in the retained iPhone originals; no system-profile lookup is needed.
const profiles = new Map([
  ['20789fdbea9835251a4f0796c8bf45cbd964896044886540da21ffc7457af0ab', 'Display P3'],
  ['cb51de38e482ee974c0c76b9689e16aad04bad16e226fed2f30c842d15ff3a3d', 'Display P3'],
  ['c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353', 'sRGB'],
]);

export function qualifyHeifIcc(bytes) {
  if (!bytes.length) return null;
  const name = profiles.get(createHash('sha256').update(bytes).digest('hex'));
  need(name, 'PHOTO_COLOR_UNSUPPORTED');
  return name;
}

// HEIF Exif starts with a big-endian offset relative to the byte after that
// offset. Walk the ordinary TIFF IFD graph (IFD0, next/thumbnail, Exif, GPS,
// interoperability and SubIFDs). Private MakerNote data is bounded opaque data,
// never interpreted or copied to the working raster. No Exif tag changes HEIF
// presentation: even an Exif-only or conflicting orientation is descriptive.
export function inspectHeifExif(bytes) {
  if (!bytes.length) return { orientation: null, ifdCount: 0 };
  need(bytes.length >= 12 && bytes.length <= 1024 * 1024);
  const start = 4 + bytes.readUInt32BE(0);
  need(start >= 4 && start + 8 <= bytes.length);
  const tiff = bytes.subarray(start), order = tiff.toString('ascii', 0, 2);
  need(order === 'II' || order === 'MM');
  const u16 = at => { need(at >= 0 && at + 2 <= tiff.length); return order === 'II' ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at); };
  const u32 = at => { need(at >= 0 && at + 4 <= tiff.length); return order === 'II' ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at); };
  need(u16(2) === 42);
  const first = u32(4); need(first >= 8);
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  const queue = [first], visited = new Set(), ranges = [], values = [];
  let orientation = null, entries = 0;
  while (queue.length) {
    const offset = queue.shift();
    need(offset >= 8 && !visited.has(offset) && visited.size < 32);
    visited.add(offset);
    const count = u16(offset), end = offset + 2 + count * 12 + 4;
    entries += count; need(entries <= 4096 && end <= tiff.length);
    need(ranges.every(([a, b]) => end <= a || offset >= b));
    ranges.push([offset, end]);
    const tags = new Map();
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12, tag = u16(at), type = u16(at + 2), length = u32(at + 4);
      need(!tags.has(tag) && type >= 1 && type < sizes.length && length > 0);
      const size = length * sizes[type], dataAt = size <= 4 ? at + 8 : u32(at + 8);
      need(dataAt >= 8 && dataAt + size <= tiff.length);
      if (size > 4) values.push([dataAt, dataAt + size]);
      tags.set(tag, { type, length, dataAt });
      if (tag === 0x0112) {
        need(type === 3 && length === 1);
        const value = u16(dataAt); need(value >= 1 && value <= 8);
        if (offset === first) orientation = value;
      }
      if ([0x8769, 0x8825, 0xa005, 0x014a].includes(tag) || type === 13) {
        need((type === 4 || type === 13) && length <= 32);
        if (tag !== 0x014a && type !== 13) need(length === 1);
        for (let j = 0; j < length; j++) { const child = u32(dataAt + j * 4); need(child >= 8); queue.push(child); }
      }
    }
    // If a JPEG thumbnail is described, both offset and extent must be bounded.
    if (tags.has(0x0201) || tags.has(0x0202)) {
      const a = tags.get(0x0201), b = tags.get(0x0202);
      need(a && b && a.type === 4 && b.type === 4 && a.length === 1 && b.length === 1);
      const begin = u32(a.dataAt), length = u32(b.dataAt);
      need(begin >= 8 && length > 0 && begin + length <= tiff.length);
      values.push([begin, begin + length]);
    }
    const next = u32(end - 4); if (next) queue.push(next);
    need(queue.length <= 32);
  }
  need(values.every(([a, b]) => ranges.every(([c, d]) => b <= c || a >= d)));
  return { orientation, ifdCount: visited.size };
}
