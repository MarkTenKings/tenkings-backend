import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { pidPath, action } = JSON.parse(raw);
writeFileSync(pidPath, String(process.pid));
if (action === 'bad-json') process.stdout.write('not JSON');
else if (action === 'crash') process.exit(7);
else if (action === 'stdout') {
  process.stdout.write('x'.repeat(40_000));
  setInterval(() => {}, 1000);
} else if (action === 'heic') {
  const addon = createRequire(import.meta.url)('../../native/build/heif.node');
  const bytes = readFileSync(new URL('./two-images.heic',import.meta.url));
  const limits = { maxInputBytes:2_000_000,maxPixels:2_000_000,maxRasterBytes:16_000_000 };
  addon.decode(bytes,limits);
  // Readiness proves at least one genuine HEVC decode completed in this PID.
  writeFileSync(`${pidPath}.native`,String(process.pid));
  while (true) addon.decode(bytes,limits);
} else {
  // Deliberately block the child's event loop. No Promise/AbortSignal timer in
  // this process could stop this operation; its parent must terminate it.
  while (true) { /* synchronous CPU fixture */ }
}
