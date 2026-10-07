import { deny, hash } from './policy.mjs';
import { SIDES, validateDraft } from './review-contract.mjs';
import { FIXTURE_CARDS as cards, fixtureArtwork } from '@atlas/report-view/fixture-artwork';
export class LocalReviewStore {
    constructor({ now = Date.now } = {}) {
        this.now = now;
        this.cards = new Map(cards.map(card => {
            const evidence = Object.fromEntries(SIDES.map(side => [side, side === 'BACK' && card.missingBack ? null : fixtureArtwork(`${card.id}:${side}`)]));
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
