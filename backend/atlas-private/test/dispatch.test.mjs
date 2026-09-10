import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createPrivateOperatorHost, dispatchHost } from '../src/operator-host.mjs';
import { assertPrivateProcess } from '../src/process.mjs';

function fixture() {
    const runId = randomUUID(), commandId = randomUUID(), cardId = randomUUID(), results = [];
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const value = { runId, commandId, request: { runId, commandId }, cardId, calls: [], state: 'ADMITTED', finish: resolve, results };
    value.host = dispatchHost({ onResult: result => { if (value.loggerFails) throw new Error('log unavailable'); results.push(result); }, async makeDispatcher() {
        return { async admit({ runId: selected, commandId: command }) { value.calls.push(['admit', selected, command]);
            return { runId: selected, commandId: command,
                commandHash: createHash('sha256').update(command).digest('hex'),
                activeRunId: runId, workspaceCardId: cardId, state: value.state }; },
        async run({ runId: selected, commandId: command, signal }) {
            value.calls.push(['run', selected, command]); value.signal = signal; return pending;
        } };
    } });
    return value;
}
test('private acknowledgment follows exact-command admission; retry aliases cannot create two executions', async () => {
    const f = fixture();
    assert.deepEqual(await f.host.accept(f.request), { state: 'ACCEPTED', ...f.request });
    await f.host.accept({ ...f.request, runId: randomUUID() });
    assert.equal(f.calls.filter(([kind]) => kind === 'run').length, 1);
    assert.equal(f.calls[0][0], 'admit');
    f.finish({ runId: f.runId, state: 'PAUSED' }); await f.host.close();
    assert.deepEqual(f.results, [{ runId: f.runId, state: 'PAUSED' }]);
});
test('held, paused and invalid admission cannot acknowledge or execute provider work', async () => {
    for (const state of ['HELD', 'PAUSED', 'TAKEN_OVER', 'NEEDS_ATTENTION', 'READY_FOR_HUMAN']) {
        const f = fixture(); f.state = state;
        await assert.rejects(f.host.accept(f.request), /ASTRA_DISPATCH_NOT_ADMITTED/);
        assert.equal(f.calls.filter(([kind]) => kind === 'run').length, 0); await f.host.close();
    }
    const f = fixture();
    await assert.rejects(f.host.accept({ runId: 'not-a-run', commandId: f.commandId }));
    await assert.rejects(f.host.accept({ runId: f.runId })); assert.equal(f.calls.length, 0);
});
test('a proved completed command recovers its lost acknowledgment without launching another execution', async () => {
    const f = fixture(); f.state = 'SETTLED';
    assert.deepEqual(await f.host.accept(f.request), { state: 'SETTLED', ...f.request });
    assert.equal(f.calls.filter(([kind]) => kind === 'run').length, 0); await f.host.close();
});
test('service shutdown aborts its execution and refuses another acknowledgment', async () => {
    const f = fixture(); await f.host.accept(f.request);
    f.host.stop(); assert.equal(f.signal.aborted, true);
    await assert.rejects(f.host.accept(f.request), /ASTRA_DISPATCH_UNAVAILABLE/);
    f.finish({ runId: f.runId, state: 'HELD' }); await f.host.close();
});
test('a newer STEP cannot be acknowledged as covered by the previous finishing command', async () => {
    const f = fixture(); await f.host.accept(f.request);
    const next = { runId: f.runId, commandId: randomUUID() };
    await assert.rejects(f.host.accept(next), /ASTRA_DISPATCH_BUSY/);
    assert.equal(f.calls.filter(([kind]) => kind === 'run').length, 1);
    f.finish({ runId: f.runId, state: 'PAUSED' }); await new Promise(setImmediate);
    assert.deepEqual(await f.host.accept(next), { state: 'ACCEPTED', ...next });
    assert.equal(f.calls.filter(([kind]) => kind === 'run').length, 2);
    assert.equal(f.calls.filter(([kind]) => kind === 'run')[1][2], next.commandId);
    await f.host.close();
});
test('in-flight proof coalesces only the exact command already running in this process', async () => {
    const f = fixture(); f.state = 'IN_FLIGHT';
    await assert.rejects(f.host.accept(f.request), /ASTRA_DISPATCH_NOT_ADMITTED/);
    assert.equal(f.calls.filter(([kind]) => kind === 'run').length, 0);
    f.state = 'ADMITTED'; await f.host.accept(f.request); f.state = 'IN_FLIGHT';
    assert.deepEqual(await f.host.accept(f.request), { state: 'ACCEPTED', ...f.request });
    await assert.rejects(f.host.accept({ ...f.request, commandId: randomUUID() }), /ASTRA_DISPATCH_BUSY/);
    f.state = 'HELD'; await assert.rejects(f.host.accept(f.request), /ASTRA_DISPATCH_NOT_ADMITTED/);
    f.finish({ runId: f.runId, state: 'HELD' }); await f.host.close();
});
test('log failure cannot convert settled work to an unhandled dispatch failure', async () => {
    const f = fixture(); f.loggerFails = true; await f.host.accept(f.request);
    f.finish({ runId: f.runId, state: 'PAUSED' }); await f.host.close();
    assert.deepEqual(f.results, []);
});
test('private process rejects native/code/CA overrides while allowing official image metadata', () => {
    assert.doesNotThrow(() => assertPrivateProcess({ NODE_ENV: 'production', NODE_VERSION: '20.20.1', YARN_VERSION: '1.22.22' }, []));
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'PRISMA_QUERY_ENGINE_LIBRARY',
        'OPENSSL_CONF', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'DEBUG']) assert.throws(() => assertPrivateProcess({ [key]: '' }, []));
    assert.throws(() => assertPrivateProcess({}, ['--import', 'untrusted.mjs']));
});
test('operator bootstrap checks the original process before reading a manifest or filtering credentials', async () => {
    for (const key of ['NODE_OPTIONS', 'LD_PRELOAD', 'OPENSSL_CONF', 'PRISMA_QUERY_ENGINE_LIBRARY', 'NODE_VERSION']) {
        const existed = Object.hasOwn(process.env, key), previous = process.env[key]; process.env[key] = '';
        try {
            await assert.rejects(createPrivateOperatorHost({ config: { dispatch: {} },
                makeClient() { throw new Error('client construction must remain unreachable'); } }),
            error => error.code === 'ASTRA_RELEASE_PROCESS_UNSAFE');
        } finally { if (existed) process.env[key] = previous; else delete process.env[key]; }
    }
});
