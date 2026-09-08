import { randomUUID } from 'node:crypto';
import { deny, hash } from '../policy.mjs';
import { canonical, SIDES, validateDraft } from '../review-contract.mjs';
import { gradingView } from './reports.mjs';
const uuid = value => {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) deny(404, 'CARD_NOT_FOUND');
    return value;
};

export class DurableReviewStore {
    constructor({ auth, evidence }) { this.auth = auth; this.evidence = evidence; }
    async assigned(context, cardId) {
        const rows = await context.tx.$queryRaw`SELECT * FROM atlas_staff.lock_assignment(${uuid(cardId)}::uuid, ${context.identity.id}::uuid)`;
        const assignment = rows[0];
        if (!assignment || assignment.revokedAt || assignment.expiresAt <= context.now) deny(404, 'CARD_NOT_FOUND');
        return assignment;
    }
    evidenceRecord(card) {
        if (hash(card.evidenceCanonical) !== card.evidenceHash) deny(503, 'EVIDENCE_UNAVAILABLE');
        const evidence = JSON.parse(card.evidenceCanonical);
        if (canonical(evidence) !== card.evidenceCanonical || !evidence.sides || !SIDES.every(side => Object.hasOwn(evidence.sides, side))) deny(503, 'EVIDENCE_UNAVAILABLE');
        for (const side of SIDES) {
            const entry = evidence.sides[side];
            if (entry !== null && (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.byteCount)
                || entry.byteCount < 1 || entry.byteCount > 50 * 1024 * 1024 || !Number.isSafeInteger(entry.width)
                || !Number.isSafeInteger(entry.height) || entry.width < 1 || entry.height < 1 || typeof entry.sourceRef !== 'string'
                || !['image/svg+xml', 'image/jpeg', 'image/png', 'image/webp'].includes(entry.contentType))) deny(503, 'EVIDENCE_UNAVAILABLE');
            if (entry?.contentType === 'image/svg+xml' && card.sourceType !== 'LOCAL_FIXTURE') deny(503, 'EVIDENCE_UNAVAILABLE');
        }
        return evidence;
    }
    revisionRecord(row) {
        if (!row || hash(row.canonical) !== row.contentHash) deny(503, 'DRAFT_UNAVAILABLE');
        const draft = JSON.parse(row.canonical);
        if (canonical(draft) !== row.canonical || draft.revision !== row.revision || draft.evidenceHash !== row.evidenceHash
            || draft.evidenceRevision !== row.evidenceRevision) deny(503, 'DRAFT_UNAVAILABLE');
        return draft;
    }
    async view(context, card, assignment) {
        const evidence = this.evidenceRecord(card);
        const row = await context.tx.staffReviewRevision.findUnique({ where: { specimenId_revision: { specimenId: card.id, revision: card.draftRevision } } });
        const history = await context.tx.staffReviewRevision.findMany({ where: { specimenId: card.id, revision: { lt: card.draftRevision } }, orderBy: { revision: 'desc' }, take: 100 });
        return { id: card.id, title: card.title, set: card.subtitle, number: '', category: card.sourceType === 'LOCAL_FIXTURE' ? 'Illustration' : 'Card',
            evidenceRevision: card.evidenceRevision, evidenceHash: card.evidenceHash, draft: this.revisionRecord(row), reviewHash: row.contentHash,
            grading: await gradingView(context, card, assignment, this.revisionRecord(row)),
            canEdit: context.identity.role === 'REVIEWER' && assignment.canReview, assignmentFence: assignment.fence,
            sides: SIDES.map(side => ({ side, available: Boolean(evidence.sides[side]), sha256: evidence.sides[side]?.sha256 ?? null,
                width: evidence.sides[side]?.width ?? null, height: evidence.sides[side]?.height ?? null })),
            history: history.map(row => { const draft = this.revisionRecord(row); return { revision: draft.revision, disposition: draft.disposition, savedAt: draft.savedAt, savedBy: draft.savedBy }; }),
            olderHistoryAvailable: card.draftRevision > history.length + 1 };
    }
    async list(staff) {
        return this.auth.withStaff(staff, async context => {
            const assignments = await context.tx.staffAssignment.findMany({ where: { identityId: context.identity.id, revokedAt: null, expiresAt: { gt: context.now } }, include: { specimen: true }, orderBy: { specimenId: 'asc' }, take: 100 });
            return Promise.all(assignments.map(async assignment => {
                const card = assignment.specimen, evidence = this.evidenceRecord(card);
                const row = await context.tx.staffReviewRevision.findUnique({ where: { specimenId_revision: { specimenId: card.id, revision: card.draftRevision } } });
                const publication = await context.tx.staffPublicReport.findUnique({ where: { specimenId: card.id } });
                const approval = publication ? await context.tx.staffReportApproval.findUnique({ where: { id: publication.currentApprovalId } }) : null;
                const approved = approval?.analysisRevision === card.analysisRevision && approval?.reviewRevision === card.draftRevision && approval?.evidenceHash === card.evidenceHash;
                return { id: card.id, title: card.title, set: card.subtitle, number: '', category: card.sourceType === 'LOCAL_FIXTURE' ? 'Illustration' : 'Card',
                    disposition: approved ? 'HUMAN_APPROVED' : this.revisionRecord(row).disposition, evidenceComplete: Boolean(evidence.sides.FRONT && evidence.sides.BACK), revision: card.draftRevision };
            }));
        });
    }
    async read(staff, cardId) {
        return this.auth.withStaff(staff, async context => {
            const assignment = await this.assigned(context, cardId);
            const card = await context.tx.staffSpecimen.findUnique({ where: { id: cardId } });
            if (!card) deny(404, 'CARD_NOT_FOUND');
            return this.view(context, card, assignment);
        });
    }
    async asset(staff, cardId, side) {
        if (!SIDES.includes(side)) deny(404, 'EVIDENCE_NOT_FOUND');
        const binding = await this.auth.withStaff(staff, async context => {
            const assignment = await this.assigned(context, cardId);
            const card = await context.tx.staffSpecimen.findUnique({ where: { id: cardId } });
            if (!card) deny(404, 'CARD_NOT_FOUND');
            const descriptor = this.evidenceRecord(card).sides[side];
            if (!descriptor) deny(404, 'EVIDENCE_NOT_FOUND');
            return { cardId, sourceType: card.sourceType, sourceId: card.sourceId, sourceOwnerId: card.sourceOwnerId,
                evidenceHash: card.evidenceHash, assignmentFence: assignment.fence, side, descriptor };
        });
        // The injected server port accepts this bound record, never a browser URL.
        const bytes = Buffer.from(await this.evidence.read(binding));
        if (bytes.length !== binding.descriptor.byteCount || hash(bytes) !== binding.descriptor.sha256) deny(503, 'EVIDENCE_UNAVAILABLE');
        await this.auth.withStaff(staff, async context => {
            const assignment = await this.assigned(context, cardId);
            const card = await context.tx.staffSpecimen.findUnique({ where: { id: cardId } });
            if (!card || card.evidenceHash !== binding.evidenceHash || assignment.fence !== binding.assignmentFence) deny(409, 'EVIDENCE_CHANGED');
        });
        return { bytes, contentType: binding.descriptor.contentType };
    }
    async save(staff, cardId, input) {
        return this.auth.withStaff(staff, async context => {
            const { tx, identity, now } = context;
            const assignment = await this.assigned(context, cardId);
            if (identity.role !== 'REVIEWER' || !assignment.canReview) deny(403, 'REVIEW_PERMISSION_REQUIRED');
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id = ${cardId}::uuid FOR UPDATE`;
            const card = rows[0];
            if (!card) deny(404, 'CARD_NOT_FOUND');
            const evidence = this.evidenceRecord(card); validateDraft(input, evidence.sides);
            const inputHash = hash(canonical({ cardId, input }));
            const prior = await tx.staffOperation.findUnique({ where: { identityId_operationId: { identityId: identity.id, operationId: input.operationId } } });
            if (prior && (prior.inputHash !== inputHash || prior.specimenId !== cardId)) deny(409, 'REQUEST_CONFLICT');
            if (card.evidenceHash !== input.evidenceHash || card.evidenceRevision !== input.evidenceRevision) deny(409, 'EVIDENCE_CHANGED');
            if (prior) {
                if (card.draftRevision !== prior.revision) deny(409, 'DRAFT_CHANGED');
                return this.view(context, card, assignment);
            }
            if (card.draftRevision !== input.expectedRevision) deny(409, 'DRAFT_CHANGED');
            const draft = { revision: card.draftRevision + 1, evidenceRevision: card.evidenceRevision, evidenceHash: card.evidenceHash,
                observations: input.observations, reviewedSides: input.reviewedSides, identityReviewed: input.identityReviewed,
                disposition: input.disposition, savedAt: now.toISOString(), savedBy: identity.name };
            const content = canonical(draft);
            await tx.staffReviewRevision.create({ data: { specimenId: cardId, revision: draft.revision, evidenceRevision: card.evidenceRevision,
                evidenceHash: card.evidenceHash, analysisRevision: card.analysisRevision, contentHash: hash(content), canonical: content, savedById: identity.id, savedAt: now } });
            await tx.staffSpecimen.update({ where: { id: cardId }, data: { draftRevision: draft.revision } });
            await tx.staffOperation.create({ data: { identityId: identity.id, operationId: input.operationId, specimenId: cardId, inputHash, revision: draft.revision, createdAt: now } });
            await tx.staffAudit.create({ data: { id: randomUUID(), event: 'REVIEW_DRAFT_SAVED', subjectId: cardId, actorId: identity.id,
                details: canonical({ revision: draft.revision, evidenceHash: card.evidenceHash, assignmentFence: assignment.fence }) } });
            return this.view(context, { ...card, draftRevision: draft.revision }, assignment);
        });
    }
}
