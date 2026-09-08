import { deny, hash } from './policy.mjs';
import { SIDES, validateDraft } from './review-contract.mjs';
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
export class LocalReviewStore {
    constructor({ now = Date.now } = {}) {
        this.now = now;
        this.cards = new Map(cards.map(card => {
            const evidence = Object.fromEntries(SIDES.map(side => [side, side === 'BACK' && card.missingBack ? null : sourceSvg(card, side)]));
            const evidenceHash = hash(SIDES.map(side => `${side}:${evidence[side] ? hash(evidence[side]) : 'MISSING'}`).join('|'));
            const draft = { revision: 1, evidenceRevision: 1, evidenceHash, observations: { FRONT: '', BACK: '' }, reviewedSides: [], identityReviewed: false, disposition: card.state, savedAt: null, savedBy: null };
            return [card.id, { ...card, evidence, evidenceHash, evidenceRevision: 1, draft, history: [], operations: new Map() }];
        }));
        this.assignments = new Map([['fixture-reviewer', new Set(cards.map(c => c.id))], ['fixture-observer', new Set(['sample-002'])]]);
    }
    assigned(staff, cardId) {
        if (!staff || staff.mode !== 'SYNTHETIC' || !this.assignments.get(staff.id)?.has(cardId))
            deny(404, 'CARD_NOT_FOUND');
        const card = this.cards.get(cardId);
        if (!card)
            deny(404, 'CARD_NOT_FOUND');
        return card;
    }
    list(staff) {
        return [...(this.assignments.get(staff.id) ?? [])].map(id => {
            const c = this.assigned(staff, id);
            return { id: c.id, title: c.title, set: c.set, number: c.number, category: c.category, disposition: c.draft.disposition, evidenceComplete: Boolean(c.evidence.FRONT && c.evidence.BACK), revision: c.draft.revision };
        });
    }
    read(staff, cardId) {
        const c = this.assigned(staff, cardId);
        return structuredClone({ id: c.id, title: c.title, set: c.set, number: c.number, category: c.category,
            evidenceRevision: c.evidenceRevision, evidenceHash: c.evidenceHash, draft: c.draft,
            sides: SIDES.map(side => ({ side, available: Boolean(c.evidence[side]), sha256: c.evidence[side] ? hash(c.evidence[side]) : null, width: c.evidence[side] ? 360 : null, height: c.evidence[side] ? 504 : null })),
            canEdit: staff.role === 'REVIEWER', history: c.history.map(d => ({ revision: d.revision, disposition: d.disposition, savedAt: d.savedAt, savedBy: d.savedBy })) });
    }
    asset(staff, cardId, side) {
        const c = this.assigned(staff, cardId);
        if (!SIDES.includes(side) || !c.evidence[side])
            deny(404, 'EVIDENCE_NOT_FOUND');
        return Buffer.from(c.evidence[side]);
    }
    save(staff, cardId, input) {
        const c = this.assigned(staff, cardId);
        if (staff.role !== 'REVIEWER')
            deny(403, 'REVIEW_PERMISSION_REQUIRED');
        validateDraft(input, c.evidence);
        const operationKey = `${staff.id}:${input.operationId}`;
        const payloadHash = hash(JSON.stringify(input));
        const prior = c.operations.get(operationKey);
        if (prior && prior.payloadHash !== payloadHash)
            deny(409, 'REQUEST_CONFLICT');
        if (input.evidenceRevision !== c.evidenceRevision || input.evidenceHash !== c.evidenceHash)
            deny(409, 'EVIDENCE_CHANGED');
        if (prior) {
            if (c.draft.revision !== prior.revision)
                deny(409, 'DRAFT_CHANGED');
            return this.read(staff, cardId);
        }
        if (input.expectedRevision !== c.draft.revision)
            deny(409, 'DRAFT_CHANGED');
        if (c.history.length >= 200)
            deny(409, 'FIXTURE_HISTORY_LIMIT');
        // Synchronous CAS: never await between current-revision comparison and append.
        c.history.push(structuredClone(c.draft));
        c.draft = { revision: c.draft.revision + 1, evidenceRevision: c.evidenceRevision, evidenceHash: c.evidenceHash,
            observations: { ...input.observations }, reviewedSides: [...input.reviewedSides], identityReviewed: input.identityReviewed,
            disposition: input.disposition, savedAt: new Date(this.now()).toISOString(), savedBy: staff.name };
        c.operations.set(operationKey, { payloadHash, revision: c.draft.revision });
        return this.read(staff, cardId);
    }
}
