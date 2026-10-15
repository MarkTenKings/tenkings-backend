/** Read-only handoff from fresh, authenticated label-sheet replies. No NFC result is recorded. */
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const check = (value, code = 'NFC_BATCH_INVALID') => { if (!value) throw Object.assign(new Error(code), { code }); };
const safeText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
export function nfcBatchMessage(error) {
  return ({
    NFC_BATCH_INVALID: 'A saved label has incomplete or inconsistent NFC details. No batch was downloaded. Refresh labels before continuing.',
    NFC_BATCH_URL_INVALID: 'A saved report URL does not match its approved version. No batch was downloaded.',
    NFC_BATCH_DUPLICATE: 'More than one current original label refers to the same card or report. No batch was downloaded; review the label queue.',
    NFC_BATCH_SELECTION_INVALID: 'Select at least one card from the current NFC batch.',
    NFC_BATCH_CHANGED: 'The queue changed. Review the refreshed card order and selection before downloading.',
  })[error?.code];
}

export function buildNfcBatch(sheets) {
  check(Array.isArray(sheets));
  const sheetIds = new Set(), sheetNumbers = new Set(), itemIds = new Set(), cards = new Set(), urls = new Set();
  const rows = [], excluded = [];
  for (const sheet of [...sheets].sort((a, b) => a.number - b.number)) {
    check(uuid(sheet?.sheetId) && Number.isSafeInteger(sheet.number) && sheet.number > 0
      && Number.isSafeInteger(sheet.revision) && sheet.revision >= 0 && ['OPEN', 'SEALED'].includes(sheet.state)
      && Array.isArray(sheet.items) && sheet.items.length <= 50 && !sheetIds.has(sheet.sheetId) && !sheetNumbers.has(sheet.number));
    sheetIds.add(sheet.sheetId); sheetNumbers.add(sheet.number);
    const slots = new Set();
    for (const item of [...sheet.items].sort((a, b) => a.slot - b.slot)) {
      check(uuid(item?.itemId) && uuid(item.cardId) && uuid(item.approvalActionId) && item.sheetId === sheet.sheetId
        && Number.isInteger(item.slot) && item.slot >= 1 && item.slot <= 50 && !slots.has(item.slot) && !itemIds.has(item.itemId)
        && ['ORIGINAL', 'REPRINT'].includes(item.purpose));
      slots.add(item.slot); itemIds.add(item.itemId);
      const name = item.snapshot?.identity?.playerName || item.snapshot?.identity?.cardName || 'Approved card';
      const location = { itemId: item.itemId, sheetNumber: sheet.number, slot: item.slot, name };
      if (item.state !== 'READY' || item.purpose === 'REPRINT') {
        check(['READY', 'SUPERSEDED', 'PENDING_RENDER', 'NEEDS_LAYOUT', 'FAILED'].includes(item.state));
        excluded.push({ ...location, reason: item.state === 'SUPERSEDED' ? 'Approval changed' : item.purpose === 'REPRINT' ? 'Replacement label — original card only' : 'Label is not ready' });
        continue;
      }
      check(item.originalItemId == null && /^[a-f0-9]{64}$/.test(item.labelHash ?? '')
        && Number.isSafeInteger(item.approvalVersion) && item.approvalVersion > 0
        && item.snapshot?.approvalVersion === item.approvalVersion && safeText(item.snapshot?.reportNumber) && safeText(name)
        && Number.isFinite(item.snapshot.grade) && item.snapshot.grade >= 0 && item.snapshot.grade <= 10);
      // The endpoint binds this hash-checked snapshot to its card and immutable
      // production approval. Preserve its exact URL; never reconstruct it from a name.
      const href = item.snapshot.reportHref;
      check(typeof href === 'string' && /^https:\/\/atlasgrading\.com\/reports\/ar_[A-Za-z0-9_-]{24}\?v=[1-9][0-9]*$/.test(href)
        && href.endsWith(`?v=${item.approvalVersion}`), 'NFC_BATCH_URL_INVALID');
      check(!cards.has(item.cardId) && !urls.has(href), 'NFC_BATCH_DUPLICATE');
      cards.add(item.cardId); urls.add(href);
      rows.push({ ...location, correlationId: `atlas-${item.itemId}`, cardId: item.cardId, approvalActionId: item.approvalActionId,
        approvalVersion: item.approvalVersion, reportNumber: item.snapshot.reportNumber, reportHref: href, grade: item.snapshot.grade,
        sheetId: sheet.sheetId, labelHash: item.labelHash });
    }
  }
  return { rows, excluded };
}

// GoToTags' published correlated WEBSITE CSV plus its documented extra.* fields:
// https://gitlab.com/gototags/public/-/tree/main/Desktop%20App/NFC/Encoding/Correlated
// https://gitlab.com/gototags/public/-/tree/main/Desktop%20App/NFC/Encoding/Extra
const columns = ['correlationId', 'ndef.lock', 'ndef.records.0.type', 'ndef.records.0.url', 'extra.atlasCardId',
  'extra.atlasApprovalActionId', 'extra.atlasApprovalVersion', 'extra.atlasLabelItemId', 'extra.atlasSheet',
  'extra.atlasPosition', 'extra.atlasCardName', 'extra.atlasReportNumber'];
const cell = value => `"${String(value).replaceAll('"', '""')}"`;
const inertText = value => /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
export function nfcBatchCsv(batch, selectedItemIds) {
  check(Array.isArray(selectedItemIds) && selectedItemIds.length > 0 && new Set(selectedItemIds).size === selectedItemIds.length
    && selectedItemIds.every(id => batch.rows.some(row => row.itemId === id)), 'NFC_BATCH_SELECTION_INVALID');
  const selected = new Set(selectedItemIds), rows = batch.rows.filter(row => selected.has(row.itemId));
  return [columns, ...rows.map(row => [row.correlationId, 'TRUE', 'WEBSITE', row.reportHref, row.cardId,
    row.approvalActionId, row.approvalVersion, row.itemId, row.sheetNumber, row.slot, inertText(row.name), inertText(row.reportNumber)])]
    .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
