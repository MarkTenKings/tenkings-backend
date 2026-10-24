import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectManualSource } from '../../../frontend/atlas-app/scripts/package-manual-container.mjs';

// Reuse the existing source-closure packager. This owned Node host additionally
// needs customer canonical auth, the public policy, marketplace UI and its real
// process script. No environment, generated client, SQL or private file is copied.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 256 * 1024 * 1024 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [sourceRevision, output, ...extra] = process.argv.slice(2);
assert(!extra.length && /^[a-f0-9]{40}$/.test(sourceRevision) && output === resolve(output)
    && output !== root && !output.startsWith(root + '/'));
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), sourceRevision);
assert.equal(git(['status', '--porcelain']).toString(), '', 'CLEAN_SOURCE_REQUIRED');
const collected = await collectManualSource(root), files = new Map(collected.files.map(file => [file.path, file]));
const extraPaths = git(['ls-tree', '-r', '--name-only', sourceRevision]).toString().trim().split('\n').filter(path =>
    /^frontend\/atlas-customer\/lib\//.test(path)
    || /^packages\/atlas-marketplace\/ui\//.test(path)
    || ['frontend/atlas-customer/package.json', 'frontend/atlas-customer/prisma/schema.prisma',
        'frontend/atlas-customer/scripts/generate-database.mjs', 'frontend/atlas-public/lib/server/policy.mjs',
        'packages/atlas-site-router/marketplace.mjs', 'packages/atlas-marketplace/scripts/production-host.mjs'].includes(path));
for (const path of extraPaths) {
    const stat = await lstat(join(root, path)); assert(stat.isFile() && !stat.isSymbolicLink());
    const bytes = await readFile(join(root, path));
    files.set(path, { path, bytes, sha256: sha(bytes), byteCount: bytes.length });
}
await mkdir(output, { mode: 0o700 });
for (const file of files.values()) {
    assert(!/(?:^|\/)(?:\.env(?:\.|$)|node_modules|\.generated|\.vercel|\.git)(?:\/|$)/.test(file.path));
    assert.deepEqual(file.bytes, git(['show', sourceRevision + ':' + file.path]), 'SOURCE_BLOB_CHANGED');
    const path = join(output, 'source', file.path); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes, { flag: 'wx', mode: 0o644 });
}
const manifest = { schema: 'atlas-marketplace-production-source-v1', sourceRevision,
    tree: git(['rev-parse', sourceRevision + '^{tree}']).toString().trim(), nodeVersion: '22.16.0',
    packageManager: 'pnpm@9.12.0', files: [...files.values()].map(({ bytes, ...file }) => file).sort((a, b) => a.path.localeCompare(b.path)) };
const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(output, 'source-manifest.json'), bytes, { flag: 'wx', mode: 0o644 });
console.log(JSON.stringify({ status: 'PRODUCTION_SOURCE_PACKAGED', sourceRevision, sourceManifestSha256: sha(bytes), files: files.size,
    output, generatedClientsIncluded: false, secretsCopied: false, productionEffects: 0 }));
