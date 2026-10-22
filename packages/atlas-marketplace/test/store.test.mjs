import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { openLocalStore } from '../src/store.mjs';

test('local persistence rolls back failures and protects immutable financial/event history', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-r2-store-')));
  const options = { filename: join(dir, 'owned.sqlite'), environment: 'SYNTHETIC_LOCAL', clock: () => 1000 };
  try {
    let store = openLocalStore(options);
    store.transaction(tx => { tx.state.journals.push({ id: 'j1', cents: 123 }); tx.emit('test', { id: 'demo_1' }); });
    const saved = store.read();
    assert.throws(() => store.transaction(tx => { tx.state.journals[0].cents = 999; }), { code: 'JOURNAL_MUTATION' });
    assert.throws(() => store.transaction(tx => { tx.state.events = []; }), { code: 'EVENT_MUTATION' });
    assert.throws(() => store.transaction(tx => { tx.state.orders.leaked = {}; throw Error('failure'); }), /failure/);
    assert.throws(() => store.transaction(async tx => { tx.state.orders.leaked = {}; }), { code: 'ASYNC_TRANSACTION_REFUSED' });
    assert.deepEqual(store.read(), saved);
    store.close();
    store = openLocalStore(options);
    assert.deepEqual(store.read(), saved);
    store.close();
    assert.throws(() => openLocalStore({ ...options, environment: 'production' }), { code: 'LOCAL_STORE_ONLY' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('independent Node processes serialize writes to the actual owned database', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-r2-race-')));
  const filename = join(dir, 'owned.sqlite');
  const options = { filename, environment: 'SYNTHETIC_LOCAL' };
  openLocalStore(options).close();
  const code = `import {openLocalStore} from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    const store=openLocalStore({filename:process.argv[1],environment:'SYNTHETIC_LOCAL'});
    for(let i=0;i<15;i++) store.transaction(tx=>{tx.state.count=(tx.state.count??0)+1;tx.emit('race',{i});});store.close();`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, filename], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', exit => exit === 0 ? resolve() : reject(Error(stderr)));
  });
  try {
    await Promise.all([run(), run(), run()]);
    const store = openLocalStore(options);
    assert.equal(store.read().count, 45);
    assert.equal(store.read().events.length, 45);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
