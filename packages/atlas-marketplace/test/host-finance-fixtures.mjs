import { createHmac } from 'node:crypto';
import { openLocalStore } from '../src/store.mjs';
import { createLocalFixture, actors } from '../scripts/local-fixture.mjs';
import { createMarketplacePilot, intentId } from '../src/service.mjs';
import { createRecoverySettlementCapability } from '../src/recovery-settlement.mjs';
import { createHostedFinance } from '../src/host-finance.mjs';
import { recordAccountAdjustment } from '../src/reconciliation.mjs';
export { actors };
export const NOW = 1792699200000, secret = 'whsec_host_fixture_only_no_provider';
export const webhook = { endpoints: [{ id: 'we_fixture_platform', scope: 'PLATFORM', secret }, { id: 'we_fixture_connected', scope: 'CONNECTED', secret: 'whsec_host_connected_fixture_only' }] };
export const config = { environment: 'SYNTHETIC_LOCAL', platformAccountId: 'demo_platform', connectedAccountIds: ['demo_connected'], activationRef: 'fixture_activation', operationsRef: 'fixture_operations', qualificationRefs: null, finalizationBudgetMs: 10000,
  recovery: { approvalRef: 'fixture_recovery', maxItems: 10, concurrency: 2, maxEvidenceAgeMs: 60000, maxDurationMs: 60000 },
  schedule: { intervalMs: 60000, pollIntervalMs: 1000, leaseMs: 71000 },
  alerts: { approvalRef: 'fixture_alerts', destinationRef: 'fixture_sink', maxItems: 20, leaseMs: 30000, staleIntentMs: 60000, staleReportMs: 60000 } };
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export function signed(event, now = NOW, signingSecret = secret) {
  const rawBody = Buffer.from(JSON.stringify(event)), time = Math.floor(now / 1000);
  return { rawBody, signature: `t=${time},v1=${createHmac('sha256', signingSecret).update(`${time}.`).update(rawBody).digest('hex')}` };
}
export function compose({ filename = ':memory:', clock = () => NOW, readiness = () => true, sender, timers } = {}) {
  const store = openLocalStore({ filename, environment: 'SYNTHETIC_LOCAL', clock }), fixture = createLocalFixture({ store, clock, assets: false });
  const counts = { retrieves: 0, creates: 0, identities: 0 }, base = fixture.provider;
  const provider = { ...base,
    acceptsAccount: id => config.connectedAccountIds.includes(id),
    create: async (...args) => { counts.creates++; return base.create(...args); },
    retrieve: async (...args) => { counts.retrieves++; return base.retrieve(...args); },
    getIdentity: async () => { counts.identities++; return { provider: 'synthetic', environment: 'SYNTHETIC_LOCAL', platformAccountId: config.platformAccountId, allowedConnectedAccountIds: config.connectedAccountIds, livemode: false }; },
    discover: async intent => ({ complete: true, objectId: store.read(state => state.syntheticProvider.intentObjects[intent.id] ?? null) }),
    getAccountSnapshot: async accountId => { const balance = await base.getBalance(accountId); return { provider: 'synthetic', ...balance, pendingCents: 0, totalCents: balance.availableCents, unsupported: [] }; },
    listBalanceTransactions: async ({ accountId, fromMs, toMs }) => ({ provider: 'synthetic', accountId, livemode: false, currency: 'USD', observedAt: clock(), fromMs, toMs, complete: true, transactions: store.read(state => Object.values(state.syntheticProvider.objects).flatMap(object => {
      const values = []; if (object.intent.accountId === accountId) for (const key of ['balanceTransaction','failureBalanceTransaction']) if (object.evidence[key]) values.push({ ...object.evidence[key], createdAt: NOW });
      if (object.intent.connectedAccountId === accountId && object.evidence.connectedBalanceTransaction) values.push({ ...object.evidence.connectedBalanceTransaction, createdAt: NOW }); return values;
    })) }),
    retrieveDispute: async (payment, { objectId }) => ({ provider: 'synthetic', accountId: payment.accountId, livemode: false, objectId, chargeId: payment.chargeId, currency: 'USD', amountCents: payment.amountCents, status: 'needs_response', observedAt: clock() })
  };
  const capability = createRecoverySettlementCapability({ enabled: true, store, environment: config.environment, platformAccountId: config.platformAccountId, approvalRef: 'fixture_settlement', assertRuntimeReady: readiness });
  const service = createMarketplacePilot({ ...fixture, store, provider, enabled: true, environment: config.environment, platformAccountId: config.platformAccountId, recoverySettlementCapability: capability, clock, webhook });
  const options = { enabled: true, store, provider, service, settlementCapability: capability, config, assertRuntimeReady: readiness, alertSender: sender, timers };
  const host = createHostedFinance(options);
  async function reserve({ lostResponse = false } = {}) {
    await service.recordConsent(actors.seller, { requestId: 'demo_consent', cardId: 'demo_card', choice: 'HOLD_AND_LIST', evidenceRef: 'demo_hold_consent' });
    const listing = await service.publishListing(actors.seller, { requestId: 'demo_listing', cardId: 'demo_card', askingPriceCents: 12500 });
    const quote = await service.quote(actors.buyer, listing.id);
    const reservation = await service.reserve(actors.buyer, { requestId: 'demo_reservation', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, quoteId: quote.quoteId });
    // Prepare/dispatch creates the finance order required for connected opening scope.
    if (lostResponse) base.failNextCreateAfterCommit(intentId('payment', reservation.id));
    try { await service.pay(actors.buyer, { reservationId: reservation.id }); }
    catch (error) { if (!lostResponse || error.code !== 'SYNTHETIC_RESPONSE_LOST') throw error; }
    for (const accountId of [config.platformAccountId, ...config.connectedAccountIds]) if (!store.read(state => state.financeOpenings?.[accountId])) store.transaction(tx => recordAccountAdjustment(tx, { adjustmentId: `opening_${accountId}`, accountId, platformAccountId: config.platformAccountId, kind: 'OPENING', maxEvidenceAgeMs: 60000,
      evidence: { provider: 'synthetic', accountId, livemode: false, currency: 'USD', availableCents: 0, pendingCents: 0, totalCents: 0, unsupported: [], observedAt: clock(), cutoffMs: Math.floor(clock()/1000)*1000 },
      approval: { approved: true, accountId, kind: 'OPENING', quiescent: true, reviewerId: 'fixture_review', policyVersion: 'fixture_policy', evidenceRef: 'fixture_opening' } }));
    return { reservation, paymentId: intentId('payment', reservation.id) };
  }
  return { store, provider, service, capability, host, options, counts, reserve };
}
