import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const pages = JSON.parse(readFileSync(resolve(app, '.next/server/pages-manifest.json'), 'utf8'));
assert.deepEqual(Object.keys(pages).sort(), ['/', '/404', '/_app', '/_document', '/_error', '/api/staff/[...path]', '/cards/[cardId]', '/grading', '/operations'].sort());
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
        assert.ok(rel.startsWith('frontend/atlas-app/') || rel.startsWith('node_modules/') || rel === 'package.json' || rel === 'packages/atlas-grading-core/package.json' || rel.startsWith('packages/atlas-grading-core/dist/') || rel.startsWith('packages/atlas-report-view/') || rel.startsWith('packages/atlas-service-bridge/')
            || rel === 'packages/atlas-finishing/package.json' || rel === 'packages/atlas-finishing/src/nfc.mjs' || rel === 'packages/atlas-finishing/browser.mjs', `Non-app server dependency: ${rel}`);
        assert.ok(!/@tenkings[+/]|stripe|mux-player|aws-sdk|ai-grader-capture-helper/i.test(rel)
            && (!/twilio/i.test(rel) || rel === 'frontend/atlas-app/lib/server/access/twilio.mjs'), `Forbidden effect dependency: ${rel}`);
        if (/prisma/i.test(rel)) assert.ok(rel === 'frontend/atlas-app/prisma/schema.prisma' || rel.startsWith('frontend/atlas-app/.generated/staff-database/')
            || /^node_modules\/\.pnpm\/@prisma\+(client|engines|engines-version|debug|fetch-engine|get-platform)@5\.22\./.test(rel), `Unreviewed database runtime: ${rel}`);
        checkedFiles++;
    }
}
assert.ok(traces.length > 0 && chunks.length > 0);
console.log(JSON.stringify({ status: 'STAFF_BUILD_BOUNDARY_PASS', pages: Object.keys(pages), browserChunks: chunks.length, serverTraces: traces.length,
    tracedFilesChecked: checkedFiles, durableStore: 'atlas_staff', providerAdapters: ['explicitly activated ATLAS Verify'], certificationRoutes: 1 }));
