import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [resolve(app, 'node_modules/prisma/build/index.js'),
    'generate', '--schema', resolve(app, 'prisma/schema.prisma')], {
    cwd: app, stdio: 'inherit', env: {
        HOME: process.env.HOME, PATH: process.env.PATH,
        ATLAS_PUBLIC_DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build?schema=atlas_staff',
        PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_GENERATE_NO_HINTS: '1',
    },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
