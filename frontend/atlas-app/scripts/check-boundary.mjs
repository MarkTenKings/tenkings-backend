import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const pages = JSON.parse(readFileSync(resolve(app, '.next/server/pages-manifest.json'), 'utf8'));
assert.deepEqual(Object.keys(pages).sort(), ['/', '/404', '/_app', '/_document', '/_error', '/api/staff/[...path]', '/cards/[cardId]', '/grading'].sort());
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]); }
const forbidden = /@tenkings\/|requireAdminSession|buildAdminHeaders|QueenWidget|ATLAS_ADMIN_PHONES|AC_SYNTHETIC_ATLAS|VA_SYNTHETIC_ATLAS|__Host-atlas_staff/;
const chunks = files(resolve(app, '.next/static')).filter(p => p.endsWith('.js'));
for (const path of chunks)
    assert.ok(!forbidden.test(readFileSync(path, 'utf8')), `Private/legacy dependency in browser chunk ${relative(app, path)}`);
const traces = files(resolve(app, '.next/server')).filter(p => p.endsWith('.nft.json'));
let checkedFiles = 0;
for (const trace of traces) {
    for (const file of JSON.parse(readFileSync(trace, 'utf8')).files) {
        const full = resolve(dirname(trace), file), rel = relative(repo, full);
        assert.ok(!rel.startsWith('..'), `External checkout dependency: ${file}`);
        assert.ok(rel.startsWith('frontend/atlas-app/') || rel.startsWith('node_modules/') || rel === 'package.json', `Non-app server dependency: ${rel}`);
        assert.ok(!/@tenkings[+/]|prisma|twilio|stripe|mux-player|aws-sdk|ai-grader-capture-helper/i.test(rel), `Forbidden effect dependency: ${rel}`);
        checkedFiles++;
    }
}
assert.ok(traces.length > 0 && chunks.length > 0);
console.log(JSON.stringify({ status: 'LOCAL_STAFF_BUILD_BOUNDARY_PASS', pages: Object.keys(pages), browserChunks: chunks.length, serverTraces: traces.length, tracedFilesChecked: checkedFiles, providerAdapters: 0, certificationRoutes: 0 }));
