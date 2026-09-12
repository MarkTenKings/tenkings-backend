/** Browser coordinator. Pending compact commands are scoped to staff + card.
 * A missing response retries/reconciles the SAME action ID and exact payload;
 * it never treats an unobserved save as success or invents a second action.
 */
export function createManualClient({ cardId, staffId, csrf, storage, basePath = '', timeoutMs = 45000, fetchImpl = fetch, onView = () => {}, onStatus = () => {} }) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>240000)throw new Error('Invalid request deadline');
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(basePath) && basePath !== '') throw new Error('Invalid staff mount');
  const path = `${basePath}/api/staff/manual/cards/${cardId}`, key = `atlas-manual-pending:v1:${basePath ? `${basePath}:` : ''}${staffId}:${cardId}`;
  let view = null, active = false;
  const pending = () => { const value = storage.getItem(key); return value ? JSON.parse(value) : null; };
  // Another recovery client may finish this command and start a later one
  // while an earlier reply/view is still in flight. Clear only the exact
  // completed or definitely refused request, never just this card's slot.
  function clearPending(command) {
    if (storage.getItem(key) === JSON.stringify(command)) storage.removeItem(key);
  }
  async function request(url, body) {
    const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-atlas-csrf': csrf }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? 'Save unavailable'), { status: response.status, code: result.error });
    return result;
  }
  async function load() { view = await request(`${path}/view`); onView(view); return view; }
  async function finish(command) { await load(); clearPending(command); onStatus('Saved'); return view; }
  async function reconcile(command) {
    const found = await request(`${path}/actions/${command.actionId}`);
    if (found.state === 'COMMITTED') return finish(command);
    if (found.state !== 'NOT_FOUND') throw new Error('Save outcome unknown');
    await request(`${path}/actions`, command);
    return finish(command);
  }
  async function send(command) {
    // Keep reconciliation bound to the bytes journaled before dispatch even
    // if the caller later mutates its action object.
    command = JSON.parse(JSON.stringify(command));
    storage.setItem(key, JSON.stringify(command)); onStatus('Saving…');
    try { await request(`${path}/actions`, command); return await finish(command); }
    catch (error) {
      if ([400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
        clearPending(command); await load().catch(() => {}); onStatus('Change needs review'); throw error;
      }
      try { return await reconcile(command); }
      catch { onStatus('Save not confirmed — retry the pending save'); throw error; }
    }
  }
  async function exclusive(work) {
    if (active) throw new Error('A save is already in progress');
    active = true; try { return await work(); } finally { active = false; }
  }
  return Object.freeze({
    load, current: () => view, hasPending: () => Boolean(pending()),
    recover: () => exclusive(async () => {
      const command = pending(); if (!command) return load();
      await load();
      onStatus('Checking pending save…');
      try { return await reconcile(command); }
      catch (error) {
        if ([400, 401, 403, 404, 409, 413, 422].includes(error.status)) { clearPending(command); await load().catch(() => {}); }
        onStatus('Pending save needs review'); throw error;
      }
    }),
    execute: action => exclusive(async () => {
      if (pending()) throw new Error('Resolve the pending save first');
      if (!view) await load();
      return send({ actionId: crypto.randomUUID(), expectedRevision: view.card.revision, action });
    }),
    editDefect: input => exclusive(async () => {
      if (pending()) throw new Error('Resolve the pending save first');
      if (!view) await load();
      const expectedRevision = view.card.revision;
      const action = input.action.type === 'TRACE_SAVE'
        ? await request(`${path}/trace`, { side: input.side, base: input.base, findingId: input.action.findingId, trace: input.action.trace })
        : { type: 'DEFECT_EDIT', side: input.side, base: input.base, edit: input.action };
      return send({ actionId: crypto.randomUUID(), expectedRevision, action });
    }),
    previewReport: () => request(`${path}/report-preview`),
  });
}
