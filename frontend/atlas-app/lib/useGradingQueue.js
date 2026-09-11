import { useEffect, useRef, useState } from 'react';
import { api } from './client';

const paths = { assigned: 'cards', workspace: 'workspace' };
const loading = () => ({ loading: true, refreshing: false, data: null, session: null, error: '', refreshError: '', signedOut: false, lastUpdatedAt: null });
const initial = () => ({ assigned: loading(), workspace: loading() });
const signInRequired = () => Object.assign(new Error('Your session ended. Sign in again to continue.'), { code: 'SIGN_IN_REQUIRED' });
const failed = error => ({ loading: false, data: null, session: null, signedOut: error?.code === 'SIGN_IN_REQUIRED',
    error: error?.code === 'REQUEST_OUTCOME_UNCONFIRMED' ? 'The reply could not be confirmed. Reload this list to try again.'
        : error?.code === 'TEMPORARILY_UNAVAILABLE' ? 'The service is temporarily unavailable. Reload to try again.'
            : error?.message || 'This list could not be loaded. Reload to try again.' });

/** A complete visible-page refresh owns one fresh session check and ordered
 * workspace/report reads. Background refreshes retain the last saved view.
 * Cancelled replies never update it; abort does not prove server work stopped. */
export function useGradingQueue(staffId) {
    const [state, setState] = useState(initial);
    const [request, setRequest] = useState({ target: 'all', generation: 0, background: false });
    const active = useRef(null), owner = useRef(staffId), timer = useRef(null), suspended = useRef(false), mounted = useRef(true);
    useEffect(() => {
        clearTimeout(timer.current);
        if (request.background && (suspended.current || document.visibilityState === 'hidden')) return undefined;
        const controller = new AbortController(); active.current = controller;
        const sameOwner = owner.current === staffId, background = request.background && sameOwner;
        const targets = request.target === 'all' || !sameOwner ? ['workspace', 'assigned'] : [request.target];
        owner.current = staffId;
        let expired = false;
        setState(previous => ({ ...previous, ...Object.fromEntries(targets.map(target => [target,
            background && previous[target].data ? { ...previous[target], refreshing: true } : loading()])) }));
        const fail = (targets, error) => {
            if (controller.signal.aborted) return;
            const value = failed(error);
            expired = value.signedOut;
            // Expired access invalidates both views, including a previously
            // successful one retained while the other list was reloaded.
            setState(previous => ({ ...previous, ...Object.fromEntries((value.signedOut ? Object.keys(paths) : targets).map(target => [target,
                background && !value.signedOut && previous[target].data
                    ? { ...previous[target], loading: false, refreshing: false, refreshError: value.error }
                    : { ...loading(), ...value, refreshing: false }])) }));
        };
        const load = async () => {
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
                    setState(previous => ({ ...previous, [target]: { loading: false, refreshing: false, data, session,
                        error: '', refreshError: '', signedOut: false, lastUpdatedAt: new Date().toISOString() } }));
                } catch (error) {
                    fail([target], error);
                    if (error?.code === 'SIGN_IN_REQUIRED') return;
                }
            }
        };
        load().finally(() => {
            if (controller.signal.aborted || expired || suspended.current || document.visibilityState === 'hidden') return;
            timer.current = setTimeout(() => setRequest(previous => ({ target: 'all', generation: previous.generation + 1, background: true })), 6000);
        });
        return () => { clearTimeout(timer.current); controller.abort(); if (active.current === controller) active.current = null; };
    }, [request, staffId]);
    useEffect(() => {
        mounted.current = true;
        const hide = () => { clearTimeout(timer.current); active.current?.abort(); setState(initial()); };
        const show = event => { if (event.persisted) setRequest(previous => ({ target: 'all', generation: previous.generation + 1, background: false })); };
        const visibility = () => {
            if (document.visibilityState === 'hidden') { clearTimeout(timer.current); active.current?.abort(); }
            else if (!suspended.current) setRequest(previous => ({ target: 'all', generation: previous.generation + 1, background: true }));
        };
        window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
        document.addEventListener('visibilitychange', visibility);
        return () => { mounted.current = false; clearTimeout(timer.current); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); document.removeEventListener('visibilitychange', visibility); };
    }, []);
    const reload = target => {
        // Cancelling an initial load must also restart its unfinished list.
        const next = Object.entries(state).some(([name, value]) => name !== target && value.loading) ? 'all' : target;
        active.current?.abort();
        setRequest(previous => ({ target: next, generation: previous.generation + 1, background: false }));
    };
    const suspend = () => { suspended.current = true; clearTimeout(timer.current); active.current?.abort(); };
    const resume = () => { suspended.current = false; if (mounted.current) setRequest(previous => ({ target: 'all', generation: previous.generation + 1, background: true })); };
    return { resource: { ...state.workspace, reload: () => reload('workspace') }, assigned: { ...state.assigned, reload: () => reload('assigned') }, suspend, resume };
}
