export const STAGES = Object.freeze([
    ['SUBMITTED', 'Submission created'], ['RECEIVED', 'Cards received'], ['GRADING', 'Grading'],
    ['FINAL_REVIEW', 'Final review'], ['APPROVED', 'Report approved'], ['ENCAPSULATED', 'Encapsulation'], ['SHIPPED', 'Shipped'],
]);
export function summary(cards) {
    const counts = new Map(STAGES.map(([key]) => [key, 0]));
    for (const card of cards) if (counts.has(card.stage)) counts.set(card.stage, counts.get(card.stage) + 1);
    return STAGES.filter(([key]) => counts.get(key)).map(([key, label]) => ({ stage: key, label, count: counts.get(key) }));
}
export function milestones(card) {
    return STAGES.map(([kind, label]) => ({ kind, label, recordedAt: card.events.find(event => event.kind === kind)?.recordedAt ?? null }));
}
