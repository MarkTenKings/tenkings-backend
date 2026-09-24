import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { readConfirmationFence, validateConfirmationCommit } from '../src/confirmation-fence.mjs';

const progress = (gate, work) => Promise.race([gate, work.then(() => { throw new Error('Owned fixture ended before expected lock checkpoint'); })]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Only the owned PostgreSQL qualification fixture calls this helper. It uses
// synthetic existing fixture rows and the actual restricted serving/receipt
// roles, with no provider, storage operation, live URL or schema change.
export async function runConfirmationFencePostgres({ fixture, connection, reviewer, cardId, repository, input, response }) {
  const before = (await connection.repository.load(reviewer.staff, cardId)).card;
  const checks = [];
  async function prepare() {
    const id = randomUUID(), run = { ...input, analysisId: id, actionId: id, requestHash: digest(id), baseHash: digest(`confirm:${id}`),
      expiresAt: new Date(Date.now() + 120000).toISOString() };
    await repository.prepare(reviewer.staff, run);
    await repository.claim(reviewer.staff, { cardId, analysisId: id, requestHash: run.requestHash });
    await repository.recordReply({ analysisId: id, requestHash: run.requestHash, kind: 'OUTCOME', evidence: {
      state: 'UNKNOWN', responseRef: null, resultRef: null, responseHash: null, providerRequestId: null,
      responseId: null, httpStatus: null, usage: null, code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' } });
    return run;
  }
  const guard = analysis => ({ version: 'atlas-manual-confirmation-fence-v1', analysis, deadlineAt: Date.now() + 15000 });
  const command = { action: { type: 'CONFIRM_FINDINGS' } };
  async function waitForLock(pid) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const [row] = await fixture.admin.$queryRawUnsafe('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1::integer', pid);
      if (row?.wait_event_type === 'Lock') return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`Owned fixture backend ${pid} did not reach the expected database lock`);
  }
  const receipt = (run, onStarted, afterInsert = null) => fixture.admin.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE atlas_fixture_analysis_receipt');
    const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
    onStarted?.resolve(pid);
    await tx.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4)',
      run.analysisId, run.requestHash, 'RESPONSE', canonical(response));
    if (afterInsert) { afterInsert.inserted.resolve(); await afterInsert.release.promise; }
  });

  // Receipt gets KEY SHARE first. Manual FOR UPDATE waits; the separate fresh
  // receipt SELECT must see that committed READY result and reject old guard.
  {
    const run = await prepare(), old = await connection.boundary.transaction(reviewer.staff, ({ tx }) => readConfirmationFence(tx, cardId));
    const inserted = deferred(), release = deferred(), started = deferred();
    const pendingReceipt = receipt(run, null, { inserted, release });
    let pendingManual;
    try {
      await progress(inserted.promise, pendingReceipt);
      pendingManual = connection.boundary.transaction(reviewer.staff, async ({ tx }) => {
        await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', cardId);
        const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'); started.resolve(pid);
        return validateConfirmationCommit({ tx, cardId, input: command, commitGuard: guard(old) });
      });
      const rejected = assert.rejects(pendingManual, { code: 'MANUAL_ASTRA_REVIEW_STALE' });
      await waitForLock(await progress(started.promise, pendingManual)); release.resolve();
      await pendingReceipt; await rejected;
    } finally { release.resolve(); await Promise.allSettled([pendingReceipt, pendingManual].filter(Boolean)); }
    checks.push('confirmation fence serializes late receipts: earlier receipt commits before fresh metadata read and stale confirmation is refused');
  }

  // Manual gets FOR UPDATE first. The receipt function must block on its FK
  // KEY SHARE until the card transaction is finished; there is no gap between
  // the guard check and the protected manual commit interval.
  {
    const run = await prepare(), old = await connection.boundary.transaction(reviewer.staff, ({ tx }) => readConfirmationFence(tx, cardId));
    const protectedCommit = deferred(), release = deferred(), receiptStarted = deferred();
    const pendingManual = connection.boundary.transaction(reviewer.staff, async ({ tx }) => {
      await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', cardId);
      await validateConfirmationCommit({ tx, cardId, input: command, commitGuard: guard(old) });
      protectedCommit.resolve(); await release.promise;
    });
    let pendingReceipt;
    try {
      await progress(protectedCommit.promise, pendingManual);
      pendingReceipt = receipt(run, receiptStarted);
      await waitForLock(await progress(receiptStarted.promise, pendingReceipt)); release.resolve();
      await pendingManual; await pendingReceipt;
      const latest = await connection.boundary.transaction(reviewer.staff, ({ tx }) => readConfirmationFence(tx, cardId));
      assert.equal(latest.responseState, 'READY'); assert.notDeepEqual(latest, old);
    } finally { release.resolve(); await Promise.allSettled([pendingManual, pendingReceipt].filter(Boolean)); }
    checks.push('confirmation fence serializes late receipts: later receipt waits through the protected manual commit interval without extra grants');
  }
  assert.deepEqual((await connection.repository.load(reviewer.staff, cardId)).card, before);
  return checks;
}
