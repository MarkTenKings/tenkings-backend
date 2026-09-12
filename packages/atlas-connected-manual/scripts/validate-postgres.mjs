import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { intakeGrantSQL } from '@atlas/manual-intake/repository';
import { connectedGrantSQL } from '../src/details.mjs';
import { runConnectedIntegration } from '../test/connected.test.mjs';

const output = process.env.ATLAS_CONNECTED_EVIDENCE, pythonExecutable = process.env.ATLAS_FIXTURE_PYTHON;
assert(output && resolve(output) === output, 'Absolute owned evidence directory required');
assert(pythonExecutable && resolve(pythonExecutable) === pythonExecutable, 'Absolute qualified CPU Python required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
try {
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql(connectedGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await writeFile(join(output, 'startup.json'), JSON.stringify({ owned: true, directory: fixture.cluster.directory,
    pythonExecutable, auth: 'actual DurableStaffAuth, explicitly synthetic SMS provider',
    storage: 'exact-byte injected SDK fixture, no live bucket', at: new Date().toISOString() }, null, 2));
  const result = await runConnectedIntegration({ fixture, pythonExecutable, output });
  console.log(JSON.stringify({ status: result.status, assertions: result.assertions, output }));
} finally {
  await fixture.stop();
  await copyFile(join(fixture.cluster.directory, 'cleanup.json'), join(output, 'database-cleanup.json'));
  await writeFile(join(output, 'cleanup.json'), JSON.stringify({ ownedDatabaseStoppedVerified: true, directory: fixture.cluster.directory,
    at: new Date().toISOString() }, null, 2));
}
