import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(app, '../..');

// Generate from the canonical models; this command never introspects a database
// or edits either application's schema/migration history. Database permissions,
// independently asserted by the runtime, remain the access boundary.
function schemaModels(text, schema) {
    let count = 0;
    const models = [...text.matchAll(/^(model|enum)\s+(\w+)\s*\{\r?\n([\s\S]*?)^\}/gm)].map(match => {
        assert(!match[3].includes('@@schema(')); count++;
        return `${match[1]} ${match[2]} {\n${match[3]}  @@schema("${schema}")\n}`;
    });
    assert(count > 0); return models.join('\n\n');
}
const [legacy, staff] = await Promise.all([
    readFile(resolve(root, 'packages/database/prisma/schema.prisma'), 'utf8'),
    readFile(resolve(root, 'frontend/atlas-app/prisma/schema.prisma'), 'utf8'),
]);
const schema = `// Generated only from the two canonical schema sources.\ngenerator client {
  provider = "prisma-client-js"
  output = "../.generated/database"
  previewFeatures = ["multiSchema"]
  binaryTargets = ["native", "debian-openssl-3.0.x", "rhel-openssl-3.0.x"]
}
datasource db {
  provider = "postgresql"
  url = env("ATLAS_PRIVATE_SOURCE_DATABASE_URL")
  schemas = ["public", "atlas_staff"]
}
\n${schemaModels(legacy, 'public')}\n\n${schemaModels(staff, 'atlas_staff')}\n`;
await mkdir(resolve(app, 'prisma'), { recursive: true });
await writeFile(resolve(app, 'prisma/schema.prisma'), schema);
const result = spawnSync(process.execPath, [resolve(root, 'frontend/atlas-app/node_modules/prisma/build/index.js'),
    'generate', '--schema', resolve(app, 'prisma/schema.prisma')], {
    cwd: app, stdio: 'inherit', env: { HOME: process.env.HOME, PATH: process.env.PATH,
        ATLAS_PRIVATE_SOURCE_DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build?schema=atlas_staff',
        PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_GENERATE_NO_HINTS: '1', PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
