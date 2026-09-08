// One controller survives page changes (and module replacement) on this window.
// History metadata is bookkeeping only; it conveys no staff or job authority.
const SLOT = Symbol.for('atlas.pending-navigation.controller.v1');
export const HISTORY_MARK = '__atlasPendingNavigation';
const MESSAGE = 'Resolve the retained request or helper operation before leaving this workspace. Sign-in can open in another tab.';
const objectState = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const marker = (state,href) => {
    const value = state?.[HISTORY_MARK];
    return value?.version === 1 && typeof value.session === 'string' && value.session.length <= 100
        && Number.isSafeInteger(value.index) && value.href===href ? value : null;
};
const samePage = (a,b) => { try { const x=new URL(a,b),y=new URL(b);return x.origin===y.origin&&x.pathname===y.pathname&&x.search===y.search; } catch { return false; } };

function controllerFor({ window, document, router }) {
    if (window[SLOT]) {
        if (window[SLOT].router !== router) throw new Error('The pending navigation controller requires the same Pages Router.');
        return window[SLOT];
    }
    const subscribers=new Set(),owners=new Set(),history=window.history;
    const originalPush=history.pushState,originalReplace=history.replaceState;
    // Next 14 exposes one beforePopState callback. Preserve its existing owner;
    // the pinned implementation updates _key immediately before this callback.
    const nextRouter=router.router??router,previousBeforePop=nextRouter._bps;
    let serial=0,settled,restoring=false,detached=false,restoreTimer=null,disposed=false;
    const newSession=()=>window.crypto?.randomUUID?.() ?? `atlas-${Date.now()}-${++serial}`;
    const currentMarker=()=>marker(history.state,window.location.href);
    const snapshot=()=>({href:window.location.href,mark:currentMarker()});
    const stamp=(state,mark)=>({...objectState(state),[HISTORY_MARK]:mark});
    const pending=()=>[...subscribers].filter(s=>s.isPending());
    const notify=(unknown=false)=>{
        const message=unknown ? `${MESSAGE} The browser address currently differs from the retained workspace. Use Back/Forward to return to ${settled.href}. This untracked history entry has no reliable traversal index; it has not been changed.` : MESSAGE;
        for(const owner of owners)owner.onBlocked?.(message);
        for(const subscriber of pending())subscriber.onBlocked?.(message);
    };
    const tagCurrent=()=>{
        let mark=currentMarker();
        // Native fragment navigation can copy the previous history state while
        // creating another entry. Its copied marker is not valid for the new
        // URL: start an unknown boundary instead of duplicating its index.
        if(!mark){mark={version:1,session:newSession(),index:0,href:window.location.href};originalReplace.call(history,stamp(history.state,mark),'',window.location.href);}
        return mark;
    };
    tagCurrent();settled=snapshot();
    const atSettled=()=>{
        const mark=currentMarker();
        return mark && mark.session===settled.mark.session && mark.index===settled.mark.index && window.location.href===settled.href;
    };
    const clearRestoration=()=>{if(restoreTimer!==null)window.clearTimeout(restoreTimer);restoreTimer=null;restoring=false;};
    const restore=()=>{
        if(atSettled()){clearRestoration();detached=false;return;}
        const target=currentMarker(),saved=settled.mark;
        if(!target||target.session!==saved.session||target.index===saved.index){clearRestoration();detached=true;notify(true);return;}
        // A pop already selected another entry. Return to the retained entry;
        // never replace or delete the destination or copy its Next key.
        restoring=true;detached=false;
        if(restoreTimer!==null)window.clearTimeout(restoreTimer);
        restoreTimer=window.setTimeout(()=>{restoreTimer=null;restoring=false;detached=!atSettled();if(detached)notify(true);},2000);
        try{history.go(saved.index-target.index);}catch{clearRestoration();detached=true;notify(true);}
    };
    const blockCommit=(url,routeProps={shallow:false})=>{
        if(!pending().length&&!restoring&&!detached)return;
        if(!restoring&&!detached&&samePage(url,settled.href))return;
        if(!atSettled())restore();
        notify(detached);
        const error=Object.assign(new Error(MESSAGE),{cancelled:true});
        // Installed Next 14 catches cancellation thrown from beforeHistoryChange.
        // routeChangeStart and hashChangeStart are outside that try/catch.
        router.events.emit('routeChangeError',error,url,routeProps);throw error;
    };
    const push=function(state,title,url){
        const current=tagCurrent();
        return originalPush.call(history,stamp(state,{...current,index:current.index+1,href:new URL(url??window.location.href,window.location.href).href}),title,url);
    };
    const replace=function(state,title,url){return originalReplace.call(history,stamp(state,{...tagCurrent(),href:new URL(url??window.location.href,window.location.href).href}),title,url);};
    history.pushState=push;history.replaceState=replace;
    const complete=()=>{if(restoring||detached)return;tagCurrent();settled=snapshot();};
    const inspectPop=()=>{
        if(restoring||detached){
            if(atSettled()){clearRestoration();detached=false;}else restore();
            return false;
        }
        if(pending().length&&!samePage(window.location.href,settled.href)){
            notify();restore();return false;
        }
        // Otherwise Next may load asynchronously. Keep the rendered entry as
        // settled until completion so a late pending request can restore it.
        return true;
    };
    const beforePop=state=>inspectPop()&&(previousBeforePop?previousBeforePop(state):true);
    router.beforePopState(beforePop);
    const pop=event=>{
        // Next-owned entries reach beforePopState after Next updates its key.
        // Do not suppress that update during compensating traversal. Unknown
        // entries otherwise bypass Next's callback and need capture protection.
        if(event.state?.__N&&!event.state?.__NA){
            // Next's initial-SSR same-page shortcut can return before its
            // beforePopState callback. Let Next update its key, then finish
            // restoration if that callback was skipped (no route is needed).
            if((restoring||detached)&&atSettled())Promise.resolve().then(()=>{
                if(!disposed&&(restoring||detached)&&atSettled()){clearRestoration();detached=false;}
            });
            return;
        }
        if(!inspectPop())event.stopImmediatePropagation();
    };
    const hash=()=>{
        if(restoring||detached)return;
        if(samePage(window.location.href,settled.href))complete();
    };
    const beforeUnload=event=>{if(pending().length){event.preventDefault();event.returnValue='';}};
    const click=event=>{
        const link=event.target?.closest?.('a[href]');
        if(!pending().length||!link||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey
            ||link.target==='_blank'||link.hasAttribute?.('download')||!detached&&!restoring&&samePage(link.href,settled.href))return;
        event.preventDefault();event.stopImmediatePropagation();notify(detached);
    };
    window.addEventListener('popstate',pop,true);window.addEventListener('hashchange',hash);
    window.addEventListener('beforeunload',beforeUnload);document.addEventListener('click',click,true);
    router.events.on('beforeHistoryChange',blockCommit);router.events.on('routeChangeComplete',complete);router.events.on('hashChangeComplete',complete);
    const cleanup=()=>{
        if(owners.size||subscribers.size||disposed)return;disposed=true;clearRestoration();
        window.removeEventListener('popstate',pop,true);window.removeEventListener('hashchange',hash);
        window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('click',click,true);
        router.events.off('beforeHistoryChange',blockCommit);router.events.off('routeChangeComplete',complete);router.events.off('hashChangeComplete',complete);
        if(nextRouter._bps===beforePop)router.beforePopState(previousBeforePop??(()=>true));
        if(history.pushState===push)history.pushState=originalPush;if(history.replaceState===replace)history.replaceState=originalReplace;
        if(window[SLOT]===controller)delete window[SLOT];
    };
    const register=(set,value)=>{set.add(value);let removed=false;return()=>{if(removed)return;removed=true;set.delete(value);cleanup();};};
    const controller={router,own:value=>register(owners,value),subscribe:value=>register(subscribers,value)};
    window[SLOT]=controller;return controller;
}

// _app owns one controller before page passive effects register pending panels.
export function installPendingNavigationController(options){return controllerFor(options).own({onBlocked:options.onBlocked});}
// Kept as the panel API: registrations share the central native/router handlers.
export function installPendingNavigationGuard(options){return controllerFor(options).subscribe({isPending:options.isPending,onBlocked:options.onBlocked});}
