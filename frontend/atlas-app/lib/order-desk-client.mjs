import { staffApiPath } from './routes.mjs';

export const ORDER_DESK_BASE = 'manual-connected/order-desk';
export const ORDER_DESK_POLL_MS = 30_000;
export const ORDER_STAGES = Object.freeze([
  ['ARRIVAL', 'Awaiting arrival'], ['RECEIVED', 'Received'],
  ['GRADING_REVIEW', 'Grading & review'], ['FINISHING_PACKING', 'Finishing & packing'],
  ['RETURNING', 'Return mailed'], ['COMPLETE', 'Delivered'],
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const validOrderId = value => typeof value === 'string' && uuid.test(value);
export const stageLabel = value => ORDER_STAGES.find(([key]) => key === value)?.[1] ?? ({ WAITING_FOR_ARRIVAL: 'Awaiting arrival', GRADING: 'In grading', HUMAN_REVIEW: 'Human review', FINISHING: 'Finishing', READY_FOR_RETURN: 'Ready for return', ATTENTION: 'Needs attention', MIXED: 'Mixed card stages' }[value] ?? 'Stage not available');
export function orderDeskPath({ q = '', stage = 'all', view = 'all', cursor, limit = 30 } = {}) {
  const search = new URLSearchParams();
  if (q.trim()) search.set('q', q.trim().slice(0, 120));
  if (stage !== 'all') search.set('stage', stage);
  search.set('view', view === 'new' ? 'new' : 'all');
  search.set('limit', String(limit));
  if (cursor) search.set('cursor', cursor);
  return `${ORDER_DESK_BASE}?${search}`;
}
export function orderDetailPath(id) {
  if (!validOrderId(id)) throw new Error('The saved order reference is invalid.');
  return `${ORDER_DESK_BASE}/orders/${id}`;
}
export function orderPhotoPath(orderId, cardId, side = 'FRONT', size = 'thumbnail') {
  if (!validOrderId(orderId) || !validOrderId(cardId) || !['FRONT', 'BACK'].includes(side) || !['thumbnail', 'detail'].includes(size)) return null;
  return staffApiPath(`${orderDetailPath(orderId)}/cards/${cardId}/photos/${side}?size=${size}`);
}
export const orderMoney = (cents, currency = 'USD') => {
  if (!Number.isSafeInteger(cents)) return 'Not recorded';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100); }
  catch { return 'Not recorded'; }
};
export const orderDate = value => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const cardTitle = card => card?.identity?.title || card?.identity?.cardName || card?.identity?.playerName || 'Card identity not recorded';
export const cardSubtitle = card => [card?.identity?.year, card?.identity?.productSet, card?.identity?.cardNumber].filter(Boolean).join(' · ');
export function mergeOrderPage(current, incoming, append = false) {
  const rows = append ? [...(current ?? []), ...(incoming ?? [])] : incoming ?? [];
  return [...new Map(rows.map(row => [row.id, row])).values()];
}
export const isAccessFailure = error => error?.status === 401 || error?.status === 403;
export function orderDeskMessage(error) {
  if (isAccessFailure(error)) return 'Your staff access needs to be checked. Sign in again before continuing.';
  if (error?.code === 'ORDER_NOT_FOUND') return 'This paid order is no longer available to this staff account.';
  if (error?.code === 'REQUEST_CONFLICT') return 'This acknowledgment conflicts with the saved request. Keep the retained request and check the saved order.';
  return error?.message && !error?.status ? error.message : 'The saved order could not be read. Your selection and entered details are kept.';
}

// Acknowledgment is a shared team fact. A read never writes it, and an uncertain
// reply keeps the same request identity across navigation, tabs and reloads.
export function acknowledgmentJournal(storage, staffId) {
  if (!validOrderId(staffId)) throw new Error('The reviewer identity is invalid.');
  const key = `atlas-order-acknowledgment:v1:${staffId}`;
  const validate = row => {
    if (row?.version !== 1 || row.staffId !== staffId || !validOrderId(row.orderId) || !validOrderId(row.requestId) || typeof row.accepted !== 'boolean') throw new Error('The retained acknowledgment needs review. Keep this browser’s saved request.');
    return row;
  };
  return { key,
    read() {
      const value = storage.getItem(key); if (!value) return null;
      if (value.length > 2000) throw new Error('The retained acknowledgment needs review.');
      let row; try { row = JSON.parse(value); } catch { throw new Error('The retained acknowledgment could not be read. Keep this browser’s saved request.'); }
      return validate(row);
    },
    save(row) { const value = JSON.stringify(validate(row)); storage.setItem(key, value); if (storage.getItem(key) !== value) throw new Error('This browser could not retain the acknowledgment. Nothing was sent.'); },
    clear() { storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error('The saved acknowledgment could not be cleared. Check its saved status.'); },
  };
}
export function acknowledgmentConfirmed(order) {
  return !!order?.acknowledgment?.acknowledgedAt && validOrderId(order.acknowledgment.acknowledgedBy?.id);
}
export function retainedSelection(storage, staffId, orderId) {
  const key = `atlas-order-selection:v1:${staffId}`;
  if (orderId !== undefined) { if (validOrderId(orderId)) storage.setItem(key, orderId); return orderId; }
  const value = storage.getItem(key); return validOrderId(value) ? value : null;
}

export async function orderLabelBytes(label, orderId, leg, subtle = globalThis.crypto.subtle) {
  const invalid = () => { throw new Error('The saved shipping label could not be verified. Refresh its saved status.'); };
  if (!validOrderId(orderId) || !['INBOUND', 'RETURN'].includes(leg) || label?.orderId !== orderId || label.leg !== leg || label.mimeType !== 'application/pdf' || !(label.bytes instanceof Uint8Array) || label.bytes.length > 4 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(label.labelSha256 ?? '')) invalid();
  if (String.fromCharCode(...label.bytes.subarray(0, 5)) !== '%PDF-') invalid();
  const hash = Array.from(new Uint8Array(await subtle.digest('SHA-256', label.bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== label.labelSha256) invalid();
  return label.bytes;
}
