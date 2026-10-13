#!/usr/bin/env node
// Current standalone schema + durable auth/manual workflow qualification.
// The child owns and cleans its disposable cluster; no historical migrations.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qualifyManualPublicRoundtrip } from '../../atlas-public/scripts/manual-public-fixture.mjs';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../../packages/atlas-manual-service/scripts/validate-postgres.mjs', import.meta.url)), ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env });
assert.equal(result.status, 0, 'Current standalone manual/auth qualification failed');
const manualPublic = await qualifyManualPublicRoundtrip();
console.log(JSON.stringify({ status: 'CURRENT_STAFF_POSTGRES_PASS', manualPublic, historicalMigrationReplay: false, productionCalls: 0 }));
