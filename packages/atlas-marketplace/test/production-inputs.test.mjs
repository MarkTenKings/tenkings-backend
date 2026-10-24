import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { productionProcessArguments, loadProductionProcessInputs } from '../src/production-inputs.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const configuration = { schema: 'atlas-marketplace-production-input-v1', sourceRevision: 'a'.repeat(40), sourceManifestSha256: 'b'.repeat(64),
    manifest: { sourceRevision: 'a'.repeat(40), environment: 'PRODUCTION' }, runtime: {} };
const secrets = { schema: 'atlas-marketplace-production-secrets-v1', canonicalInputs: {}, database: {}, proof: {} };
function fixture(t, text = JSON.stringify(configuration)) {
    const directory = fs.mkdtempSync(join(os.homedir(), '.atlas-input-test-')); fs.chmodSync(directory, 0o700);
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const configPath = join(directory, 'config.json'), secretPath = join(directory, 'secrets.json');
    fs.writeFileSync(configPath, text, { mode: 0o600 }); fs.writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    return { configPath, configSha256: digest(text), secretFd: fs.openSync(secretPath, 'r') };
}
const assertClosed = fd => assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });

test('protected config hash and inherited secret FD are consumed without ambient values', async t => {
    const input = fixture(t), actual = await loadProductionProcessInputs(input);
    assert.deepEqual(actual, { configuration, secrets }); assertClosed(input.secretFd);
    assert.deepEqual(productionProcessArguments(['--secrets-fd', '3', '--config', input.configPath, '--config-sha256', input.configSha256]),
        { ...input, secretFd: 3 });
});

test('changed bytes, duplicate JSON keys and public permissions refuse and close the inherited FD', async t => {
    for (const mutate of [
        input => { input.configSha256 = '0'.repeat(64); },
        input => { fs.chmodSync(input.configPath, 0o640); },
        input => { const bytes = JSON.stringify(configuration).replace('"runtime":{}', '"runtime":{},"runtime":{}');
            fs.writeFileSync(input.configPath, bytes); input.configSha256 = digest(bytes); },
        input => { const original = input.configPath + '.original'; fs.renameSync(input.configPath, original); fs.symlinkSync(original, input.configPath); },
    ]) {
        const input = fixture(t); mutate(input);
        await assert.rejects(loadProductionProcessInputs(input)); assertClosed(input.secretFd);
    }
});

test('argv cannot carry credentials, duplicate switches, stdin or an unpinned configuration', () => {
    for (const args of [[], ['--config','/a','--config-sha256','a'.repeat(64),'--password','private'],
        ['--config','/a','--config','/b','--secrets-fd','3'], ['--config','/a','--config-sha256','a'.repeat(64),'--secrets-fd','0']])
        assert.throws(() => productionProcessArguments(args), { code: 'PRODUCTION_INPUT_REFUSED' });
});
