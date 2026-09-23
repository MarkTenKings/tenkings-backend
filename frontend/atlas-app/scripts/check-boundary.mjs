import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const pages = JSON.parse(readFileSync(resolve(app, '.next/server/pages-manifest.json'), 'utf8'));
const routes = JSON.parse(readFileSync(resolve(app, '.next/routes-manifest.json'), 'utf8'));
assert.equal(routes.basePath, '/admin', 'Staff artifact must mount only at /admin');
assert.deepEqual(Object.keys(pages).sort(), ['/', '/404', '/_app', '/_document', '/_error', '/api/staff/[...path]', '/cards/[cardId]', '/grading', '/operations', '/add-cards', '/workspace/[cardId]', '/manual', '/manual/[cardId]', '/batch'].sort());
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]); }
const forbidden = /@tenkings\/|requireAdminSession|buildAdminHeaders|QueenWidget|ATLAS_ADMIN_PHONES|AC_SYNTHETIC_ATLAS|VA_SYNTHETIC_ATLAS|__(?:Host|Secure)-atlas_staff/;
const chunks = files(resolve(app, '.next/static')).filter(p => p.endsWith('.js'));
for (const path of chunks)
    assert.ok(!forbidden.test(readFileSync(path, 'utf8')), `Private/legacy dependency in browser chunk ${relative(app, path)}`);
const traces = files(resolve(app, '.next/server')).filter(p => p.endsWith('.nft.json'));
const database = resolve(app, '.generated/staff-database');
const engines = readdirSync(database).filter(file => /^(?:libquery_engine-|query_engine-).+\.node$/.test(file));
assert.ok(engines.length, 'Generated staff database engine is missing');
const apiTrace = resolve(app, '.next/server', pages['/api/staff/[...path]']) + '.nft.json';
const apiFiles = new Set(JSON.parse(readFileSync(apiTrace, 'utf8')).files.map(file => resolve(dirname(apiTrace), file)));
for (const file of ['schema.prisma', ...engines])
    assert.ok(apiFiles.has(resolve(database, file)), `Staff API deployment is missing database runtime file: ${file}`);
let checkedFiles = 0;
for (const trace of traces) {
    for (const file of JSON.parse(readFileSync(trace, 'utf8')).files) {
        const full = resolve(dirname(trace), file), rel = relative(repo, full);
        assert.ok(!rel.startsWith('..'), `External checkout dependency: ${file}`);
        const manualResponseLink = (rel === 'packages/atlas-connected-manual/node_modules/@atlas/manual-service'
            || rel === 'packages/atlas-manual-workflow/node_modules/@atlas/manual-service')
            && lstatSync(full).isSymbolicLink()
            && realpathSync(full) === realpathSync(resolve(repo, 'packages/atlas-manual-service'));
        const manualPackage = /^packages\/atlas-(?:connected-manual\/(?:package\.json|src\/transport\.mjs)|manual-service\/(?:package\.json|src\/response\.mjs)|manual-intake\/(?:package\.json|src\/client\.mjs)|manual-workflow\/(?:package\.json|src\/client\.mjs)|manual-workspace\/package\.json)$/.test(rel);
        assert.ok(manualResponseLink || manualPackage || rel.startsWith('frontend/atlas-app/') || rel.startsWith('node_modules/') || rel === 'package.json' || rel === 'packages/atlas-grading-core/package.json' || rel.startsWith('packages/atlas-grading-core/dist/') || rel.startsWith('packages/atlas-report-view/') || rel.startsWith('packages/atlas-service-bridge/')
            || rel.startsWith('packages/atlas-site-router/') || rel === 'packages/atlas-finishing/package.json' || rel === 'packages/atlas-finishing/src/nfc.mjs' || rel === 'packages/atlas-finishing/browser.mjs', `Non-app server dependency: ${rel}`);
        assert.ok(!/@tenkings[+/]|stripe|mux-player|(?:^|\/)aws-sdk@|ai-grader-capture-helper/i.test(rel)
            && (!/twilio/i.test(rel) || rel === 'frontend/atlas-app/lib/server/access/twilio.mjs'), `Forbidden effect dependency: ${rel}`);
        if (/prisma/i.test(rel)) assert.ok(rel === 'frontend/atlas-app/prisma/schema.prisma' || rel.startsWith('frontend/atlas-app/.generated/staff-database/')
            || /^node_modules\/\.pnpm\/@prisma\+(client|engines|engines-version|debug|fetch-engine|get-platform)@5\.22\./.test(rel), `Unreviewed database runtime: ${rel}`);
        checkedFiles++;
    }
}
assert.ok(traces.length > 0 && chunks.length > 0);
console.log(JSON.stringify({ status: 'STAFF_BUILD_BOUNDARY_PASS', pages: Object.keys(pages), browserChunks: chunks.length, serverTraces: traces.length,
    tracedFilesChecked: checkedFiles, databaseEngines: engines, basePath: routes.basePath, durableStore: 'atlas_staff', providerAdapters: ['explicitly activated ATLAS Verify'], certificationRoutes: 1 }));
