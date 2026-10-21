import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_ENTRY_STORAGE_KEY, REPORT_ENTRY_HISTORY_KEY, REPORT_ENTRY_MAX_AGE_MS,
  staffCardDetailPath, rememberCardDetailReportEntry, rememberCardDetailReportClick, readCardDetailReportEntry,
} from '../report-entry.mjs';

const origin = 'https://atlasgrading.com', now = 1792627200000;
const cardId = '95ef2d5a-0d49-425f-bd8f-30fa1e444516', cardPath = `/admin/graded-cards/${cardId}`;
const reportPath = `/reports/ar_${'a'.repeat(24)}?v=2`;
function browser(path = cardPath, siteOrigin = origin) {
  const values = new Map();
  return {
    location: { href: `${siteOrigin}${path}` },
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    history: { state: { __N: true }, replaceState(state, title, url) { assert.equal(url, undefined); this.state = state; } },
  };
}
const context = () => ({ version: 1, origin, cardPath, reportPath, createdAt: now });

test('same-tab report entry keeps exact version and private return state out of the URL', () => {
  const b = browser();
  assert.equal(rememberCardDetailReportEntry(reportPath, cardId, b, now), true);
  assert.equal(b.location.href, `${origin}${cardPath}`);
  b.location.href = `${origin}${reportPath}`;
  assert.equal(readCardDetailReportEntry(reportPath, b, now + 1), cardPath);
  assert.equal(b.location.href, `${origin}${reportPath}`);
  assert.equal(b.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY), null);
  assert.equal(b.history.state.__N, true);
  assert.deepEqual(b.history.state[REPORT_ENTRY_HISTORY_KEY], context());
  assert.equal(readCardDetailReportEntry(reportPath, b, now + 1000), cardPath, 'reload/back restores this entry');
  b.history.state = { __N: true };
  assert.equal(readCardDetailReportEntry(reportPath, b, now + 1001), null, 'a fresh direct entry has no remembered return');
});

test('only canonical current staff detail and an exact versioned report can create a handoff', () => {
  assert.equal(staffCardDetailPath(cardId), cardPath);
  for (const invalid of [null, '', `${cardId}/extra`, cardId.toUpperCase(), `../${cardId}`, 'https://example.com']) assert.equal(staffCardDetailPath(invalid), null);
  for (const bad of [reportPath.replace('?v=2', ''), reportPath.replace('?v=2', '?v=02'), reportPath.replace('?v=2', '?v=2147483648'), `${reportPath}&returnTo=${cardPath}`, `${reportPath}#private`, `https://example.com${reportPath}`, `//evil.test${reportPath}`]) {
    assert.equal(rememberCardDetailReportEntry(bad, cardId, browser(), now), false, bad);
  }
  for (const bad of ['/admin/graded-cards', '/account', '/admin', `${cardPath}/extra`, cardPath.replace('/admin', '')]) {
    assert.equal(rememberCardDetailReportEntry(reportPath, cardId, browser(bad), now), false, bad);
  }
  assert.equal(rememberCardDetailReportEntry(reportPath, cardId, browser(cardPath, 'https://evil.test'), now), false);
  assert.equal(rememberCardDetailReportEntry(reportPath, cardId, browser(cardPath, 'http://127.0.0.1:58609'), now), true);
});

test('missing, unrelated, expired, future and malformed context never produce a return link', () => {
  assert.equal(readCardDetailReportEntry(reportPath, browser(reportPath), now), null);
  const cases = [null, [], { ...context(), reportPath: reportPath.replace('?v=2', '?v=1') }, { ...context(), origin: 'https://evil.test' },
    { ...context(), createdAt: now + 1 }, { ...context(), createdAt: now - 120001 }, { ...context(), version: 2 },
    { ...context(), privateCustomer: 'should never render' }, { ...context(), createdAt: '1792627200000' }];
  for (const candidate of cases) {
    const b = browser(reportPath); b.sessionStorage.setItem(REPORT_ENTRY_STORAGE_KEY, JSON.stringify(candidate));
    assert.equal(readCardDetailReportEntry(reportPath, b, now), null, JSON.stringify(candidate));
    assert.equal(b.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY), null);
  }
  for (const raw of ['{broken', 'x'.repeat(1025)]) {
    const b = browser(reportPath); b.sessionStorage.setItem(REPORT_ENTRY_STORAGE_KEY, raw);
    assert.equal(readCardDetailReportEntry(reportPath, b, now), null);
  }
  const b = browser(reportPath); b.history.state[REPORT_ENTRY_HISTORY_KEY] = context();
  assert.equal(readCardDetailReportEntry(reportPath, b, now + REPORT_ENTRY_MAX_AGE_MS + 1), null);
});

test('external, encoded, query-bearing and unsupported return routes fail closed in both stores', () => {
  for (const cardTarget of [`https://evil.test${cardPath}`, `//evil.test${cardPath}`, `/\\evil.test${cardPath}`, `javascript:alert(1)`,
    `${cardPath}?returnTo=https://evil.test`, `${cardPath}#x`, `/admin/graded-cards/../${cardId}`, cardPath.replace('/admin', '/%61dmin'),
    cardPath.replace('/admin/', '/admin%2f'), `/account/cards/${cardId}`, `/cards/${cardId}`, `/admin/manual/${cardId}`, `${cardPath}\n`]) {
    for (const store of ['session', 'history']) {
      const b = browser(reportPath), value = { ...context(), cardPath: cardTarget };
      if (store === 'session') b.sessionStorage.setItem(REPORT_ENTRY_STORAGE_KEY, JSON.stringify(value));
      else b.history.state[REPORT_ENTRY_HISTORY_KEY] = value;
      assert.equal(readCardDetailReportEntry(reportPath, b, now), null, `${store}: ${cardTarget}`);
    }
  }
});

test('current report mismatch, omitted version and extra return parameters cannot borrow context', () => {
  for (const path of [reportPath.replace('?v=2', '?v=1'), reportPath.replace('?v=2', ''), `${reportPath}&returnTo=${cardPath}`]) {
    const b = browser(path); b.sessionStorage.setItem(REPORT_ENTRY_STORAGE_KEY, JSON.stringify(context()));
    assert.equal(readCardDetailReportEntry(reportPath, b, now), null);
    assert.equal(b.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY), null);
  }
});

test('blocked browser storage/history never prevents ordinary report access', () => {
  const b = browser();
  b.sessionStorage.setItem = () => { throw new Error('Storage unavailable'); };
  assert.equal(rememberCardDetailReportEntry(reportPath, cardId, b, now), false);
  b.location.href = `${origin}${reportPath}`;
  b.sessionStorage.getItem = () => { throw new Error('Storage unavailable'); };
  assert.equal(readCardDetailReportEntry(reportPath, b, now), null);
  b.history.state[REPORT_ENTRY_HISTORY_KEY] = context();
  b.history.replaceState = () => { throw new Error('History unavailable'); };
  assert.equal(readCardDetailReportEntry(reportPath, b, now), cardPath);
  assert.equal(readCardDetailReportEntry(reportPath, undefined, now), null);
});

test('modified and auxiliary clicks do not create a pending same-tab handoff', () => {
  for (const event of [{ button: 1 }, { button: 2 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true },
    { button: 0, shiftKey: true }, { button: 0, altKey: true }, { button: 0, defaultPrevented: true }]) {
    const b = browser();
    assert.equal(rememberCardDetailReportClick(event, reportPath, cardId, b), false);
    assert.equal(b.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY), null);
  }
  assert.equal(rememberCardDetailReportClick({ button: 0 }, reportPath, cardId, browser()), true);
});
