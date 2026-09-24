// Browser-safe deterministic SVG renderer. Text measurement and QR generation are
// injected by the existing browser/printer adapter; no remote font/image needed.
export const MANUAL_LABEL_GEOMETRY = Object.freeze({ widthInches: 2.73, heightInches: 0.83, width: 196.56, height: 59.76,
  nfcReserve: Object.freeze({ x: 134.25, y: 14.29, width: 31.18, height: 31.18, diameterMm: 11, guideDiameterMm: 9, cx: 149.84, cy: 29.88 }) });
const fail = code => { throw new Error(code); };
const text = (value, max, nullable = false) => (nullable && value === null) || typeof value === 'string'
  && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
export function validateManualLabel(label) {
  if (label?.version !== 'atlas-manual-label-v1' || label.layoutVersion !== 'atlas-noir-gold-v1'
    || !['PRODUCTION', 'LOCAL_FIXTURE'].includes(label.mode) || !['SPORTS', 'POKEMON'].includes(label.cardProfile)
    || !/^ar_[A-Za-z0-9_-]{24}$/.test(label.publicToken) || !/^ATLAS-[A-F0-9]{12}$/.test(label.reportNumber)
    || !Number.isSafeInteger(label.approvalVersion) || label.approvalVersion < 1 || label.approvalVersion > 2147483647
    || label.url !== `https://atlasgrading.com/reports/${label.publicToken}?v=${label.approvalVersion}`
    || !Number.isFinite(label.finalGrade) || label.finalGrade < 0 || label.finalGrade > 10 || !Number.isInteger(label.finalGrade * 2)
    || label.finalGradePolicy !== 'atlas-final-half-point-v1') fail('MANUAL_LABEL_INVALID');
  const identity = label.identity, sports = label.cardProfile === 'SPORTS';
  const required = sports ? ['playerName', 'year', 'manufacturer', 'productSet'] : ['cardName', 'year', 'productSet'];
  const optional = sports ? ['parallel', 'insert', 'cardNumber'] : ['parallel', 'cardNumber'];
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || required.some(key => !text(identity[key], key === 'year' ? 24 : 180))
    || optional.some(key => identity[key] !== '' && !text(identity[key], 120, true))
    || Object.keys(identity).some(key => ![...required, ...optional, ...(!sports ? ['layoutType'] : [])].includes(key))
    || !sports && identity.layoutType !== undefined && !['POKEMON', 'TRAINER', 'ENERGY'].includes(identity.layoutType)) fail('MANUAL_LABEL_IDENTITY_INVALID');
  return label;
}
function fit(paragraphs, measureText, width, height) {
  if (typeof measureText !== 'function') fail('MANUAL_LABEL_MEASUREMENT_REQUIRED');
  for (let step = 0; step <= 9; step++) {
    const size = 6.8 - step * 0.2, leading = size + 1.2, lines = []; let invalid = false;
    for (const [index, paragraph] of paragraphs.entries()) {
      let line = ''; const weight = index === 0 ? 700 : 400;
      for (const word of paragraph.split(/\s+/u)) {
        const measured = measureText(word, size, weight);
        if (!Number.isFinite(measured) || measured < 0 || measured > width) { invalid = true; break; }
        if (line && measureText(`${line} ${word}`, size, weight) > width) { lines.push({ text: line, weight }); line = word; }
        else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push({ text: line, weight });
    }
    if (!invalid && lines.length * leading <= height) return { lines, size, leading };
  }
  fail('MANUAL_LABEL_IDENTITY_REQUIRES_LAYOUT');
}
function qrPath(qr) {
  if (!qr || !Number.isInteger(qr.size) || qr.size < 21 || qr.size > 61 || typeof qr.get !== 'function') fail('MANUAL_LABEL_QR_INVALID');
  let path = '';
  for (let row = 0; row < qr.size; row++) for (let column = 0; column < qr.size; column++) {
    const dark = qr.get(row, column); if (![true, false, 0, 1].includes(dark)) fail('MANUAL_LABEL_QR_INVALID');
    if (dark) path += `M${column + 4} ${row + 4}h1v1h-1z`;
  }
  return path;
}
export function renderManualLabel({ label, measureText, qr, palette = 'NOIR_GOLD' }) {
  validateManualLabel(label);
  if (!['NOIR_GOLD', 'MONOCHROME'].includes(palette)) fail('MANUAL_LABEL_PALETTE_INVALID');
  const g = MANUAL_LABEL_GEOMETRY, color = palette === 'NOIR_GOLD' ? { bg: '#111211', ink: '#f5eedc', gold: '#d2b26b', muted: '#c7bfa9' }
    : { bg: '#ffffff', ink: '#111111', gold: '#111111', muted: '#333333' };
  const id = label.identity, paragraphs = [label.cardProfile === 'SPORTS' ? id.playerName : id.cardName,
    [id.year, id.manufacturer, id.productSet].filter(Boolean).join(' '), [id.parallel, id.insert, id.cardNumber ? `#${id.cardNumber}` : null].filter(Boolean).join(' ')].filter(Boolean);
  const fitted = fit(paragraphs, measureText, 81.5, 39), fixture = label.mode === 'LOCAL_FIXTURE';
  const title = `ATLAS ${label.reportNumber}, approved version ${label.approvalVersion}, grade ${label.finalGrade}${fixture ? ', example only' : ''}`;
  const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="2.73in" height="0.83in" viewBox="0 0 ${g.width} ${g.height}" role="img"><title>${esc(title)}</title><rect x=".25" y=".25" width="196.06" height="59.26" fill="${color.bg}" stroke="${color.gold}" stroke-width=".5"/><g font-family="Arial,Helvetica,sans-serif">${content}</g></svg>`;
  const front = svg(`<path d="M3 3H193.56M3 56.76H193.56" stroke="${color.gold}" stroke-width=".45"/>
    <g text-anchor="middle" fill="${color.gold}"><text x="22" y="27" font-size="10.5" font-weight="700" letter-spacing=".6">ATLAS</text><text x="22" y="35" font-size="4" letter-spacing="1.2">GRADING</text></g>
    <path d="M44 8V49M132.5 8V49" stroke="${color.gold}" stroke-width=".45"/>
    <g text-anchor="middle" fill="${color.ink}">${fitted.lines.map((line, index) => `<text x="88.75" y="${7 + (39 - fitted.lines.length * fitted.leading) / 2 + fitted.size + index * fitted.leading}" font-size="${fitted.size}" font-weight="${line.weight}">${esc(line.text)}</text>`).join('')}</g>
    <circle cx="149.84" cy="29.88" r="12.7559055" fill="none" stroke="${color.gold}" stroke-width=".4" stroke-dasharray="1.3 1.8"/>
    <text x="149.84" y="31.5" text-anchor="middle" fill="${color.muted}" font-size="4.5" letter-spacing=".7">NFC</text>
    <text x="181.35" y="37" text-anchor="middle" fill="${color.gold}" font-size="${String(label.finalGrade).length > 2 ? 16 : 23}" font-weight="700">${label.finalGrade}</text>
    <text x="181.35" y="46" text-anchor="middle" fill="${color.muted}" font-size="3.4" letter-spacing=".65">GRADE</text>
    <text x="98.28" y="53.9" text-anchor="middle" fill="${color.muted}" font-size="4.5" letter-spacing=".15">${label.reportNumber} · v${label.approvalVersion}${fixture ? ' · EXAMPLE' : ''}</text>`);
  const reverse = svg(`<g fill="${color.gold}"><text x="7" y="17" font-size="11" font-weight="700" letter-spacing="1.5">ATLAS</text><text x="7" y="25" font-size="4.1" letter-spacing="1.1">THE GRADE. THE EVIDENCE.</text></g>
    <g fill="${color.ink}"><text x="7" y="37" font-size="6.4">${label.reportNumber}</text><text x="7" y="46" font-size="5.2">Approved report · version ${label.approvalVersion}</text></g>
    <text x="7" y="54" fill="${color.muted}" font-size="4.6">${fixture ? 'EXAMPLE ONLY · NOT ISSUED' : 'atlasgrading.com'}</text>
    <svg x="137" y="4" width="51.76" height="51.76" viewBox="0 0 ${qr.size + 8} ${qr.size + 8}" shape-rendering="crispEdges"><rect width="${qr.size + 8}" height="${qr.size + 8}" fill="#fff"/><path d="${qrPath(qr)}" fill="#000"/></svg>`);
  return Object.freeze({ front, reverse, widthInches: g.widthInches, heightInches: g.heightInches, url: label.url, palette });
}
