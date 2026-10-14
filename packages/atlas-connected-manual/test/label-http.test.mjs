import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelSheetsHandler } from '../src/label-sheet-http.mjs';
import { isManualServicePath, manualResponsePolicy } from '../src/transport.mjs';

const origin = 'https://atlasgrading.com', id = 'bca3a38d-527f-4f0e-881d-27caa6880f2d';
const base = '/api/staff/manual-connected', sheet = `${base}/label-sheets/${id}`, item = `${base}/labels/${id}`;
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; },
  json(value) { this.value = value; }, send(bytes) { this.bytes = bytes; } });
const request = (url, method = 'GET', body) => ({ url, method, body, headers: { cookie: 'session', origin, 'content-type': 'application/json', 'x-atlas-csrf': 'csrf' } });

test('only exact label paths and bounded SVG artwork enter the signed transport', () => {
  for (const path of [`${base}/label-sheets`, `${base}/label-sheets?cursor=20`, sheet, `${sheet}/exports`, `${sheet}/exports/${id}`,
    `${sheet}/exports/${id}/download`, `${sheet}/print-confirmations`, `${item}/artwork?mode=preview`, `${item}/artwork?mode=print`,
    `${item}/exports`, `${item}/exports/${id}`, `${item}/exports/${id}/download`, `${item}/reprints`]) assert.equal(isManualServicePath(path), true, path);
  for (const path of [`${base}/label-sheets?cursor=-1`, `${base}/label-sheets?cursor=20&cursor=40`, `${sheet}/delete`,
    `${item}/artwork?mode=preview&url=https://evil.invalid`, `${item}/exports?mode=preview`, `${item}/artwork?mode=other`,
    `${sheet}/exports/${id}/download?token=anything`]) assert.equal(isManualServicePath(path), false, path);
  assert.equal(manualResponsePolicy(`${item}/artwork?mode=preview`, 'image/svg+xml').limit, 1024 * 1024);
  assert.throws(() => manualResponsePolicy(`${sheet}/exports/${id}`, 'image/svg+xml'));
  assert.throws(() => manualResponsePolicy(`${sheet}/exports/${id}/download`, 'image/png'));
});

test('mutating label actions require current cookie and CSRF, wake processing and never call hardware', async () => {
  const calls = [], staff = Object.freeze({ id: 'opaque' });
  const connected = { labels: { async prepareSheetExport(...args) { calls.push(args); return { state: 'PREPARING' }; } },
    labelWorker: { wake() { calls.push('wake'); } }, station: { finish() { assert.fail('No hardware'); } } };
  const boundary = { async authenticate(cookie, csrf) { assert.equal(cookie, 'session'); assert.equal(csrf, 'csrf'); return staff; } };
  const handle = createLabelSheetsHandler({ connected, boundary, origin });
  for (const headers of [{ origin: 'https://evil.invalid' }, { 'x-atlas-csrf': '' }, { 'content-type': 'text/plain' }]) {
    const req = request(`${sheet}/exports`, 'POST', {}); Object.assign(req.headers, headers);
    await assert.rejects(handle(req, response(), new URL(req.url, origin)), { code: 'CSRF_REQUIRED' });
  }
  assert.equal(calls.length, 0);
  const req = request(`${sheet}/exports`, 'POST', { requestId: id, expectedSheetRevision: 7 }), res = response();
  assert.equal(await handle(req, res, new URL(req.url, origin)), true);
  assert.deepEqual(calls, [[staff, id, req.body], 'wake']);
  assert.deepEqual(res.value, { state: 'PREPARING' });
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('preview is a bounded authenticated SVG response; reads do not start queue work', async () => {
  const staff = {}, bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const handle = createLabelSheetsHandler({ origin, boundary: { async authenticate(cookie, csrf) { assert.equal(cookie, 'session'); assert.equal(csrf, undefined); return staff; } },
    connected: { labels: { async artwork(actual, input) { assert.equal(actual, staff); assert.deepEqual(input, { itemId: id, mode: 'print' }); return { bytes, contentType: 'image/svg+xml' }; } },
      labelWorker: { wake() { assert.fail('Read cannot process'); } } } });
  const req = request(`${item}/artwork?mode=print`), res = response();
  await handle(req, res, new URL(req.url, origin));
  assert.equal(res.bytes, bytes);
  assert.equal(res.headers['Content-Type'], 'image/svg+xml');
  assert.match(res.headers['Content-Security-Policy'], /sandbox/);
  await assert.rejects(handle(request(`${item}/artwork?mode=print&mode=preview`), response(), new URL(`${item}/artwork?mode=print&mode=preview`, origin)), { code: 'LABEL_ARTWORK_MODE_INVALID' });
});
