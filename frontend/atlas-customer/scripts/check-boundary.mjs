import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(app, '.next/server/pages-manifest.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest).sort(), ['/', '/404', '/_app', '/_document', '/_error', '/api/customer/[...path]', '/profile', '/submissions/[id]', '/submit'].sort());
const routes = JSON.parse(readFileSync(join(app, '.next/routes-manifest.json'), 'utf8'));
assert.equal(routes.basePath, '/account');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
for (const path of walk(join(app, '.next/static')).filter(path => path.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /ATLAS_CUSTOMER_(?:DATABASE_URL|SESSION_KEY|PHONE_KEY|ROUTER_KEY|TWILIO_API_KEY_SECRET)|atlas_staff\.\"|customer_call\(/, 'Server-only customer authority leaked into a browser chunk');
}
console.log('PASS customer build: isolated /account routes, dedicated assets and no server credentials in browser chunks');
