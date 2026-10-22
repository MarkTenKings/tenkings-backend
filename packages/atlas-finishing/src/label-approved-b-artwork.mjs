import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../assets/approved-b/', import.meta.url);
export const APPROVED_B_ASSETS = JSON.parse(readFileSync(new URL('manifest.json', root)));
export const approvedBHash = value => createHash('sha256').update(value).digest('hex');
export const APPROVED_B_LAYOUT = 'atlas-approved-b-v1';
export const APPROVED_B_MARKER = 'atlas-approved-b-label-v1';
export const approvedBColors = Object.freeze({ gold: '#cfad58', holo: '#bacbd1' });
const images = {};
for (const name of ['front-black.png', 'front-support-white.png', 'front-support-black.png', 'back-black.png']) {
  const bytes = readFileSync(new URL(name, root));
  if (approvedBHash(bytes) !== APPROVED_B_ASSETS.files[name]?.sha256) throw new Error('APPROVED_B_ASSET_HASH_MISMATCH');
  images[name] = `<image width="68.342" height="20.082" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const opening = (purpose, side) => `<svg xmlns="http://www.w3.org/2000/svg" width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082" data-atlas-artwork="${purpose}" data-renderer="${APPROVED_B_MARKER}" data-side="${side}" role="img">`;
const mask = (id, content) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/>${content}</mask>`;

/** Only pinned, already rendered package pixels enter this SVG. The supplied
 * filter-heavy masters are not reinterpreted by a different raster engine. */
export function buildApprovedBFront({ title, cutouts, support }) {
  return `${opening('PRINT', 'FRONT')}<title>${escape(title)}</title><defs>${mask('approved-cutouts', `<g fill="black">${cutouts}</g>`)}</defs><g mask="url(#approved-cutouts)">${images['front-black.png']}</g><g id="approved-support" fill="white">${images['front-support-white.png']}${support}</g></svg>`;
}

export function validateApprovedBArtwork({ printSvg, artworkHash }) {
  const fail = () => { throw new Error('LABEL_PRINT_ARTWORK_INVALID'); };
  if (typeof printSvg !== 'string' || Buffer.byteLength(printSvg) > 1048576 || approvedBHash(printSvg) !== artworkHash
    || ![opening('PRINT', 'FRONT'), opening('PRINT', 'BACK')].some(prefix => printSvg.startsWith(prefix))) fail();
  let safe = printSvg;
  for (const [name, serialized] of Object.entries(images)) {
    const occurrences = safe.split(serialized).length - 1;
    if (occurrences > 1 || name === 'front-support-black.png' && occurrences) fail();
    safe = safe.replace(serialized, '');
  }
  // A known image URI is allowed only by exact serialized-byte equality above.
  // Historical V4 validation remains vector-only and unchanged.
  if (/<!|\bon\w+\s*=|\b(?:href|src|style)\s*=|url\(\s*[^#]/i.test(safe)) fail();
  const tags = [...safe.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)].map(match => match[1]);
  if (tags.some(tag => !['svg', 'title', 'defs', 'mask', 'rect', 'g', 'path'].includes(tag))) fail();
  if (printSvg.startsWith(opening('PRINT', 'FRONT'))) {
    if (!printSvg.includes(images['front-black.png']) || !printSvg.includes(images['front-support-white.png'])
      || printSvg.includes(images['back-black.png']) || !printSvg.includes('<g id="approved-support" fill="white">')) fail();
  } else if (printSvg !== renderApprovedBBack()) fail();
  return printSvg;
}

export function renderApprovedBBlackInk(item) {
  const svg = validateApprovedBArtwork(item);
  if (svg.includes('data-side="BACK"')) return svg;
  const match = svg.match(/<g id="approved-support" fill="white">([^]*)<\/g><\/svg>$/);
  if (!match) throw new Error('LABEL_BLACK_INK_ARTWORK_INVALID');
  const support = match[1].replace(images['front-support-white.png'], images['front-support-black.png']);
  return svg.slice(0, match.index).replace('</defs>', `${mask('approved-support-knockout', `<g fill="black">${support}</g>`)}</defs>`)
    .replace('<g mask="url(#approved-cutouts)">', '<g mask="url(#approved-support-knockout)"><g mask="url(#approved-cutouts)">') + '</g></svg>';
}

export function colorApprovedBArtwork(svg, previewMaterial = 'gold', purpose = 'PREVIEW_ONLY') {
  const color = approvedBColors[previewMaterial];
  if (!color || !['PREVIEW_ONLY', 'COLOR_PRINT'].includes(purpose)) throw new Error('LABEL_PREVIEW_MATERIAL_INVALID');
  return svg.replace('data-atlas-artwork="PRINT"', `data-atlas-artwork="${purpose}"`)
    .replace('</title>', `</title><rect width="68.342" height="20.082" fill="${color}"/>`);
}

export function renderApprovedBBack({ previewMaterial = null, purpose = 'PREVIEW_ONLY' } = {}) {
  const svg = `${opening('PRINT', 'BACK')}<title>ATLAS shared back; website QR https://atlasgrading.com/</title>${images['back-black.png']}</svg>`;
  return previewMaterial ? colorApprovedBArtwork(svg, previewMaterial, purpose) : svg;
}
