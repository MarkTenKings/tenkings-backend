import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplePlan } from '../test/manual-fixture.mjs';

// Explicit offline design editor. Real renderer/design/logo modules are bundled
// into a standalone HTML file; no provider, printer, NFC or live staff endpoint.
// The exported JSON is a draft, not an activation or print-profile operation.
const args = process.argv.slice(2), destination = args.shift() || '/tmp/atlas-label-design.html';
const options = { hub: false, pdfHref: null };
while (args.length) {
  const option = args.shift();
  if (option === '--hub' && !options.hub) options.hub = true;
  else if (option === '--pdf-href' && options.pdfHref === null) {
    const value = args.shift();
    if (typeof value !== 'string' || !/^\/[A-Za-z0-9/_-]+\.pdf$/.test(value)) throw new Error('LABEL_PREVIEW_PDF_PATH_INVALID');
    options.pdfHref = value;
  } else throw new Error('LABEL_PREVIEW_ARGUMENT_INVALID');
}
const output = resolve(destination), repository = fileURLToPath(new URL('../../../', import.meta.url));
const fromRepository = relative(repository, output);
if (fromRepository === '' || fromRepository !== '..' && !fromRepository.startsWith('../') && !isAbsolute(fromRepository)) throw new Error('LABEL_PREVIEW_OUTPUT_MUST_BE_OUTSIDE_GIT');
const label = samplePlan({ mode: 'LOCAL_FIXTURE' }).label;
const built = await build({ entryPoints: [fileURLToPath(new URL('./label-preview/client.mjs', import.meta.url))],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
  define: { __ATLAS_LABEL_SAMPLE__: JSON.stringify(label) } });
const bundle = built.outputFiles[0].text.replaceAll('</script', '<\\/script');
const [css, shell] = await Promise.all([readFile(new URL('./label-preview/preview.css', import.meta.url), 'utf8'), readFile(new URL('./label-preview/shell.html', import.meta.url), 'utf8')]);
const pdf = options.pdfHref ? `<a href="${options.pdfHref}" class="pdf-link" target="_blank" rel="noopener">Default design PDF ↗</a>` : '<span class="draft-note">Default PDF proof is being refreshed.</span>';
const html = shell.replace('STYLE_PLACEHOLDER', css).replace('BUNDLE_PLACEHOLDER', () => bundle)
  .replace('DEFAULT_PDF_PLACEHOLDER', pdf)
  .replace('HUB_GUARD_PLACEHOLDER', options.hub ? '<script src="/fixture-guard.js"></script>' : '')
  .replace('HUB_RETURN_PLACEHOLDER', options.hub ? '<a href="/">← Return to workflow review</a><br>' : '');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, { mode: 0o600 }); console.log(output);
