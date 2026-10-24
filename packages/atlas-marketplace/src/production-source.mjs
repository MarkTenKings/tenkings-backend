import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireValue } from './contract.mjs';

const check = value => requireValue(value, 'PRODUCTION_SOURCE_REFUSED');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The reviewed packager creates this fixed sibling manifest from clean Git
 * blobs. Its hash comes from the separately pinned process configuration.
 * Runtime configuration cannot select an import or an alternate source tree. */
export function verifyProductionSource({ sourceRevision, sourceManifestSha256 }) {
    const path = resolve(root, '../source-manifest.json'), stat = fs.lstatSync(path);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o022) === 0 && stat.size <= 4194304);
    const bytes = fs.readFileSync(path); check(digest(bytes) === sourceManifestSha256);
    const manifest = JSON.parse(bytes);
    check(manifest.schema === 'atlas-marketplace-production-source-v1' && manifest.sourceRevision === sourceRevision
        && manifest.nodeVersion === '22.16.0' && process.versions.node === manifest.nodeVersion
        && Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000);
    const paths = new Set();
    for (const file of manifest.files) {
        check(typeof file.path === 'string' && /^[A-Za-z0-9_./@+\[\]-]+$/.test(file.path) && !file.path.split('/').includes('..')
            && !paths.has(file.path) && /^[a-f0-9]{64}$/.test(file.sha256)); paths.add(file.path);
        const full = resolve(root, file.path); check(relative(root, full) === file.path && fs.realpathSync(full) === full);
        const current = fs.lstatSync(full);
        check(current.isFile() && current.uid === 0 && (current.mode & 0o022) === 0 && current.size === file.byteCount
            && digest(fs.readFileSync(full)) === file.sha256);
    }
    for (const required of ['packages/atlas-marketplace/scripts/production-host.mjs',
        'packages/atlas-marketplace/src/production-runtime.mjs', 'packages/atlas-marketplace/src/production-proof-owners.mjs',
        'packages/atlas-marketplace/src/production-canonical-pins.mjs', 'pnpm-lock.yaml']) check(paths.has(required));
    return Object.freeze({ sourceRevision, sourceManifestSha256, files: paths.size });
}
