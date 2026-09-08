import { useEffect, useState } from 'react';
const messages = {
    SIGN_IN_NOT_AVAILABLE: 'Sign-in is not available for these details.',
    USE_INTERNATIONAL_PHONE: 'Enter the full number with a country code, such as +1.',
    CODE_NOT_ACCEPTED: 'That code was not accepted. Check the code and try again.',
    SIGN_IN_SESSION_EXPIRED: 'Your sign-in session expired. Reload to start again.',
    SIGN_IN_RESTART_REQUIRED: 'This attempt could not be confirmed. Wait five minutes, then start again.',
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
    REQUEST_CONFLICT: 'This request changed during retry. Reload the latest state before continuing.'
};
export async function api(path, { body, csrf, signal } = {}) {
    const response = await fetch(`/api/staff/${path}`, { method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', cache: 'no-store', signal,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(messages[data.error] ?? 'The request could not be completed. Your unsaved notes are kept.');
        error.code = data.error;
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
