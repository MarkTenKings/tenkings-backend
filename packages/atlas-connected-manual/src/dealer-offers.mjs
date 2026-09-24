import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { activeDealers } from '@atlas/report-view/dealer-directory';
import { dealerOfferConfigurationSchema } from '@atlas/report-view/presentation-contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';

const same = (left, right) => canonical(left) === canonical(right);

/** Trusted server loader only. Directory approval is separate from BUY service
 * authorization; contact-only shops can never contribute an offer. The loader
 * may read an existing controlled config store; no dealer/provider call occurs.
 */
export function createDealerOfferService({ repository, approved, loadConfiguration = null, now = () => new Date() }) {
  requireThat(loadConfiguration === null || typeof loadConfiguration === 'function', 500, 'DEALER_OFFERS_CONFIGURATION_INVALID');
  async function configured(binding) {
    const time = now().getTime(); requireThat(Number.isFinite(time), 503, 'DEALER_OFFERS_CONFIGURATION_INVALID');
    if (!loadConfiguration) return { configured: false, sourceHash: digest('unconfigured'), offers: [], records: [] };
    let directory, records;
    try {
      const config = await loadConfiguration();
      if (config === null) return { configured: false, sourceHash: digest('unconfigured'), offers: [], records: [] };
      object(config, ['directory', 'offers']);
      directory = activeDealers(config.directory, time); records = dealerOfferConfigurationSchema.parse(config.offers).offers;
      requireThat(new Set(records.map(value => value.id)).size === records.length);
    } catch { requireThat(false, 503, 'DEALER_OFFERS_CONFIGURATION_INVALID'); }
    const dealers = new Map(directory.filter(dealer => !dealer.contactOnly && dealer.services.includes('BUY')).map(dealer => [dealer.id, dealer]));
    const eligible = records.filter(record => dealers.has(record.dealerId) && same(record.binding, binding)
      && Date.parse(record.source.receivedAt) <= time && Date.parse(record.expiresAt) > time
      && Date.parse(record.source.receivedAt) < Date.parse(record.expiresAt))
      .sort((a, b) => a.id.localeCompare(b.id));
    requireThat(eligible.length <= 40, 503, 'DEALER_OFFERS_CONFIGURATION_INVALID');
    const offers = eligible.map(({ dealerId, binding: _binding, source, ...offer }) => ({ ...offer,
      dealerName: dealers.get(dealerId).name, dealerUrl: `/dealers?dealer=${dealerId}&service=buy` }));
    return { configured: true, sourceHash: digest(canonical({ binding, offers, records: eligible })), offers, records: eligible };
  }
  async function source(staff, cardId) {
    const state = await repository.status(staff, cardId);
    const approvedReport = await approved.loadPacket(staff, cardId, state.approvalActionId);
    requireThat(/^[a-f0-9]{64}$/.test(approvedReport.publicHash ?? '') && digest(JSON.stringify(approvedReport.packet)) === approvedReport.publicHash,
      409, 'DEALER_OFFER_PUBLICATION_MISMATCH');
    const packet = parsePublicManualReport(approvedReport.packet);
    return { state, binding: { publicToken: packet.publicToken, approvalVersion: packet.approvalVersion, publicHash: approvedReport.publicHash } };
  }
  return Object.freeze({
    async status(staff, cardId) {
      const { state, binding } = await source(staff, cardId), available = await configured(binding);
      return { approvalActionId: state.approvalActionId, revision: state.revision, sourceHash: available.sourceHash,
        configured: available.configured, offers: available.offers.map((offer, index) => ({ ...offer, source: available.records[index].source })),
        selectedIds: state.presentation?.dealerOffers?.map(offer => offer.id) ?? [] };
    },
    async select(staff, cardId, input) {
      object(input, ['requestId', 'approvalActionId', 'expectedRevision', 'sourceHash', 'selectedIds']);
      uuid(input.requestId); uuid(input.approvalActionId);
      requireThat(/^[a-f0-9]{64}$/.test(input.sourceHash ?? '') && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0
        && Array.isArray(input.selectedIds) && input.selectedIds.length <= 40 && input.selectedIds.every(id => typeof id === 'string')
        && new Set(input.selectedIds).size === input.selectedIds.length, 400, 'DEALER_OFFER_SELECTION_INVALID');
      // Committed replay precedes current offer expiry/config checks. The
      // historical receipt remains true; public reads still apply revocation.
      const committed = await repository.dealerOfferCommitStatus(staff, cardId, input);
      if (committed) return committed;
      const { state, binding } = await source(staff, cardId);
      requireThat(state.approvalActionId === input.approvalActionId, 409, 'PRESENTATION_APPROVAL_STALE');
      const available = await configured(binding);
      requireThat(available.sourceHash === input.sourceHash, 409, 'DEALER_OFFER_SOURCE_CHANGED');
      const offers = input.selectedIds.map(id => {
        const offer = available.offers.find(value => value.id === id);
        requireThat(offer, 409, 'DEALER_OFFER_SOURCE_CHANGED'); return offer;
      });
      const offerSource = { version: 'atlas-selected-dealer-offers-v1', sourceHash: input.sourceHash, selectedIds: [...input.selectedIds],
        sources: input.selectedIds.map(id => { const record = available.records.find(value => value.id === id);
          return { id, dealerId: record.dealerId, sourceHash: digest(canonical(record)), ...record.source }; }) };
      return repository.commit(staff, cardId, { requestId: input.requestId, approvalActionId: input.approvalActionId, expectedRevision: input.expectedRevision },
        null, null, { dealerOffers: offers, source: offerSource });
    },
    async filterPublished(presentation) {
      if (!presentation?.dealerOffers?.length) return presentation;
      // Optional configuration failure cannot suppress the immutable grade.
      let available; try { available = await configured(presentation.binding); } catch { available = { offers: [] }; }
      return { ...presentation, dealerOffers: presentation.dealerOffers.filter(offer => available.offers.some(current => same(current, offer))) };
    },
  });
}
