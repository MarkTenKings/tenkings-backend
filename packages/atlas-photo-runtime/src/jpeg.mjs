import { createHash } from 'node:crypto';
import { PhotoRuntimeError } from './process.mjs';

const need = (ok, code = 'PHOTO_DECODE_INVALID') => { if (!ok) throw new PhotoRuntimeError(code); };
const hdr = ok => need(ok, 'PHOTO_HDR_UNSUPPORTED');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MPF = Buffer.from('MPF\0');
const ISO = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
const XMP = Buffer.from('http://ns.adobe.com/xap/1.0/\0');
const ICC = Buffer.from('ICC_PROFILE\0');
const EXIF = Buffer.from('Exif\0\0');
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
  const namespaces = '(?:xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"\\s+'
    + 'xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/"|'
    + 'xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/"\\s+'
    + 'xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/")';
  const pattern = new RegExp('^\\s*<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core [0-9.]+">\\s*'
    + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\\s*'
    + '<rdf:Description rdf:about=""\\s+' + namespaces + '>\\s*([\\s\\S]*?)'
    + '</rdf:Description>\\s*</rdf:RDF>\\s*</x:xmpmeta>\\s*$');
  const match = pattern.exec(xml); hdr(match);
  const body = match[1], values = new Map();
  const property = /<(HDRGainMap:HDRGainMapVersion|HDRGainMap:HDRGainMapHeadroom|apdi:AuxiliaryImageType|apdi:NativeFormat|apdi:StoredFormat)>([^<>]*)<\/\1>\s*/y;
  let offset = 0;
  while (offset < body.length) {
    property.lastIndex = offset; const entry = property.exec(body);
    hdr(entry && !values.has(entry[1])); values.set(entry[1], entry[2]); offset = property.lastIndex;
  }
  const declaredHeadroom = values.get('HDRGainMap:HDRGainMapHeadroom');
  hdr([3, 5].includes(values.size) && values.get('HDRGainMap:HDRGainMapVersion') === '131072'
    && values.get('apdi:AuxiliaryImageType') === 'urn:com:apple:photo:2020:aux:hdrgainmap'
    && /^[0-9]+(?:\.[0-9]+)?$/.test(declaredHeadroom ?? '')
    && Number.isFinite(Number(declaredHeadroom)) && Number(declaredHeadroom) > 1
    && Math.abs(Number(declaredHeadroom) - headroom) / headroom < 0.0001);
  // Apple's L008 auxiliary declaration is a single 8-bit component, matching
  // the separately checked grayscale JPEG. Neither half may be omitted.
  hdr(values.size === 3 || values.get('apdi:NativeFormat') === '1278226488'
    && values.get('apdi:StoredFormat') === '1278226488');
  return data;
}

// Some Apple originals also carry capture dates and face-region annotations in
// the primary JPEG. They are inert metadata, not gain-map/color evidence. Admit
// only this closed, bounded shape; never apply its regions as crops or read an
// XMP orientation. Unknown namespaces/properties and all HDR claims still fail.
function applePrimaryMetadata(primary) {
  const segments = matching(primary, 225, XMP); hdr(segments.length <= 1);
  if (!segments.length) return Buffer.alloc(0);
  const data = segments[0].data.subarray(XMP.length); hdr(data.length <= 16_384);
  let xml; try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { hdr(false); }
  let offset = 0;
  const read = pattern => {
    pattern.lastIndex = offset; const match = pattern.exec(xml); hdr(match);
    offset = pattern.lastIndex; return match;
  };
  const space = () => { read(/\s*/y); };
  const literal = value => { space(); hdr(xml.startsWith(value, offset)); offset += value.length; };
  const value = (tag, pattern) => {
    literal(`<${tag}>`); const text = read(pattern)[0]; literal(`</${tag}>`); return text;
  };
  space(); read(/<x:xmpmeta xmlns:x="adobe:ns:meta\/" x:xmptk="XMP Core [0-9.]+">/y);
  literal('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  literal('<rdf:Description rdf:about=""');
  const namespaces = new Map([
    ['xmp', 'http://ns.adobe.com/xap/1.0/'],
    ['mwg-rs', 'http://www.metadataworkinggroup.com/schemas/regions/'],
    ['stArea', 'http://ns.adobe.com/xmp/sType/Area#'],
    ['apple-fi', 'http://ns.apple.com/faceinfo/1.0/'],
    ['stDim', 'http://ns.adobe.com/xap/1.0/sType/Dimensions#'],
    ['photoshop', 'http://ns.adobe.com/photoshop/1.0/'],
  ]);
  for (let i = 0; i < 6; i++) {
    const match = read(/\s+xmlns:([A-Za-z-]+)="([^"<>&]*)"/y);
    hdr(namespaces.has(match[1]) && namespaces.get(match[1]) === match[2]); namespaces.delete(match[1]);
  }
  literal('>');
  const date = /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?/y;
  value('xmp:CreateDate', date); value('xmp:CreatorTool', /[0-9]+(?:\.[0-9]+){1,3}/y); value('xmp:ModifyDate', date);
  literal('<mwg-rs:Regions rdf:parseType="Resource">'); literal('<mwg-rs:RegionList>'); literal('<rdf:Seq>');
  let regions = 0;
  space();
  while (xml.startsWith('<rdf:li', offset)) {
    hdr(++regions <= 32); literal('<rdf:li rdf:parseType="Resource">');
    literal('<mwg-rs:Area rdf:parseType="Resource">');
    for (const tag of ['y', 'w', 'x', 'h']) {
      const area = Number(value(`stArea:${tag}`, /[0-9]+(?:\.[0-9]+)?/y)); hdr(area >= 0 && area <= 1);
    }
    value('stArea:unit', /normalized/y); literal('</mwg-rs:Area>'); value('mwg-rs:Type', /Face/y);
    literal('<mwg-rs:Extensions rdf:parseType="Resource">');
    for (const [tag, maximum] of [['AngleInfoYaw', 360], ['AngleInfoRoll', 360], ['ConfidenceLevel', 100], ['FaceID', 2_147_483_647]]) {
      const number = Number(value(`apple-fi:${tag}`, /[0-9]+/y)); hdr(number <= maximum);
    }
    literal('</mwg-rs:Extensions>'); literal('</rdf:li>'); space();
  }
  hdr(regions > 0); literal('</rdf:Seq>'); literal('</mwg-rs:RegionList>');
  literal('<mwg-rs:AppliedToDimensions rdf:parseType="Resource">');
  hdr(Number(value('stDim:h', /[0-9]+/y)) === primary.height);
  hdr(Number(value('stDim:w', /[0-9]+/y)) === primary.width);
  value('stDim:unit', /pixel/y); literal('</mwg-rs:AppliedToDimensions>'); literal('</mwg-rs:Regions>');
  value('photoshop:DateCreated', date); literal('</rdf:Description>'); literal('</rdf:RDF>'); literal('</x:xmpmeta>');
  space(); hdr(offset === xml.length);
  return data;
}

// A missing ICC is not color evidence. The additional iPhone JPEG variant must
// explicitly declare Exif ColorSpace=1 (sRGB) in exactly one bounded Exif IFD.
// Other metadata is never surfaced or interpreted as a profile.
function exifSrgb(primary) {
  const segments = matching(primary, 225, EXIF); hdr(segments.length === 1);
  const data = segments[0].data.subarray(EXIF.length);
  hdr(data.length >= 8); const order = data.toString('ascii', 0, 2); hdr(order === 'II' || order === 'MM');
  const u16 = at => { hdr(at >= 0 && at + 2 <= data.length); return order === 'II' ? data.readUInt16LE(at) : data.readUInt16BE(at); };
  const u32 = at => { hdr(at >= 0 && at + 4 <= data.length); return order === 'II' ? data.readUInt32LE(at) : data.readUInt32BE(at); };
  hdr(u16(2) === 42);
  const ranges = [];
  const ifd = offset => {
    hdr(offset >= 8); const count = u16(offset), end = offset + 2 + count * 12 + 4;
    hdr(count > 0 && count <= 512 && end <= data.length && ranges.every(([a, b]) => end <= a || offset >= b));
    ranges.push([offset, end]); const tags = new Map();
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12, tag = u16(at); hdr(!tags.has(tag));
      tags.set(tag, { type: u16(at + 2), count: u32(at + 4), valueAt: at + 8 });
    }
    return tags;
  };
  const root = ifd(u32(4)), pointer = root.get(0x8769);
  hdr(pointer?.type === 4 && pointer.count === 1);
  const tags = ifd(u32(pointer.valueAt)), color = tags.get(0xa001);
  hdr(color?.type === 3 && color.count === 1 && u16(color.valueAt) === 1);
  return segments[0].data;
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
    && !matching(auxiliary, 226, MPF).length);
  mpIndex(mpf[0], primary, auxiliary, bytes.length);
  const primaryMetadata = applePrimaryMetadata(primary);
  const iso = isoMetadata(primary, auxiliary), xmp = appleGainMap(auxiliary, iso.headroom);
  const profiles = matching(primary, 226, ICC); hdr(profiles.length <= 1);
  let iccSha256 = null, colorEvidence = Buffer.alloc(0);
  if (profiles.length) {
    const icc = profiles[0].data;
    hdr(icc.length > ICC.length + 2 && icc[ICC.length] === 1 && icc[ICC.length + 1] === 1);
    iccSha256 = sha(icc.subarray(ICC.length + 2));
  } else colorEvidence = exifSrgb(primary);
  return { mime: 'image/jpeg', format: 'jpeg', bitDepth: primary.bitDepth,
    jpegHdr: { iccSha256, colorSpace: profiles.length ? 'Display P3' : 'sRGB', primaryWidth: primary.width, primaryHeight: primary.height,
      gainMapWidth: auxiliary.width, gainMapHeight: auxiliary.height,
      selection: { kind: 'primary-jpeg-sdr-base', primaryByteCount: primary.end,
        gainMapByteCount: auxiliary.end - auxiliary.start,
        gainMapSha256: sha(bytes.subarray(auxiliary.start, auxiliary.end)),
        metadataSha256: sha(Buffer.concat([mpf[0].data, iso.bytes, xmp, colorEvidence, primaryMetadata])) } } };
}
