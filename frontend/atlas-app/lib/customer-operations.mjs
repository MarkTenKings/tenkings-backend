const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const custodyNames = Object.freeze({ COLLECTED: 'Collected from kiosk', ATLAS_RECEIVED: 'Received by ATLAS', RETURN_DISPATCHED: 'Dispatched to kiosk', RETURNED_TO_KIOSK: 'Received back at kiosk', CUSTOMER_COLLECTED: 'Collected by customer', MAIL_DISPATCHED: 'Mailed to customer', CUSTOMER_DELIVERED: 'Delivered to customer', DELAY_REPORTED: 'Delay reported', DELAY_RESOLVED: 'Delay resolved', DEPOSIT_DECLARED: 'Customer declared deposit' });
export const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export async function returnLabelBytes(label, orderId, subtle = globalThis.crypto.subtle) {
  const invalid = () => { throw new Error('The saved return label could not be verified. Refresh the order or contact an administrator.'); };
  if (label?.orderId !== orderId || label.leg !== 'RETURN' || label.mimeType !== 'application/pdf'
    || !(label.bytes instanceof Uint8Array) || label.bytes.length > 4 * 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(label.labelSha256 ?? '')) invalid();
  const bytes = label.bytes;
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') invalid();
  const hash = Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== label.labelSha256) invalid();
  return bytes;
}
export function availableCustody(card) {
  const physical = (card.events ?? []).filter(event => !['DEPOSIT_DECLARED', 'DELAY_REPORTED', 'DELAY_RESOLVED'].includes(event.kind)).at(-1)?.kind;
  const next = !physical ? (card.channel === 'KIOSK' ? 'COLLECTED' : 'ATLAS_RECEIVED')
    : physical === 'COLLECTED' ? 'ATLAS_RECEIVED'
    : physical === 'ATLAS_RECEIVED' && card.manualCardId && card.grading === 'HUMAN_APPROVED' ? (card.channel === 'KIOSK' ? 'RETURN_DISPATCHED' : 'MAIL_DISPATCHED')
    : physical === 'RETURN_DISPATCHED' ? 'RETURNED_TO_KIOSK'
    : physical === 'RETURNED_TO_KIOSK' ? 'CUSTOMER_COLLECTED'
    : physical === 'MAIL_DISPATCHED' ? 'CUSTOMER_DELIVERED' : null;
  return [...(next ? [next] : []), 'DELAY_REPORTED', 'DELAY_RESOLVED'];
}
export function isoDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error('Enter the actual date and time.');
  return new Date(value).toISOString();
}
export function localDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function newLocation() {
  return { id: '', dealerId: '', enabled: false, name: '', address: { line1: '', city: '', region: '', postalCode: '', country: 'US' }, position: { lat: '', lng: '' }, schedule: { timeZone: '', pickups: [], returns: [], exceptions: [] }, terminalId: '', terminalLocationId: '', packagePrinterId: '', entryToken: '', authorizedUntil: '' };
}
export function locationForm(row) {
  return { id: row.id, dealerId: row.dealer_id, expectedRevision: row.revision, enabled: row.enabled, name: row.name, address: { ...row.address }, position: { lat: String(row.latitude), lng: String(row.longitude) }, schedule: structuredClone(row.schedule), terminalId: row.terminal_id ?? '', terminalLocationId: row.terminal_location_id ?? '', packagePrinterId: row.package_printer_id ?? '', entryToken: row.entry_token, authorizedUntil: localDate(row.authorized_until) };
}
const text = (v, label, max = 300) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Enter ${label}.`); return v.trim(); };
const id = (v, label) => { if (!uuid.test(v ?? '')) throw new Error(`Enter the exact ${label} UUID.`); return v; };
const time = (v, label) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '')) throw new Error(`Enter ${label}.`); return v; };
export function locationInput(form, randomUUID) {
  const schedule = form.schedule;
  try { new Intl.DateTimeFormat('en-US', { timeZone: schedule.timeZone }).format(); } catch { throw new Error('Enter a valid IANA schedule time zone.'); }
  if (!schedule.timeZone || !schedule.pickups.length || !schedule.returns.length) throw new Error('Add the actual pickup and return schedule.');
  const slots = (rows, pickup) => {
    if (new Set(rows.map(row => String(row.weekday))).size !== rows.length) throw new Error('Enter only one weekly time for each day.');
    return rows.map(row => {
      if (!/^[0-6]$/.test(String(row.weekday))) throw new Error('Choose a day for each schedule entry.');
      const result = { weekday: Number(row.weekday), time: time(row.time, 'the scheduled time'), ...(pickup ? { cutoff: time(row.cutoff, 'the submission cutoff') } : {}) };
      if (pickup && result.cutoff > result.time) throw new Error('The submission cutoff must be at or before pickup.');
      return result;
    });
  };
  if (schedule.exceptions.length > 100 || new Set(schedule.exceptions.map(row => `${row.date}:${row.kind}`)).size !== schedule.exceptions.length) throw new Error('Use at most 100 exceptions, with one entry for each date and schedule.');
  const exceptions = schedule.exceptions.map(row => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(new Date(`${row.date}T00:00:00Z`).getTime()) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date || !['pickups', 'returns'].includes(row.kind)) throw new Error('Complete the exception date and schedule.');
    const result = { date: row.date, kind: row.kind, cancelled: !!row.cancelled, reason: text(row.reason, 'the exception reason', 240), ...(!row.cancelled ? { time: time(row.time, 'the exception time'), ...(row.kind === 'pickups' ? { cutoff: time(row.cutoff, 'the exception cutoff') } : {}) } : {}) };
    if (!result.cancelled && result.kind === 'pickups' && result.cutoff > result.time) throw new Error('The exception cutoff must be at or before pickup.');
    return result;
  });
  const lat = Number(form.position.lat), lng = Number(form.position.lng);
  if (form.position.lat === '' || form.position.lng === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Enter the actual latitude and longitude.');
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(form.entryToken)) throw new Error('Generate or enter a valid kiosk entry token.');
  const address = Object.fromEntries(['line1', 'city', 'region', 'postalCode', 'country'].map(k => [k, text(form.address[k], `the ${k === 'line1' ? 'street address' : k}`, 180)]));
  if (!/^[A-Z]{2}$/.test(address.country)) throw new Error('Enter the two-letter country code.');
  const equipment = {};
  for (const [key, label] of [['terminalId', 'the linked terminal ID'], ['terminalLocationId', 'the terminal location ID'], ['packagePrinterId', 'the package printer ID']]) {
    const value = form[key];
    if (value == null || typeof value === 'string' && !value.trim()) continue;
    equipment[key] = text(value, label, 160);
  }
  return { id: form.id ? id(form.id, 'location') : randomUUID(), dealerId: id(form.dealerId, 'dealer'), ...(form.expectedRevision ? { expectedRevision: form.expectedRevision } : {}), enabled: !!form.enabled, name: text(form.name, 'the kiosk name', 160), address, position: { lat, lng }, schedule: { timeZone: schedule.timeZone, pickups: slots(schedule.pickups, true), returns: slots(schedule.returns, false), exceptions }, ...equipment, entryToken: form.entryToken, authorizedUntil: isoDate(form.authorizedUntil) };
}
export function custodyInput(card, form, randomUUID, now = Date.now()) {
  if (!form.confirmed || !availableCustody(card).includes(form.kind)) throw new Error('Confirm the actual event before recording it.');
  const occurredAt = isoDate(form.occurredAt);
  if (new Date(occurredAt).getTime() > now) throw new Error('A custody event must have already happened.');
  return { cardId: id(card.cardId, 'customer card'), requestId: randomUUID(), kind: form.kind, occurredAt, evidence: { reference: text(form.reference, 'the physical evidence reference'), ...(form.note?.trim() ? { note: text(form.note, 'a note of at most 500 characters', 500) } : {}), ...(form.kind === 'DELAY_REPORTED' && form.expectedReturnAt ? { expectedReturnAt: isoDate(form.expectedReturnAt) } : {}) } };
}
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const equal = (a, b) => canonical(a) === canonical(b);
const sameTime = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
export function operationRecorded(data, journal) {
  if (!data || !journal) return false;
  const { action, input, staffId } = journal;
  const card = (data.orders ?? []).flatMap(order => order.cards ?? []).find(row => row.cardId === input.cardId);
  if (action === 'custody') return !!card?.custodyEvents?.some(event => event.requestId === input.requestId && event.actorId === staffId && event.kind === input.kind && sameTime(event.occurredAt, input.occurredAt) && equal(event.evidence, input.evidence));
  if (action === 'bind-manual') return card?.manualCardId === input.manualCardId;
  if (action === 'membership-configure') return !!data.memberships?.some(row => row.accountId === input.accountId && row.locationId === input.locationId && row.version === journal.priorVersion + 1 && (row.revokedAt === null) === input.enabled);
  if (action === 'location-configure') {
    const row = data.locations?.find(value => value.id === input.id);
    return !!row && row.revision === (input.expectedRevision ?? 0) + 1 && row.dealer_id === input.dealerId && row.enabled === input.enabled && row.name === input.name && equal(row.address, input.address) && Number(row.latitude) === input.position.lat && Number(row.longitude) === input.position.lng && equal(row.schedule, input.schedule) && (row.terminal_id ?? null) === (input.terminalId ?? null) && (row.terminal_location_id ?? null) === (input.terminalLocationId ?? null) && (row.package_printer_id ?? null) === (input.packagePrinterId ?? null) && row.entry_token === input.entryToken && sameTime(row.authorized_until, input.authorizedUntil);
  }
  return false;
}
export function browserJournal(storage, staffId) {
  const key = `atlas-customer-operations:v1:${id(staffId, 'staff')}`;
  return { key, read() {
    const saved = storage.getItem(key); if (!saved) return null;
    let row; try { row = JSON.parse(saved); } catch { throw new Error('The saved operation cannot be read. Keep this browser journal and contact an administrator.'); }
    if (row.version !== 1 || row.staffId !== staffId || !['custody', 'bind-manual', 'membership-configure', 'location-configure'].includes(row.action) || !row.input || typeof row.input !== 'object' || saved.length > 24000) throw new Error('The saved operation needs administrator review.');
    if (row.action === 'custody' && (!uuid.test(row.input.requestId) || !uuid.test(row.input.cardId) || !custodyNames[row.input.kind] || !row.input.evidence || typeof row.input.evidence.reference !== 'string')) throw new Error('The saved custody request needs administrator review.');
    return row;
  }, save(row) { const value = JSON.stringify(row); storage.setItem(key, value); if (storage.getItem(key) !== value) throw new Error('The browser could not retain this operation. Nothing was sent.'); }, clear() { storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error('The browser journal could not be cleared. Refresh saved status.'); } };
}
export async function journalLock(navigator, key, work) {
  if (!navigator.locks?.request) throw new Error('Use a browser that supports safe operation locking before recording changes.');
  return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) throw new Error('This staff operation is open in another tab. Wait, then refresh saved status.');
    return work();
  });
}
export const operationsMessage = error => ({ FRESH_HUMAN_OPERATIONS_REQUIRED: 'Kiosk setup and dealer access require an existing operations grant and a sign-in from the last five minutes. Sign in again; an administrator must provision the grant if it is missing.', LOCATION_REVISION_CHANGED: 'This location changed. Load its latest configuration before editing again.', PHYSICAL_RECEIPT_AND_CARD_ACCESS_REQUIRED: 'Record actual ATLAS receipt and choose a grading card you can access.', CUSTODY_TRANSITION_INVALID: 'That event is not available in the saved custody sequence. Refresh the latest record.', CUSTODY_EVENT_ORDER: 'The actual event time is earlier than the last recorded custody event.', STAFF_REQUIRED: 'Customer operations requires a reviewer staff account.', REQUEST_OUTCOME_UNCONFIRMED: 'The reply was lost. The exact operation is retained. Check saved status before any retry.', REQUEST_CONFLICT: 'The saved request conflicts with an existing record. Keep the journal and contact an administrator.' }[error.code] ?? (error.status ? 'The server refused this operation. Check the saved record and entered details.' : error.message ?? 'The operation could not be confirmed.'));
