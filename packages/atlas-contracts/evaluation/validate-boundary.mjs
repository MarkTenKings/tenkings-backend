import '../test/offline-guard.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { TOOL_NAMES } from '../src/contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'frontend/atlas-app/boundary-manifest.json'), 'utf8'));
assert.equal(manifest.status, 'DESIGN_ONLY_NOT_RUNTIME_ENFORCEMENT');
assert.equal(manifest.machineRouteProposal.status, 'NOT_REGISTERED_OFFLINE_CONTRACT_ONLY');
assert.deepEqual(manifest.machineRouteProposal.exactRoutes.map(r => r.tool).sort(), [...TOOL_NAMES].sort());
const sources = [...new Set([...manifest.sourceRoutes.map(r => r.source), ...manifest.sourceModuleDependencies.map(r => r.source), ...manifest.dependencyGroups.flatMap(r => r.currentSources)])];
for (const source of sources) assert.ok(typeof source === 'string' && !isAbsolute(source) && !source.split(/[\\/]/).includes('..') && existsSync(resolve(root, source)), `Missing or unsafe inventoried source: ${source}`);
for (const [name, routes] of [['public', manifest.publicRouteManifest], ['staff', manifest.staffRouteManifest]]) {
  const keys = routes.flatMap(r => r.methods.map(method => `${method}:${r.path}`));
  assert.equal(new Set(keys).size, keys.length, `Duplicate ${name} route`);
}
process.stdout.write(`${JSON.stringify({ status: 'DESIGN_MANIFEST_VALID', currentRoutes: manifest.sourceRoutes.length, selectedModules: manifest.sourceModuleDependencies.length, existingSourcePathsChecked: sources.length, proposedMachineTools: TOOL_NAMES.length, runtimeRoutesCreatedByDesignManifest: 0, staffBuildValidation: 'frontend/atlas-app/scripts/check-boundary.mjs' })}\n`);
