import { fileURLToPath } from 'node:url';
import { assertProcess, check, verifyContainer, verifyExecutable } from './verify.mjs';

try {
    assertProcess();
    check(process.getuid() === 65532 && process.getgid() === 65532, 'ATLAS_PRIVATE_CONTAINER_USER');
    check(process.argv.length <= 3, 'ATLAS_PRIVATE_CONTAINER_ARGUMENT');
    const mode = process.argv[2];
    check(mode === undefined || ['--verify-only', '--smoke'].includes(mode), 'ATLAS_PRIVATE_CONTAINER_ARGUMENT');
    await verifyExecutable();
    const verified = await verifyContainer(fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''));
    if (mode === '--verify-only') process.stdout.write(JSON.stringify({ status: 'ATLAS_PRIVATE_CONTAINER_VERIFIED',
        manifestHash: verified.manifestHash, files: verified.manifest.files.length }) + '\n');
    else if (mode === '--smoke') await (await import('./smoke.mjs')).smoke(verified);
    else await import('../dist/server.mjs');
} catch {
    process.stderr.write('ATLAS_PRIVATE_CONTAINER_STARTUP_REJECTED\n');
    process.exitCode = 78;
}
