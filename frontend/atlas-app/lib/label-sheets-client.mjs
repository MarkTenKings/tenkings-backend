/** Browser-only label sheet API. No allocation, artwork rendering or hardware effects. */
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
export const LABEL_SHEETS_PATH = '/api/staff/manual-connected/label-sheets';
export const LABEL_ITEMS_PATH = '/api/staff/manual-connected/labels';
export const LABEL_INDIVIDUAL_PROFILE = 'atlas-v4-individual-2400ppi-v1';
export const LABEL_EXPORT_PROFILE = 'atlas-v4-sheet-800ppi-diagnostic-v2';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'LABEL_REPLY_INVALID') => { if (!value) throw fail(code); };
export const labelName = item => item?.snapshot?.identity?.playerName || item?.snapshot?.identity?.cardName || item?.identity?.playerName || item?.identity?.cardName || 'Approved card';
export const labelSheetName = sheet => sheet?.number == null ? 'Saved sheet' : `Sheet ${String(sheet.number).padStart(3, '0')}`;
export function labelArtworkHref(item, basePath = '', mode = 'preview') {
  if (!uuid(item?.itemId) || !['preview', 'print'].includes(mode) || item?.state !== 'READY') return null;
  return `${basePath}${LABEL_ITEMS_PATH}/${item.itemId}/artwork?mode=${mode}`;
}
export function labelSheetMessage(error) {
  return ({
    LABEL_JIG_CHANGED: 'The saved jig layout differs from this application. Reload the current ATLAS version before previewing or exporting.',
    LABEL_SHEETS_UNAVAILABLE: 'Label sheets are not enabled here yet. Your approved reports and existing NFC tools remain available.',
    LABEL_EXPORT_UNAVAILABLE: 'Sheet export is unavailable. Your saved sheet is retained.',
    LABEL_SHEET_STALE: 'This sheet changed. Its current positions have been refreshed; review them before exporting.',
    LABEL_SHEET_REVISION_STALE: 'This sheet changed. Its current positions have been refreshed; review them before exporting.',
    LABEL_REVISION_CHANGED: 'This sheet changed. Its current positions have been refreshed; review them before exporting.',
    LABEL_SOURCE_SUPERSEDED: 'An approval on this sheet changed. Use the current approved label before printing.',
    LABEL_SOURCE_CHANGED: 'The approved report changed. Refresh and use its current saved label.',
    LABEL_PUBLISHED_PRODUCTION_REQUIRED: 'This label requires the current published production report.',
    LABEL_EXPORT_RETRY_LIMIT: 'This export needs staff attention after repeated failures. Its frozen sheet remains saved.',
    LABEL_EXPORT_CHANGED: 'The saved export changed. Refresh its status before downloading.',
    LABEL_REPRINT_SOURCE_INVALID: 'The original label is no longer ready for a replacement. Refresh its saved status.',
    LABEL_LAYOUT_ALREADY_RETRIED: 'A new layout attempt already exists. Refresh labels to view its progress.',
    LABEL_LAYOUT_RETRY_UNAVAILABLE: 'This label cannot be retried from its current state. Refresh its saved status.',
    LABEL_LAYOUT_RETRY_LIMIT: 'This label still needs a layout correction after repeated attempts. Its approved report is retained.',
    LABEL_FAILURE_CHANGED: 'This label changed. Refresh before retrying its layout.',
    LABEL_RENDERER_CHANGED: 'The label layout was updated. Refresh before retrying.',
    LABEL_PROFILE_INVALID: 'This saved export used an older print profile. Refresh labels and prepare a new export.',
    LABEL_ITEM_NOT_FOUND: 'This label is no longer available. Refresh to view the current labels.',
    LABEL_SHEET_NOT_FOUND: 'This sheet is no longer available. Refresh to view the current sheets.',
    LABEL_EXPORT_NOT_FOUND: 'This export is no longer available. Refresh and prepare a new export.',
    LABEL_NOT_READY: 'The label is still preparing or needs attention. Refresh its saved status.',
    LABEL_SHEET_NOT_READY: 'This sheet is not ready to export. Check its saved label statuses.',
    LABEL_EXPORT_NOT_READY: 'The saved export is still preparing or changed. Refresh its status before downloading.',
    LABEL_ACCESS_DENIED: 'Your current access does not permit this label action.',
    LABEL_REQUEST_CONFLICT: 'The saved request conflicts with a recorded action. Refresh the saved sheet before continuing.',
    LABEL_NEEDS_LAYOUT: 'The complete approved identity needs a reviewed label layout.',
    LABEL_STORAGE_UNAVAILABLE: 'The browser could not retain this request. Enable local storage before trying again.',
    LABEL_REQUEST_PENDING: 'A saved request needs to finish before another change. Retry the saved request below.',
    LABEL_REQUEST_CHANGED: 'Another tab changed the saved request. Reload to see its current state.',
    LABEL_REPLY_INVALID: 'ATLAS could not verify the reply. Your request is retained; retry the same saved request.',
    LABEL_DOWNLOAD_INVALID: 'ATLAS could not verify this download. Request the saved file again.',
    LABEL_ACCESS_CHANGED: 'Access to a card on this sheet changed. Refresh before continuing.',
  })[error?.code];
}
export function createLabelSheetsClient({ staffId, csrf, request, storage, cryptoImpl = globalThis.crypto }) {
  check(typeof staffId === 'string' && staffId && typeof csrf === 'string' && csrf && typeof request === 'function', 'MANUAL_STAFF_CHANGED');
  const key = `atlas-label-sheets:${staffId}:pending`;
  let active = false;
  const readRaw = () => { try { return storage.getItem(key); } catch { throw fail('LABEL_STORAGE_UNAVAILABLE'); } };
  const pending = () => {
    const raw = readRaw(); if (!raw) return null;
    let saved; try { saved = JSON.parse(raw); } catch { throw fail('LABEL_REQUEST_CHANGED'); }
    check(saved?.version === 1 && saved.staffId === staffId && uuid(saved.body?.requestId)
      && ['export', 'individual-export', 'print', 'reprint', 'layout-retry', 'download', 'individual-download'].includes(saved.kind)
      && validPath(saved), 'LABEL_REQUEST_CHANGED');
    return saved;
  };
  const save = saved => {
    try { const raw = JSON.stringify(saved); storage.setItem(key, raw); check(storage.getItem(key) === raw, 'LABEL_STORAGE_UNAVAILABLE'); }
    catch { throw fail('LABEL_STORAGE_UNAVAILABLE'); }
  };
  const clear = saved => {
    if (readRaw() === JSON.stringify(saved)) {
      try { storage.removeItem(key); } catch { throw fail('LABEL_STORAGE_UNAVAILABLE'); }
    }
  };
  const exclusive = async operation => {
    check(!active, 'LABEL_REQUEST_PENDING'); active = true;
    try { return await operation(); } finally { active = false; }
  };
  const commit = async saved => {
    check(saved && JSON.stringify(pending()) === JSON.stringify(saved), 'LABEL_REQUEST_CHANGED');
    let result;
    try { result = await request(saved.path, { method: 'POST', csrf, body: saved.body }); }
    catch (error) {
      // These named CAS refusals occur before reservation. Unknown outcomes keep
      // the exact intent, including across reload and other-tab completion.
      const definiteConflict = error?.status === 409 && ['LABEL_SHEET_STALE', 'LABEL_SHEET_REVISION_STALE', 'LABEL_REQUEST_CONFLICT', 'LABEL_REVISION_CHANGED', 'LABEL_SOURCE_SUPERSEDED', 'LABEL_SHEET_NOT_READY', 'LABEL_EXPORT_NOT_READY', 'LABEL_ACCESS_DENIED', 'LABEL_SOURCE_CHANGED', 'LABEL_PUBLISHED_PRODUCTION_REQUIRED', 'LABEL_EXPORT_RETRY_LIMIT', 'LABEL_EXPORT_CHANGED', 'LABEL_REPRINT_SOURCE_INVALID', 'LABEL_NOT_READY'].includes(error.code);
      const unavailableSource = error?.status === 404 && ['LABEL_EXPORT_NOT_FOUND', 'LABEL_ITEM_NOT_FOUND', 'LABEL_SHEET_NOT_FOUND', 'MANUAL_CARD_NOT_FOUND'].includes(error.code) || error?.status === 410 && error.code === 'INTAKE_CARD_DELETED' || error?.status === 403 && error.code === 'LABEL_ACCESS_DENIED';
      const rejectedLayout = saved.kind === 'layout-retry' && error?.status === 409 && ['LABEL_LAYOUT_ALREADY_RETRIED', 'LABEL_LAYOUT_RETRY_UNAVAILABLE', 'LABEL_LAYOUT_RETRY_LIMIT', 'LABEL_FAILURE_CHANGED', 'LABEL_RENDERER_CHANGED'].includes(error.code);
      const rejectedProfile = ['export', 'individual-export'].includes(saved.kind) && error?.status === 400 && error.code === 'LABEL_PROFILE_INVALID';
      if (definiteConflict || unavailableSource || rejectedLayout || rejectedProfile) clear(saved);
      throw error;
    }
    validateResult(saved, result);
    clear(saved);
    return { kind: saved.kind, result, ...(saved.kind === 'individual-export' ? { itemId: saved.path.split('/').at(-2) } : {}) };
  };
  const mutate = (kind, path, body) => exclusive(async () => {
    check(!pending(), 'LABEL_REQUEST_PENDING');
    const saved = { version: 1, staffId, kind, path, body: { requestId: cryptoImpl.randomUUID(), ...body } };
    check(validPath(saved), 'LABEL_REPLY_INVALID'); save(saved); return commit(saved);
  });
  return Object.freeze({
    pending,
    list: async ({ cursor = 0, ...options } = {}) => {
      check(Number.isSafeInteger(cursor) && cursor >= 0);
      const result = await request(`${LABEL_SHEETS_PATH}${cursor ? `?cursor=${cursor}` : ''}`, options);
      check(result?.version === 'atlas-label-sheets-v1' && Array.isArray(result.sheets) && Array.isArray(result.pending));
      result.sheets.forEach(sheet => { check(uuid(sheet.sheetId) && Number.isInteger(sheet.revision) && sheet.capacity === 50); check(sheet.jigHash === LABEL_JIG_V1.jigHash, 'LABEL_JIG_CHANGED'); });
      return result;
    },
    sheet: async (sheetId, options) => {
      check(uuid(sheetId));
      const result = await request(`${LABEL_SHEETS_PATH}/${sheetId}`, options);
      check(result?.sheetId === sheetId && Number.isInteger(result.revision) && result.capacity === 50 && Array.isArray(result.items));
      check(result.jigHash === LABEL_JIG_V1.jigHash, 'LABEL_JIG_CHANGED');
      const slots = result.items.map(item => item.slot);
      check(new Set(slots).size === slots.length && slots.every(slot => Number.isInteger(slot) && slot >= 1 && slot <= 50));
      return result;
    },
    exportSheet: sheet => {
      check(uuid(sheet?.sheetId) && Number.isInteger(sheet.revision));
      return mutate('export', `${LABEL_SHEETS_PATH}/${sheet.sheetId}/exports`, { expectedSheetRevision: sheet.revision, exportProfileId: LABEL_EXPORT_PROFILE });
    },
    downloadSheet: (sheet, output) => {
      check(uuid(sheet?.sheetId) && uuid(output?.exportId) && output.state === 'READY' && hash(output.sha256));
      return mutate('download', `${LABEL_SHEETS_PATH}/${sheet.sheetId}/exports/${output.exportId}/download`, { expectedExportSha256: output.sha256 });
    },
    exportLabel: item => {
      check(uuid(item?.itemId) && item.state === 'READY' && hash(item.labelHash));
      return mutate('individual-export', `${LABEL_ITEMS_PATH}/${item.itemId}/exports`, { expectedLabelHash: item.labelHash, exportProfileId: LABEL_INDIVIDUAL_PROFILE });
    },
    readLabelExport: async (itemId, exportId) => {
      check(uuid(itemId) && uuid(exportId)); const result = await request(`${LABEL_ITEMS_PATH}/${itemId}/exports/${exportId}`);
      check(result?.itemId === itemId && result.exportId === exportId && ['PREPARING', 'READY', 'FAILED'].includes(result.state)); return result;
    },
    downloadLabel: (item, output) => {
      check(uuid(item?.itemId) && uuid(output?.exportId) && output.state === 'READY' && hash(output.sha256));
      return mutate('individual-download', `${LABEL_ITEMS_PATH}/${item.itemId}/exports/${output.exportId}/download`, { expectedExportSha256: output.sha256 });
    },
    recordPrint: (sheet, output, successfulSlots) => {
      check(uuid(sheet?.sheetId) && uuid(output?.exportId) && output.state === 'READY' && hash(output.sha256) && hash(output.manifestHash));
      const occupied = new Set(sheet.items.map(item => item.slot));
      check(Array.isArray(successfulSlots) && successfulSlots.length > 0 && new Set(successfulSlots).size === successfulSlots.length && successfulSlots.every(slot => occupied.has(slot)));
      return mutate('print', `${LABEL_SHEETS_PATH}/${sheet.sheetId}/print-confirmations`, { exportId: output.exportId, exportSha256: output.sha256, manifestHash: output.manifestHash,
        successfulSlots: [...successfulSlots].sort((a, b) => a - b), failedSlots: [] });
    },
    reprint: (item, reason) => {
      check(uuid(item?.itemId) && hash(item.labelHash) && typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 500);
      return mutate('reprint', `${LABEL_ITEMS_PATH}/${item.itemId}/reprints`, { expectedLabelHash: item.labelHash, reason: reason.trim() });
    },
    retryLayout: (item, rendererProfileHash) => {
      check(uuid(item?.itemId) && item.state === 'NEEDS_LAYOUT' && ['ORIGINAL', 'LAYOUT_RETRY'].includes(item.purpose)
        && hash(item.failureHash) && hash(rendererProfileHash));
      return mutate('layout-retry', `${LABEL_ITEMS_PATH}/${item.itemId}/layout-retries`, {
        expectedFailureHash: item.failureHash, expectedRendererProfileHash: rendererProfileHash,
      });
    },
    resume: () => exclusive(() => commit(pending())),
  });
}
function validPath(saved) {
  const id = '[0-9a-f-]{36}';
  const patterns = {
    export: `${LABEL_SHEETS_PATH}/${id}/exports`, print: `${LABEL_SHEETS_PATH}/${id}/print-confirmations`,
    download: `${LABEL_SHEETS_PATH}/${id}/exports/${id}/download`,
    reprint: `${LABEL_ITEMS_PATH}/${id}/reprints`, 'individual-export': `${LABEL_ITEMS_PATH}/${id}/exports`, 'individual-download': `${LABEL_ITEMS_PATH}/${id}/exports/${id}/download`,
    'layout-retry': `${LABEL_ITEMS_PATH}/${id}/layout-retries`,
  };
  return typeof saved.path === 'string' && Boolean(patterns[saved.kind]) && new RegExp(`^${patterns[saved.kind]}$`, 'i').test(saved.path);
}
function validateResult(saved, result) {
  if (saved.kind.endsWith('download') || saved.kind === 'download') {
    let url; try { url = new URL(result?.url); } catch { throw fail('LABEL_DOWNLOAD_INVALID'); }
    check(url.protocol === 'https:' && !url.username && !url.password && Number.isFinite(Date.parse(result.expiresAt)) && Date.parse(result.expiresAt) > Date.now(), 'LABEL_DOWNLOAD_INVALID');
  } else if (saved.kind === 'export' || saved.kind === 'individual-export') {
    check(uuid(result?.exportId) && ['PREPARING', 'READY', 'FAILED'].includes(result.state));
  } else if (saved.kind === 'print') {
    check(result && (uuid(result.eventId) || uuid(result.printEventId)) && result.exportId === saved.body.exportId);
  } else if (saved.kind === 'reprint') check(uuid(result?.itemId));
  else if (saved.kind === 'layout-retry') check(uuid(result?.itemId) && result.itemId !== result.originalItemId
    && result.originalItemId === saved.path.split('/').at(-2) && result.purpose === 'LAYOUT_RETRY'
    && ['PENDING_RENDER', 'READY', 'NEEDS_LAYOUT', 'SUPERSEDED'].includes(result.state));
}
