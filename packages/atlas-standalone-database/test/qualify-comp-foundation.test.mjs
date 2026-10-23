import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertCompUpgrade, compQualificationDefinition, main, COMP_VERSION } from '../scripts/qualify-comp-foundation.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checksum = 'aa19879134c9ad6261fa33ad96ed0f5be6ee2e498b601c3e2f12deee407fe36a';
function snapshots() {
  const before = { rows: { 'atlas_staff._standalone_migrations': { count: 10, sha256: 'ledger-before' },
    'atlas_manual.approval': { count: 2, sha256: 'actual-old-report-rows' } },
  ledger: [{ version: 'atlas-standalone-010-collection-foundation', checksum: 'retained', applied_at: 'unchanged' },
    { version: 'atlas-standalone-baseline-v1', checksum: 'retained-baseline', applied_at: 'original-baseline-time' }],
  roles: { roles: [{ name: 'retained-role' }], memberships: [] },
  catalog: [{ name: 'routine:existing', value: { owner: 'original', definition: 'original', acl: ['retained'] } }] };
  const after = structuredClone(before);
  after.rows['atlas_staff._standalone_migrations'] = { count: 11, sha256: 'ledger-after' };
  after.rows['atlas_manual.comp_curation'] = { count: 0, sha256: 'empty' };
  after.ledger.splice(1, 0, { version: COMP_VERSION, checksum, applied_at: 'new' });
  after.catalog.push({ name: 'relation:atlas_manual.comp_curation', value: { owner: 'original' } });
  return { before, after };
}

test('qualifier binds exact committed010 prefix and only wrapper-free011 bytes', async () => {
  const { migrations, migration } = await compQualificationDefinition();
  assert.equal(migrations.length, 10);
  assert.equal(migrations[8].sqlSha256, 'a6de21a978dc5b3bb5e21dbdf408d60709fa2c724a3e17376ff11502e6ef42a9');
  assert.equal(migration.sqlSha256, checksum);
});

test('actual upgrade comparator preserves lexical-last baseline while admitting only named011', () => {
  const { before, after } = snapshots(); assert.doesNotThrow(() => assertCompUpgrade(before, after));
  assert.equal(before.ledger.length, 2, 'comparison does not edit the preserved baseline');
  assert.equal(after.ledger.at(-1).version, 'atlas-standalone-baseline-v1');
  assert.deepEqual(after.ledger.at(-1), before.ledger.at(-1));
});

test('actual comparator refuses old row/catalog/ACL/owner/role, seed and ledger drift', () => {
  for (const change of [
    value => { value.rows['atlas_manual.approval'].sha256 = 'changed'; },
    value => { delete value.rows['atlas_manual.approval']; },
    value => { value.rows['atlas_manual.comp_curation'].count = 1; },
    value => { value.rows['unexpected.table'] = { count: 0 }; },
    value => { value.rows['atlas_staff._standalone_migrations'].count = 12; },
    value => { value.ledger[0].applied_at = 'rewritten'; },
    value => { value.ledger.find(row => row.version === COMP_VERSION).checksum = 'unreviewed'; },
    value => { value.ledger.at(-1).applied_at = 'rewritten-baseline-time'; },
    value => { value.ledger.push({ ...value.ledger.find(row => row.version === COMP_VERSION) }); },
    value => { value.ledger.find(row => row.version === COMP_VERSION).version = 'unknown-migration'; },
    value => { value.ledger.splice(0, 1); },
    value => { value.catalog[0].value.owner = 'changed'; },
    value => { value.catalog[0].value.acl.push('widened'); },
    value => { value.catalog[0].value.definition = 'changed'; },
    value => { value.catalog.shift(); },
    value => { value.roles.memberships.push({ member: 'retained-role', role: 'unsafe' }); },
  ]) {
    const { before, after } = snapshots(); change(after); assert.throws(() => assertCompUpgrade(before, after));
  }
});

test('actual preparation is exclusive file-only and wrong execution hash refuses before intent or data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-comp-foundation-plan-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'owned'); await main(['--prepare', output, '52771']);
  const bytes = await readFile(join(output, 'launch-plan.json')), plan = JSON.parse(bytes);
  assert.equal(plan.host, '127.0.0.1'); assert.equal(plan.unixSockets, false);
  assert.equal(plan.groups.length, 6);
  assert(plan.sources.some(ref => ref.path === 'packages/atlas-connected-manual/src/comp-curation-runtime.mjs'));
  assert(plan.sources.some(ref => ref.path === 'frontend/atlas-app/lib/server/staff-comp-curation-private-adapter.mjs'));
  assert.match(plan.groups[3], /native signed read and historical replay/);
  assert.match(plan.nonce, /^[a-f0-9]{32}$/);
  for (const source of plan.sources) assert.equal(sha(await readFile(join(output, 'source-used', source.path.replaceAll('/', '__')))), source.sha256);
  await assert.rejects(main(['--prepare', output, '52771']), { code: 'EEXIST' });
  await assert.rejects(main(['--execute', output, '0'.repeat(64)]), /Exact separately reviewed plan required/);
  assert.deepEqual(await readFile(join(output, 'launch-plan.json')), bytes);
  await assert.rejects(stat(plan.data), { code: 'ENOENT' });
  await assert.rejects(stat(join(output, 'execute-intent.json')), { code: 'ENOENT' });
});
