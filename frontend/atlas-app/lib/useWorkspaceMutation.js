import { useEffect, useRef, useState } from 'react';
import { usePendingNavigation } from './usePendingNavigation';
import { checkedCardRefresh, checkedCardResult, freshWorkspaceAccess, isNotDispatched, makePending, workspaceCardPath, workspaceMessage, workspaceRequest } from './workspace-client.mjs';
import { createWorkspaceJournal } from './workspace-drafts.mjs';

export function useWorkspaceMutation({ staffId, cardId, csrf, onCard }) {
    const scopeRef = useRef(null), callback = useRef(onCard);
    callback.current = onCard;
    const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [errorCode, setErrorCode] = useState(null), [ready, setReady] = useState(false), [reconciling, setReconciling] = useState(false);
    useEffect(() => {
        const scope = { active: true, ready: false, saved: null, working: false, journal: null, controller: null };
        scopeRef.current = scope; setReady(false); setBusy(false); setError(''); setErrorCode(null); setPending(null); setReconciling(false);
        try { scope.journal = createWorkspaceJournal(staffId, cardId); scope.saved = scope.journal.read(); scope.ready = true; setPending(scope.saved); setReady(true); }
        catch (cause) { setError(cause.message); }
        return () => { scope.active = false; scope.controller?.abort(); };
    }, [staffId, cardId]);
    // Settled browser requests remain durable in the journal. They do not trap
    // the user on this page or force sign-in into a second tab.
    usePendingNavigation(() => Boolean(scopeRef.current?.working), setError);
    const retain = (scope, value) => { scope.journal.write(value); scope.saved = value; if (scope.active) setPending(value); };
    async function execute(request, refresh) {
        const scope = scopeRef.current;
        if (!scope?.active || !scope.ready || scope.working) return null;
        scope.working = true; scope.controller = new AbortController(); setBusy(true); setError(''); setErrorCode(null); setReconciling(refresh);
        try {
            if (!scope.saved) retain(scope, request);
            const current = scope.saved;
            // One bounded reconciliation follows an uncertain reply. Every
            // POST uses the identical durable command, including its ID/body;
            // the server either returns that command or resumes its saved
            // dispatch. No new command is manufactured on timeout or reload.
            for (let attempt = 0; attempt < 2 && scope.active; attempt++) {
                let posted = false;
                try {
                    const access = refresh || attempt ? await freshWorkspaceAccess(path => workspaceRequest(path, { signal: scope.controller.signal })) : { csrf };
                    if (!scope.active) return null;
                    if ((refresh || attempt) && access.staff?.id !== staffId) throw Object.assign(new Error('Sign in with the staff account that started this action.'), { code: 'SIGN_IN_REQUIRED' });
                    posted = true;
                    const result = await workspaceRequest(current.path, { body: current.body, csrf: access.csrf, signal: scope.controller.signal });
                    if (!scope.active) return null;
                    const card = checkedCardResult(result, current);
                    retain(scope, null); callback.current?.(card, result); return card;
                } catch (cause) {
                    if (!scope.active) return null;
                    if (!scope.saved) throw cause;
                    if (posted && isNotDispatched(cause)) {
                        retain(scope, null); setErrorCode(cause.code); setError(workspaceMessage(cause));
                        if (current.cardId && current.path === `${workspaceCardPath(current.cardId)}/claim` && current.body.operator === 'ASTRA') {
                            // Automatic pickup may have claimed this card while
                            // an earlier browser Start was refused. Only after
                            // proven rejection may a normal GET refresh the UI.
                            try {
                                const observed = await workspaceRequest(workspaceCardPath(current.cardId), { signal: scope.controller.signal });
                                if (!scope.active) return null;
                                const card = checkedCardRefresh(observed, current);
                                callback.current?.(card, observed);
                                if (cause.code === 'WORKSPACE_CLAIM_CONFLICT' && card.operator?.kind === 'ASTRA'
                                    && ['IN_PROGRESS', 'NEEDS_ATTENTION', 'HUMAN_REVIEW', 'APPROVED'].includes(card.state)) {
                                    setError(''); setErrorCode(null);
                                }
                            } catch { /* Keep the useful rejection if a refresh is unavailable. */ }
                        }
                        return null;
                    }
                    if (cause.code === 'SIGN_IN_REQUIRED' || cause.code === 'CSRF_REQUIRED' && (refresh || attempt)) {
                        setErrorCode(cause.code); setError(workspaceMessage(cause)); return null;
                    }
                    if (attempt === 0) { setReconciling(true); continue; }
                    setErrorCode(cause.code ?? 'REQUEST_OUTCOME_UNCONFIRMED');
                    setError('This action is still unconfirmed. Check your connection, then return to this page to check the same action automatically.');
                }
            }
        } catch (cause) {
            if (scope.active) { setErrorCode(cause.code ?? null); setError(workspaceMessage(cause)); }
        } finally { scope.working = false; if (scope.active) { setBusy(false); setReconciling(false); } }
        return null;
    }
    useEffect(() => {
        if (!ready) return;
        const scope = scopeRef.current;
        const resume = () => { if (scope.active && scope === scopeRef.current && scope.saved && !scope.working) void execute(scope.saved, true); };
        resume();
        window.addEventListener('online', resume); window.addEventListener('focus', resume);
        return () => { window.removeEventListener('online', resume); window.removeEventListener('focus', resume); };
    }, [ready, staffId, cardId]);
    return { busy, pending, error, errorCode, ready, reconciling, setError,
        mutate(path, body, targetCardId) { if (scopeRef.current?.saved || scopeRef.current?.working || !ready) return Promise.resolve(null); return execute(makePending(path, body, targetCardId), false); },
        recover() { return scopeRef.current?.saved ? execute(scopeRef.current.saved, true) : Promise.resolve(null); }
    };
}
