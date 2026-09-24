import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
const root = '/build';
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const traces = walk(root + '/frontend/atlas-app/.next/server').filter(path => path.endsWith('.nft.json')).sort().map(path => {
  const targets = JSON.parse(readFileSync(path)).files.map(file => resolve(dirname(path), file));
  assert(targets.every(file => file.startsWith(root + '/')));
  return { path: relative(root, path), files: targets.map(file => relative(root, file)).sort() };
});
const all = [...new Set(traces.flatMap(trace => trace.files))].sort();
const source = root + '/packages/atlas-service-bridge/src/customer-service.mjs';
assert(readFileSync(source, 'utf8').includes('atlas-customer-service-v1'));
const markerArtifacts = walk(root + '/frontend/atlas-app/.next/server').filter(path => path.endsWith('.js') && readFileSync(path, 'utf8').includes('atlas-customer-service-v1')).map(path => relative(root, path));
console.log(JSON.stringify({ sourceManifestSha256: createHash('sha256').update(readFileSync(root + '/source-manifest.json')).digest('hex'), traces, uniqueTracedFileCount: all.length, customerBridgeSourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), customerBridgeTraced: all.includes('packages/atlas-service-bridge/src/customer-service.mjs'), markerArtifacts, externalTracePaths: 0 }, null, 2));
