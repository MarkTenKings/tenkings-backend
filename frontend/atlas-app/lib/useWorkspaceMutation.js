import { useEffect, useRef, useState } from 'react';
import { usePendingNavigation } from './usePendingNavigation';
import { checkedCardResult, freshWorkspaceAccess, isNotDispatched, makePending, workspaceMessage, workspaceRequest } from './workspace-client.mjs';
import { createWorkspaceJournal } from './workspace-drafts.mjs';

export function useWorkspaceMutation({ staffId, cardId, csrf, onCard }) {
    const saved = useRef(null), journal = useRef(null), working = useRef(false), callback = useRef(onCard);
    callback.current = onCard;
    const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [ready, setReady] = useState(false);
    useEffect(() => {
        try { journal.current = createWorkspaceJournal(staffId, cardId); saved.current = journal.current.read(); setPending(saved.current); setReady(true); }
        catch (cause) { setError(cause.message); }
    }, [staffId, cardId]);
    usePendingNavigation(() => working.current || Boolean(saved.current), setError);
    const retain = value => { journal.current.write(value); saved.current = value; setPending(value); };
    async function execute(request, refresh) {
        if (working.current || !ready) return null;
        working.current = true; setBusy(true); setError('');
        try {
            if (!saved.current) retain(request);
            const current = saved.current;
            const access = refresh ? await freshWorkspaceAccess() : { csrf };
            const result = await workspaceRequest(current.path, { body: current.body, csrf: access.csrf });
            const card = checkedCardResult(result, current);
            retain(null);
            callback.current?.(card, result);
            return card;
        } catch (cause) {
            if (isNotDispatched(cause)) {
                try { retain(null); } catch (storageError) { setError(storageError.message); return null; }
            }
            setError(workspaceMessage(cause)); return null;
        } finally { working.current = false; setBusy(false); }
    }
    return { busy, pending, error, ready, setError,
        mutate(path, body, targetCardId) { if (saved.current || working.current || !ready) return Promise.resolve(null); return execute(makePending(path, body, targetCardId), false); },
        recover() { return saved.current ? execute(saved.current, true) : Promise.resolve(null); }
    };
}
