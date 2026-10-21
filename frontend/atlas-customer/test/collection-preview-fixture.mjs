/** Synthetic display-only fixture. No real ownership, customer, saved sale,
 * approval or value is asserted. Imported by tests/local browser previews only. */
export function createCollectionPreviewFixture() {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const preferences = { schema: 'atlas-collection-preferences-v1', accountId, revision: 0, visibility: 'PRIVATE', offersDisabled: false };
  const cards = ['A', 'B'].map((letter, index) => {
    const numeral = index ? '3' : '2';
    return { schema: 'atlas-owner-collection-card-v1', cardId: `${numeral.repeat(8)}-${numeral.repeat(4)}-4${numeral.repeat(3)}-8${numeral.repeat(3)}-${numeral.repeat(12)}`,
      ownership: { status: 'VERIFIED', ownerAccountId: accountId, revision: 1 }, cardPreferenceRevision: 0,
      visibility: 'PRIVATE', cardVisibility: 'PRIVATE', offers: { preference: 'OPEN_TO_OFFERS', collectionDisabled: false, cardDisabled: false },
      eligibility: { canReceiveOffers: false, reasonCodes: ['OFFER_DELIVERY_UNAVAILABLE', 'PRIVATE_COLLECTION', 'PRIVATE_CARD'] },
      notificationDelivery: 'NOT_REQUESTED', custody: { status: 'UNKNOWN', currentPhysicalHolder: 'UNKNOWN' },
      approvedCard: { approvalActionId: `${numeral.repeat(8)}-4444-4444-8444-${numeral.repeat(12)}`,
        certificateNumber: `ATLAS-${letter.repeat(12)}`, report: { publicToken: `ar_${letter.repeat(24)}`, version: 1, publicHash: letter.toLowerCase().repeat(64) } } };
  });
  const displays = Object.fromEntries(cards.map((card, index) => [card.cardId, {
    cardId: card.cardId, approvalActionId: card.approvedCard.approvalActionId, report: { ...card.approvedCard.report },
    title: index ? 'Synthetic collection card B' : 'Synthetic collection card A', finalGrade: index ? 8 : 9,
  }]));
  const binding = { cardId: cards[0].cardId, approvalActionId: cards[0].approvedCard.approvalActionId, report: { ...cards[0].approvedCard.report } };
  const source = { schema: 'atlas-saved-comp-source-v1', cardId: binding.cardId, approvalActionId: binding.approvalActionId,
    previewId: '55555555-5555-4555-8555-555555555555', sourceHash: 'c'.repeat(64),
    preview: { version: 'atlas-market-preview-v2', source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0',
      binding: { publicToken: binding.report.publicToken, approvalVersion: binding.report.version, publicHash: binding.report.publicHash },
      retrievedAt: '2026-10-21T00:00:00.000Z', candidates: [10000, 11000, 9000, null, 24000, 18000].map((priceMinor, index) => ({
        match: 'MATCH', requiresReview: true, sale: { id: `ebay:${123456789000 + index}`, title: `Synthetic sold reference ${index + 1}${index === 4 ? ' lot of 3 cards' : ''}`,
          listingUrl: `https://www.ebay.com/itm/${123456789000 + index}`, grader: index === 5 ? 'SGC' : 'PSA', grade: '9', raw: false,
          designation: 'STANDARD', identityStatus: 'MATCH', evidenceKind: 'SLABBED', soldAt: `2026-10-${20 - index}T00:00:00.000Z`,
          priceMinor, currency: 'USD', priceBasis: priceMinor === null ? 'accepted_offer_unknown' : 'sold' },
      })) } };
  return { accountId, snapshot: { schema: 'atlas-owner-collection-v1', accountId, preferences, cards, nextCardId: null }, displays,
    source, binding, asOf: '2026-10-21T12:00:00.000Z', recencyDays: 180 };
}
