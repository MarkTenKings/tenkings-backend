// Inactive native-host composition. Importing this file opens no client, reads
// no credentials, registers no route and starts no worker. Vercel must keep
// forwarding through a separately reviewed private transport; it never owns
// this writer. The caller retains ownership of every supplied capability.
import { canonical, requireThat } from '@atlas/manual-service/contract';
import { createCompCurationService } from '../../../../packages/atlas-connected-manual/src/comp-curation-service.mjs';
import { compEvidenceSelectionPolicy } from '../../../../packages/atlas-connected-manual/src/comp-curation-contract.mjs';
import { createCompCurationArchiveCapability } from '../../../../packages/atlas-connected-manual/src/comp-curation-archive.mjs';
import { createStaffCompCurationHandler } from './staff-comp-curation-http.mjs';

const keys = ['enabled', 'environment', 'auth', 'boundary', 'approved', 'artifacts', 'validateAccess', 'assertRequest', 'origin', 'selectionPolicy', 'archiveCompAccess', 'designationReviewsEnabled'];
const refuse = ok => requireThat(ok, 503, 'COMP_NOT_CONFIGURED');

export function createStaffCompCurationNativeComposition(options = {}) {
  // Disabled composition must not touch capabilities, environment or clients.
  if (options.enabled !== true) return null;
  refuse(Object.getPrototypeOf(options) === Object.prototype && Reflect.ownKeys(options).every(key => keys.includes(key)));
  const { auth, boundary, approved, artifacts, validateAccess, assertRequest, origin } = options;
  const environment = options.environment ?? process.env;
  const authenticate = auth?.authenticate, transaction = boundary?.transaction;
  const loadPacket = approved?.loadPacket, readArtifact = artifacts?.read;
  const environmentInput = options.environment;
  const selectionPolicyInput = options.selectionPolicy;
  const selectionPolicy = compEvidenceSelectionPolicy(selectionPolicyInput ?? null)?.policy ?? null;
  const selectionPolicySnapshot = canonical(selectionPolicy);
  const archiveCompAccess = options.archiveCompAccess;
  refuse(archiveCompAccess === undefined || typeof archiveCompAccess === 'boolean');
  const designationReviewsEnabled = options.designationReviewsEnabled;
  refuse(designationReviewsEnabled === undefined || typeof designationReviewsEnabled === 'boolean');
  refuse(designationReviewsEnabled !== true || selectionPolicy !== null && archiveCompAccess === true);
  let closed = false;
  function configured() {
    refuse(!closed && options.enabled === true && options.environment === environmentInput
      && options.auth === auth && options.boundary === boundary && options.approved === approved
      && options.artifacts === artifacts && options.validateAccess === validateAccess
      && options.assertRequest === assertRequest && options.origin === origin
      && options.selectionPolicy === selectionPolicyInput && canonical(options.selectionPolicy ?? null) === selectionPolicySnapshot
      && options.archiveCompAccess === archiveCompAccess
      && options.designationReviewsEnabled === designationReviewsEnabled
      && Reflect.ownKeys(options).every(key => keys.includes(key)));
    refuse(environment && typeof environment === 'object' && !environment.VERCEL && !environment.AWS_LAMBDA_FUNCTION_NAME);
    refuse(typeof authenticate === 'function' && auth.authenticate === authenticate
      && typeof transaction === 'function' && boundary.transaction === transaction
      && typeof loadPacket === 'function' && approved.loadPacket === loadPacket
      && typeof readArtifact === 'function' && artifacts.read === readArtifact
      && typeof validateAccess === 'function' && typeof assertRequest === 'function');
    let url; try { url = new URL(origin); } catch { refuse(false); }
    refuse(url.origin === origin && (url.protocol === 'https:'
      || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  }
  configured();
  async function call(owner, method, args) {
    configured();
    const value = await Reflect.apply(method, owner, args);
    configured();
    return value;
  }
  const serviceOptions = {
    boundary: Object.freeze({ async transaction(staff, work) {
      return call(boundary, transaction, [staff, async context => {
        configured();
        const refresh = context?.refresh;
        refuse(typeof refresh === 'function');
        const wrapped = { ...context, refresh: async () => {
          configured(); refuse(context.refresh === refresh);
          const value = await Reflect.apply(refresh, context, []);
          configured(); refuse(context.refresh === refresh);
          return value;
        } };
        const value = await work(wrapped);
        configured();
        return value;
      }]);
    } }),
    approved: Object.freeze({ loadPacket: (...args) => call(approved, loadPacket, args) }),
    artifacts: Object.freeze({ read: (...args) => call(artifacts, readArtifact, args) }),
    validateAccess: (...args) => call(options, validateAccess, args),
    // Pricing remains disabled. Evidence-only selection requires an explicit
    // policy and a separately qualified additive replacement of the SQL011
    // guard. No current runtime caller supplies this opt-in.
    policy: null,
    selectionPolicy,
    designationReviewsEnabled: designationReviewsEnabled === true,
  };
  const service = createCompCurationService({ ...serviceOptions,
    archiveCapability: archiveCompAccess === true ? createCompCurationArchiveCapability(serviceOptions) : null });
  const handler = createStaffCompCurationHandler({
    auth: Object.freeze({ authenticate: (...args) => call(auth, authenticate, args) }),
    service, origin, designationReviewsEnabled: designationReviewsEnabled === true,
    assertRequest(req) {
      configured();
      const result = Reflect.apply(assertRequest, options, [req]);
      configured();
      return result; // Existing handler requires synchronous throwing/void.
    },
  });
  return Object.freeze({
    handler,
    close() { closed = true; },
    policy: null,
    selectionPolicy: selectionPolicy === null ? null : Object.freeze({ ...selectionPolicy }),
    archiveCompAccess: archiveCompAccess === true,
    status: 'LOCAL_PROPOSAL',
    visibility: 'PRIVATE_INTERNAL',
  });
}
