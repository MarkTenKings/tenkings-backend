// Synthetic in-memory SQL adapter for the actual repository/service/client
// integration. It is not PostgreSQL or human/live approval evidence.
import { randomUUID } from 'node:crypto';
import { publicationFixture } from './publication-fixture.mjs';
import { createPresentationRepository } from '../src/presentation-repository.mjs';
import { createApprovedManualReader } from '../src/publication-reader.mjs';
import { createConnectedHandler } from '../src/http.mjs';

export async function presentationIntegrationFixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  f.source = { packet, publicHash: f.row.public_hash };
  f.staff = { id: f.actorId }; f.principal = { id: f.actorId, role: 'REVIEWER' };
  f.card = { id: f.cardId, owner_id: f.actorId, approvers: [], editors: [], readers: [] };
  f.presentations = []; f.searches = new Map();
  const tx = {
    async $queryRawUnsafe(sql, ...args) {
      if (sql.includes('FROM atlas_manual.card')) return args[0] === f.cardId ? [f.card] : [];
      if (sql.includes('FROM atlas_manual.publication p')) return [f.row];
      if (sql.includes('read_publication')) return args[0] === f.row.public_token && (args[1] === null || args[1] === f.row.version) ? [f.row] : [];
      if (sql.includes('FROM atlas_manual.approval')) return [];
      if (sql.includes('FROM atlas_manual.presentation_market')) return f.searches.has(args[1]) ? [structuredClone(f.searches.get(args[1]))] : [];
      if (sql.includes('FROM atlas_manual.presentation WHERE')) {
        const rows = f.presentations.filter(row => row.card_id === args[0]
          && (sql.includes('request_id=$2') ? row.request_id === args[1] : row.approval_action_id === args[1]));
        return rows.length ? [structuredClone(rows.at(-1))] : [];
      }
      throw new Error(`Unexpected fixture SQL: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.startsWith('INSERT INTO atlas_manual.presentation(')) {
        const fields = ['card_id','approval_action_id','revision','request_id','request_hash','actor_id','presentation','presentation_hash','media','media_hash','market_source','market_source_hash'];
        f.presentations.push(Object.fromEntries(fields.map((key, index) => [key, args[index]]))); return 1;
      }
      if (sql.startsWith('INSERT INTO atlas_manual.presentation_market')) {
        const fields = ['card_id','approval_action_id','request_id','actor_id','request','request_hash'];
        f.searches.set(args[2], { ...Object.fromEntries(fields.map((key, index) => [key, args[index]])), state: 'STARTED', result: null, result_hash: null }); return 1;
      }
      if (sql.startsWith('UPDATE atlas_manual.presentation_market')) {
        Object.assign(f.searches.get(args[1]), { state: args[2], result: args[3], result_hash: args[4] }); return 1;
      }
      throw new Error(`Unexpected fixture write: ${sql}`);
    },
  };
  f.boundary = {
    async authenticate(cookie, csrf) {
      if (cookie !== 'fixture-session' || csrf !== undefined && csrf !== 'fixture-csrf') throw Object.assign(new Error('fixture authorization'), { status: 403, code: 'AUTH_REQUIRED' });
      return f.staff;
    },
    async transaction(staff, work) {
      if (staff !== f.staff) throw Object.assign(new Error('fixture authority'), { status: 403, code: 'AUTH_REQUIRED' });
      return work({ tx, principal: f.principal, refresh: async () => ({ principal: f.principal }) });
    },
  };
  f.repository = createPresentationRepository({ boundary: f.boundary, keyPrefix: 'fixture-presentation' });
  f.approved = { async loadPacket(staff, cardId, actionId) {
    const state = await f.repository.status(staff, cardId);
    if (state.approvalActionId !== actionId) throw Object.assign(new Error('stale approval'), { code: 'PRESENTATION_APPROVAL_STALE', status: 409 });
    return structuredClone(f.source);
  } };
  f.reader = dealerOffers => createApprovedManualReader({ client: { $transaction: async work => work(tx) }, artifacts: f.artifacts,
    storage: f.storage, presentationEnabled: true, dealerOffers });
  f.claims = () => ({ request: { kind: 'REPORT', token: f.row.public_token, version: 1 }, expiresAt: Date.now() + 30000 });
  f.transport = connected => {
    const handler = createConnectedHandler({ connected: { workflow: {}, intake: {}, ...connected }, boundary: f.boundary,
      origin: 'https://atlasgrading.com', assertRequest: async () => {} });
    return async (url, options = {}) => {
      const req = { url, method: options.method ?? 'GET', body: options.body, headers: { cookie: 'fixture-session', origin: 'https://atlasgrading.com',
        'content-type': 'application/json', 'x-atlas-csrf': 'fixture-csrf' } };
      const res = { setHeader() {}, status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; } };
      await handler(req, res);
      if (res.statusCode !== 200) throw Object.assign(new Error(res.body?.error), { status: res.statusCode, code: res.body?.error });
      return res.body;
    };
  };
  f.storageClient = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
  f.command = extra => ({ requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: f.presentations.length, ...extra });
  return f;
}
