/** One compact last-request journal per staff/card. Recovery reads the exact
 * recorded analysis; a new paid request always requires a new human action. */
export function createDefectAnalysisClient({ cardId, staffId, storage, request, onAnalysis = () => {}, uuid = () => crypto.randomUUID() }) {
  const path = `/api/staff/manual-connected/cards/${encodeURIComponent(cardId)}/defect-analysis`;
  const key = `atlas-defect-analysis:v1:${staffId}:${cardId}`;
  const statuses = ['IDLE', 'RUNNING', 'UNKNOWN', 'REFUSED', 'FAILED', 'READY', 'STALE'];
  let active = false, disposed = false, projection = null;
  const fail = code => Object.assign(new Error(code), { code });
  const clone = value => JSON.parse(JSON.stringify(value));
  function read() {
    const raw = storage.getItem(key); if (!raw) return null;
    try {
      if (raw.length > 16384) throw Error();
      const record = JSON.parse(raw), body = record.body;
      if (record.version !== 1 || !['PENDING', 'SETTLED'].includes(record.phase) || typeof record.canResume !== 'boolean'
        || typeof body?.actionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.actionId)
        || Object.keys(body).some(name => !['actionId', 'base'].includes(name))
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
    emit({ enabled: true, status: 'UNKNOWN', analysisId: record.body.actionId, base: record.body.base, proposals: [], resumeAvailable: canResume });
  }
  function receive(before, result) {
    if (result?.state === 'NOT_FOUND') { unknown(before, true); return result; }
    const astra = result?.astra;
    if (!astra || typeof astra.enabled !== 'boolean' || !statuses.includes(astra.status)
      || astra.analysisId !== before.record.body.actionId) throw fail('MANUAL_ANALYSIS_RESPONSE_INVALID');
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
    try { return receive(before, await request(path, { method: 'POST', body: clone(before.record.body) })); }
    catch (error) { unknown(before); throw error; }
  }
  return Object.freeze({
    current: () => projection,
    hasPending: () => read()?.record.phase === 'PENDING',
    start: input => exclusive(async () => {
      if (read()?.record.phase === 'PENDING') throw fail('MANUAL_ANALYSIS_PENDING');
      const record = { version: 1, phase: 'PENDING', canResume: false, body: { actionId: uuid(), base: clone(input.base) } };
      const raw = JSON.stringify(record); storage.setItem(key, raw);
      const before = read();
      if (before.raw !== raw) throw fail('MANUAL_ANALYSIS_CHANGED');
      return send(before);
    }),
    refresh: () => exclusive(async () => {
      const before = read();
      if (!before) {
        const result = await request(path);
        // A read begun before another client recorded a request must not
        // replace that client's newer analysis with an earlier latest result.
        if (!read() && result?.astra && typeof result.astra.enabled === 'boolean' && statuses.includes(result.astra.status)) emit(result.astra);
        return result;
      }
      try { return receive(before, await request(`${path}/${before.record.body.actionId}`)); }
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
