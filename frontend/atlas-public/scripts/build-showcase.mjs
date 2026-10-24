import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild');
const output = resolve(root, 'docs/atlas/design/experience/site/showcase-data.mjs');
await mkdir(resolve(root, 'docs/atlas/design/experience/site'), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['frontend/atlas-public/components/showcase-browser.mjs'],
  outfile: output, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'],
  minify: true, legalComments: 'none', logLevel: 'silent' });
// The bundled schema library emits whitespace-only lines inside generated JS
// function templates. Normalize those empty lines for a clean, stable artifact.
await writeFile(output, (await readFile(output, 'utf8')).replace(/^[ \t]+$/gm, ''));
console.log('SHOWCASE_BROWSER_BUNDLE_READY');
