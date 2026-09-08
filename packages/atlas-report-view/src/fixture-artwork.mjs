const cards = [
    { id: 'sample-001', title: 'Lumen Finch', set: 'Field Notes · 2026', number: '01 / 03', category: 'Illustration', color: '#b8ca9b', accent: '#df875d', state: 'IN_REVIEW' },
    { id: 'sample-002', title: 'Northstar', set: 'Night Studies · 2026', number: '02 / 03', category: 'Illustration', color: '#acc7d3', accent: '#ecd399', state: 'IN_REVIEW' },
    { id: 'sample-003', title: 'Terra No. 8', set: 'Field Notes · 2026', number: '03 / 03', category: 'Illustration', color: '#c9b8a5', accent: '#9daa91', state: 'NEEDS_EVIDENCE', missingBack: true }
];
function sourceSvg(card, side) {
    // Original code-native fixture artwork; never a photograph or optical measurement.
    const art = side === 'FRONT' ? `
    <rect x="28" y="72" width="304" height="296" rx="3" fill="${card.color}"/>
    <circle cx="253" cy="138" r="40" fill="#f7f0db"/>
    <path d="M28 310L126 159l62 98 43-69 101 134v46H28Z" fill="#263d39"/>
    <path d="M28 336l91-93 85 125H28Z" fill="#47665a"/>
    <path d="M130 194q61-55 94 16-71 66-94-16Z" fill="${card.accent}"/>
    <path d="M145 201l40-50 4 65Z" fill="#f7f0db"/>
    <circle cx="215" cy="201" r="4" fill="#243730"/>
    <path d="M224 200l15 8-16 4Z" fill="#243730"/>
    <text x="28" y="412" font-size="28" font-family="Georgia,serif" fill="#20372f">${card.title}</text>
    <text x="28" y="439" font-size="10" letter-spacing="1.8" fill="#58625b">AN IMAGINED COLLECTIBLE</text>
    <text x="28" y="476" font-size="10" fill="#58625b">${card.number}</text>` : `
    <rect x="28" y="72" width="304" height="370" rx="3" fill="#263d39"/>
    <circle cx="180" cy="231" r="97" fill="none" stroke="${card.color}"/>
    <circle cx="180" cy="231" r="75" fill="none" stroke="${card.color}"/>
    <path d="M180 135l65 145H115Z" fill="none" stroke="${card.color}" stroke-width="2"/>
    <path d="M180 327l-65-145h130Z" fill="none" stroke="${card.color}" stroke-width="2"/>
    <text x="180" y="374" font-size="14" letter-spacing="6" text-anchor="middle" fill="#eee9dc">ATLAS</text>
    <text x="180" y="398" font-size="9" letter-spacing="2" text-anchor="middle" fill="${card.color}">REVIEW STUDY</text>
    <text x="28" y="476" font-size="10" fill="#58625b">${card.number}</text>`;
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="504" viewBox="0 0 360 504"><rect width="360" height="504" rx="12" fill="#f3efdf"/><rect x="12" y="12" width="336" height="480" rx="6" fill="none" stroke="#c8c6b7"/><text x="28" y="44" font-size="10" letter-spacing="2.2" fill="#58625b" font-family="sans-serif">SYNTHETIC · ${side}</text>${art}<text x="332" y="476" text-anchor="end" font-family="sans-serif" font-size="8" fill="#58625b">NOT A REAL CARD</text></svg>`);
}

export const FIXTURE_CARDS = cards;
export function fixtureArtwork(sourceRef) {
    if (typeof sourceRef !== 'string' || !/^sample-00[123]:(FRONT|BACK)$/.test(sourceRef)) throw new Error('FIXTURE_ASSET_NOT_FOUND');
    const [id, side] = sourceRef.split(':');
    const card = cards.find(c => c.id === id);
    if (!card || (side === 'BACK' && card.missingBack)) throw new Error('FIXTURE_ASSET_NOT_FOUND');
    return sourceSvg(card, side);
}
