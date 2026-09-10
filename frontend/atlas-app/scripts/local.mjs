import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    if (existsSync(resolve(root, file)))
        throw new Error('Remove app env files before running the synthetic fixture.');
}
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', root, '-H', '127.0.0.1', '-p', '4318'], {
    cwd: root, stdio: 'inherit',
    env: { PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_SYNTHETIC: '1' }
});
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
