import { useEffect, useState } from 'react';
import { staffClientRequest } from './client-request.mjs';
const messages = {
    SIGN_IN_NOT_AVAILABLE: 'Sign-in is not available for these details.',
    USE_INTERNATIONAL_PHONE: 'Enter the full number with a country code, such as +1.',
    CODE_NOT_ACCEPTED: 'That code was not accepted. Check the code and try again.',
    SIGN_IN_SESSION_EXPIRED: 'Your sign-in session expired. Reload to start again.',
    SIGN_IN_RESTART_REQUIRED: 'This attempt could not be confirmed. Please wait before starting a new sign-in attempt.',
    PLEASE_WAIT: 'Please wait before trying again.',
    DRAFT_CHANGED: 'A newer draft was saved. Your notes are still here. Reload the latest draft to continue.',
    EVIDENCE_CHANGED: 'The evidence changed. Your notes are still here. Reload the card before continuing.',
    REVIEW_CHECKLIST_REQUIRED: 'Review the identity and both sides before marking this ready for human review.',
    EVIDENCE_REQUIRED: 'Both evidence sides must be available for a complete review.',
    SIGN_IN_REQUIRED: 'Your session ended. Sign in again to continue.',
    CSRF_REQUIRED: 'Your session changed. Reload before saving.',
    STAFF_ACCESS_NOT_ENABLED: 'Staff access is not enabled in this environment.',
    CARD_NOT_FOUND: 'This card is not available in your assigned queue.',
    REVIEW_PERMISSION_REQUIRED: 'This staff identity has read-only access.',
    REQUEST_CONFLICT: 'This request changed during retry. Reload the latest state before continuing.',
    GRADING_NOT_READY: 'The graded report is not ready yet.',
    GRADING_NOT_ENABLED: 'Grading corrections are waiting for the approved pilot and service connection.',
    PILOT_NOT_ACTIVE: 'This card is outside the active ten-card pilot or its test window has ended.',
    PILOT_BUDGET_EXHAUSTED: 'The pilot has reached its reserved cost limit. Review costs before starting more work.',
    PREPARATION_RELEASE_NOT_ADMITTED: 'This capture needs the approved preparation release before grading can start.',
    SOURCE_REVISION_CHANGED: 'The source capture or grading result changed. Intake needs to reconcile this card.',
    GRADING_OUTCOME_UNCONFIRMED: 'This grading result needs reconciliation. The same work will not be started again.',
    BRIDGE_OUTCOME_UNCONFIRMED: 'The grading connection lost its reply. Check the recorded operation before continuing.',
    INVALID_GRADING_ACTION: 'This correction is incomplete or exceeds the supported limits.',
    TRACE_NOT_FOUND: 'This finding has an outline rather than a saved pixel trace.',
    GRADING_WORK_UNRESOLVED: 'A grading operation still needs to finish or be resolved.',
    MACHINE_PROPOSALS_UNRESOLVED: 'Review and resolve every Astra proposal before approving this report.',
    SAVE_PROPOSED_CORRECTION_FIRST: 'Save this correction using the grading controls before accepting its proposal.',
    PROPOSAL_ALREADY_RESOLVED: 'This proposal was already resolved. Reload the current report.',
    GRADING_POLICY_CHANGED: 'This analysis needs to be checked against the current grading release.',
    TRAINED_REVIEWER_REQUIRED: 'An assigned reviewer with current certification training must approve this report.',
    FRESH_SIGN_IN_REQUIRED: 'Sign in again before approving this report. Approval requires a recent sign-in.',
    ALREADY_APPROVED: 'This exact report and review have already been approved.',
    REPORT_UNAVAILABLE: 'The report could not be verified. Reload before continuing.'
};
export const approvalMessage = code => messages[code] ?? 'Save and review this report before approving.';
export async function api(path, { body, csrf, signal } = {}) {
    const response = await staffClientRequest(path, { body, csrf, signal });
    const { data } = response;
    if (!response.ok) {
        const error = new Error(messages[data.error] ?? 'The request could not be completed. Your unsaved notes are kept.');
        error.code = data.error;
        error.status = response.status;
        throw error;
    }
    return data;
}
export function useStaffResource(path) {
    const [state, setState] = useState({ loading: true, data: null, session: null, error: '', signedOut: false });
    const [generation, setGeneration] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setState({ loading: true, data: null, session: null, error: '', signedOut: false });
        Promise.all([api('session', { signal: controller.signal }), api(path, { signal: controller.signal })]).then(([session, data]) => {
            if (!controller.signal.aborted)
                setState({ loading: false, data, session, error: '', signedOut: !session.staff });
        }).catch(error => {
            if (!controller.signal.aborted)
                setState({ loading: false, data: null, session: null, error: error.message, signedOut: error.code === 'SIGN_IN_REQUIRED' });
        });
        return () => controller.abort();
    }, [path, generation]);
    useEffect(() => {
        const hide = () => setState(s => ({ ...s, loading: true, data: null, session: null }));
        const show = event => { if (event.persisted)
            setGeneration(g => g + 1); };
        window.addEventListener('pagehide', hide);
        window.addEventListener('pageshow', show);
        return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
    }, []);
    return { ...state, reload: () => setGeneration(g => g + 1) };
}
