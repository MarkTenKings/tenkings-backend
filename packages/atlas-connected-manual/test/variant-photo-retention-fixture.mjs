import assert from 'node:assert/strict';
import {createVariantJobStore} from '../src/variant-job-store.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
export function photoCacheDatabase(serialized = null) {
  const rows = new Map(serialized ? JSON.parse(serialized) : []), locks = new Map(), writes = [], lockNames = [];
  let nextId = 0;
  const boundary = { async machineTransaction(_scope, work) {
    const id = ++nextId, held = new Map();
    const tx = {
      async $queryRawUnsafe(sql, key, requiredSha = null) {
        assert.match(sql, /variant_catalog_cache/); await tick();
        let values = [...(rows.get(key) ?? [])];
        if (requiredSha) values = values.filter(row => JSON.parse(row.snapshot).sha256 === requiredSha);
        if (sql.includes('DESC')) values.reverse();
        return values.slice(0, sql.includes('LIMIT 1') ? 1 : 2).map(row => ({...row}));
      },
      async $executeRawUnsafe(sql, ...args) {
        if (sql.includes('pg_advisory_xact_lock')) {
          const name = args[0]; if (held.has(name)) return 1;
          const previous = locks.get(name) ?? Promise.resolve();
          let release; const next = new Promise(resolve => { release = resolve; }); locks.set(name, next);
          await previous; held.set(name, release); lockNames.push({id,name}); return 1;
        }
        assert.match(sql, /^INSERT INTO atlas_manual_connected\.variant_catalog_cache/);
        const [key,snapshot,snapshot_hash,expires_at] = args;
        if (key.startsWith('variant-listing-image-body:v1:'))
          assert(held.has(`atlas-listing-source:${key}`), 'content bodies require the shared per-hash lock');
        await tick(); const records = rows.get(key) ?? [];
        if (records.some(row => row.snapshot_hash === snapshot_hash)) {
          assert(sql.includes('ON CONFLICT'), 'duplicate PK insert without conflict handling'); return 0;
        }
        records.push({snapshot,snapshot_hash,expires_at}); rows.set(key,records); writes.push({key,snapshot,snapshot_hash}); return 1;
      },
    };
    try { return await work({tx}); } finally { for (const release of held.values()) release(); }
  }};
  return { rows, writes, lockNames, boundary, store: createVariantJobStore({boundary}),
    serialized: () => JSON.stringify([...rows]),
    values: () => [...rows.values()].flat().map(row => JSON.parse(row.snapshot)) };
}
