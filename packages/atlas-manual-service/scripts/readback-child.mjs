// Owned-fixture child only. Connection/session material arrives through IPC,
// never CLI arguments, persisted output, inherited provider environment or HTTP.
import assert from 'node:assert/strict';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { localAccessConfig } from '../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../../frontend/atlas-app/lib/server/access/database.mjs';
import { createDurableStaffBoundary } from '../src/staff-auth.mjs';
import { createManualRepository } from '../src/repository.mjs';
import { createManualService } from '../src/service.mjs';
import { createManualArtifactStore } from '../src/artifacts.mjs';
import { createFileArtifactTransport } from './file-artifacts.mjs';
import { digest } from '../src/contract.mjs';

process.once('message', async input => {
  let staffClient, manualClient;
  try {
    assert(process.send);
    for (const [value, user] of [[input.staffUrl, 'atlas_fixture_staff'], [input.manualUrl, 'atlas_fixture_manual']]) {
      const url = new URL(value);
      assert(url.hostname === '127.0.0.1' && url.username === user && /^\/atlas_fixture_case_\d+$/.test(url.pathname));
    }
    const config = localAccessConfig({ databaseUrl: input.staffUrl, sessionKey: Buffer.from(input.sessionKey, 'hex'),
      phoneKey: Buffer.from(input.phoneKey, 'hex'), phones: input.phones });
    staffClient = new PrismaClient({ datasources: { db: { url: input.staffUrl } } });
    manualClient = new PrismaClient({ datasources: { db: { url: input.manualUrl } } });
    const auth = new DurableStaffAuth({ database: new StaffDatabase(staffClient, config), config, provider: null });
    const boundary = createDurableStaffBoundary({ auth, manualClient });
    const service = createManualService({ repository: createManualRepository({ boundary }), reduce: () => { throw new Error('Replay invoked reducer'); } });
    const staff = await auth.authenticate(input.cookie, input.csrf);
    const card = await service.read(staff, input.cardId), replay = await service.execute(staff, input.cardId, input.action);
    const store = createManualArtifactStore({ transport: await createFileArtifactTransport(input.objectDirectory) });
    const artifact = await store.read(card.draft.defectsRef, input.artifactSource);
    process.send({ ok: true, pid: process.pid, card, replay, artifactContentHash: digest(JSON.stringify(artifact)) });
  } catch (error) { process.send({ ok: false, error: error.code ?? error.message }); process.exitCode = 1; }
  finally { await Promise.all([staffClient?.$disconnect(), manualClient?.$disconnect()]); process.disconnect(); }
});
