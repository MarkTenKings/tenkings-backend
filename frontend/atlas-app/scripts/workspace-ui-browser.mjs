import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from '../lib/server/policy.mjs';

/** Actual Chrome UI, real local auth/DB/HTTP. Only the declared synthetic HTTPS
 * object destination is intercepted; its bytes go to the owned fixture store. */
export async function verifyWorkspaceBrowser({ directory, toolModules, assets, restart }) {
    const { chromium } = createRequire(join(toolModules, '__workspace_browser__.cjs'))('playwright');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, ignoreHTTPSErrors: true }), page = await context.newPage();
    const origin = 'http://127.0.0.1:4318', uploadOrigin = 'https://workspace-uploads.example.test', checks = [], pageErrors = [], puts = [], operations = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const mark = name => { checks.push(name); console.log(JSON.stringify({ check: name, status: 'PASS' })); };
    const screenshot = name => page.screenshot({ path: join(directory, 'workspace-screenshots', `${name}.png`), fullPage: false });
    const until = async (read, message, timeout = 30_000) => { const deadline = Date.now() + timeout; while (!await read()) { assert(Date.now() < deadline, message); await delay(100); } };
    const get = async path => { const response = await context.request.get(`${origin}/admin/api/staff/${path}`); assert.equal(response.status(), 200, await response.text()); return response.json(); };
    let lostPut = false, lostComplete = false;
    const certificate = join(directory, 'workspace-tls.crt'), privateKey = join(directory, 'workspace-tls.key');
    const tls = spawnSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey, '-out', certificate, '-days', '1', '-subj', '/CN=owned-workspace-fixture'], { encoding: 'utf8' });
    assert.equal(tls.status, 0, 'Owned loopback TLS fixture certificate creation failed');
    const storage = createServer({ key: readFileSync(privateKey), cert: readFileSync(certificate) }, async (request, response) => {
        try {
            assert(['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress));
            const id = request.url.slice(1); assert.match(id, /^[a-f0-9-]{36}$/);
            const path = join(directory, 'workspace-objects', id), plan = JSON.parse(readFileSync(`${path}.json`, 'utf8'));
            const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'PUT,OPTIONS', 'access-control-allow-headers': 'content-type,if-none-match' };
            if (request.method === 'OPTIONS') { response.writeHead(204, headers); response.end(); return; }
            assert.equal(request.method, 'PUT'); assert.equal(request.headers['if-none-match'], '*');
            const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
            assert.equal(hash(bytes), plan.sha256); assert.equal(bytes.length, plan.byteCount);
            const existing = existsSync(path); puts.push({ id, existing, sha256: hash(bytes) });
            if (!existing) writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
            if (!lostPut) { lostPut = true; request.socket.destroy(); return; }
            response.writeHead(existing ? 412 : 200, headers); response.end();
        } catch (error) { pageErrors.push(`Owned storage fixture: ${error.message}`); response.writeHead(500); response.end(); }
    });
    await new Promise((done, reject) => { storage.once('error', reject); storage.listen(0, '127.0.0.1', done); });
    const storageOrigin = `https://127.0.0.1:${storage.address().port}`;
    await context.route(/^https?:\/\//, async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === uploadOrigin) {
            const id = url.pathname.slice(1); assert.match(id, /^[a-f0-9-]{36}$/);
            assert(existsSync(join(directory, 'workspace-objects', `${id}.json`)));
            return route.continue({ url: `${storageOrigin}/${id}` });
        }
        assert.equal(url.origin, origin, 'Browser must not contact any provider or external site');
        if (url.pathname.includes('/workspace/cards') && request.method() === 'POST') {
            const body = request.postDataJSON(); operations.push({ path: url.pathname, body });
            if (url.pathname.endsWith('/upload-complete') && !lostComplete) {
                const response = await route.fetch(); assert.equal(response.status(), 200, await response.text()); lostComplete = true; return route.abort('failed');
            }
        }
        return route.continue();
    });
    async function action(button, name) {
        const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/action')
            && response.request().method() === 'POST' && response.request().postDataJSON().action === name), button.click()]);
        assert.equal(response.status(), 200, await response.text()); return response.json();
    }
    async function setBoundary(side) {
        const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Mark the physical card boundary', exact: true }) });
        await section.getByRole('button', { name: side === 'FRONT' ? 'Front' : 'Back', exact: true }).click();
        const editor = section.locator(`svg[aria-label="${side === 'FRONT' ? 'Front' : 'Back'} physical card boundary editor"]`);
        await editor.waitFor(); const box = await editor.boundingBox(); assert(box);
        for (const [x, y] of [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]) await editor.click({ position: { x: box.width * x, y: box.height * y } });
        const result = await action(section.getByRole('button', { name: 'Save card boundary', exact: true }), 'SAVE_BOUNDARY');
        assert.equal(result.card.workspace.preparation[side].corners.length, 4); return section;
    }
    try {
        await page.goto(`${origin}/admin/`);
        await page.getByLabel('Phone number', { exact: true }).fill('+12025550141');
        await page.getByRole('button', { name: 'Request sign-in code' }).click();
        await page.getByLabel('Verification code', { exact: true }).fill('424242');
        await page.getByRole('button', { name: 'Verify & open workspace' }).click();
        await page.waitForURL('**/admin/grading'); await page.locator('main').getByRole('link', { name: '+ Add cards', exact: true }).click();
        await page.getByRole('heading', { name: 'Add cards', exact: true }).waitFor();
        await until(async () => await page.getByLabel('Short name', { exact: true }).count() === 1, 'Initial local photo draft did not open');
        await screenshot('01-add-cards-empty'); mark('real fictional-code staff login opens Add cards');
        for (let index = 0; index < 10; index++) {
            if (index) { await page.getByRole('button', { name: '+ Add another card', exact: true }).click(); await until(async () => await page.getByLabel('Short name', { exact: true }).count() === index + 1, 'Next card draft did not open'); }
            await page.getByLabel('Short name', { exact: true }).nth(index).fill(`Synthetic fixture ${String(index + 1).padStart(2, '0')}`);
            await page.getByRole('combobox', { name: /^Card type/ }).nth(index).selectOption('SPORTS');
            for (const [sideIndex, side] of ['FRONT', 'BACK'].entries()) {
                const asset = assets.find(asset => asset.index === index + 1 && asset.side === side);
                await page.locator('input[type="file"]').nth(index * 2 + sideIndex).setInputFiles(join(directory, 'workspace-assets', asset.file));
            }
        }
        await page.evaluate(() => scrollTo(0, 0)); await screenshot('02-batch-pairs-selected');
        assert.equal(await page.getByRole('button', { name: '+ Add another card', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: 'Upload all selected photos', exact: true }).click();
        await page.getByText('The upload reply was interrupted. Your photograph and saved upload are kept.', { exact: true }).waitFor();
        await page.reload(); await page.getByRole('button', { name: 'Upload all selected photos', exact: true }).click();
        await until(async () => lostComplete && await page.getByRole('button', { name: 'Recover saved request', exact: true }).isEnabled(), 'Lost completion did not settle into recoverable state');
        await page.getByRole('button', { name: 'Recover saved request', exact: true }).scrollIntoViewIfNeeded();
        await screenshot('03-upload-recovery');
        const originalComplete = operations.find(operation => operation.path.endsWith('/upload-complete'));
        await page.reload(); await page.getByRole('button', { name: 'Recover saved request', exact: true }).click();
        await until(async () => await page.getByRole('button', { name: 'Recover saved request', exact: true }).count() === 0
            && await page.getByRole('button', { name: 'Upload all selected photos', exact: true }).isEnabled()
            && (await get('workspace')).cards[0].sides.every(side => side.status === 'VERIFIED'), 'Exact completion did not recover');
        const completions = operations.filter(operation => operation.path === originalComplete.path && operation.body.uploadId === originalComplete.body.uploadId);
        assert.equal(completions.length, 2); assert.deepEqual(completions[1].body, originalComplete.body);
        assert.equal(puts.filter(put => put.id === puts[0].id).length, 2); assert.equal(puts[1].existing, true);
        mark('real reload retains photo Files, same PUT object and exact lost completion operation');
        await page.getByRole('button', { name: 'Upload all selected photos', exact: true }).click();
        await until(async () => (await get('workspace')).cards.length === 10 && (await get('workspace')).cards.every(card => card.sides.every(side => side.status === 'VERIFIED')), 'Ten real database photo pairs did not verify', 90_000);
        const queueButtons = page.getByRole('button', { name: 'Add to Waiting to grade' });
        assert.equal(await queueButtons.count(), 10); assert.equal(await queueButtons.first().isDisabled(), true);
        assert.equal((await get('workspace')).cards.filter(card => card.state !== 'DRAFT').length, 0);
        for (let index = 0; index < 10; index++) {
            await page.getByRole('checkbox').first().check(); await queueButtons.first().click();
            await until(async () => await queueButtons.count() === 9 - index, 'Confirmed card did not enter Waiting');
        }
        await page.getByRole('link', { name: 'View grading queues' }).click();
        await page.getByRole('heading', { name: 'Waiting to grade', exact: true }).waitFor();
        await until(async () => await page.getByRole('button', { name: 'Grade this card', exact: true }).count() === 10, 'Waiting queue did not show all ten cards');
        await screenshot('04-ten-waiting-cards'); mark('ten verified Front/Back pairs require separate human confirmation before queue');
        const saved = (await get('workspace')).cards, first = saved[0];
        const access = await get('session');
        const overflow = await context.request.post(`${origin}/admin/api/staff/workspace/cards`, { headers: { Origin: origin, 'X-Atlas-Csrf': access.csrf }, data: { operationId: randomUUID(), title: 'Synthetic overflow', identity: {} } });
        assert.equal(overflow.status(), 409); assert.equal((await overflow.json()).error, 'WORKSPACE_PILOT_FULL');
        await page.getByRole('button', { name: 'Grade this card', exact: true }).first().click();
        await page.waitForURL(`**/admin/workspace/${first.id}`);
        await page.getByRole('combobox', { name: /^Physical card corners/ }).waitFor();
        assert.equal(await page.getByRole('combobox', { name: /^Physical card corners/ }).inputValue(), 'ROUNDED_3_18_MM');
        await page.getByRole('combobox', { name: /^Physical card corners/ }).selectOption('SQUARE');
        for (const [label, value] of [['Player name', 'Synthetic fixture 01'], ['Year', '2026'], ['Manufacturer', 'Synthetic fixture'], ['Product / set', 'Local visual validation'], ['Card number', '01']]) await page.getByLabel(label, { exact: true }).fill(value);
        await page.reload(); assert.equal(await page.getByRole('combobox', { name: /^Physical card corners/ }).inputValue(), 'SQUARE');
        await until(() => page.locator('main img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), 'Saved original image did not load');
        await page.getByRole('button', { name: 'Save confirmed identity' }).scrollIntoViewIfNeeded();
        await screenshot('05-human-identity');
        const identity = await action(page.getByRole('button', { name: 'Save confirmed identity' }), 'SAVE_IDENTITY');
        assert.equal(identity.card.workspace.cornerShape, 'SQUARE'); mark('human claim and category-specific identity/corner drafts survive reload');
        await page.getByRole('navigation', { name: 'Card grading stages' }).getByRole('button', { name: 'Prepare images' }).click();
        const front = await setBoundary('FRONT'); await screenshot('06-front-boundary');
        const prepared = await action(front.getByRole('button', { name: 'Prepare front image' }), 'PREPARE_SIDE');
        assert(prepared.card.workspace.pending); await page.getByRole('button', { name: 'Check saved result', exact: true }).scrollIntoViewIfNeeded(); await screenshot('07-preparation-pending');
        await restart(); await page.reload();
        await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
        await until(async () => !(await get(`workspace/cards/${first.id}`)).card.workspace.pending, 'Saved source result did not recover');
        const back = await setBoundary('BACK'); await action(back.getByRole('button', { name: 'Prepare back image' }), 'PREPARE_SIDE');
        mark('saved external intent recovers after web process restart using one status read');
        await page.getByRole('navigation', { name: 'Card grading stages' }).getByRole('button', { name: 'Centering' }).click();
        const centering = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Review the printed frame', exact: true }) });
        for (const side of ['Front', 'Back']) {
            await centering.getByRole('button', { name: side, exact: true }).click();
            const editor = centering.locator(`svg[aria-label="${side} prepared image and printed frame editor"]`);
            await editor.waitFor(); const box = await editor.boundingBox(); assert(box);
            for (const [x, y] of [[.05625, .0491], [.94375, .0491], [.94375, .9464], [.05625, .9464]]) await editor.click({ position: { x: box.width * x, y: box.height * y } });
            const handle = centering.getByRole('button', { name: 'Top left handle. Use arrow keys to adjust.', exact: true });
            await handle.focus(); await handle.press('ArrowRight');
            await centering.getByRole('checkbox').check();
            const measured = await action(centering.getByRole('button', { name: 'Save and measure centering' }), 'SAVE_CENTERING');
            assert.deepEqual(measured.card.workspace.centering[side.toUpperCase()].outer, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
            assert.equal(typeof measured.card.workspace.centering[side.toUpperCase()].score, 'number');
        }
        await centering.getByRole('button', { name: 'Save and measure centering' }).scrollIntoViewIfNeeded();
        await screenshot('08-centering');
        await page.getByRole('navigation', { name: 'Card grading stages' }).getByRole('button', { name: 'Inspection', exact: false }).click();
        await page.getByRole('heading', { name: 'Inspect corners, edges and surface', exact: true }).waitFor();
        await until(async () => (await get(`workspace/cards/${first.id}`)).card.workspace.map?.status === 'LOOKUP_FAILED', 'Original map lookup projection did not arrive');
        await page.getByRole('button', { name: 'Save decision and continue without map', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Initialize grading report' }).isEnabled(), false);
        assert.equal(await page.getByRole('button', { name: 'Save decision and continue without map', exact: true }).isDisabled(), true);
        await page.getByRole('region', { name: 'Card map check' }).scrollIntoViewIfNeeded(); await screenshot('11-recorded-map-failure');
        await page.getByRole('checkbox', { name: 'I reviewed the recorded map failure and choose human review without applying a card map.' }).check();
        const decision = await action(page.getByRole('button', { name: 'Save decision and continue without map', exact: true }), 'CONTINUE_WITHOUT_MAP');
        assert(decision.card.workspace.pending); await page.reload();
        await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
        await until(async () => (await get(`workspace/cards/${first.id}`)).card.workspace.map?.status === 'HUMAN_REVIEW_WITHOUT_MAP', 'Exact human map decision did not recover');
        await until(() => page.getByRole('button', { name: 'Initialize grading report' }).isEnabled(), 'Report initialization did not unlock after map decision');
        await page.getByRole('region', { name: 'Card map check' }).scrollIntoViewIfNeeded(); await screenshot('12-confirmed-human-map-decision');
        mark('recorded map failure requires explicit human consent and recovers the same saved decision after reload');
        await page.getByRole('button', { name: 'Initialize grading report' }).scrollIntoViewIfNeeded();
        await screenshot('09-inspection'); mark('original images, boundary editor and server-measured fixed-frame centering work in Chrome');
        await page.goto(`${origin}/admin/workspace/${saved[1].id}`);
        await page.getByRole('button', { name: 'Grade this card', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Grade this card', exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: 'Start Astra · step mode', exact: true }).isDisabled(), true);
        await screenshot('10-second-card-held');
        const second = (await get(`workspace/cards/${saved[1].id}`)).card;
        const denied = await context.request.post(`${origin}/admin/api/staff/workspace/cards/${second.id}/claim`, { headers: { Origin: origin, 'X-Atlas-Csrf': (await get('session')).csrf }, data: { operationId: randomUUID(), expectedRevision: second.revision, operator: 'HUMAN' } });
        assert.equal(denied.status(), 409); assert.equal((await denied.json()).error, 'WORKSPACE_CAPABILITY_UNAVAILABLE');
        mark('server enforces ten-card capacity and only the first started card');
        assert.deepEqual(pageErrors, []);
        return { checks, chrome: browser.version(), viewport: { width: 1440, height: 1100 }, firstCardId: first.id,
            distinctOriginals: new Set(assets.map(asset => asset.sha256)).size, physicalCards: 10,
            lostPutRecovered: true, lostCompletionRecovered: true, statusOnlyRecovery: true, explicitMapDecisionRecovered: true, pageErrors };
    } catch (error) {
        await screenshot('failure').catch(() => {}); writeFileSync(join(directory, 'workspace-ui-browser-failure.json'), JSON.stringify({ error: error.stack, checks, pageErrors, puts, operations }, null, 2)); throw error;
    } finally { await context.close(); await browser.close(); await new Promise(done => storage.close(done)); }
}
