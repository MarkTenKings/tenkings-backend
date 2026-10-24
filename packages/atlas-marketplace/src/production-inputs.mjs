import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { requireValue } from './contract.mjs';
import { parseProofDecoderEngineJSON, engineDataOptions } from './proof-decoder-engine-json.mjs';

const MAX_BYTES = 262144;
const check = value => requireValue(value, 'PRODUCTION_INPUT_REFUSED');
const stamp = s => [s.dev, s.ino, s.uid, s.gid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs].join(':');
const protectedFile = stat => stat.isFile() && stat.nlink === 1 && [0, process.getuid()].includes(stat.uid)
    && (stat.mode & 0o077) === 0 && stat.size > 0 && stat.size <= MAX_BYTES;

export function productionProcessArguments(args) {
    check(Array.isArray(args) && args.length === 6);
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
        check(['--config', '--config-sha256', '--secrets-fd'].includes(args[i]) && !Object.hasOwn(values, args[i]));
        values[args[i]] = args[i + 1];
    }
    check(typeof values['--config'] === 'string' && isAbsolute(values['--config']) && resolve(values['--config']) === values['--config']
        && /^[a-f0-9]{64}$/.test(values['--config-sha256']) && /^[1-9][0-9]{0,5}$/.test(values['--secrets-fd']));
    const secretFd = Number(values['--secrets-fd']); check(secretFd >= 3);
    return { configPath: values['--config'], configSha256: values['--config-sha256'], secretFd };
}

function configurationBytes(path) {
    check(fs.realpathSync(path) === path);
    for (let directory = dirname(path);; directory = dirname(directory)) {
        const stat = fs.lstatSync(directory);
        check(stat.isDirectory() && !stat.isSymbolicLink() && [0, process.getuid()].includes(stat.uid) && (stat.mode & 0o022) === 0);
        if (directory === dirname(directory)) break;
    }
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const before = fs.fstatSync(fd); check(protectedFile(before));
        const bytes = fs.readFileSync(fd);
        check(bytes.length === before.size && stamp(before) === stamp(fs.fstatSync(fd)) && stamp(before) === stamp(fs.lstatSync(path)));
        return bytes;
    } finally { fs.closeSync(fd); }
}

async function secretBytes(fd) {
    let stat;
    try { stat = fs.fstatSync(fd); check(protectedFile(stat) || stat.isFIFO() && [0, process.getuid()].includes(stat.uid) && (stat.mode & 0o077) === 0); }
    catch (error) { try { fs.closeSync(fd); } catch {} throw error; }
    const stream = fs.createReadStream(null, { fd, autoClose: true, highWaterMark: 8192 });
    const chunks = []; let length = 0;
    const deadline = setTimeout(() => stream.destroy(Object.assign(new Error(), { code: 'PRODUCTION_SECRET_FD_DEADLINE' })), 5000);
    try {
        for await (const chunk of stream) { length += chunk.length; check(length <= MAX_BYTES); chunks.push(chunk); }
        check(length > 0); return Buffer.concat(chunks);
    } finally { clearTimeout(deadline); stream.destroy(); for (const chunk of chunks) chunk.fill(0); }
}

/** Inputs are data, never module names, JS, authority callbacks or credentials
 * in argv/env. The inherited secret FD is consumed/closed once. Raw byte buffers
 * are cleared after parsing; resulting credentials belong to concrete owners.
 */
export async function loadProductionProcessInputs(options) {
    const { configPath, configSha256, secretFd } = engineDataOptions(options, ['configPath', 'configSha256', 'secretFd']);
    let configBytes, secretsBytes, secretStreamOwnsFd = false;
    try {
        check(isAbsolute(configPath) && resolve(configPath) === configPath && /^[a-f0-9]{64}$/.test(configSha256)
            && Number.isSafeInteger(secretFd) && secretFd >= 3);
        configBytes = configurationBytes(configPath);
        check(createHash('sha256').update(configBytes).digest('hex') === configSha256);
        const configuration = engineDataOptions(parseProofDecoderEngineJSON(configBytes), ['schema', 'sourceRevision', 'sourceManifestSha256', 'manifest', 'runtime']);
        check(configuration.schema === 'atlas-marketplace-production-input-v1' && /^[a-f0-9]{40}$/.test(configuration.sourceRevision)
            && /^[a-f0-9]{64}$/.test(configuration.sourceManifestSha256)
            && configuration.manifest?.sourceRevision === configuration.sourceRevision && configuration.manifest?.environment === 'PRODUCTION');
        secretStreamOwnsFd = true;
        secretsBytes = await secretBytes(secretFd);
        const secrets = engineDataOptions(parseProofDecoderEngineJSON(secretsBytes), ['schema', 'canonicalInputs', 'database', 'proof']);
        check(secrets.schema === 'atlas-marketplace-production-secrets-v1');
        return { configuration, secrets };
    } finally {
        configBytes?.fill(0); secretsBytes?.fill(0);
        if (!secretStreamOwnsFd && Number.isSafeInteger(secretFd) && secretFd >= 3) { try { fs.closeSync(secretFd); } catch {} }
    }
}
