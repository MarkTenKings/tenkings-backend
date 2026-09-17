// Offline reviewed-package check, deliberately excludes the manifest itself.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../handoff-manifest.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
if (!Array.isArray(manifest.result_files) || hash(JSON.stringify(manifest.result_files)) !== manifest.result_tree_sha256) throw new Error('Invalid result ledger');
async function paths(directory, prefix = 'packages/card-identification-core/') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'handoff-manifest.json') continue;
    if (entry.isDirectory()) result.push(...await paths(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`));
    else if (entry.isFile()) result.push(`${prefix}${entry.name}`);
    else throw new Error('Unexpected package link');
  }
  return result.sort();
}
if (JSON.stringify(await paths(new URL('../', import.meta.url))) !== JSON.stringify(manifest.result_files.map(file => file.path))) throw new Error('Unexpected package members');
for (const file of manifest.result_files) {
  if (!file.path.startsWith('packages/card-identification-core/') || file.path.includes('..')) throw new Error('Invalid package path');
  if (hash(await readFile(new URL(file.path, root))) !== file.sha256) throw new Error(`Result hash mismatch: ${file.path}`);
}
for (const file of manifest.baseline_files.filter(file => !file.path.endsWith('/README.md') && !file.path.endsWith('/package.json'))) {
  if (hash(await readFile(new URL(file.path, root))) !== file.sha256) throw new Error(`V1 drift: ${file.path}`);
}
process.stdout.write(`Verified ${manifest.result_files.length} result files; V1 runtime/types/fixtures unchanged; result tree ${manifest.result_tree_sha256}\n`);
