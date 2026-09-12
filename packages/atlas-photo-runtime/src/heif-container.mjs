import { PhotoRuntimeError } from './process.mjs';
const need = (ok, code = 'PHOTO_DECODE_INVALID') => { if (!ok) throw new PhotoRuntimeError(code); };

// This is structural verification, never proof that compressed image pixels decode.
export function boxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  while (start < end) {
    need(start + 8 <= end);
    let size = bytes.readUInt32BE(start), header = 8;
    if (size === 1) {
      need(start + 16 <= end); const large = bytes.readBigUInt64BE(start + 8);
      need(large <= BigInt(Number.MAX_SAFE_INTEGER)); size = Number(large); header = 16;
    }
    // Zero-to-EOF boxes complicate exact-end evidence; deliberately unsupported.
    need(size >= header && start + size <= end);
    out.push({ type: bytes.toString('latin1', start + 4, start + 8), start, end: start + size,
      data: bytes.subarray(start + header, start + size), header });
    need(out.length <= 4096, 'PHOTO_DECODE_LIMIT'); start += size;
  }
  return out;
}

export function inspectHeif(bytes) {
  const roots = boxes(bytes);
  need(!roots.some(box => box.type === 'moov'), 'PHOTO_MULTIFRAME_UNSUPPORTED');
  need(roots.filter(box => box.type === 'ftyp').length === 1 && roots[0].type === 'ftyp');
  const metas = roots.filter(box => box.type === 'meta'); need(metas.length === 1);
  need(metas[0].data.length >= 4 && metas[0].data.readUInt32BE(0) === 0);
  const meta = boxes(metas[0].data, 4);
  const one = (list, type) => { const found = list.filter(box => box.type === type); need(found.length === 1); return found[0]; };
  need(!meta.some(box => box.type === 'ipro'), 'PHOTO_HEIC_UNSUPPORTED');
  const iprp = boxes(one(meta, 'iprp').data), properties = boxes(one(iprp, 'ipco').data);
  const iinf = one(meta, 'iinf').data; need(iinf.length >= 6);
  need(iinf[0] === 0 || iinf[0] === 1);
  const offset = iinf[0] === 0 ? 6 : 8; need(iinf.length >= offset);
  const entries = boxes(iinf, offset), count = offset === 6 ? iinf.readUInt16BE(4) : iinf.readUInt32BE(4);
  need(entries.length === count && count > 0 && count <= 4096);
  const items = new Map();
  for (const entry of entries) {
    need(entry.type === 'infe'); const data = entry.data;
    need(data.length >= 12 && [2, 3].includes(data[0]), 'PHOTO_HEIC_UNSUPPORTED');
    const idSize = data[0] === 2 ? 2 : 4, id = idSize === 2 ? data.readUInt16BE(4) : data.readUInt32BE(4);
    need(data.length >= 10 + idSize && data.readUInt16BE(4 + idSize) === 0, 'PHOTO_HEIC_UNSUPPORTED');
    const type = data.toString('latin1', 6 + idSize, 10 + idSize);
    need(!items.has(id)); items.set(id, type);
    // A HEVC ftyp is not enough: no AV1/JPEG/overlay/identity derived item silently becomes HEIC.
    need(['hvc1', 'grid', 'Exif', 'mime', 'uri '].includes(type), 'PHOTO_HEIC_UNSUPPORTED');
  }
  need([...items.values()].includes('hvc1'), 'PHOTO_HEIC_UNSUPPORTED');
  const association = one(iprp, 'ipma').data; need(association.length >= 8 && association[0] <= 1);
  const flags = association.readUInt32BE(0) & 0xffffff; need(flags <= 1);
  const associationCount = association.readUInt32BE(4); need(associationCount <= 4096, 'PHOTO_DECODE_LIMIT');
  const itemProperties = new Map(); let at = 8;
  for (let entry = 0; entry < associationCount; entry++) {
    const idSize = association[0] ? 4 : 2; need(at + idSize + 1 <= association.length);
    const id = idSize === 2 ? association.readUInt16BE(at) : association.readUInt32BE(at); at += idSize;
    need(items.has(id) && !itemProperties.has(id));
    const count = association[at++], indices = [], indexSize = flags ? 2 : 1;
    need(at + count * indexSize <= association.length);
    for (let i = 0; i < count; i++) {
      const index = flags ? association.readUInt16BE(at) & 0x7fff : association[at] & 0x7f; at += indexSize;
      need(index > 0 && index <= properties.length && !indices.includes(index)); indices.push(index);
    }
    itemProperties.set(id, indices.map(index => properties[index - 1]));
  }
  need(at === association.length);
  // Native property IDs are 1-based in an item's associated list, NOT global ipco indices.
  return { properties, items, itemProperties };
}

// clap is rational. Native border getters round; use exact box fractions to refuse
// fractional pixels instead of assigning a fictitious integer source transform.
export function integerCrop(data, width, height) {
  need(data.length === 32);
  const ratio = (offset, signed = false) => {
    const n = signed ? data.readInt32BE(offset) : data.readUInt32BE(offset), d = data.readUInt32BE(offset + 4);
    need(d !== 0 && n % d === 0, 'PHOTO_GEOMETRY_UNSUPPORTED'); return n / d;
  };
  const w = ratio(0), h = ratio(8), x = (width - w) / 2 + ratio(16, true), y = (height - h) / 2 + ratio(24, true);
  need([w, h, x, y].every(Number.isSafeInteger) && w >= 2 && h >= 2 && x >= 0 && y >= 0
    && x + w <= width && y + h <= height, 'PHOTO_GEOMETRY_UNSUPPORTED');
  return { x, y, width: w, height: h };
}
