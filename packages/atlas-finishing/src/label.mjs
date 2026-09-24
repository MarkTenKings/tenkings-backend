import { renderManualLabel as renderLegacy, validateManualLabel as validateLegacy, MANUAL_LABEL_GEOMETRY } from './label-legacy.mjs';
import { validateLabelDesign } from './label-design.mjs';
import { LABEL_LOGO_DATA_URI } from './label-logo.mjs';
export { MANUAL_LABEL_GEOMETRY } from './label-legacy.mjs';

export const CURRENT_LABEL_LAYOUT = 'atlas-signature-v2';
const fail = code => { throw new Error(code); };
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const number = value => Number(value.toFixed(4));
export function validateManualLabel(label) {
  if (label?.layoutVersion === 'atlas-noir-gold-v1') return validateLegacy(label);
  if (label?.layoutVersion !== CURRENT_LABEL_LAYOUT) fail('MANUAL_LABEL_INVALID');
  validateLegacy({ ...label, layoutVersion: 'atlas-noir-gold-v1' });
  validateLabelDesign(label.design); return label;
}
const family = font => font === 'Times-Bold' ? 'Times New Roman,Times,serif' : 'Arial,Helvetica,sans-serif';

function fitLines(value, { maximum, minimum, tracking, font, maxLines, width, measureText }) {
  const measure = (text, size) => {
    const result = measureText(text, size, 700, family(font)) + Math.max(0, [...text].length - 1) * tracking;
    if (!Number.isFinite(result) || result < 0) fail('MANUAL_LABEL_MEASUREMENT_REQUIRED');
    return result;
  };
  for (let size = maximum; size >= minimum - 0.001; size = number(size - 0.1)) {
    const lines = []; let line = '', valid = true;
    for (const word of value.split(/\s+/u)) {
      if (measure(word, size) > width) { valid = false; break; }
      if (line && measure(`${line} ${word}`, size) > width) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    if (valid && lines.length <= maxLines) return { lines, size, leading: number(size * 1.06) };
  }
  fail('MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT');
}

export function renderManualLabel({ label, measureText, qr, palette = 'NOIR_GOLD' }) {
  validateManualLabel(label);
  // Preserve saved v1 artwork and its QR; a v2 design never silently repaints
  // an existing print intent. New labels intentionally have a plain black back.
  if (label.layoutVersion === 'atlas-noir-gold-v1') return renderLegacy({ label, measureText, qr, palette });
  if (palette !== 'NOIR_GOLD') fail('MANUAL_LABEL_PALETTE_INVALID');
  if (typeof measureText !== 'function') fail('MANUAL_LABEL_MEASUREMENT_REQUIRED');
  const d = label.design, g = MANUAL_LABEL_GEOMETRY, id = label.identity;
  const name = label.cardProfile === 'SPORTS' ? id.playerName : id.cardName;
  // Do not infer a variant from the set/year/card number. Base/null is absent.
  const parallel = [...new Set([id.parallel, id.insert].filter(value => value && !/^(base|base card|none|n\/a)$/i.test(value)))].join(' · ') || null;
  const variant = parallel ? fitLines(parallel, { maximum: d.variantSize, minimum: d.variantMinSize,
    tracking: d.variantTracking, font: 'Helvetica-Bold', maxLines: 2, width: 80.5, measureText }) : null;
  let fitted;
  for (let max = d.nameSize; max >= d.nameMinSize - 0.001; max = number(max - 0.1)) {
    fitted = fitLines(name, { maximum: max, minimum: d.nameMinSize, tracking: d.nameTracking,
      font: d.nameFont, maxLines: 2, width: 80.5, measureText });
    if (fitted.lines.length * fitted.leading + (variant ? variant.lines.length * variant.leading + 3 : 0) <= 39) break;
    fitted = null;
  }
  if (!fitted) fail('MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT');
  const total = fitted.lines.length * fitted.leading + (variant ? variant.lines.length * variant.leading + 3 : 0);
  const start = 7 + (39 - total) / 2, fixture = label.mode === 'LOCAL_FIXTURE';
  const title = `ATLAS ${name}, approved version ${label.approvalVersion}, grade ${label.finalGrade}${fixture ? ', example only' : ''}`;
  const svg = (content, accessibleTitle) => `<svg xmlns="http://www.w3.org/2000/svg" width="2.73in" height="0.83in" viewBox="0 0 ${g.width} ${g.height}" role="img"><title>${esc(accessibleTitle)}</title>${content}</svg>`;
  const front = svg(`<rect width="${g.width}" height="${g.height}" fill="#000000"/>
    <rect x=".25" y=".25" width="196.06" height="59.26" fill="none" stroke="${d.accentColor}" stroke-width=".5"/>
    <path d="M3 3H193.56M3 56.76H193.56M44 8V49M132.5 8V49" stroke="${d.accentColor}" stroke-width=".45"/>
    <svg x="4.5" y="9" width="35.5" height="36" viewBox="98 190 1058 866" preserveAspectRatio="xMidYMid meet"><image width="1254" height="1254" href="${LABEL_LOGO_DATA_URI}"/></svg>
    <g text-anchor="middle" font-weight="700" font-family="${family(d.nameFont)}" fill="${d.nameColor}" letter-spacing="${d.nameTracking}">${fitted.lines.map((line, i) => `<text x="88.25" y="${number(start + fitted.size + i * fitted.leading)}" font-size="${fitted.size}">${esc(line)}</text>`).join('')}</g>
    ${variant ? `<g text-anchor="middle" font-weight="700" font-family="Arial,Helvetica,sans-serif" fill="${d.accentColor}" letter-spacing="${d.variantTracking}">${variant.lines.map((line, i) => `<text x="88.25" y="${number(start + fitted.lines.length * fitted.leading + 3 + variant.size + i * variant.leading)}" font-size="${variant.size}">${esc(line)}</text>`).join('')}</g>` : ''}
    <g font-family="Arial,Helvetica,sans-serif"><circle cx="149.84" cy="29.88" r="12.7559055" fill="none" stroke="${d.accentColor}" stroke-width=".4" stroke-dasharray="1.3 1.8"/>
    <text x="149.84" y="31.5" text-anchor="middle" fill="#c7bfa9" font-size="4.5" letter-spacing=".7">NFC</text>
    <text x="181.35" y="37" text-anchor="middle" fill="${d.accentColor}" font-size="${String(label.finalGrade).length > 2 ? 16 : 23}" font-weight="700">${label.finalGrade}</text>
    <text x="181.35" y="46" text-anchor="middle" fill="#c7bfa9" font-size="3.4" letter-spacing=".65">GRADE</text>
    <text x="98.28" y="53.9" text-anchor="middle" fill="#c7bfa9" font-size="4.5" letter-spacing=".15">${label.reportNumber} · v${label.approvalVersion}${fixture ? ' · EXAMPLE' : ''}</text></g>`, title);
  const reverse = svg(`<rect width="${g.width}" height="${g.height}" fill="#000000"/>`, 'Plain black reverse');
  return Object.freeze({ front, reverse, widthInches: g.widthInches, heightInches: g.heightInches, url: label.url, palette });
}
