#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, cp, chmod, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds only into a new review directory. No install, launch agent, signing,
// Keychain, printer discovery/output, RF, config, or hosted connection occurs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
if (process.platform !== 'darwin' || process.versions.node.split('.')[0] !== '20'
  || args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1])) {
  throw new Error('Usage on macOS with Node 20: build-review-bundle.mjs --output /absolute/new/directory');
}
const output = args[1];
await mkdir(output, { mode: 0o700 }); // existing directories are never replaced
const destination = await realpath(output);
const run = (cmd, argv) => {
  const result = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`REVIEW_BUILD_FAILED: ${cmd}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  return result.stdout.trim();
};
const sourceCommit = run('/usr/bin/git', ['rev-parse', 'HEAD']);
const sourceStatus = run('/usr/bin/git', ['status', '--porcelain', '--', 'packages/atlas-finishing', 'packages/atlas-finishing-station', 'packages/atlas-mac-nfc']);
run('/usr/bin/swift', ['build', '--package-path', 'packages/atlas-mac-nfc', '-c', 'release', '--product', 'atlas-mac-nfc-companion']);
const nativeDirectory = run('/usr/bin/swift', ['build', '--package-path', 'packages/atlas-mac-nfc', '-c', 'release', '--show-bin-path']);
await cp(join(nativeDirectory, 'atlas-mac-nfc-companion'), join(destination, 'atlas-mac-nfc-companion'));
await chmod(join(destination, 'atlas-mac-nfc-companion'), 0o555);

const require = createRequire(join(root, 'packages/atlas-finishing/package.json'));
const { build } = require('esbuild');
const result = await build({ absWorkingDir: root,
  entryPoints: { station: 'packages/atlas-finishing-station/src/cli.mjs', library: 'packages/atlas-finishing-station/scripts/bundle-library.mjs' },
  bundle: true, splitting: true, platform: 'node', target: 'node20', format: 'esm',
  outdir: destination, outExtension: { '.js': '.mjs' }, metafile: true,
  banner: { js: 'import {createRequire as atlasCreateRequire} from "node:module"; import {fileURLToPath as atlasFilePath} from "node:url"; import {dirname as atlasDirname} from "node:path"; const require=atlasCreateRequire(import.meta.url); const __filename=atlasFilePath(import.meta.url); const __dirname=atlasDirname(__filename);' },
});
// PDFKit's standard-font metrics are read relative to its runtime bundle.
await cp(join(dirname(require.resolve('pdfkit')), 'data'), join(destination, 'data'), { recursive: true });
await cp(join(root, 'packages/atlas-finishing-station/SETUP.md'), join(destination, 'SETUP.md'));
await cp(join(root, 'packages/atlas-finishing-station/README.md'), join(destination, 'README.md'));
await cp(join(root, 'packages/atlas-mac-nfc/COMPANION.md'), join(destination, 'COMPANION.md'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
async function census(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await census(path);
    else if (item.isFile()) { const bytes = await readFile(path); files.push({ path: relative(destination, path), bytes: bytes.length, sha256: hash(bytes) }); }
    else throw new Error('REVIEW_UNEXPECTED_FILE_TYPE');
  }
}
await census(destination);
const inputs = [];
for (const input of Object.keys(result.metafile.inputs).sort()) {
  const bytes = await readFile(join(root, input)); inputs.push({ path: input, sha256: hash(bytes) });
}
const nativeSourceFiles = run('/usr/bin/git', ['ls-files', 'packages/atlas-mac-nfc/Sources', 'packages/atlas-mac-nfc/Package.swift']).split('\n');
for (const input of nativeSourceFiles) inputs.push({ path: input, sha256: hash(await readFile(join(root, input))) });
const capabilities = JSON.parse(run(join(destination, 'atlas-mac-nfc-companion'), ['capabilities']));
const manifest = { version: 'atlas-mac-station-review-bundle-v1', sourceCommit, sourceDirty: Boolean(sourceStatus),
  platform: process.platform, architecture: process.arch, minimumMacOS: '15.0', requiredNodeMajor: 20,
  distributionStatus: 'UNSIGNED_REVIEW_ONLY', installed: false, configured: false, capabilities,
  inputs, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ output: destination, files: files.length, sourceCommit, sourceDirty: manifest.sourceDirty,
  nativeSha256: files.find(file => file.path === 'atlas-mac-nfc-companion').sha256, distributionStatus: manifest.distributionStatus,
  productionReady: capabilities.productionReady }) + '\n');
