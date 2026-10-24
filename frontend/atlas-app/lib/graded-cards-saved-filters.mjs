import { gradedCardsPath } from './graded-cards-client.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const SAVED_ARCHIVE_FILTER_LIMIT = 20;
export function savedArchiveFilterScope(staff) {
  if (!uuid(staff?.id) || staff.role !== 'REVIEWER' || typeof staff.mode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(staff.mode)) fail('SAVED_FILTER_ACCESS_ENDED');
  return { staffId: staff.id, role: staff.role, mode: staff.mode };
}
export function savedArchiveFiltersInput(value) {
  if (!exact(value, ['q', 'category', 'from', 'to']) || Object.values(value).some(x => typeof x !== 'string')
    || value.q.length > 120 || /[\x00-\x1f\x7f]/.test(value.q)) fail('SAVED_FILTER_INVALID');
  const filters = { q: value.q.trim(), category: value.category, from: value.from, to: value.to };
  try { gradedCardsPath(filters); } catch { fail('SAVED_FILTER_INVALID'); }
  return filters;
}
const nameInput = value => {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) fail('SAVED_FILTER_NAME_INVALID');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 48) fail('SAVED_FILTER_NAME_INVALID');
  return name;
};
function validateEnvelope(value, scope) {
  if (!exact(value, ['version', 'scope', 'presets']) || value.version !== 1
    || !exact(value.scope, ['staffId', 'role', 'mode']) || !same(value.scope, scope)
    || !Array.isArray(value.presets) || value.presets.length > SAVED_ARCHIVE_FILTER_LIMIT) fail('SAVED_FILTER_STORAGE_INVALID');
  const ids = new Set(), names = new Set();
  for (const row of value.presets) {
    if (!exact(row, ['id', 'name', 'filters', 'view']) || !uuid(row.id) || ids.has(row.id)
      || !['gallery', 'table'].includes(row.view)) fail('SAVED_FILTER_STORAGE_INVALID');
    let name, filters;
    try { name = nameInput(row.name); filters = savedArchiveFiltersInput(row.filters); } catch { fail('SAVED_FILTER_STORAGE_INVALID'); }
    if (name !== row.name || !same(filters, row.filters) || names.has(name.toLowerCase())) fail('SAVED_FILTER_STORAGE_INVALID');
    ids.add(row.id); names.add(name.toLowerCase());
  }
  return value.presets;
}

/** Local preferences only. This key is namespacing, not an authorization or
 * encryption boundary; the UI separately checks the current staff session. */
export function createSavedArchiveFilters({ staff, storage, locks, randomUUID = () => globalThis.crypto.randomUUID() }) {
  const scope = savedArchiveFilterScope(staff), key = `atlas-graded-cards-filters:v1:${scope.mode}:${scope.role}:${scope.staffId}`;
  const get = () => { try { return storage.getItem(key); } catch { fail('SAVED_FILTER_STORAGE_UNAVAILABLE'); } };
  const read = () => {
    const raw = get(); if (raw === null) return [];
    if (typeof raw !== 'string' || raw.length > 32768) fail('SAVED_FILTER_STORAGE_INVALID');
    let value; try { value = JSON.parse(raw); } catch { fail('SAVED_FILTER_STORAGE_INVALID'); }
    return validateEnvelope(value, scope);
  };
  async function update(authorize, change) {
    if (typeof authorize !== 'function') fail('SAVED_FILTER_ACCESS_ENDED');
    if (typeof locks?.request !== 'function') fail('SAVED_FILTER_LOCK_UNAVAILABLE');
    return locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) fail('SAVED_FILTER_BUSY');
      // Recheck inside the cross-tab lock; a queued operation cannot use an
      // earlier session. No await separates authorization from storage changes.
      const isCurrent = await authorize();
      if (typeof isCurrent !== 'function' || !isCurrent()) fail('SAVED_FILTER_CANCELED');
      const presets = change(read()), serialized = JSON.stringify({ version: 1, scope, presets });
      validateEnvelope(JSON.parse(serialized), scope);
      try { storage.setItem(key, serialized); } catch { fail('SAVED_FILTER_STORAGE_UNAVAILABLE'); }
      if (get() !== serialized) fail('SAVED_FILTER_STORAGE_UNAVAILABLE');
      return presets;
    });
  }
  return { key, read,
    create({ name, filters, view }, authorize) {
      name = nameInput(name); filters = savedArchiveFiltersInput(filters);
      if (!['gallery', 'table'].includes(view)) fail('SAVED_FILTER_INVALID');
      return update(authorize, presets => {
        if (presets.length >= SAVED_ARCHIVE_FILTER_LIMIT) fail('SAVED_FILTER_LIMIT');
        if (presets.some(row => row.name.toLowerCase() === name.toLowerCase())) fail('SAVED_FILTER_NAME_EXISTS');
        const id = randomUUID(); if (!uuid(id) || presets.some(row => row.id === id)) fail('SAVED_FILTER_STORAGE_UNAVAILABLE');
        return [...presets, { id, name, filters, view }];
      });
    },
    remove(id, authorize) {
      if (!uuid(id)) fail('SAVED_FILTER_INVALID');
      return update(authorize, presets => {
        if (!presets.some(row => row.id === id)) fail('SAVED_FILTER_CHANGED');
        return presets.filter(row => row.id !== id);
      });
    },
  };
}
export const savedArchiveFiltersMessage = error => ({
  SAVED_FILTER_ACCESS_ENDED: 'Sign in as the same reviewer to use saved filters.',
  SAVED_FILTER_INVALID: 'Apply valid archive filters before saving.',
  SAVED_FILTER_NAME_INVALID: 'Enter a filter name of 1–48 characters.',
  SAVED_FILTER_NAME_EXISTS: 'That name is already saved. Choose another name.',
  SAVED_FILTER_LIMIT: 'Delete a saved filter before adding another. This browser keeps up to 20.',
  SAVED_FILTER_STORAGE_INVALID: 'Saved filters could not be read. Existing browser data was kept.',
  SAVED_FILTER_STORAGE_UNAVAILABLE: 'This browser could not confirm the saved-filter change. Reload saved filters to check.',
  SAVED_FILTER_LOCK_UNAVAILABLE: 'This browser cannot safely update saved filters. The archive still works.',
  SAVED_FILTER_BUSY: 'Saved filters are being changed in another tab. Try again.',
  SAVED_FILTER_CHANGED: 'That saved filter changed. Reload saved filters.',
}[error?.code] ?? 'Saved filters are unavailable. Try again to check staff access.');
