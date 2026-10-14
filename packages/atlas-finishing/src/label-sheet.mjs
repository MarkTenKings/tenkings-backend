import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LABEL_JIG_V1, labelSlotTransform } from './label-sheet-geometry.mjs';
export { LABEL_JIG_V1, labelSlotTransform, labelPointOnSheet } from './label-sheet-geometry.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const profile = { id: 'atlas-v4-sheet-800ppi-diagnostic-v1', version: 1, widthMm: 310, heightMm: 400, ppi: 800,
  pixelWidth: 9764, pixelHeight: 12598, contentType: 'image/png', alphaPolicy: 'straight-rgba-alpha-threshold-128-v1',
  qualification: 'DIAGNOSTIC_PHYSICAL_IMPORT_UNQUALIFIED', rasterizer: 'sharp-0.33.5-strip-png-v1',
  stripRows: 256, maxPngBytes: 64 * 1024 * 1024, transparentMarginsVerified: false };
export const LABEL_EXPORT_PROFILE_V1 = Object.freeze({ ...profile, hash: hash(stable(profile)) });
const individual = { ...profile, id: 'atlas-v4-individual-2400ppi-v1', widthMm: 68.342, heightMm: 20.082,
  ppi: 2400, pixelWidth: 6458, pixelHeight: 1898, maxPngBytes: 32 * 1024 * 1024 };
export const LABEL_INDIVIDUAL_EXPORT_PROFILE_V1 = Object.freeze({ ...individual, hash: hash(stable(individual)) });

export function validateLabelV4Artwork({ printSvg, artworkHash }) {
  if (typeof printSvg !== 'string' || Buffer.byteLength(printSvg) > 1024 * 1024 || hash(printSvg) !== artworkHash
      || !/^<svg\s[^>]*data-atlas-artwork="PRINT"[^>]*data-renderer="atlas-v4-outlined-label-v1"[^>]*>/.test(printSvg)
      || !printSvg.includes('width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082"')
      || /<(?:script|image|foreignObject|text|style|linearGradient|radialGradient)\b|\bon\w+\s*=|\b(?:href|src)\s*=|<!/i.test(printSvg)
      || /url\(\s*[^#]/i.test(printSvg)) throw new Error('LABEL_PRINT_ARTWORK_INVALID');
  return printSvg;
}

export function renderLabelSheetSvg(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new Error('LABEL_SHEET_ITEMS_INVALID');
  const seen = new Set();
  const content = [...items].sort((a, b) => a.slot - b.slot).map(item => {
    if (!Number.isInteger(item.slot) || item.slot < 1 || item.slot > 50 || seen.has(item.slot)) throw new Error('LABEL_SLOT_INVALID');
    seen.add(item.slot);
    const original = validateLabelV4Artwork(item);
    const inner = original.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<title>[^]*?<\/title>/g, '');
    // Each label owns its mask/clip IDs. Prefix both definitions and references;
    // never let one card's dynamic grade mask alter another card's artwork.
    const renamed = inner.replace(/\bid="([^"]+)"/g, `id="s${item.slot}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#s${item.slot}-$1)`);
    return `<g data-slot="${item.slot}" transform="${labelSlotTransform(item.slot)}">${renamed}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="310mm" height="400mm" viewBox="0 0 310 400" data-atlas-artwork="PRINT_SHEET">${content}</svg>`;
}

function mappingFor(exportProfile, calibrationProfile) {
  if (calibrationProfile != null && (typeof calibrationProfile !== 'object'
      || !/^[a-f0-9]{64}$/.test(calibrationProfile.hash)
      || calibrationProfile.anchor !== 'TOP_LEFT' || calibrationProfile.axes !== 'X_RIGHT_Y_DOWN'
      || !Number.isFinite(calibrationProfile.originXmm) || !Number.isFinite(calibrationProfile.originYmm))) throw new Error('LABEL_CALIBRATION_INVALID');
  return { jigHash: LABEL_JIG_V1.jigHash, calibrationProfileHash: calibrationProfile?.hash ?? null,
    pixelWidth: exportProfile.pixelWidth, pixelHeight: exportProfile.pixelHeight,
    canvasWidthMm: exportProfile.widthMm, canvasHeightMm: exportProfile.heightMm, cropXmm: 0, cropYmm: 0,
    intendedImportWidthMm: exportProfile.widthMm, intendedImportHeightMm: exportProfile.heightMm,
    intendedImportXmm: calibrationProfile?.originXmm ?? null, intendedImportYmm: calibrationProfile?.originYmm ?? null,
    importPositionAnchor: calibrationProfile ? 'TOP_LEFT' : null, importAxes: calibrationProfile ? 'X_RIGHT_Y_DOWN' : null,
    rotationDeg: 0, effectivePpiX: exportProfile.pixelWidth * 25.4 / exportProfile.widthMm,
    effectivePpiY: exportProfile.pixelHeight * 25.4 / exportProfile.heightMm, alphaPolicy: exportProfile.alphaPolicy,
    renderProfileHash: exportProfile.hash, exportProfileId: exportProfile.id, contentType: 'image/png',
    qualification: exportProfile.qualification, transparentMarginsVerified: false };
}

let pending = 0, previous = Promise.resolve();
async function raster(svg, exportProfile) {
  // At most one bounded native child exists. It rasterizes small vector strips
  // directly at final scale and streams PNG scanlines; no full-plate RGBA buffer.
  if (pending >= 4) throw new Error('LABEL_RENDER_BUSY');
  pending += 1;
  const run = previous.then(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-label-v4-'));
    try {
      const outputPath = join(directory, 'print.png');
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--max-old-space-size=256', fileURLToPath(new URL('./label-v4-raster-worker.mjs', import.meta.url))],
          { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, UV_THREADPOOL_SIZE: '1', VIPS_CONCURRENCY: '1' } });
        let stdout = '', stderr = '', settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
        const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('LABEL_RENDER_TIMEOUT')); }, 180_000);
        child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > 8192) child.kill('SIGKILL'); });
        child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4096); });
        child.on('error', error => finish(error));
        child.on('exit', code => {
          if (code !== 0) { const error = new Error('LABEL_RASTER_FAILED'); error.diagnostic = stderr; finish(error); }
          else { try { finish(null, JSON.parse(stdout)); } catch { finish(new Error('LABEL_RASTER_RECEIPT_INVALID')); } }
        });
        child.stdin.on('error', error => finish(error));
        child.stdin.end(JSON.stringify({ svg, exportProfile, outputPath }));
      });
      const bytes = await readFile(outputPath);
      if (bytes.length > exportProfile.maxPngBytes || bytes.length !== result.byteCount || hash(bytes) !== result.sha256) throw new Error('LABEL_PNG_INTEGRITY_FAILED');
      return { bytes, sha256: result.sha256, rasterReceipt: result };
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  previous = run.catch(() => {});
  try { return await run; } finally { pending -= 1; }
}

export async function renderLabelSheetPng(items, { calibrationProfile = null, exportProfileId = LABEL_EXPORT_PROFILE_V1.id } = {}) {
  if (exportProfileId !== LABEL_EXPORT_PROFILE_V1.id) throw new Error('LABEL_EXPORT_PROFILE_INVALID');
  const mapping = mappingFor(LABEL_EXPORT_PROFILE_V1, calibrationProfile);
  const svg = renderLabelSheetSvg(items), result = await raster(svg, LABEL_EXPORT_PROFILE_V1);
  return { bytes: result.bytes, sha256: result.sha256, manifest: { version: 'atlas-label-png-manifest-v1', ...mapping,
    sha256: result.sha256, byteCount: result.bytes.length, orderedArtwork: [...items].sort((a, b) => a.slot - b.slot).map(({ slot, artworkHash }) => ({ slot, artworkHash })),
    rasterReceipt: result.rasterReceipt } };
}

export async function renderLabelV4Png(item) {
  const svg = validateLabelV4Artwork(item), exportProfile = LABEL_INDIVIDUAL_EXPORT_PROFILE_V1;
  const result = await raster(svg, exportProfile), mapping = mappingFor(exportProfile, null);
  return { bytes: result.bytes, sha256: result.sha256, manifest: { version: 'atlas-label-png-manifest-v1', ...mapping,
    jigHash: null, sha256: result.sha256, byteCount: result.bytes.length, artworkHash: item.artworkHash, rasterReceipt: result.rasterReceipt } };
}
