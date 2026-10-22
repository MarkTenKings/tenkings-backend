// Inactive exact-path contract. This does not register any browser or private
// route. The private alias requires its own explicitly composed dispatcher.
import { curationReadInput, curationError } from './staff-comp-curation-client.mjs';
const ID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const publicPath = new RegExp(`^/api/staff/comp-curation/cards/(${ID})(/decision)?$`);
const privatePath = new RegExp(`^/api/staff/manual-connected/cards/(${ID})/comp-curation(/decision)?$`);
const marketPath = new RegExp(`^/api/staff/manual-connected/cards/(${ID})/presentation/market$`);
export function compTransportRoute(value, { privateAlias = false, includeReads = false } = {}) {
  if (typeof value !== 'string' || value.length > 1200 || !value.startsWith('/') || /[\\#%\s]/.test(value)) return null;
  const url = new URL(value, 'https://comp.invalid');
  if (url.origin !== 'https://comp.invalid' || url.pathname + url.search !== value) return null;
  if (includeReads && !privateAlias && !url.search) {
    if (url.pathname === '/api/staff/session') return { kind: 'session', method: 'GET', path: value };
    const market = marketPath.exec(url.pathname);
    if (market) return { kind: 'market', method: 'GET', cardId: market[1], path: value };
  }
  const match = (privateAlias ? privatePath : publicPath).exec(url.pathname);
  if (!match) return null;
  let input = null;
  if (match[2]) { if (url.search) return null; }
  else {
    if ([...url.searchParams.keys()].length !== 2 || url.searchParams.getAll('approvalActionId').length !== 1
      || url.searchParams.getAll('previewId').length !== 1) return null;
    try { input = curationReadInput({ approvalActionId: url.searchParams.get('approvalActionId'), previewId: url.searchParams.get('previewId') === 'none' ? null : url.searchParams.get('previewId') }); }
    catch { return null; }
  }
  const suffix = `${match[2] ?? ''}${url.search}`;
  return { kind: match[2] ? 'decide' : 'read', method: match[2] ? 'POST' : 'GET', cardId: match[1], input,
    path: `/api/staff/comp-curation/cards/${match[1]}${suffix}`,
    privatePath: `/api/staff/manual-connected/cards/${match[1]}/comp-curation${suffix}` };
}
export function requireCompTransportRoute(path, options) {
  const value = compTransportRoute(path, options); if (!value) throw curationError('COMP_REQUEST_INVALID'); return value;
}
