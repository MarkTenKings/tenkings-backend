/** One compact last-request journal per staff/card. Recovery reads the exact
 * recorded analysis; a new paid request always requires a new human action. */
export function createDefectAnalysisClient({ cardId, staffId, storage, request, onAnalysis = () => {}, uuid = () => crypto.randomUUID() }) {
  const path = `/api/staff/manual-connected/cards/${encodeURIComponent(cardId)}/defect-analysis`;
  const key = `atlas-defect-analysis:v1:${staffId}:${cardId}`;
  const statuses = ['IDLE', 'RUNNING', 'UNKNOWN', 'REFUSED', 'FAILED', 'READY', 'STALE'];
  let active = false, disposed = false, projection = null;
  const fail = code => Object.assign(new Error(code), { code });
  const clone = value => JSON.parse(JSON.stringify(value));
  const replacementValid = value => value && Object.keys(value).length === 2
    && /^[a-f0-9-]{36}$/i.test(value.analysisId) && /^[a-f0-9]{64}$/.test(value.outcomeHash);
  function read() {
    const raw = storage.getItem(key); if (!raw) return null;
    try {
      if (raw.length > 16384) throw Error();
      const record = JSON.parse(raw), body = record.body;
      if (record.version !== 1 || !['PENDING', 'SETTLED'].includes(record.phase) || typeof record.canResume !== 'boolean'
        || record.followLatest !== undefined && (record.followLatest !== true || record.phase !== 'SETTLED' || record.canResume)
        || typeof body?.actionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.actionId)
        || Object.keys(body).some(name => !['actionId', 'base', 'replacement'].includes(name))
        || body.replacement !== undefined && !replacementValid(body.replacement)
        || !['FRONT', 'BACK'].every(side => body.base?.[side]?.cardId === cardId && body.base[side].side === side)) throw Error();
      return { record, raw };
    } catch { throw fail('MANUAL_ANALYSIS_JOURNAL_INVALID'); }
  }
  function replace(before, record) {
    if (storage.getItem(key) !== before.raw) return false;
    storage.setItem(key, JSON.stringify(record)); return true;
  }
  function emit(value) { projection = clone(value); if (!disposed) onAnalysis(projection); }
  function unknown(before, canResume = false) {
    const record = { ...before.record, phase: 'PENDING', canResume };
    if (!replace(before, record)) return;
    const accepted = projection?.analysisId === record.body.actionId && projection.backgroundAccepted === true;
    emit({ enabled: true, status: 'UNKNOWN', analysisId: record.body.actionId, base: record.body.base, proposals: [], resumeAvailable: canResume,
      ...(accepted ? { backgroundAccepted: true, ...(projection.collectionStopped ? { collectionStopped: true } : {}) } : {}) });
  }
  async function followLatest(before) {
    if (storage.getItem(key) !== before.raw) throw fail('MANUAL_ANALYSIS_CHANGED');
    if (projection?.analysisId !== before.record.body.actionId || !projection.followLatest)
      emit({ enabled: true, status: 'REFUSED', analysisId: before.record.body.actionId, base: before.record.body.base,
        proposals: [], resumeAvailable: false, followLatest: true });
    const result = await request(path), astra = result?.astra;
    if (!astra || typeof astra.enabled !== 'boolean' || !statuses.includes(astra.status)
      || result.followLatest === true || astra.analysisId === before.record.body.actionId)
      throw fail('MANUAL_ANALYSIS_RESPONSE_INVALID');
    // The exact refused action is already durably settled. Only retire this
    // unchanged browser journal; never erase a newer action from another tab.
    if (storage.getItem(key) === before.raw) {
      storage.removeItem(key);
      emit({ ...astra, resumeAvailable: false });
    }
    return result;
  }
  async function receive(before, result) {
    if (result?.state === 'NOT_FOUND') { unknown(before, true); return result; }
    const astra = result?.astra;
    if (!astra || typeof astra.enabled !== 'boolean' || !statuses.includes(astra.status)
      || astra.analysisId !== before.record.body.actionId) throw fail('MANUAL_ANALYSIS_RESPONSE_INVALID');
    if (astra.replacement !== undefined && astra.replacement !== null
      && (!replacementValid(astra.replacement) || astra.replacement.analysisId !== astra.analysisId
        || astra.status !== 'UNKNOWN' || astra.backgroundAccepted)) throw fail('MANUAL_ANALYSIS_RESPONSE_INVALID');
    if (result.followLatest === true) {
      if (result.state !== 'REFUSED' || astra.status !== 'REFUSED' || astra.resumeAvailable === true)
        throw fail('MANUAL_ANALYSIS_RESPONSE_INVALID');
      if (!replace(before, { ...before.record, phase: 'SETTLED', canResume: false, followLatest: true })) return result;
      const settled = read();
      emit({ ...astra, resumeAvailable: false, followLatest: true });
      return followLatest(settled);
    }
    const pending = ['RUNNING', 'UNKNOWN'].includes(astra.status) || result.state === 'PREPARED';
    const canResume = result.state === 'PREPARED';
    if (replace(before, { ...before.record, phase: pending ? 'PENDING' : 'SETTLED', canResume })) emit({ ...astra, resumeAvailable: canResume });
    return result;
  }
  async function exclusive(work) {
    if (active) throw fail('MANUAL_ANALYSIS_BUSY');
    active = true; try { return await work(); } finally { active = false; }
  }
  async function send(before) {
    if (storage.getItem(key) !== before.raw) throw fail('MANUAL_ANALYSIS_CHANGED');
    emit({ enabled: true, status: 'RUNNING', analysisId: before.record.body.actionId, base: before.record.body.base, proposals: [] });
    try { return await receive(before, await request(path, { method: 'POST', body: clone(before.record.body) })); }
    catch (error) { unknown(before); throw error; }
  }
  return Object.freeze({
    current: () => projection,
    hasPending: () => read()?.record.phase === 'PENDING',
    start: input => exclusive(async () => {
      const saved = read();
      if (saved?.record.phase === 'PENDING' || saved?.record.followLatest || projection?.followLatest
        || ['RUNNING', 'UNKNOWN'].includes(projection?.status)) throw fail('MANUAL_ANALYSIS_PENDING');
      const record = { version: 1, phase: 'PENDING', canResume: false, body: { actionId: uuid(), base: clone(input.base) } };
      const raw = JSON.stringify(record); storage.setItem(key, raw);
      const before = read();
      if (before.raw !== raw) throw fail('MANUAL_ANALYSIS_CHANGED');
      return send(before);
    }),
    replace: input => exclusive(async () => {
      const previous = read(), replacement = projection?.replacement;
      if (projection?.status !== 'UNKNOWN' || projection.backgroundAccepted || !replacementValid(replacement)
        || replacement.analysisId !== projection.analysisId
        || previous && previous.record.body.actionId !== replacement.analysisId) throw fail('MANUAL_ANALYSIS_RECONCILE_REQUIRED');
      // A fresh explicit human action names the retained unknown request. It
      // never reuses its dispatch identity or silently clears another tab's work.
      const beforeRaw = previous?.raw ?? null;
      const record = { version: 1, phase: 'PENDING', canResume: false,
        body: { actionId: uuid(), base: clone(input.base), replacement: clone(replacement) } };
      if (record.body.actionId === replacement.analysisId || storage.getItem(key) !== beforeRaw) throw fail('MANUAL_ANALYSIS_CHANGED');
      const raw = JSON.stringify(record); storage.setItem(key, raw);
      const saved = read(); if (saved.raw !== raw) throw fail('MANUAL_ANALYSIS_CHANGED');
      return send(saved);
    }),
    refresh: () => exclusive(async () => {
      const before = read();
      if (!before) {
        const result = await request(path);
        // A read begun before another client recorded a request must not
        // replace that client's newer analysis with an earlier latest result.
        if (!read() && result?.astra && typeof result.astra.enabled === 'boolean' && statuses.includes(result.astra.status))
          emit({ ...result.astra, resumeAvailable: false });
        return result;
      }
      if (before.record.followLatest) return followLatest(before);
      try { return await receive(before, await request(`${path}/${before.record.body.actionId}`)); }
      catch (error) { if (before.record.phase === 'PENDING') unknown(before); throw error; }
    }),
    resume: () => exclusive(async () => {
      const before = read();
      if (!before || before.record.phase !== 'PENDING' || !before.record.canResume) throw fail('MANUAL_ANALYSIS_RECONCILE_REQUIRED');
      if (!replace(before, { ...before.record, canResume: false })) throw fail('MANUAL_ANALYSIS_CHANGED');
      return send(read());
    }),
    dispose() { disposed = true; },
  });
}
