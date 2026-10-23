import { approvedReportPath, gradedCardPath, submissionOrigin } from './graded-cards-client.mjs';

const invalid = () => Object.assign(new Error('Refresh the archive before exporting these cards.'), { code: 'GRADED_CARDS_EXPORT_INVALID' });
const text = value => {
  if (value == null) return '';
  if (typeof value !== 'string') throw invalid();
  return value;
};
// Quoting keeps commas/newlines in their own cell. The leading apostrophe
// prevents saved names or identifiers from becoming spreadsheet formulas.
const cell = value => {
  const valueText = String(value);
  const inert = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(valueText) ? `'${valueText}` : valueText;
  return `"${inert.replaceAll('"', '""')}"`;
};
const columns = ['Card ID', 'Certificate', 'Card name', 'Category', 'Year', 'Manufacturer', 'Product / set',
  'Parallel', 'Insert', 'Card number', 'ATLAS grade', 'Approved at (UTC)', 'Approver', 'Review staff',
  'Customer name', 'Submission reference', 'Origin / dealer', 'Approved report path'];

/** Only the existing archive projection, in its loaded order. No media URLs,
 * private response extras, ownership/value claims, paging or network calls. */
export function loadedGradedCardsCsv(cards) {
  if (!Array.isArray(cards) || cards.length === 0) throw invalid();
  const seen = new Set();
  const rows = cards.map(card => {
    if (!gradedCardPath(card) || seen.has(card.cardId)) throw invalid();
    seen.add(card.cardId);
    const identity = card.identity ?? {}, report = approvedReportPath(card);
    if (card.report?.state === 'PUBLISHED' && !report) throw invalid();
    if (card.approvedAt != null && (typeof card.approvedAt !== 'string' || !Number.isFinite(Date.parse(card.approvedAt)))) throw invalid();
    if (card.finalGrade != null && !(Number.isFinite(card.finalGrade) && card.finalGrade >= 1 && card.finalGrade <= 10)) throw invalid();
    if (card.reviewers != null && !Array.isArray(card.reviewers)) throw invalid();
    return [card.cardId, text(card.certificateNumber), text(identity.playerName || identity.cardName), text(identity.category),
      ...['year', 'manufacturer', 'productSet', 'parallel', 'insert', 'cardNumber'].map(key => text(identity[key])),
      card.finalGrade ?? '', text(card.approvedAt), text(card.approver?.name), (card.reviewers ?? []).map(person => text(person?.name)).filter(Boolean).join(', '),
      text(card.submission?.customer?.name), text(card.submission?.reference), submissionOrigin(card), report ?? ''];
  });
  return [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Called only after the component's current staff/session and snapshot checks.
export function downloadGradedCardsCsv(csv) {
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = 'atlas-graded-cards-loaded.csv';
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
