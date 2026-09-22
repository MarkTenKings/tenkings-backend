import { createHash } from 'node:crypto';
import { PhotoRuntimeError } from './process.mjs';

const need = (ok, code = 'PHOTO_DECODE_INVALID') => { if (!ok) throw new PhotoRuntimeError(code); };
const hdr = ok => need(ok, 'PHOTO_HDR_UNSUPPORTED');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MPF = Buffer.from('MPF\0');
const ISO = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
const XMP = Buffer.from('http://ns.adobe.com/xap/1.0/\0');
const ICC = Buffer.from('ICC_PROFILE\0');
export const APPLE_P3_SHA256 = '20789fdbea9835251a4f0796c8bf45cbd964896044886540da21ffc7457af0ab';

// Walk entropy-coded scans as well as metadata. Each returned end is the real
// EOI, never a byte search that could mistake an embedded EXIF thumbnail for it.
function image(bytes, start) {
  need(bytes[start] === 255 && bytes[start + 1] === 216);
  let offset = start + 2, scan = false, frame = null, scans = 0;
  const segments = [];
  while (offset < bytes.length) {
    if (scan) while (offset < bytes.length && bytes[offset] !== 255) offset++;
    else need(bytes[offset] === 255);
    while (bytes[offset] === 255) offset++;
    need(offset < bytes.length);
    const marker = bytes[offset++];
    if (scan && (marker === 0 || marker >= 208 && marker <= 215)) continue;
    scan = false;
    if (marker === 217) {
      need(frame !== null && scans > 0);
      need(frame.bitDepth === 8, 'PHOTO_BIT_DEPTH_UNSUPPORTED');
      return { start, end: offset, ...frame, segments };
    }
    need(marker !== 0 && marker !== 216 && offset + 2 <= bytes.length);
    const length = bytes.readUInt16BE(offset);
    need(length >= 2 && offset + length <= bytes.length);
    const dataOffset = offset + 2, data = bytes.subarray(dataOffset, offset + length);
    if (marker >= 224 && marker <= 239) {
      need(segments.length < 1024); segments.push({ marker, data, dataOffset });
    }
    if ([192, 193, 194].includes(marker)) {
      need(length >= 8 && frame === null && length === 8 + data[5] * 3);
      frame = { bitDepth: data[0], height: data.readUInt16BE(1), width: data.readUInt16BE(3), channels: data[5] };
      need(frame.width >= 2 && frame.height >= 2);
    }
    offset += length;
    if (marker === 218) { need(frame !== null); scan = true; scans++; }
  }
  need(false);
}
const matching = (frame, marker, prefix) => frame.segments.filter(s => s.marker === marker && s.data.subarray(0, prefix.length).equals(prefix));
function one(frame, marker, prefix) {
  const found = matching(frame, marker, prefix); hdr(found.length === 1); return found[0];
}

// Qualified CIPA MP Index layout: version0100, two JPEG entries, no dependent
// image or additional IFD. Offsets are relative to the MP TIFF header, except
// the primary's required zero offset. All entries must cover the file exactly.
function mpIndex(segment, primary, auxiliary, byteCount) {
  const data = segment.data.subarray(4); hdr(data.length === 82);
  const order = data.toString('ascii', 0, 2); hdr(order === 'MM' || order === 'II');
  const u16 = at => order === 'MM' ? data.readUInt16BE(at) : data.readUInt16LE(at);
  const u32 = at => order === 'MM' ? data.readUInt32BE(at) : data.readUInt32LE(at);
  hdr(u16(2) === 42 && u32(4) === 8 && u16(8) === 3 && u32(46) === 0);
  hdr(u16(10) === 0xb000 && u16(12) === 7 && u32(14) === 4 && data.toString('ascii', 18, 22) === '0100');
  hdr(u16(22) === 0xb001 && u16(24) === 4 && u32(26) === 1 && u32(30) === 2);
  hdr(u16(34) === 0xb002 && u16(36) === 7 && u32(38) === 32 && u32(42) === 50);
  hdr([0x00030000, 0x20030000].includes(u32(50)) && u32(54) === primary.end && u32(58) === 0 && u32(62) === 0);
  hdr(u32(66) === 0 && u32(70) === auxiliary.end - auxiliary.start
    && segment.dataOffset + 4 + u32(74) === auxiliary.start && u32(78) === 0);
  hdr(primary.end === auxiliary.start && auxiliary.end === byteCount);
}

// ISO21496-1 v0 single-channel, base-color-space metadata. Accept only the
// forward SDR base (zero log2 headroom), never an HDR base mislabeled as SDR.
// Rational layout follows Google's reference libultrahdr gainmapmetadata.cpp;
// no gain-map application, tone mapping, or pixel resampling happens here.
function isoMetadata(primary, auxiliary) {
  const base = one(primary, 226, ISO).data.subarray(ISO.length);
  const gain = one(auxiliary, 226, ISO).data.subarray(ISO.length);
  hdr(base.length === 4 && base.readUInt32BE(0) === 0);
  hdr(gain.length === 61 && gain.readUInt32BE(0) === 0 && gain[4] === 0x40);
  const fraction = (at, signed = false) => {
    const denominator = gain.readUInt32BE(at + 4); hdr(denominator > 0);
    return (signed ? gain.readInt32BE(at) : gain.readUInt32BE(at)) / denominator;
  };
  const baseHeadroom = fraction(5), alternateHeadroom = fraction(13);
  const minimum = fraction(21, true), maximum = fraction(29, true), gamma = fraction(37);
  hdr(baseHeadroom === 0 && alternateHeadroom > 0 && Number.isFinite(2 ** alternateHeadroom)
    && minimum <= maximum && gamma > 0 && fraction(45, true) >= 0 && fraction(53, true) >= 0);
  return { headroom: 2 ** alternateHeadroom, bytes: Buffer.concat([base, gain]) };
}

// Closed Apple auxiliary XMP shape, not a permissive substring check or XML
// parser with entities. Reject duplicate properties, namespaces, nested claims,
// DTDs, extra payloads and unsupported gain-map versions.
function appleGainMap(auxiliary, headroom) {
  const data = one(auxiliary, 225, XMP).data.subarray(XMP.length);
  hdr(data.length <= 4096);
  let xml; try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { hdr(false); }
  const number = '([0-9]+(?:\\.[0-9]+)?)';
  const pattern = new RegExp('^\\s*<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core [0-9.]+">\\s*'
    + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\\s*'
    + '<rdf:Description rdf:about=""\\s+xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"\\s+'
    + 'xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/">\\s*'
    + '<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>\\s*'
    + '<HDRGainMap:HDRGainMapHeadroom>' + number + '</HDRGainMap:HDRGainMapHeadroom>\\s*'
    + '<apdi:AuxiliaryImageType>urn:com:apple:photo:2020:aux:hdrgainmap</apdi:AuxiliaryImageType>\\s*'
    + '</rdf:Description>\\s*</rdf:RDF>\\s*</x:xmpmeta>\\s*$');
  const match = pattern.exec(xml);
  hdr(match && Number.isFinite(Number(match[1])) && Number(match[1]) > 1
    && Math.abs(Number(match[1]) - headroom) / headroom < 0.0001);
  return data;
}

export function inspectJpeg(bytes, { allowAppleJpegSdrBase = false } = {}) {
  const primary = image(bytes, 0), mpf = matching(primary, 226, MPF);
  if (!mpf.length) {
    need(primary.end === bytes.length);
    hdr(!matching(primary, 226, ISO).length);
    return { mime: 'image/jpeg', format: 'jpeg', bitDepth: primary.bitDepth };
  }
  need(allowAppleJpegSdrBase, 'PHOTO_MULTIFRAME_UNSUPPORTED');
  hdr(mpf.length === 1 && primary.channels === 3 && primary.end < bytes.length);
  const auxiliary = image(bytes, primary.end);
  hdr(auxiliary.channels === 1 && auxiliary.width <= primary.width && auxiliary.height <= primary.height
    && !matching(auxiliary, 226, MPF).length && !matching(primary, 225, XMP).length);
  mpIndex(mpf[0], primary, auxiliary, bytes.length);
  const iso = isoMetadata(primary, auxiliary), xmp = appleGainMap(auxiliary, iso.headroom);
  const icc = one(primary, 226, ICC).data;
  hdr(icc.length > ICC.length + 2 && icc[ICC.length] === 1 && icc[ICC.length + 1] === 1);
  return { mime: 'image/jpeg', format: 'jpeg', bitDepth: primary.bitDepth,
    jpegHdr: { iccSha256: sha(icc.subarray(ICC.length + 2)), primaryWidth: primary.width, primaryHeight: primary.height,
      gainMapWidth: auxiliary.width, gainMapHeight: auxiliary.height,
      selection: { kind: 'primary-jpeg-sdr-base', primaryByteCount: primary.end,
        gainMapByteCount: auxiliary.end - auxiliary.start,
        gainMapSha256: sha(bytes.subarray(auxiliary.start, auxiliary.end)),
        metadataSha256: sha(Buffer.concat([mpf[0].data, iso.bytes, xmp])) } } };
}
