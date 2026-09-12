import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflate, deflateSync } from 'node:zlib';
import { completeUpload, orientationTransform, planDecode } from '@atlas/photo-core';
import { inspectHeif, integerCrop } from './heif-container.mjs';
import { inspectHeifExif, qualifyHeifIcc } from './heif-metadata.mjs';
import { PhotoRuntimeError } from './process.mjs';

const need = (ok, code = 'PHOTO_DECODE_INVALID') => { if (!ok) throw new PhotoRuntimeError(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const multiply = (a, b) => Array.from({ length: 9 }, (_, i) =>
  [0, 1, 2].reduce((sum, k) => sum + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + i % 3], 0));

function verifyColorProperties(properties, probe) {
  const kinds = new Set();
  for (const property of properties.filter(p => p.type === 'colr')) {
    const data = property.data, type = data.toString('ascii', 0, 4), kind = type === 'nclx' ? 'nclx' : 'icc';
    need(!kinds.has(kind), 'PHOTO_COLOR_UNSUPPORTED'); kinds.add(kind);
    if (kind === 'icc') need(['prof', 'rICC'].includes(type) && data.length > 4
      && data.subarray(4).equals(probe.icc), 'PHOTO_COLOR_UNSUPPORTED');
    else need(data.length === 11 && probe.nclx && data.readUInt16BE(4) === probe.nclx.primaries
      && data.readUInt16BE(6) === probe.nclx.transfer && data.readUInt16BE(8) === probe.nclx.matrix
      && (data[10] === 0 || data[10] === 128) && data[10] / 128 === probe.nclx.fullRange, 'PHOTO_COLOR_UNSUPPORTED');
  }
}
const hasIccProperty = properties => properties.some(p => p.type === 'colr'
  && ['prof', 'rICC'].includes(p.data.toString('ascii', 0, 4)));

export function heifGeometry(probe, container) {
  const properties = container.itemProperties.get(probe.primary); need(properties, 'PHOTO_SOURCE_MISMATCH');
  let width = probe.width, height = probe.height, matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1], crop = null;
  let transformed = false;
  const transformTypes = new Set();
  for (const op of probe.transforms) {
    const property = properties[op.id - 1]; need(property?.type === op.type, 'PHOTO_SOURCE_MISMATCH');
    if (op.type === 'clap') {
      need(!transformed && crop === null, 'PHOTO_GEOMETRY_UNSUPPORTED');
      crop = integerCrop(property.data, width, height);
      matrix = orientationTransform(width, height, 1, crop).matrix; ({ width, height } = crop);
      continue;
    }
    need(!transformTypes.has(op.type), 'PHOTO_GEOMETRY_UNSUPPORTED');
    transformTypes.add(op.type);
    transformed = true;
    need(property.data.length === 1);
    let orientation;
    if (op.type === 'irot') {
      need(property.data[0] <= 3 && property.data[0] * 90 === op.value, 'PHOTO_SOURCE_MISMATCH');
      orientation = { 0: 1, 90: 8, 180: 3, 270: 6 }[op.value];
    } else {
      need(property.data[0] <= 1 && [0, 1].includes(op.value), 'PHOTO_SOURCE_MISMATCH');
      // Pin the native v1.23.2 interpretation and verify its wire observation.
      need(op.value === property.data[0], 'PHOTO_SOURCE_MISMATCH');
      orientation = op.value === 0 ? 4 : 2;
    }
    const step = orientationTransform(width, height, orientation);
    matrix = multiply(step.matrix, matrix); ({ width, height } = step);
  }
  let orientation = null;
  for (let value = 1; value <= 8; value++) {
    const expected = orientationTransform(probe.width, probe.height, value, crop);
    if (expected.matrix.every((v, i) => v === matrix[i])) orientation = value;
  }
  need(orientation !== null && width === probe.displayWidth && height === probe.displayHeight, 'PHOTO_SOURCE_MISMATCH');
  return { orientation, crop };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8);
  let crc = 0xffffffff; for (const value of out.subarray(4, -4)) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
}

// Encode exact once-transformed RGB samples; no color conversion, resampling or
// default 8-bit buffer. 10/12-bit code values expand injectively to full-range16.
async function encodePng(native, geometry, outputPath, maxOutputBytes) {
  const bitDepth = native.bitDepth === 8 ? 8 : 16, sampleBytes = bitDepth / 8;
  const { width, height, matrix: [a, b, c, d, e, f] } = geometry;
  async function* rows() {
    for (let y = 0; y < height; y++) {
      const row = Buffer.alloc(1 + width * 3 * sampleBytes);
      for (let x = 0; x < width; x++) {
        // The inverse of the orthogonal source transform is its transpose.
        const sx = a * (x - c) + d * (y - f), sy = b * (x - c) + e * (y - f);
        need(sx >= 0 && sx < native.width && sy >= 0 && sy < native.height, 'PHOTO_SOURCE_MISMATCH');
        const source = (sy * native.width + sx) * 3 * sampleBytes, target = 1 + x * 3 * sampleBytes;
        for (let channel = 0; channel < 3; channel++) {
          if (bitDepth === 8) row[target + channel] = native.pixels[source + channel];
          else {
            const value = native.pixels.readUInt16BE(source + channel * 2), maximum = 2 ** native.bitDepth - 1;
            need(value <= maximum, 'PHOTO_SOURCE_MISMATCH');
            row.writeUInt16BE(Math.round(value * 65535 / maximum), target + channel * 2);
          }
        }
      }
      yield row;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = bitDepth; header[9] = 2;
  const rowSource = Readable.from(rows());
  const compressed = rowSource.pipe(createDeflate({ level: 6 }));
  rowSource.on('error', error => compressed.destroy(error));
  const source = compressed;
  async function* png() {
    yield Buffer.from('89504e470d0a1a0a', 'hex'); yield chunk('IHDR', header);
    if (native.icc.length) yield chunk('iCCP', Buffer.concat([Buffer.from('ICC\0\0'), deflateSync(native.icc)]));
    else if (native.nclx) yield chunk('sRGB', Buffer.from([0]));
    for await (const data of source) yield chunk('IDAT', data);
    yield chunk('IEND', Buffer.alloc(0));
  }
  let count = 0;
  const bound = new Transform({ transform(data, _encoding, done) {
    count += data.length; done(count > maxOutputBytes ? new PhotoRuntimeError('PHOTO_DECODE_LIMIT') : null,
      count > maxOutputBytes ? undefined : data);
  } });
  try { await pipeline(Readable.from(png()), bound, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })); }
  finally { rowSource.destroy(); compressed.destroy(); }
  return { byteCount: count, bitDepth };
}

export async function decodeHeif(bytes, request) {
  const container = inspectHeif(bytes);
  let addon;
  try { addon = createRequire(import.meta.url)('../native/build/heif.node'); }
  catch { throw new PhotoRuntimeError('PHOTO_DECODER_UNAVAILABLE'); }
  const probe = addon.probe(bytes, request.limits), geometry = heifGeometry(probe, container);
  inspectHeifExif(probe.exif);
  const iccColorSpace = qualifyHeifIcc(probe.icc);
  const crop=geometry.crop??{x:0,y:0,width:probe.width,height:probe.height};
  // Odd-origin YCbCr crops changed chroma phase in the independent native-default
  // comparison, including without rotation. Keep this unqualified case explicit.
  need(crop.x%2===0&&crop.y%2===0, 'PHOTO_GEOMETRY_UNSUPPORTED');
  const nontrivialTransform = probe.transforms.some(op => op.type === 'imir' || (op.type === 'irot' && op.value !== 0));
  if (nontrivialTransform) need([probe.width,probe.height,crop.width,crop.height]
    .every(value=>value%2===0), 'PHOTO_GEOMETRY_UNSUPPORTED');
  const primaryProperties = container.itemProperties.get(probe.primary);
  verifyColorProperties(primaryProperties, probe);
  const primaryHasIcc = hasIccProperty(primaryProperties);
  need(probe.properties.length >= primaryProperties.length, 'PHOTO_SOURCE_MISMATCH');
  need(probe.properties.every((id,i)=>id===i+1), 'PHOTO_SOURCE_MISMATCH');
  need(primaryProperties.every((property,i)=>probe.propertyTypes[i]===property.type), 'PHOTO_SOURCE_MISMATCH');
  // libheif1.23.2 can append inherited grid colr properties to its in-memory
  // list. Original properties must match exactly; only verified color suffixes
  // are allowed. Tile NCLX equality was checked natively before this point.
  need(probe.propertyTypes.slice(primaryProperties.length).every(type=>probe.grid&&(probe.nclx||iccColorSpace)&&type==='colr'), 'PHOTO_SOURCE_MISMATCH');
  for (const property of primaryProperties) need(['ispe', 'pixi', 'hvcC', 'colr', 'clap', 'irot', 'imir']
    .includes(property.type), 'PHOTO_HEIC_UNSUPPORTED');
  need(container.items.get(probe.primary) === (probe.grid ? 'grid' : 'hvc1'), 'PHOTO_SOURCE_MISMATCH');
  if (probe.grid) for (const id of probe.grid.tileIds) {
    need(container.items.get(id) === 'hvc1', 'PHOTO_SOURCE_MISMATCH');
    const properties = container.itemProperties.get(id); need(properties, 'PHOTO_SOURCE_MISMATCH');
    verifyColorProperties(properties, probe);
    // libheif inherits a missing primary ICC from only the first tile. Without
    // an explicit primary profile, every tile must supply that same ICC; an
    // unprofiled tile cannot acquire preserved-color authority from its neighbor.
    if (iccColorSpace && !primaryHasIcc) need(hasIccProperty(properties), 'PHOTO_COLOR_UNSUPPORTED');
    need(properties.every(p => ['ispe', 'pixi', 'hvcC', 'colr'].includes(p.type)), 'PHOTO_HEIC_UNSUPPORTED');
  }
  need(request.existingOriginal?.metadata?.dynamicRange !== 'HDR', 'PHOTO_HDR_UNSUPPORTED');
  const metadata = {
    encoded: { width: probe.width, height: probe.height }, ...geometry,
    orientationSource: probe.transforms.length ? 'heif-properties' : 'identity',
    selection: { kind: 'primary-still-image', itemId: String(probe.primary) }, bitDepth: probe.bitDepth,
    iccSha256: probe.icc.length ? sha(probe.icc) : null,
    colorSpace: iccColorSpace ?? (probe.nclx ? `NCLX:${probe.nclx.primaries}/${probe.nclx.transfer}/${probe.nclx.matrix}/${probe.nclx.fullRange}` : null),
    // Absence of a profile is unknown, not evidence of SDR or sRGB.
    dynamicRange: probe.nclx || iccColorSpace ? 'SDR' : request.existingOriginal?.metadata?.dynamicRange ?? null,
  };
  const { plan, observedObject, existingOriginal, limits, outputPath } = request;
  const original = completeUpload(plan, { schemaVersion: 1, kind: 'original', uploadId: plan.uploadId,
    binding: plan.binding, object: observedObject,
    content: { mime: 'image/heic', byteCount: bytes.length, sha256: plan.expected.sha256 },
    metadata: existingOriginal ? existingOriginal.metadata : metadata }, existingOriginal);
  const decodePlan = planDecode(original, metadata, limits);
  const native = addon.decode(bytes, limits);
  const { pixels, ...again } = native;
  need(JSON.stringify(again) === JSON.stringify(probe), 'PHOTO_SOURCE_MISMATCH');
  need(pixels.length === probe.width * probe.height * 3 * (probe.bitDepth === 8 ? 1 : 2), 'PHOTO_SOURCE_MISMATCH');
  const output = await encodePng(native, decodePlan.geometry, outputPath, limits.maxOutputBytes);
  return { original, decodePlan, output,
    treatment: { decoder: 'libheif/libde265', version: probe.version,
      policyVersion: 'atlas-heif-primary-lossless-v2', channels: 3, bitDepth: output.bitDepth,
      colorSpace: iccColorSpace ?? (probe.nclx ? 'sRGB' : null), colorTreatment: iccColorSpace ? 'preserved' : probe.nclx ? 'converted' : 'unmanaged',
      hdrTreatment: metadata.dynamicRange === 'SDR' ? 'not-present' : 'unknown' } };
}
