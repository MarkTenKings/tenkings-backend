import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'dist'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/PairedGeometryWorkspace.jsx', 'src/DefectReviewWorkspace.jsx', 'src/gradient-snap.ts'],
  outdir: 'dist', bundle: true, splitting: true, format: 'esm', platform: 'browser',
  target: ['es2022'], jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'],
  metafile: true, logLevel: 'silent',
});
for (const path of Object.keys(result.metafile.inputs)) {
  assert(!/atlas-operator|atlas-contracts|frontend\/atlas-app|atlasWorkspace|server\/access/.test(path), `Old orchestration dependency: ${path}`);
}
await writeFile(resolve(root, 'dist/build-boundary.json'), JSON.stringify({ inputs: Object.keys(result.metafile.inputs), oldOrchestrationDependencies: 0 }, null, 2));
