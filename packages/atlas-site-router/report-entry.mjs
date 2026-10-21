import { SITE_ORIGIN, ZONES } from './routes.mjs';

export const REPORT_ENTRY_STORAGE_KEY = 'atlas:report-entry:v1';
export const REPORT_ENTRY_HISTORY_KEY = 'atlasReportEntryV1';
export const REPORT_ENTRY_MAX_AGE_MS = 30 * 60 * 1000;
const handoffMaxAge = 2 * 60 * 1000;
const cardIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const capturedBrowsers = new WeakSet(), bootstrapEntries = new WeakMap();

export function staffCardDetailPath(cardId) {
  return typeof cardId === 'string' && cardIdPattern.test(cardId) ? `${ZONES.staff}/graded-cards/${cardId}` : null;
}

function reportPathValid(path) {
  if (typeof path !== 'string') return false;
  const match = /^\/reports\/ar_[A-Za-z0-9_-]{24}\?v=([1-9][0-9]{0,9})$/.exec(path);
  return Boolean(match && Number(match[1]) <= 2147483647);
}

function locationFor(browser) {
  const url = new URL(browser.location.href);
  if (url.origin !== SITE_ORIGIN && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return null;
  return url;
}

function validContext(value, reportPath, origin, now, maxAge) {
  return value && Object.keys(value).sort().join(',') === 'cardPath,createdAt,origin,reportPath,version'
    && value.version === 1 && value.origin === origin && value.reportPath === reportPath && reportPathValid(value.reportPath)
    && typeof value.cardPath === 'string' && staffCardDetailPath(value.cardPath.slice(`${ZONES.staff}/graded-cards/`.length)) === value.cardPath
    && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 && value.createdAt <= now && now - value.createdAt <= maxAge;
}

// Next's Pages Router replaces history.state before the first React render.
// Capture this document's existing entry before router bootstrap, once only.
// No report-to-card mapping is retained in storage or reused by a fresh entry.
export function captureCardDetailReportEntry(browser = globalThis.window, now = Date.now()) {
  try {
    if (!browser || capturedBrowsers.has(browser)) return false;
    capturedBrowsers.add(browser);
    const url = locationFor(browser), reportPath = url && `${url.pathname}${url.search}`;
    const saved = browser.history.state?.[REPORT_ENTRY_HISTORY_KEY];
    if (!url || !Number.isSafeInteger(now) || now <= 0
      || !validContext(saved, reportPath, url.origin, now, REPORT_ENTRY_MAX_AGE_MS)) return false;
    bootstrapEntries.set(browser, { ...saved });
    return true;
  } catch { return false; }
}

// A local handoff, never a URL parameter or public report field. Only the exact
// staff detail currently open can establish it; the destination still authenticates.
export function rememberCardDetailReportEntry(reportPath, cardId, browser = globalThis.window, now = Date.now()) {
  try {
    const url = locationFor(browser), cardPath = staffCardDetailPath(cardId);
    browser.sessionStorage.removeItem(REPORT_ENTRY_STORAGE_KEY);
    if (!url || !cardPath || url.pathname !== cardPath || !reportPathValid(reportPath) || !Number.isSafeInteger(now) || now <= 0) return false;
    browser.sessionStorage.setItem(REPORT_ENTRY_STORAGE_KEY, JSON.stringify({ version: 1, origin: url.origin, reportPath, cardPath, createdAt: now }));
    return true;
  } catch { return false; }
}

export function rememberCardDetailReportClick(event, reportPath, cardId, browser = globalThis.window) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return rememberCardDetailReportEntry(reportPath, cardId, browser);
}

// Consume the pending handoff once. Keep it only on this history entry so a
// reload/back-forward visit retains the link, while a fresh direct/NFC visit does
// not inherit an old report-to-card mapping. Storage failures leave reports usable.
export function readCardDetailReportEntry(reportPath, browser = globalThis.window, now = Date.now()) {
  try {
    const bootstrapped = bootstrapEntries.get(browser);
    bootstrapEntries.delete(browser);
    let pending = null;
    try {
      const raw = browser.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY);
      browser.sessionStorage.removeItem(REPORT_ENTRY_STORAGE_KEY);
      if (raw && raw.length <= 1024) pending = JSON.parse(raw);
    } catch { /* Direct report access never depends on browser storage. */ }
    const url = locationFor(browser);
    if (!url || !reportPathValid(reportPath) || `${url.pathname}${url.search}` !== reportPath || !Number.isSafeInteger(now) || now <= 0) return null;
    const saved = browser.history.state?.[REPORT_ENTRY_HISTORY_KEY];
    const context = validContext(pending, reportPath, url.origin, now, handoffMaxAge) ? pending
      : validContext(saved, reportPath, url.origin, now, REPORT_ENTRY_MAX_AGE_MS) ? saved
        : validContext(bootstrapped, reportPath, url.origin, now, REPORT_ENTRY_MAX_AGE_MS) ? bootstrapped : null;
    if (!context) return null;
    try { browser.history.replaceState({ ...browser.history.state, [REPORT_ENTRY_HISTORY_KEY]: context }, ''); }
    catch { /* The initial return link still works when history writes are blocked. */ }
    return context.cardPath;
  } catch { return null; }
}
