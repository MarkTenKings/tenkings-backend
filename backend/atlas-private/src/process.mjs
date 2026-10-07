import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The container supplies trusted OS libraries. Launch-time code/native/CA
 * overrides are rejected before any generated client or private adapter import.
 * Official Docker NODE_VERSION/YARN_VERSION metadata is not a loader option.
 */
export function assertPrivateProcess(env = process.env, execArgv = process.execArgv) {
    if (execArgv.length || Object.keys(env).some(name => name === 'DEBUG'
        || name.startsWith('NODE_') && !['NODE_ENV', 'NODE_VERSION'].includes(name)
        || ['LD_', 'DYLD_', 'PRISMA_', 'OPENSSL_'].some(prefix => name.startsWith(prefix))
        || ['SSL_CERT_FILE', 'SSL_CERT_DIR'].includes(name))) throw new Error('ATLAS_PRIVATE_PROCESS_UNSAFE');
}

export function privateEnginePath(moduleUrl) {
    const name = process.platform === 'linux' && process.arch === 'x64' ? 'libquery_engine-debian-openssl-3.0.x.so.node'
        : process.platform === 'darwin' && process.arch === 'arm64' ? 'libquery_engine-darwin-arm64.dylib.node' : null;
    if (!name) throw new Error('ATLAS_PRIVATE_PLATFORM_UNSUPPORTED');
    const path = fileURLToPath(new URL(`../.generated/database/${name}`, moduleUrl));
    if (!existsSync(path)) throw new Error('ATLAS_PRIVATE_ENGINE_REQUIRED');
    return path;
}
