import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = JSON.parse(readFileSync(resolve(root, 'extraction-manifest.json'), 'utf8')).unchangedModules;
const entries = [...modules.map(m => resolve(root, 'src', m.canonical.split('/').at(-1))), resolve(root, 'src/report.ts'), resolve(root, 'src/review-action-contract.ts')];
const result = await build({ entryPoints: entries, outdir: resolve(root, 'dist'), bundle: true, splitting: true,
    format: 'esm', platform: 'neutral', target: ['es2022'], metafile: true, logLevel: 'silent',
    conditions: ['import', 'default'], sourcemap: false });
const sourceInputs = [];
for (const name of Object.keys(result.metafile.inputs)) {
    const full = resolve(name);
    const path = relative(root, full);
    assert(entries.includes(full) || /node_modules\/.+zod/.test(path), `Unreviewed grading dependency ${path}`);
    sourceInputs.push(path);
}
assert(!JSON.stringify(result.metafile).includes('node:'));
writeFileSync(resolve(root, 'dist/build-boundary.json'), JSON.stringify({ status: 'PURE_GRADING_CORE_BUILD_PASS', entries: entries.length, inputs: sourceInputs }, null, 2));
console.log(JSON.stringify({ status: 'PURE_GRADING_CORE_BUILD_PASS', entries: entries.length, ambientEffectDependencies: 0 }));
