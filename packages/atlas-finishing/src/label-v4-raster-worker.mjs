// Isolated native raster work. Called only by label-sheet.mjs with a private
// output path. No external resources, hardware or network operations exist.
import sharp from 'sharp';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';
sharp.cache(false);
sharp.concurrency(1);

const table = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
function crc(bytes) { let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const buffer = Buffer.allocUnsafe(data.length + 12); buffer.writeUInt32BE(data.length, 0); buffer.write(type, 4, 4, 'ascii'); data.copy(buffer, 8);
  buffer.writeUInt32BE(crc(buffer.subarray(4, 8 + data.length)), 8 + data.length); return buffer;
}
let input = '';
for await (const bytes of process.stdin) { input += bytes; if (input.length > 54 * 1024 * 1024) throw new Error('LABEL_RASTER_INPUT_TOO_LARGE'); }
const { svg, exportProfile: p, outputPath } = JSON.parse(input); input = '';
if (!Number.isInteger(p.pixelWidth) || !Number.isInteger(p.pixelHeight) || p.pixelWidth > 12800 || p.pixelHeight > 12800
    || ![800, 2400].includes(p.ppi) || p.stripRows !== 256) throw new Error('LABEL_RASTER_PROFILE_INVALID');
const started = performance.now(), output = await open(outputPath, 'wx', 0o600), sha = createHash('sha256');
let byteCount = 0, peakRssBytes = process.memoryUsage().rss;
async function write(bytes) {
  byteCount += bytes.length; if (byteCount > p.maxPngBytes) throw new Error('LABEL_RASTER_OUTPUT_TOO_LARGE');
  sha.update(bytes);
  let offset = 0;
  while (offset < bytes.length) { const result = await output.write(bytes, offset, bytes.length - offset); offset += result.bytesWritten; }
}
try {
  await write(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(p.pixelWidth, 0); ihdr.writeUInt32BE(p.pixelHeight, 4); ihdr[8] = 8; ihdr[9] = 6;
  await write(chunk('IHDR', ihdr));
  const phys = Buffer.alloc(9); phys.writeUInt32BE(Math.round(p.pixelWidth / (p.widthMm / 1000)), 0); phys.writeUInt32BE(Math.round(p.pixelHeight / (p.heightMm / 1000)), 4); phys[8] = 1;
  await write(chunk('pHYs', phys));
  const compressed = createDeflate({ level: 9 });
  const consumer = (async () => {
    let remainder = Buffer.alloc(0);
    for await (const bytes of compressed) {
      const pending = Buffer.concat([remainder, bytes]); let offset = 0;
      while (pending.length - offset >= 65536) { await write(chunk('IDAT', pending.subarray(offset, offset + 65536))); offset += 65536; }
      remainder = Buffer.from(pending.subarray(offset));
    }
    if (remainder.length) await write(chunk('IDAT', remainder));
  })();
  const content = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  // Top-level sheet groups have a fixed native label height after rotation.
  // Exclude entire off-strip rows before handing vectors to librsvg. This is
  // visibility culling only; every retained vector uses the same canvas scale.
  const matches = [...content.matchAll(/<g data-slot="\d+" transform="translate\([^,]+,([^)]+)\) rotate\(90\)">/g)];
  const groups = matches.map((match, i) => ({ topMm: Number(match[1]), svg: content.slice(match.index, matches[i + 1]?.index ?? content.length) }));
  for (let y = 0; y < p.pixelHeight; y += p.stripRows) {
    const height = Math.min(p.stripRows, p.pixelHeight - y);
    const topMm = y * p.heightMm / p.pixelHeight, heightMm = height * p.heightMm / p.pixelHeight;
    const visible = groups.length ? groups.filter(group => group.topMm < topMm + heightMm && group.topMm + 68.342 > topMm).map(group => group.svg).join('') : content;
    const stripSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.pixelWidth}" height="${height}" viewBox="0 ${topMm} ${p.widthMm} ${heightMm}" preserveAspectRatio="none">${visible}</svg>`;
    const { data, info } = await sharp(Buffer.from(stripSvg), { limitInputPixels: p.pixelWidth * p.stripRows, density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== p.pixelWidth || info.height !== height || info.channels !== 4) throw new Error('LABEL_STRIP_DIMENSION_MISMATCH');
    const stride = p.pixelWidth * 4, scanlines = Buffer.allocUnsafe(height * (stride + 1));
    for (let row = 0; row < height; row += 1) {
      const offset = row * (stride + 1); scanlines[offset] = 0;
      for (let x = 0; x < stride; x += 4) {
        const source = row * stride + x, target = offset + 1 + x, opaque = data[source + 3] >= 128;
        scanlines[target] = opaque ? data[source] : 0; scanlines[target + 1] = opaque ? data[source + 1] : 0;
        scanlines[target + 2] = opaque ? data[source + 2] : 0; scanlines[target + 3] = opaque ? 255 : 0;
      }
    }
    if (!compressed.write(scanlines)) await once(compressed, 'drain');
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }
  compressed.end(); await consumer; await write(chunk('IEND', Buffer.alloc(0)));
  await output.sync();
  process.stdout.write(JSON.stringify({ sha256: sha.digest('hex'), byteCount, pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight,
    peakRssBytes, elapsedMs: Math.round(performance.now() - started), sharpVersions: sharp.versions, alphaBinary: true, stripRows: p.stripRows }));
} finally { await output.close(); }
