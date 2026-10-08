export const FIXTURE_GRADING_POLICY: string;
export function fixtureAnalysis(card: { title: string; set: string }, evidenceHash: string, options?: { traces?: boolean }): {
    revision: number;
    evidenceHash: string;
    sourceCanonical: string;
    sourceHash: string;
    reportCanonical: string;
    reportHash: string;
    admissionCanonical: string;
    admissionHash: string;
    sourceRevision: string;
    mode: 'LOCAL_FIXTURE';
};
