import { cents, clone, hash, requireValue, sumCents } from './contract.mjs';
import { demoId, requiredText, SYNTHETIC_ENVIRONMENT } from './eligibility.mjs';
import { assertListingBinding } from './listing.mjs';

const METHOD = 'selected-sold-price-arithmetic-mean-v1';
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const unavailable = (reason) => ({ status: 'UNAVAILABLE', reason, guidance: null, askingPriceUnaffected: true, reportSnapshotUnaffected: true });

export function createUnavailableListingGuidanceAdapter() {
  return Object.freeze({ async read() { return unavailable('REAL_COMP_RIGHTS_AND_SELECTION_POLICY_UNRESOLVED'); } });
}

// Compatibility port for a copied, already-qualified R1 curation receipt. This
// neither selects comps nor fetches a provider and imports no grading runtime.
// Current R1 LOCAL_PROPOSAL/UNRESOLVED rights cannot authorize real guidance.
export function previewListingGuidance({ listing, packet, policy, now }) {
  assertListingBinding(listing);
  if (!policy || policy.environment !== SYNTHETIC_ENVIRONMENT || policy.status !== 'APPROVED_SYNTHETIC' || policy.rightsStatus !== 'APPROVED_SYNTHETIC') return unavailable('COMP_POLICY_AND_RIGHTS_REQUIRED');
  if (!packet) return unavailable('SAVED_SELECTED_SALES_REQUIRED');
  try {
    demoId(policy.id, 'Guidance policy');
    requiredText(policy.version, 'Guidance policy version');
    requiredText(policy.approvalRef, 'Synthetic guidance approval');
    requiredText(policy.rightsEvidenceRef, 'Synthetic data-rights evidence');
    requireValue(policy.method === METHOD && Number.isSafeInteger(policy.maxAgeMs) && policy.maxAgeMs > 0 && Number.isSafeInteger(now), 'COMP_POLICY_INVALID');
    requireValue(packet.environment === SYNTHETIC_ENVIRONMENT && packet.schema === 'atlas-marketplace-r1-guidance-copy-v1', 'COMP_SOURCE_INVALID');
    requireValue(packet.listingVersion === listing.version && packet.listingHash === listing.bindingHash && packet.identityHash === hash(listing.approvedCard.identity), 'COMP_BINDING_MISMATCH');
    const receipt = packet.receipt;
    requireValue(isHash(packet.receiptHash) && hash(receipt) === packet.receiptHash && receipt.schema === 'atlas-comp-curation-receipt-v1', 'COMP_RECEIPT_INVALID');
    requireValue(receipt.binding?.cardId === listing.cardId && receipt.binding.approvalActionId === listing.approvedCard.approvalId && receipt.binding.reportHash === listing.approvedCard.reportHash && receipt.binding.publicVersion === listing.approvedCard.reportVersion, 'COMP_APPROVAL_MISMATCH');
    requireValue(receipt.outcome === 'SELECTED' && receipt.reportSnapshotUnaffected === true && Number.isSafeInteger(receipt.revision) && receipt.revision > 0, 'COMP_SELECTION_REQUIRED');
    demoId(receipt.requestId, 'Synthetic curation receipt');
    const source = receipt.source;
    requireValue(source && ['requestHash', 'resultHash', 'artifactHash', 'previewHash'].every((key) => isHash(source[key])), 'COMP_SAVED_SOURCE_REQUIRED');
    demoId(source.previewId, 'Synthetic saved market preview');
    const selected = receipt.selected;
    requireValue(Array.isArray(selected) && selected.length > 0 && selected.length <= 5 && new Set(selected.map((row) => row.id)).size === selected.length, 'COMP_SELECTION_BOUND');
    requireValue(receipt.selectedFactsHash === hash(selected), 'COMP_SELECTED_FACTS_INVALID');
    const observed = Date.parse(packet.observedAt);
    requireValue(Number.isFinite(observed) && observed <= now && now - observed <= policy.maxAgeMs, 'COMP_STALE');
    for (const row of selected) {
      demoId(row.id, 'Synthetic sold reference');
      requireValue(row.eligible === true && Array.isArray(row.reasonCodes) && row.reasonCodes.length === 0 && row.priceBasis === 'sold' && row.currency === 'USD', 'COMP_SALE_INELIGIBLE');
      cents(row.priceMinor, { positive: true });
      requiredText(row.title, 'Selected sale title');
      // The R1 selection must have positively established exact identity. A
      // separate copied assertion prevents an unqualified candidate becoming a
      // selected listing reference solely by carrying a displayed price.
      requireValue(packet.identityMatches?.[row.id] === 'CONFIRMED', 'COMP_IDENTITY_UNCONFIRMED');
      const soldAt = Date.parse(row.soldAt);
      requireValue(Number.isFinite(soldAt) && soldAt <= observed && now - soldAt <= policy.maxAgeMs, 'COMP_STALE');
      requireValue(typeof row.listingUrl === 'string' && /^\/demo\/sales\/[a-zA-Z0-9_-]+$/.test(row.listingUrl), 'COMP_SOURCE_INVALID');
      requireValue(!/\b(?:lot|lots|bundle|bundles|reprint|reproduction|proxy)\b/i.test(row.title), 'COMP_SALE_INELIGIBLE');
      if (row.raw === true) requireValue(row.grader === null && row.grade === null && row.designation === null && row.group === 'RAW / condition unverified', 'COMP_DESIGNATION_UNCONFIRMED');
      else {
        requireValue(row.raw === false && ['PSA', 'BGS', 'SGC', 'CGC', 'ATLAS'].includes(row.grader) && Number.isFinite(row.grade) && row.grade >= 1 && row.grade <= 10, 'COMP_DESIGNATION_UNCONFIRMED');
        const designated = row.designation === 'STANDARD' || row.grade === 10 && (row.designation === 'BLACK_LABEL' && row.grader === 'BGS' || row.designation === 'PRISTINE' && ['BGS', 'CGC'].includes(row.grader) || row.designation === 'PERFECT' && row.grader === 'CGC');
        requireValue(designated && row.group === `${row.grader} / ${row.grade} / ${row.designation}`, 'COMP_DESIGNATION_UNCONFIRMED');
      }
    }
    requireValue(new Set(selected.map((row) => row.listingUrl)).size === selected.length && new Set(selected.map((row) => row.group)).size === 1, 'COMP_GROUP_MISMATCH');
    const guidance = receipt.guidance;
    requireValue(guidance?.method === METHOD && guidance.currency === 'USD' && guidance.sampleCount === selected.length && guidance.group === selected[0].group && guidance.rounding === 'NEAREST_MINOR_UNIT_HALF_UP' && guidance.sellerSetsAskingPrice === true && guidance.askingPriceMinor === null, 'COMP_GUIDANCE_INVALID');
    requireValue(hash(guidance.excludes) === hash(['SHIPPING', 'TAX', 'FEES']), 'COMP_GUIDANCE_INVALID');
    const sum = sumCents(...selected.map((row) => row.priceMinor));
    const quotient = Math.floor(sum / selected.length), remainder = sum % selected.length;
    requireValue(guidance.sumMinor === sum && guidance.meanMinor === quotient + (remainder * 2 >= selected.length ? 1 : 0) && guidance.lowMinor === Math.min(...selected.map((row) => row.priceMinor)) && guidance.highMinor === Math.max(...selected.map((row) => row.priceMinor)), 'COMP_GUIDANCE_INVALID');
    const dates = selected.map((row) => row.soldAt).sort();
    requireValue(guidance.oldestSaleAt === dates[0] && guidance.newestSaleAt === dates.at(-1), 'COMP_GUIDANCE_INVALID');
    return { status: 'AVAILABLE_SYNTHETIC', guidance: clone(guidance), selected: clone(selected), provenance: { receiptHash: packet.receiptHash, curationRevision: receipt.revision, source: clone(source), observedAt: packet.observedAt, policyId: policy.id, policyVersion: policy.version, rightsEvidenceRef: policy.rightsEvidenceRef }, askingPriceUnaffected: true, reportSnapshotUnaffected: true };
  } catch (error) {
    return unavailable(error.code ?? 'COMP_PACKET_INVALID');
  }
}

export function recordListingGuidanceRefresh(tx, input) {
  demoId(input.requestId, 'request');
  const listing = assertListingBinding(tx.state.listings[input.listingId]);
  requireValue(input.sellerId === listing.sellerId, 'SELLER_FORBIDDEN');
  requireValue(input.listingVersion === listing.version && input.listingHash === listing.bindingHash, 'LISTING_CHANGED');
  const requestHash = hash({ listingId: input.listingId, listingVersion: input.listingVersion, listingHash: input.listingHash, sellerId: input.sellerId, packet: input.packet, policy: input.policy });
  const key = `listing-guidance:${input.requestId}`;
  const prior = tx.state.receipts[key];
  if (prior) { requireValue(prior.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT'); return clone(prior.result); }
  requireValue(listing.status === 'ACTIVE', 'LISTING_UNAVAILABLE');
  const result = previewListingGuidance({ listing, packet: input.packet, policy: input.policy, now: tx.now });
  requireValue(result.status === 'AVAILABLE_SYNTHETIC', 'GUIDANCE_UNAVAILABLE', result.reason);
  const records = (tx.state.listingGuidance ??= {})[listing.id] ?? [];
  const receipt = { ...result, requestId: input.requestId, listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, revision: records.length + 1, recordedAt: new Date(tx.now).toISOString(), packet: clone(input.packet) };
  tx.state.listingGuidance[listing.id] = [...records, receipt];
  tx.state.receipts[key] = { requestHash, result: clone(receipt) };
  tx.emit('LISTING_GUIDANCE_REFRESHED', { listingId: listing.id, revision: receipt.revision, environment: SYNTHETIC_ENVIRONMENT });
  return clone(receipt);
}
