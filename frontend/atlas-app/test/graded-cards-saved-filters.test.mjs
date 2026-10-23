import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSavedArchiveFilters, savedArchiveFiltersInput } from '../lib/graded-cards-saved-filters.mjs';
const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' };
const filters = { q: 'Pikachu', category: 'POKEMON', from: '2026-10-01', to: '2026-10-22' };
const authorized = async () => () => true;
function fixture() {
  const data = new Map(), writes = [], locks = { request: async (key, options, work) => { assert.equal(options.mode, 'exclusive'); assert.equal(options.ifAvailable, true); return work({ name: key }); } };
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes.push({ key, value }); data.set(key, value); } };
  return { data, writes, storage, locks, store: createSavedArchiveFilters({ staff, storage, locks, randomUUID }) };
}
test('presets persist only the exact named filters/view under the reviewer and mode key; reads never write', async () => {
  const f = fixture(); assert.deepEqual(f.store.read(), []); assert.equal(f.writes.length, 0);
  const first = await f.store.create({ name: '  Pokémon this month  ', filters, view: 'table' }, authorized);
  assert.equal(first[0].name, 'Pokémon this month'); assert.deepEqual(first[0].filters, filters);
  const another = createSavedArchiveFilters({ staff, storage: f.storage, locks: f.locks });
  assert.deepEqual(another.read(), first); assert.equal(f.writes.length, 1);
  for (const change of [{ id: randomUUID() }, { mode: 'PRODUCTION' }]) {
    const other = createSavedArchiveFilters({ staff: { ...staff, ...change }, storage: f.storage, locks: f.locks });
    assert.deepEqual(other.read(), []); assert.notEqual(other.key, f.store.key);
  }
  assert.deepEqual(await another.remove(first[0].id, authorized), []); assert.equal(f.writes.length, 2);
  assert.throws(() => createSavedArchiveFilters({ staff: { ...staff, role: 'OBSERVER' }, storage: f.storage, locks: f.locks }));
});
test('strict query/schema validation refuses truncation, injected fields, invalid dates, wrong scope and corrupt storage without rewriting', async () => {
  for (const value of [{ ...filters, q: 'x'.repeat(121) }, { ...filters, q: 'x\n' }, { ...filters, cursor: 'other' }, { ...filters, category: 'OTHER' }, { ...filters, from: '2026-02-30' }, { ...filters, from: '2026-10-23' }]) assert.throws(() => savedArchiveFiltersInput(value));
  const f = fixture(); await f.store.create({ name: 'Good', filters, view: 'gallery' }, authorized);
  const valid = f.data.get(f.store.key), envelope = JSON.parse(valid);
  const bad = ['not JSON', 'x'.repeat(32769), JSON.stringify({ ...envelope, version: 2 }), JSON.stringify({ ...envelope, scope: { ...envelope.scope, staffId: randomUUID() } }), JSON.stringify({ ...envelope, presets: [...envelope.presets, ...envelope.presets] }), JSON.stringify({ ...envelope, extra: true })];
  for (const raw of bad) { f.data.set(f.store.key, raw); assert.throws(() => f.store.read()); await assert.rejects(() => f.store.create({ name: 'New', filters, view: 'table' }, authorized)); assert.equal(f.data.get(f.store.key), raw); }
  assert.equal(f.writes.length, 1);
});
test('names and the20-preset bound are enforced; updates preserve another tab’s latest entries', async () => {
  const f = fixture(), other = createSavedArchiveFilters({ staff, storage: f.storage, locks: f.locks });
  const initial = await f.store.create({ name: 'One', filters, view: 'gallery' }, authorized);
  await other.create({ name: 'Two', filters, view: 'table' }, authorized);
  assert.deepEqual((await f.store.remove(initial[0].id, authorized)).map(x => x.name), ['Two']);
  await assert.rejects(() => f.store.create({ name: 'two', filters, view: 'table' }, authorized), { code: 'SAVED_FILTER_NAME_EXISTS' });
  for (const name of ['', 'x'.repeat(49), 'bad\nname']) assert.throws(() => f.store.create({ name, filters, view: 'gallery' }, authorized));
  for (let n = 2; n <= 20; n++) await f.store.create({ name: 'Preset '+n, filters, view: 'gallery' }, authorized);
  await assert.rejects(() => f.store.create({ name: 'Overflow', filters, view: 'gallery' }, authorized), { code: 'SAVED_FILTER_LIMIT' });
  assert.equal(f.store.read().length, 20);
});
test('lock contention, unavailable storage, denied or stale session and quota failure never report a successful mutation', async () => {
  const f = fixture(); let checks = 0;
  const blocked = createSavedArchiveFilters({ staff, storage: f.storage, locks: { request: async (_key, _options, work) => work(null) } });
  await assert.rejects(() => blocked.create({ name: 'One', filters, view: 'gallery' }, async () => { checks++; return () => true; }), { code: 'SAVED_FILTER_BUSY' }); assert.equal(checks, 0);
  await assert.rejects(() => createSavedArchiveFilters({ staff, storage: f.storage }).create({ name: 'One', filters, view: 'gallery' }, authorized), { code: 'SAVED_FILTER_LOCK_UNAVAILABLE' });
  await assert.rejects(() => f.store.create({ name: 'One', filters, view: 'gallery' }, async () => { throw { status: 401 }; }));
  await assert.rejects(() => f.store.create({ name: 'One', filters, view: 'gallery' }, async () => () => false), { code: 'SAVED_FILTER_CANCELED' });
  assert.equal(f.writes.length, 0);
  const quota = createSavedArchiveFilters({ staff, storage: { ...f.storage, setItem() { throw Error('quota'); } }, locks: f.locks });
  await assert.rejects(() => quota.create({ name: 'One', filters, view: 'gallery' }, authorized), { code: 'SAVED_FILTER_STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.store.read(), []);
});
