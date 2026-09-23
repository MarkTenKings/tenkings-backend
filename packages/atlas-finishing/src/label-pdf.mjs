import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import QRCode from 'qrcode';
import { validateManualFinishingPlan } from './manual.mjs';
import { renderManualLabel, MANUAL_LABEL_GEOMETRY, CURRENT_LABEL_LAYOUT } from './label.mjs';
import { LABEL_LOGO_DATA_URI, LABEL_LOGO_SHA256 } from './label-logo.mjs';
import { createManualLabelPdfRenderer as createLegacyRenderer } from './label-pdf-legacy.mjs';

const assert = (value, code) => { if (!value) throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const exact = (value, keys) => assert(value && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'LABEL_PDF_LAYOUT_INVALID');
const VERSION = 'atlas-label-vector-pdf-v2';
const { width, height } = MANUAL_LABEL_GEOMETRY;

function parseLayout(input) {
  exact(input, ['version', 'widthPoints', 'heightPoints', 'pages']);
  assert(input.version === 'atlas-label-sheet-v1' && [input.widthPoints, input.heightPoints].every(value => Number.isFinite(value) && value > 0 && value <= 2160)
    && Array.isArray(input.pages) && input.pages.length > 0 && input.pages.length <= 2, 'LABEL_PDF_LAYOUT_INVALID');
  const faces = [];
  for (const page of input.pages) {
    exact(page, ['placements']);
    assert(Array.isArray(page.placements) && page.placements.length > 0 && page.placements.length <= 2, 'LABEL_PDF_LAYOUT_INVALID');
    for (const placement of page.placements) {
      exact(placement, ['face', 'x', 'y', 'rotation']);
      assert(['FRONT', 'REVERSE'].includes(placement.face) && !faces.includes(placement.face) && [0, 180].includes(placement.rotation)
        && Number.isFinite(placement.x) && Number.isFinite(placement.y) && placement.x >= 0 && placement.y >= 0
        && placement.x + width <= input.widthPoints + 0.000001 && placement.y + height <= input.heightPoints + 0.000001, 'LABEL_PDF_LAYOUT_INVALID');
      faces.push(placement.face);
    }
    if (page.placements.length === 2) {
      const [a, b] = page.placements;
      assert(a.x + width <= b.x || b.x + width <= a.x || a.y + height <= b.y || b.y + height <= a.y, 'LABEL_PDF_LABELS_OVERLAP');
    }
  }
  assert(faces.length === 2, 'LABEL_PDF_BOTH_FACES_REQUIRED');
  return structuredClone(input);
}

/** A concrete deterministic renderer. Media placement is explicitly configured
 * and physically qualified outside this module; no printer/feed is guessed.
 * It renders the SAME SVG layout as the browser: vector text and the original
 * raster logo. Checked standard fonts refuse unsupported identity glyphs.
 * Unsupported scripts fail visibly; no replacement glyph or name truncation.
 */
export function createManualLabelPdfRenderer({ layout, palette = 'NOIR_GOLD', layoutVersion = CURRENT_LABEL_LAYOUT }) {
  // Render profile and PDF bytes are part of durable CUPS custody. An existing
  // v1 station must retain the original generator, including its metadata.
  if (layoutVersion === 'atlas-noir-gold-v1') return createLegacyRenderer({ layout, palette });
  assert(layoutVersion === CURRENT_LABEL_LAYOUT, 'LABEL_PDF_LAYOUT_VERSION_INVALID');
  const selected = parseLayout(layout);
  // V2 is the owner's exact supplied full-color logo/black-and-gold artwork.
  // Refuse unsupported palettes during setup, before a station can look ready.
  assert(palette === 'NOIR_GOLD', 'MANUAL_LABEL_PALETTE_INVALID');
  const profileHash = sha(stable({ version: VERSION, layout: selected, palette, fonts: ['Helvetica', 'Times-Roman'], logoSha256: LABEL_LOGO_SHA256, pdfkit: '0.17.2', svgToPdfkit: '0.1.8', qrcode: '1.5.4' }));
  const render = async plan => {
    plan = structuredClone(plan); validateManualFinishingPlan(plan);
    assert(plan.label.layoutVersion === CURRENT_LABEL_LAYOUT, 'LABEL_PDF_LAYOUT_VERSION_MISMATCH');
    const document = new PDFDocument({ autoFirstPage: false, compress: false, margin: 0,
      info: { Title: `ATLAS ${plan.label.reportNumber} v${plan.label.approvalVersion}`, Author: 'ATLAS Grading',
        Creator: VERSION, Producer: VERSION, Subject: `${plan.planHash}:${profileHash}`,
        CreationDate: new Date('2000-01-01T00:00:00Z'), ModDate: new Date('2000-01-01T00:00:00Z') } });
    const chunks = [], finished = new Promise((resolve, reject) => {
      document.on('data', chunk => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject);
    });
    // The helper is pinned to PDFKit's AFM standard-font implementation.
    const measureText = (text, size, weight, fontFamily = '') => {
      const times = fontFamily.includes('Times');
      document.font(times ? weight >= 700 ? 'Times-Bold' : 'Times-Roman' : weight >= 700 ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      assert(document._font.font.glyphsForString(text).every(glyph => glyph !== '.notdef'), 'LABEL_PDF_FONT_UNSUPPORTED');
      return document.widthOfString(text);
    };
    try {
      const qr = plan.label.layoutVersion === 'atlas-noir-gold-v1' ? QRCode.create(plan.label.url, { errorCorrectionLevel: 'M' }).modules : undefined;
      const svg = renderManualLabel({ label: plan.label, measureText, qr, palette });
      for (const page of selected.pages) {
        document.addPage({ size: [selected.widthPoints, selected.heightPoints], margin: 0 });
        for (const placement of page.placements) {
          document.save(); document.translate(placement.x, placement.y);
          if (placement.rotation === 180) document.translate(width, height).rotate(180);
          // SVG-to-PDFKit resolves explicit inch units at 96 SVG units/in even
          // with assumePt. Our viewBox is in 72pt/in; normalize only the root
          // viewport or the right/bottom of an otherwise correct PDF is cut off.
          const face = (placement.face === 'FRONT' ? svg.front : svg.reverse)
            .replace('width="2.73in" height="0.83in"', `width="${width}" height="${height}"`);
          SVGtoPDF(document, face, 0, 0, {
            width, height, assumePt: true,
            fontCallback: (family, bold, italic) => { assert(!italic, 'LABEL_PDF_FONT_UNSUPPORTED'); return family.includes('Times') ? bold ? 'Times-Bold' : 'Times-Roman' : bold ? 'Helvetica-Bold' : 'Helvetica'; },
            warningCallback: () => { throw new Error('LABEL_PDF_RENDER_WARNING'); },
            imageCallback: source => { assert(source === LABEL_LOGO_DATA_URI, 'LABEL_PDF_EXTERNAL_RESOURCE_REJECTED'); return Buffer.from(LABEL_LOGO_DATA_URI.split(',')[1], 'base64'); },
            documentCallback: () => { throw new Error('LABEL_PDF_EXTERNAL_RESOURCE_REJECTED'); },
          });
          document.restore();
        }
      }
      document.end();
      const bytes = await finished;
      assert(bytes.length <= 8 * 1024 * 1024, 'LABEL_PDF_TOO_LARGE');
      return { bytes, sha256: sha(bytes), planHash: plan.planHash, layoutVersion: plan.label.layoutVersion, renderProfileHash: profileHash };
    } catch (error) {
      document.destroy(error); await finished.catch(() => {}); throw error;
    }
  };
  return Object.assign(render, { profileHash });
}
