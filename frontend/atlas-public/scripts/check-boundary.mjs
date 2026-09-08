import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(app, '../..');
const pages = JSON.parse(readFileSync(resolve(app, '.next/server/pages-manifest.json'), 'utf8'));
assert.deepEqual(Object.keys(pages).sort(), ['/', '/404', '/_app', '/_document', '/_error', '/reports/[token]',
    '/api/reports/[token]/images/[side]', '/api/reports/[token]/traces/[findingId]'].sort());
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const chunks = files(resolve(app, '.next/static')).filter(p => p.endsWith('.js'));
for (const file of chunks) assert(!/StaffSession|StaffIdentity|StaffAssignment|staffReportApproval|__Host-atlas|twilio|@tenkings\/|reviewedDefects|admissionCanonical|sessionHash|sourceCanonical/.test(readFileSync(file, 'utf8')),
    `Private dependency in public browser output: ${relative(app, file)}`);
const traces = files(resolve(app, '.next/server')).filter(p => p.endsWith('.nft.json'));
let checked = 0;
for (const trace of traces) for (const file of JSON.parse(readFileSync(trace, 'utf8')).files) {
    const rel = relative(repo, resolve(dirname(trace), file));
    assert(!rel.startsWith('..'));
    assert(rel.startsWith('frontend/atlas-public/') || rel.startsWith('packages/atlas-report-view/')
        || rel.startsWith('packages/atlas-grading-core/dist/') || rel === 'packages/atlas-grading-core/package.json'
        || rel.startsWith('packages/atlas-service-bridge/src/') || rel === 'packages/atlas-service-bridge/package.json'
        || rel.startsWith('node_modules/') || rel === 'package.json', `Unreviewed public server dependency: ${rel}`);
    assert(!/@tenkings[+/]|stripe|twilio|aws-sdk|capture-helper/i.test(rel), `Unexpected public effect: ${rel}`);
    if (/prisma/i.test(rel)) assert(rel === 'frontend/atlas-public/prisma/schema.prisma' || rel.startsWith('frontend/atlas-public/.generated/public-database/')
        || /^node_modules\/\.pnpm\/@prisma\+(client|engines|engines-version|debug|fetch-engine|get-platform)@5\.22\./.test(rel));
    checked++;
}
assert(chunks.length && traces.length);
console.log(JSON.stringify({ status: 'PUBLIC_BUILD_BOUNDARY_PASS', pages: Object.keys(pages), browserChunks: chunks.length,
    serverTraces: traces.length, tracedFilesChecked: checked, staffRoutes: 0, writeRoutes: 0,
    databasePorts: ['read_approved_report', 'read_approved_image', 'read_approved_trace'] }));
