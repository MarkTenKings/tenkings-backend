// Isolated native raster work. Called only by label-sheet.mjs with a private
// output path. No external resources, hardware or network operations exist.
import sharp from 'sharp';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';
import { LABEL_JIG_V1, labelSlotTransform } from './label-sheet-geometry.mjs';
import { LABEL_JIG_25, getLabel25Profile, label25SlotTransform } from './label-sheet-25.mjs';
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
const layout25 = getLabel25Profile(p.id);
const tiled25 = p.rasterizer === 'sharp-0.33.5-jig25-clipped-strip-png-v1';
if (tiled25 !== Boolean(layout25) || layout25 && (p.jigHash !== layout25.jigHash || p.templateId !== layout25.templateId
    || p.page !== layout25.page || p.firstSourceSlot !== layout25.firstSourceSlot || p.lastSourceSlot !== layout25.lastSourceSlot
    || !svg.startsWith('<svg ') || !svg.slice(0, svg.indexOf('>')).includes(`data-jig-hash="${layout25.jigHash}"`))) throw new Error('LABEL_RASTER_PROFILE_INVALID');
const tiled = tiled25 || p.rasterizer === 'sharp-0.33.5-clipped-strip-png-v2';
const blackInk = p.printMode === 'BLACK_INK_TRANSPARENT';
if (p.printMode != null && (!blackInk || p.artworkConversion !== 'white-and-gray-vector-knockouts-v1' || p.rgbPolicy !== 'black-rgb-zero-v1')) throw new Error('LABEL_RASTER_PROFILE_INVALID');
if (tiled && (p.pixelWidth !== 9764 || p.pixelHeight !== 12598 || p.widthMm !== 310 || p.heightMm !== 400
    || p.ppi !== 800 || p.tileHaloPixels !== 1 || p.maxTileWidth !== (tiled25 ? 2160 : 640))) throw new Error('LABEL_RASTER_PROFILE_INVALID');
const started = performance.now(), output = await open(outputPath, 'wx', 0o600), sha = createHash('sha256');
let byteCount = 0, peakRssBytes = process.memoryUsage().rss, rasterizedTiles = 0, maxRasterTileBytes = 0;
// Approved B embeds pinned raster artwork. Decode it once per occupied frame,
// rather than once for every output strip; historical vector tiles are unchanged.
const frameLimit = tiled25 ? { width: 2160, height: 2160, maxPixels: 640 * 2160, count: 10 } : { width: 640, height: 2160, count: 10 };
const frames = new Map();
let rasterizedFrames = 0, maxRasterFrameBytes = 0, maxCachedFrames = 0, maxCachedFrameBytes = 0, cachedFrameBytes = 0;
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
  const matches = [...content.matchAll(/<g data-slot="(\d+)" transform="translate\(([^,]+),([^)]+)\) rotate\((?:0|90)\)">/g)];
  if (tiled && (matches.length < 1 || matches.length > (tiled25 ? 25 : 50) || matches[0].index !== 0)) throw new Error('LABEL_RASTER_SHEET_INVALID');
  const seen = new Set();
  const groups = matches.map((match, i) => {
    const slot = Number(match[1]), frame = (tiled25 ? LABEL_JIG_25 : LABEL_JIG_V1).slots.find(value => value.slot === slot);
    if (!tiled || !frame || seen.has(slot) || match[0] !== `<g data-slot="${slot}" transform="${tiled25 ? label25SlotTransform(slot) : labelSlotTransform(slot)}">`) throw new Error('LABEL_RASTER_SHEET_INVALID');
    seen.add(slot);
    const left = Math.floor(frame.xMm * p.pixelWidth / p.widthMm) - p.tileHaloPixels;
    const right = Math.ceil((frame.xMm + frame.widthMm) * p.pixelWidth / p.widthMm) + p.tileHaloPixels;
    if (left < 0 || right > p.pixelWidth || right - left > p.maxTileWidth) throw new Error('LABEL_RASTER_TILE_BOUNDS_INVALID');
    return { slot, topMm: frame.yMm, heightMm: frame.heightMm, left, width: right - left,
      top: Math.floor(frame.yMm * p.pixelHeight / p.heightMm) - p.tileHaloPixels,
      bottom: Math.ceil((frame.yMm + frame.heightMm) * p.pixelHeight / p.heightMm) + p.tileHaloPixels,
      svg: content.slice(match.index, matches[i + 1]?.index ?? content.length) };
  });
  for (let y = 0; y < p.pixelHeight; y += p.stripRows) {
    const height = Math.min(p.stripRows, p.pixelHeight - y);
    const topMm = y * p.heightMm / p.pixelHeight, heightMm = height * p.heightMm / p.pixelHeight;
    let data, info;
    if (tiled) {
      data = Buffer.alloc(p.pixelWidth * height * 4); info = { width: p.pixelWidth, height, channels: 4 };
      for (const group of groups.filter(value => value.topMm < topMm + heightMm && value.topMm + value.heightMm > topMm)) {
        let tile, firstSourceRow;
        const firstRow = Math.max(0, group.top - y), lastRow = Math.min(height, group.bottom - y);
        if (group.svg.includes('<image ')) {
          // Keep the same final sheet scale and integer-pixel grid, including
          // the existing one-pixel halo. Only the viewport changes: artwork is
          // neither resized nor redrawn. Retain at most one ten-label jig row.
          tile = frames.get(group.slot);
          if (!tile) {
            const frameHeight = group.bottom - group.top;
            if (group.width > frameLimit.width || frameHeight > frameLimit.height || group.width * frameHeight > 640 * 2160 || frameHeight < 1
                || group.top < 0 || group.bottom > p.pixelHeight || frames.size >= frameLimit.count) throw new Error('LABEL_RASTER_FRAME_BOUNDS_INVALID');
            const frameTopMm = group.top * p.heightMm / p.pixelHeight, frameHeightMm = frameHeight * p.heightMm / p.pixelHeight;
            const frameSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${group.width}" height="${frameHeight}"><svg x="${-group.left}" width="${p.pixelWidth}" height="${frameHeight}" viewBox="0 ${frameTopMm} ${p.widthMm} ${frameHeightMm}" preserveAspectRatio="none">${group.svg}</svg></svg>`;
            tile = await sharp(Buffer.from(frameSvg), { limitInputPixels: 640 * 2160, density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            if (tile.info.width !== group.width || tile.info.height !== frameHeight || tile.info.channels !== 4) throw new Error('LABEL_FRAME_DIMENSION_MISMATCH');
            frames.set(group.slot, tile); cachedFrameBytes += tile.data.length;
            rasterizedFrames += 1; maxRasterFrameBytes = Math.max(maxRasterFrameBytes, tile.data.length);
            maxCachedFrames = Math.max(maxCachedFrames, frames.size); maxCachedFrameBytes = Math.max(maxCachedFrameBytes, cachedFrameBytes);
          }
          firstSourceRow = y - group.top;
        } else {
          // Historical V4 uses its exact original strip viewport, preserving
          // the inspected vector-label PNG goldens and allocation bounds.
          const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${group.width}" height="${height}"><svg x="${-group.left}" width="${p.pixelWidth}" height="${height}" viewBox="0 ${topMm} ${p.widthMm} ${heightMm}" preserveAspectRatio="none">${group.svg}</svg></svg>`;
          tile = await sharp(Buffer.from(tileSvg), { limitInputPixels: p.maxTileWidth * p.stripRows, density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          if (tile.info.width !== group.width || tile.info.height !== height || tile.info.channels !== 4) throw new Error('LABEL_TILE_DIMENSION_MISMATCH');
          rasterizedTiles += 1; maxRasterTileBytes = Math.max(maxRasterTileBytes, tile.data.length);
          firstSourceRow = 0;
        }
        // Copy only the occupied frame; adjacent transparent margins cannot
        // erase the other jig row when a strip crosses their boundary.
        for (let row = firstRow; row < lastRow; row += 1) {
          const source = (row + firstSourceRow) * group.width * 4;
          tile.data.copy(data, (row * p.pixelWidth + group.left) * 4, source, source + group.width * 4);
        }
        if (frames.has(group.slot) && group.topMm + group.heightMm <= topMm + heightMm) {
          cachedFrameBytes -= tile.data.length; frames.delete(group.slot);
        }
      }
    } else {
      const stripSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.pixelWidth}" height="${height}" viewBox="0 ${topMm} ${p.widthMm} ${heightMm}" preserveAspectRatio="none">${content}</svg>`;
      ({ data, info } = await sharp(Buffer.from(stripSvg), { limitInputPixels: p.pixelWidth * p.stripRows, density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    }
    if (info.width !== p.pixelWidth || info.height !== height || info.channels !== 4) throw new Error('LABEL_STRIP_DIMENSION_MISMATCH');
    const stride = p.pixelWidth * 4, scanlines = Buffer.allocUnsafe(height * (stride + 1));
    for (let row = 0; row < height; row += 1) {
      const offset = row * (stride + 1); scanlines[offset] = 0;
      for (let x = 0; x < stride; x += 4) {
        const source = row * stride + x, target = offset + 1 + x, opaque = data[source + 3] >= 128;
        if (blackInk && opaque && (data[source] !== 0 || data[source + 1] !== 0 || data[source + 2] !== 0)) throw new Error('LABEL_BLACK_INK_PIXEL_INVALID');
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
    peakRssBytes, elapsedMs: Math.round(performance.now() - started), sharpVersions: sharp.versions, alphaBinary: true, stripRows: p.stripRows,
    rasterizer: p.rasterizer, rasterizedTiles, maxRasterTileBytes,
    ...(rasterizedFrames ? { frameStrategy: 'approved-b-final-grid-frame-cache-v1', rasterizedFrames, maxRasterFrameBytes,
      maxCachedFrames, maxCachedFrameBytes, frameLimits: frameLimit } : {}),
    ...(blackInk ? { printMode: p.printMode, blackInkOnly: true } : {}) }));
} finally { await output.close(); }
