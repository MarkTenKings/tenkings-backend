import { useEffect, useRef, useState } from 'react';
import { api } from './client';

const paths = { assigned: 'cards', workspace: 'workspace' };
const loading = () => ({ loading: true, data: null, session: null, error: '', signedOut: false });
const initial = () => ({ assigned: loading(), workspace: loading() });
const signInRequired = () => Object.assign(new Error('Your session ended. Sign in again to continue.'), { code: 'SIGN_IN_REQUIRED' });
const failed = error => ({ loading: false, data: null, session: null, signedOut: error?.code === 'SIGN_IN_REQUIRED',
    error: error?.code === 'REQUEST_OUTCOME_UNCONFIRMED' ? 'The reply could not be confirmed. Reload this list to try again.'
        : error?.code === 'TEMPORARILY_UNAVAILABLE' ? 'The service is temporarily unavailable. Reload to try again.'
            : error?.message || 'This list could not be loaded. Reload to try again.' });

/** One dashboard load owns one fresh session check. Reads are ordered because
 * the staff database serializes authorization transactions. There is no cached
 * session authority or automatic retry. Cancelled or late replies never update
 * the view; aborting a read does not prove that server work stopped. */
export function useGradingQueue(staffId) {
    const [state, setState] = useState(initial);
    const [request, setRequest] = useState({ target: 'all', generation: 0 });
    const active = useRef(null), owner = useRef(staffId);
    useEffect(() => {
        const controller = new AbortController(); active.current = controller;
        const targets = request.target === 'all' || owner.current !== staffId ? ['workspace', 'assigned'] : [request.target];
        owner.current = staffId;
        setState(previous => ({ ...previous, ...Object.fromEntries(targets.map(target => [target, loading()])) }));
        const fail = (targets, error) => {
            if (controller.signal.aborted) return;
            const value = failed(error);
            // Expired access invalidates both views, including a previously
            // successful one retained while the other list was reloaded.
            setState(previous => ({ ...previous, ...Object.fromEntries((value.signedOut ? Object.keys(paths) : targets).map(target => [target, value])) }));
        };
        (async () => {
            let session;
            try {
                session = await api('session', { signal: controller.signal });
                if (controller.signal.aborted) return;
                if (!session?.staff || session.staff.id !== staffId) throw signInRequired();
            } catch (error) { fail(targets, error); return; }
            // Show the active waiting queue before a slow assigned-report read.
            for (const target of targets) {
                if (controller.signal.aborted) return;
                try {
                    const data = await api(paths[target], { signal: controller.signal });
                    if (controller.signal.aborted) return;
                    if (!Array.isArray(data?.cards)) throw new Error('The saved card list could not be confirmed. Reload to try again.');
                    setState(previous => ({ ...previous, [target]: { loading: false, data, session, error: '', signedOut: false } }));
                } catch (error) {
                    fail([target], error);
                    if (error?.code === 'SIGN_IN_REQUIRED') return;
                }
            }
        })();
        return () => { controller.abort(); if (active.current === controller) active.current = null; };
    }, [request, staffId]);
    useEffect(() => {
        const hide = () => { active.current?.abort(); setState(initial()); };
        const show = event => { if (event.persisted) setRequest(previous => ({ target: 'all', generation: previous.generation + 1 })); };
        window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
        return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
    }, []);
    const reload = target => {
        // Cancelling an initial load must also restart its unfinished list.
        const next = Object.entries(state).some(([name, value]) => name !== target && value.loading) ? 'all' : target;
        active.current?.abort();
        setRequest(previous => ({ target: next, generation: previous.generation + 1 }));
    };
    return { resource: { ...state.workspace, reload: () => reload('workspace') }, assigned: { ...state.assigned, reload: () => reload('assigned') } };
}
