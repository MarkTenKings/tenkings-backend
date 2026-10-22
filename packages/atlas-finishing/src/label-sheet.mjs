import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LABEL_JIG_V1, labelSlotTransform } from './label-sheet-geometry.mjs';
import { APPROVED_B_MARKER, validateApprovedBArtwork, renderApprovedBBlackInk, renderApprovedBBack, colorApprovedBArtwork, approvedBHash } from './label-approved-b-artwork.mjs';
export { LABEL_JIG_V1, labelSlotTransform, labelPointOnSheet } from './label-sheet-geometry.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const profile = { id: 'atlas-v4-sheet-800ppi-diagnostic-v1', version: 1, widthMm: 310, heightMm: 400, ppi: 800,
  pixelWidth: 9764, pixelHeight: 12598, contentType: 'image/png', alphaPolicy: 'straight-rgba-alpha-threshold-128-v1',
  qualification: 'DIAGNOSTIC_PHYSICAL_IMPORT_UNQUALIFIED', rasterizer: 'sharp-0.33.5-strip-png-v1',
  stripRows: 256, maxPngBytes: 64 * 1024 * 1024, transparentMarginsVerified: false };
const sheet = { ...profile, id: 'atlas-v4-sheet-800ppi-diagnostic-v2', version: 2,
  rasterizer: 'sharp-0.33.5-clipped-strip-png-v2', tileHaloPixels: 1, maxTileWidth: 640 };
export const LABEL_EXPORT_PROFILE_V1 = Object.freeze({ ...sheet, hash: hash(stable(sheet)) });
const individual = { ...profile, id: 'atlas-v4-individual-2400ppi-v1', widthMm: 68.342, heightMm: 20.082,
  ppi: 2400, pixelWidth: 6458, pixelHeight: 1898, maxPngBytes: 32 * 1024 * 1024 };
export const LABEL_INDIVIDUAL_EXPORT_PROFILE_V1 = Object.freeze({ ...individual, hash: hash(stable(individual)) });
const blackInk = { printMode: 'BLACK_INK_TRANSPARENT', artworkConversion: 'white-and-gray-vector-knockouts-v1', rgbPolicy: 'black-rgb-zero-v1' };
const blackSheet = { ...sheet, ...blackInk, id: 'atlas-v4-sheet-800ppi-black-ink-transparent-v1', version: 1 };
const blackIndividual = { ...individual, ...blackInk, id: 'atlas-v4-individual-2400ppi-black-ink-transparent-v1', version: 1 };
export const LABEL_BLACK_INK_EXPORT_PROFILE_V1 = Object.freeze({ ...blackSheet, hash: hash(stable(blackSheet)) });
export const LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1 = Object.freeze({ ...blackIndividual, hash: hash(stable(blackIndividual)) });

const approvedProfile = (base, mode, side) => {
  const value = { ...base, id: `atlas-approved-b-${base.ppi === 800 ? 'sheet-800ppi' : 'individual-2400ppi'}-${mode}-${side.toLowerCase()}-v1`,
    version: 1, side, ...(mode === 'color' ? { outputMode: 'COLOR_PRINT', materialPolicy: 'approved-label-material-v1' } : {}),
    ...(mode === 'black-ink-transparent' ? blackInk : {}) };
  return Object.freeze({ ...value, hash: hash(stable(value)) });
};
export const LABEL_COLOR_EXPORT_PROFILE_V1 = approvedProfile(sheet, 'color', 'FRONT');
export const LABEL_COLOR_INDIVIDUAL_EXPORT_PROFILE_V1 = approvedProfile(individual, 'color', 'FRONT');
export const LABEL_BACK_EXPORT_PROFILE_V1 = approvedProfile(sheet, 'original', 'BACK');
export const LABEL_BACK_INDIVIDUAL_EXPORT_PROFILE_V1 = approvedProfile(individual, 'original', 'BACK');
export const LABEL_BLACK_INK_BACK_EXPORT_PROFILE_V1 = approvedProfile(sheet, 'black-ink-transparent', 'BACK');
export const LABEL_BLACK_INK_BACK_INDIVIDUAL_EXPORT_PROFILE_V1 = approvedProfile(individual, 'black-ink-transparent', 'BACK');
export const LABEL_COLOR_BACK_EXPORT_PROFILE_V1 = approvedProfile(sheet, 'color', 'BACK');
export const LABEL_COLOR_BACK_INDIVIDUAL_EXPORT_PROFILE_V1 = approvedProfile(individual, 'color', 'BACK');
export const LABEL_SHEET_EXPORT_PROFILES = Object.freeze([LABEL_EXPORT_PROFILE_V1, LABEL_BLACK_INK_EXPORT_PROFILE_V1,
  LABEL_COLOR_EXPORT_PROFILE_V1, LABEL_BACK_EXPORT_PROFILE_V1, LABEL_BLACK_INK_BACK_EXPORT_PROFILE_V1, LABEL_COLOR_BACK_EXPORT_PROFILE_V1]);
export const LABEL_SINGLE_EXPORT_PROFILES = Object.freeze([LABEL_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1,
  LABEL_COLOR_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_BACK_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_BLACK_INK_BACK_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_COLOR_BACK_INDIVIDUAL_EXPORT_PROFILE_V1]);
export const isApprovedBArtwork = item => typeof item?.printSvg === 'string' && item.printSvg.includes(`data-renderer="${APPROVED_B_MARKER}"`);
export const validateLabelArtwork = item => isApprovedBArtwork(item) ? validateApprovedBArtwork(item) : validateLabelV4Artwork(item);

/** Back and color exports are separate immutable export profiles; the original
 * front bytes remain the source binding, including on a partially filled jig. */
export function renderLabelExportSvg(item, { blackInkTransparent = false, side = 'FRONT', color = false } = {}) {
  if (!['FRONT', 'BACK'].includes(side) || color && blackInkTransparent) throw new Error('LABEL_EXPORT_PROFILE_INVALID');
  if (color && !['gold', 'holo'].includes(item?.previewMaterial)) throw new Error('LABEL_PREVIEW_MATERIAL_INVALID');
  let source = item;
  if (side === 'BACK' || color) {
    if (!isApprovedBArtwork(item)) throw new Error('LABEL_APPROVED_B_REQUIRED');
    validateApprovedBArtwork(item);
  }
  if (side === 'BACK') {
    const printSvg = renderApprovedBBack(); source = { printSvg, artworkHash: approvedBHash(printSvg) };
  }
  const svg = blackInkTransparent ? renderLabelBlackInkSvg(source) : validateLabelArtwork(source);
  return color ? colorApprovedBArtwork(svg, item.previewMaterial, 'COLOR_PRINT') : svg;
}

export function validateLabelV4Artwork({ printSvg, artworkHash }) {
  if (typeof printSvg !== 'string' || Buffer.byteLength(printSvg) > 1024 * 1024 || hash(printSvg) !== artworkHash
      || !/^<svg\s[^>]*data-atlas-artwork="PRINT"[^>]*data-renderer="atlas-v4-outlined-label-v1"[^>]*>/.test(printSvg)
      || !printSvg.includes('width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082"')
      || /<(?:script|image|foreignObject|text|style|linearGradient|radialGradient)\b|\bon\w+\s*=|\b(?:href|src)\s*=|<!/i.test(printSvg)
      || /url\(\s*[^#]/i.test(printSvg)) throw new Error('LABEL_PRINT_ARTWORK_INVALID');
  return printSvg;
}

// Derive an export from the immutable PRINT artwork. White metadata and gray
// fingerprint strokes become foil reveals; their outlined geometry is retained.
// Never reinterpret mask paints or flatten the gray strokes into the black body.
export function renderLabelBlackInkSvg(item) {
  if (isApprovedBArtwork(item)) return renderApprovedBBlackInk(item);
  const svg = validateLabelV4Artwork(item);
  const parts = svg.match(/^(<svg[^>]*>)(<title>[^]*?<\/title>)<defs>([^]*?)<\/defs><g clip-path="url\(#body\)" mask="url\(#ink\)">(<rect width="68\.342" height="20\.082" fill="#000000"\/>)([^]*?)<g data-part="metadata" fill="white">([^]*)<\/g><\/g><\/svg>$/);
  if (!parts || svg.includes('black-ink-detail-knockouts')) throw new Error('LABEL_BLACK_INK_ARTWORK_INVALID');
  const [, root, title, defs, body, gray, metadata] = parts;
  if (!gray.includes('color="#353535"') || [...gray.matchAll(/\b(fill|stroke|color)="([^"]+)"/g)]
    .some(([, name, value]) => !({ fill: ['none'], stroke: ['currentColor'], color: ['#353535'] }[name].includes(value)))) throw new Error('LABEL_BLACK_INK_ARTWORK_INVALID');
  const detail = gray.replaceAll('color="#353535"', 'color="black"');
  const knockout = `<mask id="black-ink-detail-knockouts" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/>${detail}<g data-part="metadata" fill="black">${metadata}</g></mask>`;
  return `${root.replace(' role="img"', ' data-print-mode="BLACK_INK_TRANSPARENT" role="img"')}${title}<defs>${defs}${knockout}</defs><g clip-path="url(#body)" mask="url(#ink)"><g mask="url(#black-ink-detail-knockouts)">${body}</g></g></svg>`;
}

export function renderLabelBlackInkPreviewSvg(item, { previewMaterial = 'gold' } = {}) {
  if (!['gold', 'holo'].includes(previewMaterial)) throw new Error('LABEL_PREVIEW_MATERIAL_INVALID');
  const svg = renderLabelBlackInkSvg(item);
  if (isApprovedBArtwork(item)) return colorApprovedBArtwork(svg, previewMaterial);
  const colors = previewMaterial === 'gold' ? ['#c99c3d', '#ecd296', '#b78b32'] : ['#7ddfe7', '#c8a4ec', '#f1b6d4'];
  const foil = `<linearGradient id="black-ink-preview-foil">${colors.map((color, i) => `<stop offset="${i / 2}" stop-color="${color}"/>`).join('')}</linearGradient>`;
  return svg.replace('data-atlas-artwork="PRINT"', 'data-atlas-artwork="PREVIEW_ONLY"')
    .replace('</defs>', `${foil}</defs><g clip-path="url(#body)"><rect width="68.342" height="20.082" fill="url(#black-ink-preview-foil)"/></g>`);
}

export function renderLabelSheetSvg(items, { blackInkTransparent = false, side = 'FRONT', color = false } = {}) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new Error('LABEL_SHEET_ITEMS_INVALID');
  const seen = new Set();
  const content = [...items].sort((a, b) => a.slot - b.slot).map(item => {
    if (!Number.isInteger(item.slot) || item.slot < 1 || item.slot > 50 || seen.has(item.slot)) throw new Error('LABEL_SLOT_INVALID');
    seen.add(item.slot);
    const original = renderLabelExportSvg(item, { blackInkTransparent, side, color });
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
    ...(exportProfile.printMode ? { printMode: exportProfile.printMode, artworkConversion: exportProfile.artworkConversion, rgbPolicy: exportProfile.rgbPolicy } : {}),
    ...(exportProfile.side ? { side: exportProfile.side } : {}),
    ...(exportProfile.outputMode ? { outputMode: exportProfile.outputMode, materialPolicy: exportProfile.materialPolicy } : {}),
    qualification: exportProfile.qualification, transparentMarginsVerified: false };
}

let pending = 0, previous = Promise.resolve();
async function raster(svg, exportProfile) {
  // At most one bounded native child exists. Sheet strips use small, clipped
  // label tiles at final scale; individual strips and streamed PNG stay intact.
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
  const exportProfile = LABEL_SHEET_EXPORT_PROFILES.find(value => value.id === exportProfileId);
  if (!exportProfile) throw new Error('LABEL_EXPORT_PROFILE_INVALID');
  const mapping = mappingFor(exportProfile, calibrationProfile);
  const svg = renderLabelSheetSvg(items, { blackInkTransparent: exportProfile.printMode === 'BLACK_INK_TRANSPARENT', side: exportProfile.side ?? 'FRONT', color: exportProfile.outputMode === 'COLOR_PRINT' }), result = await raster(svg, exportProfile);
  return { bytes: result.bytes, sha256: result.sha256, manifest: { version: 'atlas-label-png-manifest-v1', ...mapping,
    sha256: result.sha256, byteCount: result.bytes.length, orderedArtwork: [...items].sort((a, b) => a.slot - b.slot).map(({ slot, artworkHash }) => ({ slot, artworkHash })),
    rasterReceipt: result.rasterReceipt } };
}

export async function renderLabelV4Png(item, { exportProfileId = LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.id } = {}) {
  const exportProfile = LABEL_SINGLE_EXPORT_PROFILES.find(value => value.id === exportProfileId);
  if (!exportProfile) throw new Error('LABEL_EXPORT_PROFILE_INVALID');
  const svg = renderLabelExportSvg(item, { blackInkTransparent: exportProfile.printMode === 'BLACK_INK_TRANSPARENT', side: exportProfile.side ?? 'FRONT', color: exportProfile.outputMode === 'COLOR_PRINT' });
  const result = await raster(svg, exportProfile), mapping = mappingFor(exportProfile, null);
  return { bytes: result.bytes, sha256: result.sha256, manifest: { version: 'atlas-label-png-manifest-v1', ...mapping,
    jigHash: null, sha256: result.sha256, byteCount: result.bytes.length, artworkHash: item.artworkHash, rasterReceipt: result.rasterReceipt } };
}
