import { writeFileSync } from 'node:fs';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { pidPath, action } = JSON.parse(raw);
writeFileSync(pidPath, String(process.pid));
if (action === 'bad-json') process.stdout.write('not JSON');
else if (action === 'crash') process.exit(7);
else if (action === 'stdout') {
  process.stdout.write('x'.repeat(40_000));
  setInterval(() => {}, 1000);
} else {
  // Deliberately block the child's event loop. No Promise/AbortSignal timer in
  // this process could stop this operation; its parent must terminate it.
  while (true) { /* synchronous CPU fixture */ }
}
