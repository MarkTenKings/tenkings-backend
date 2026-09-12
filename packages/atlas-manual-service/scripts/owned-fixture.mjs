// Local native PostgreSQL only. This file is never imported by a serving app.
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../../frontend/atlas-app/lib/server/access/database.mjs';
import { createDurableStaffBoundary, manualGrantSQL } from '../src/staff-auth.mjs';
import { createManualRepository } from '../src/repository.mjs';
import { createManualArtifactStore } from '../src/artifacts.mjs';
import { createFileArtifactTransport } from './file-artifacts.mjs';

export async function createOwnedManualFixture(args) {
  const cluster = await disposablePostgres(args);
  const clients = new Set();
  const open = url => { const client = new PrismaClient({ datasources: { db: { url } } }); clients.add(client); return client; };
  try {
    const database = await cluster.database();
    const admin = open(database.adminUrl);
    const config = localAccessConfig({ databaseUrl: database.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32),
      phones: ['+12025550141', '+12025550142', '+12025550143'] });
    const identities = await seedLocalStaff(admin, config, { trained: true });
    // The ordinary staff migration chain now installs all three manual schemas.
    const role = 'atlas_fixture_manual', password = randomBytes(24).toString('hex');
    await cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await cluster.sql(manualGrantSQL(role), [], database.name);
    const manualUrl = new URL(database.adminUrl); manualUrl.username = role; manualUrl.password = password;
    manualUrl.searchParams.set('schema', 'atlas_manual');
    const objectDirectory = join(cluster.directory, 'manual-artifacts');
    await mkdir(objectDirectory, { mode: 0o700 });
    const artifacts = createManualArtifactStore({ transport: await createFileArtifactTransport(objectDirectory) });
    function connect() {
      const staffClient = open(database.staffUrl), manualClient = open(manualUrl.href);
      const auth = new DurableStaffAuth({ database: new StaffDatabase(staffClient, config), config, provider: fixtureVerifyProvider(config) });
      const boundary = createDurableStaffBoundary({ auth, manualClient });
      return { auth, boundary, repository: createManualRepository({ boundary }), manualClient,
        async close() { await Promise.all([staffClient.$disconnect(), manualClient.$disconnect()]); clients.delete(staffClient); clients.delete(manualClient); } };
    }
    return { cluster, database, admin, config, identities, artifacts, objectDirectory, connect,
      async readInFreshProcess({ cookie, csrf, cardId, action, artifactSource }) {
        const child = fork(new URL('./readback-child.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { PATH: process.env.PATH, HOME: process.env.HOME } });
        const timeout = setTimeout(() => child.kill('SIGTERM'), 15000);
        let result;
        child.on('message', value => { result = value; });
        const exited = new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', code => code === 0 && result?.ok ? resolve(result) : reject(new Error(result?.error ?? 'Fresh process readback failed')));
        });
        child.send({ staffUrl: database.staffUrl, manualUrl: manualUrl.href, sessionKey: config.sessionKey.toString('hex'),
          phoneKey: config.phoneKey.toString('hex'), phones: [...config.phoneByHash.values()], objectDirectory,
          cookie, csrf, cardId, action, artifactSource });
        try { return await exited; } finally { clearTimeout(timeout); }
      },
      async stop() { await Promise.all([...clients].map(client => client.$disconnect())); clients.clear(); await cluster.stop(); } };
  } catch (error) {
    await Promise.all([...clients].map(client => client.$disconnect())); await cluster.stop(); throw error;
  }
}
